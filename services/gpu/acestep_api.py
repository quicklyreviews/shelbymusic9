"""
PhoneZoo AI Ringtone Generator — Modal GPU Backend
Deploys ACE-Step 1.5 (3.5B) on a T4 GPU via Modal.com serverless.

Storage: controlled by STORAGE_PROVIDER env var in Modal secrets
  - "shelby" → uploads to Shelby testnet (decentralized storage)
  - "r2"     → uploads to Cloudflare R2 (default for production)

Deploy:
  cd services/gpu
  modal deploy acestep_api.py

Test locally:
  modal run acestep_api.py

After deploy, copy the generated endpoint URL to MODAL_ENDPOINT_URL in .env.local
"""

import modal
import os
import io
import time

# ============================================================
# Container image — built once and cached by Modal
# ============================================================
ace_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(["ffmpeg", "libsndfile1", "git"])
    .pip_install([
        "torch==2.2.0",
        "torchaudio==2.2.0",
        "transformers>=4.40.0",
        "diffusers>=0.27.0,<0.32.0",  # 0.32+ needs torch>=2.4 for xpu; 0.27-0.31 fine with 2.2
        "accelerate>=0.28.0",
        "soundfile>=0.12.1",
        "pydub>=0.25.1",
        "numpy<2",               # ace-step compiled for numpy 1.x, numpy 2.x breaks it
        "boto3>=1.34.0",
        "requests>=2.31.0",
        "fastapi[standard]>=0.100.0",
        "huggingface_hub>=0.24.0",
    ])
    .run_commands(
        "pip install git+https://github.com/ace-step/ACE-Step.git || echo 'Warning: ace-step install failed'"
    )
)

# Modal Volume to cache the model weights across cold starts (~7GB)
model_volume = modal.Volume.from_name("phonezoo-model-cache", create_if_missing=True)

app = modal.App("phonezoo-acestep")

# ============================================================
# Model class — loaded once per container, reused across requests
# ============================================================
@app.cls(
    gpu="T4",
    image=ace_image,
    secrets=[modal.Secret.from_name("phonezoo-secrets")],
    volumes={"/model-cache": model_volume},
    scaledown_window=120,  # Keep warm for 2 min after last request
    timeout=300,                 # Max 5 min per generation
)
class ACEStepGenerator:

    @modal.enter()
    def load_model(self):
        """Load ACE-Step model into GPU memory on container start."""
        import torch

        print("[ACEStep] Loading model...")
        start = time.time()

        # Correct import path (confirmed from Modal logs: submodule = pipeline_ace_step)
        from acestep.pipeline_ace_step import ACEStepPipeline

        # float16 is faster than bfloat16 on T4 and numerically equivalent for inference
        self.pipe = ACEStepPipeline.from_pretrained(
            "ACE-Step/ACE-Step-v1.5-3.5B",
            torch_dtype=torch.float16,
            cache_dir="/model-cache",
        )
        # Keep everything on GPU — T4 has 16GB, no need for cpu_offload (which adds latency)
        self.pipe.to("cuda")

        elapsed = time.time() - start
        print(f"[ACEStep] Model loaded in {elapsed:.1f}s")

    @modal.method()
    def generate(self, payload: dict) -> dict:
        """
        Run ACE-Step inference and upload result to R2.
        Returns {status, audio_url, generation_time_ms} on success
        or {status: 'failed', error} on failure.
        """
        import torch
        import soundfile as sf
        import boto3
        import requests

        job_id = payload["job_id"]
        prompt = payload["prompt"]
        lyrics = payload.get("lyrics", "")
        duration = int(payload.get("duration", 30))
        seed = int(payload.get("seed", 42))
        webhook_url = payload["webhook_url"]

        start_ms = int(time.time() * 1000)

        try:
            print(f"[ACEStep] Generating job {job_id}: prompt='{prompt[:60]}', duration={duration}s, seed={seed}")

            # Run ACE-Step inference
            with torch.inference_mode():
                result = self.pipe(
                    prompt=prompt,
                    lyrics=lyrics if lyrics else "",
                    duration=duration,
                    seed=seed,
                    guidance_scale=7.0,
                    num_inference_steps=30,  # 30 vs 60 default: ~2x faster, quality near identical
                )

            # Extract audio array — result format may vary by ACE-Step version
            if hasattr(result, "audio"):
                audio_array = result.audio
                sample_rate = result.sample_rate if hasattr(result, "sample_rate") else 44100
            elif isinstance(result, (list, tuple)):
                audio_array, sample_rate = result[0], result[1] if len(result) > 1 else 44100
            else:
                audio_array = result
                sample_rate = 44100

            # Encode to MP3 via WAV intermediate + pydub
            import numpy as np
            from pydub import AudioSegment

            # Ensure numpy array
            if hasattr(audio_array, "cpu"):
                audio_np = audio_array.cpu().numpy()
            else:
                audio_np = np.array(audio_array)

            # Normalize to int16
            audio_np = audio_np.squeeze()
            if audio_np.dtype != np.int16:
                audio_np = (audio_np / max(np.abs(audio_np).max(), 1e-8) * 32767).astype(np.int16)

            # Write to WAV buffer
            wav_buf = io.BytesIO()
            sf.write(wav_buf, audio_np, sample_rate, format="WAV", subtype="PCM_16")
            wav_buf.seek(0)

            # Convert WAV → MP3 (192kbps) via pydub
            audio_segment = AudioSegment.from_wav(wav_buf)
            mp3_buf = io.BytesIO()
            audio_segment.export(mp3_buf, format="mp3", bitrate="192k")
            mp3_bytes = mp3_buf.getvalue()

            print(f"[ACEStep] Encoded MP3: {len(mp3_bytes) // 1024}KB")

            # Upload to storage (Shelby testnet OR Cloudflare R2)
            storage_provider = os.environ.get("STORAGE_PROVIDER", "r2").lower()

            if storage_provider == "shelby":
                audio_url = _upload_to_shelby(mp3_bytes, job_id)
            else:
                audio_url = _upload_to_r2(mp3_bytes, job_id)

            generation_time_ms = int(time.time() * 1000) - start_ms

            print(f"[ACEStep] Job {job_id} completed in {generation_time_ms}ms → {audio_url}")

            # Notify webhook
            _call_webhook(webhook_url, {
                "job_id": job_id,
                "status": "completed",
                "audio_url": audio_url,
                "audio_size_kb": len(mp3_bytes) // 1024,
                "generation_time_ms": generation_time_ms,
            })

            return {"status": "completed", "audio_url": audio_url, "generation_time_ms": generation_time_ms}

        except Exception as exc:
            import traceback
            tb = traceback.format_exc()
            print(f"[ACEStep] Job {job_id} FAILED: {exc}\n{tb}")

            _call_webhook(webhook_url, {
                "job_id": job_id,
                "status": "failed",
                "error": str(exc),
            })

            return {"status": "failed", "error": str(exc)}


# ============================================================
# Web endpoint — responds immediately, spawns background task
# ============================================================
router_image = modal.Image.debian_slim().pip_install("fastapi[standard]>=0.100.0")

@app.function(
    image=router_image,
    secrets=[modal.Secret.from_name("phonezoo-secrets")],
    timeout=30,
)
@modal.fastapi_endpoint(method="POST", label="phonezoo-acestep-generate")
def generate(payload: dict):
    """
    Public HTTP endpoint called by Next.js /api/generate.
    Returns immediately and spawns the GPU generation as a background task.
    """
    import json

    # Validate required fields
    required = ["prompt", "job_id", "webhook_url"]
    for field in required:
        if not payload.get(field):
            return {"error": f"Missing required field: {field}"}, 400

    # Spawn GPU generation asynchronously (fire-and-forget from this endpoint's perspective)
    ACEStepGenerator().generate.spawn(payload)

    return {
        "status": "processing",
        "job_id": payload["job_id"],
        "message": "Generation started. You will be notified via webhook when complete.",
    }


# ============================================================
# Storage helpers
# ============================================================

def _upload_to_r2(mp3_bytes: bytes, job_id: str) -> str:
    """Upload MP3 to Cloudflare R2, return public URL."""
    import boto3

    key = f"ringtones/ai-generated/{job_id}.mp3"
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    s3.put_object(
        Bucket=os.environ["R2_BUCKET_NAME"],
        Key=key,
        Body=mp3_bytes,
        ContentType="audio/mpeg",
        CacheControl="public, max-age=31536000",
    )
    return f"{os.environ['R2_PUBLIC_URL']}/{key}"


def _upload_to_shelby(mp3_bytes: bytes, job_id: str) -> str:
    """
    Upload MP3 to Shelby testnet via HTTP multipart API, return public URL.

    Uses Shelby's REST API directly (no SDK needed in Python).
    Endpoint: POST https://api.testnet.shelby.xyz/shelby/v1/blobs/{account}/{blobName}/multipart/start

    Required env vars in Modal secrets:
      SHELBY_API_KEY            — API key (aptoslabs_xxx)
      SHELBY_ACCOUNT_ADDRESS    — Aptos account address (0x...)
      SHELBY_PRIVATE_KEY        — Ed25519 private key hex (for on-chain registration)
      SHELBY_NETWORK            — testnet (default) or shelbynet
      SHELBY_EXPIRATION_DAYS    — 30 (default)
    """
    import requests
    import json

    network = os.environ.get("SHELBY_NETWORK", "testnet")
    account = os.environ["SHELBY_ACCOUNT_ADDRESS"]
    api_key = os.environ.get("SHELBY_API_KEY", "")
    expiration_days = int(os.environ.get("SHELBY_EXPIRATION_DAYS", "30"))

    base_url = (
        "https://api.shelbynet.shelby.xyz/shelby"
        if network == "shelbynet"
        else f"https://api.{network}.shelby.xyz/shelby"
    )

    blob_name = f"phonezoo/ringtones/ai-generated/{job_id}.mp3"
    encoded_name = "/".join(requests.utils.quote(part, safe="") for part in blob_name.split("/"))

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Step 1: Register blob on-chain via Shelby SDK (requires Aptos signer)
    # NOTE: For testnet, registration may be optional or handled by the gateway.
    # We attempt direct PUT first (simpler), fall back to multipart if needed.

    # Direct single-part PUT for files ≤ 128MB (MP3 ringtones are tiny, <10MB)
    put_url = f"{base_url}/v1/blobs/{account}/{encoded_name}"

    put_headers = {**headers, "Content-Type": "audio/mpeg"}

    # Shelby requires blob to be registered on-chain first.
    # Use the SDK via subprocess if available, else use multipart upload endpoint.
    try:
        # Try direct PUT (works if blob registration is pre-done or not required on testnet)
        resp = requests.put(put_url, data=mp3_bytes, headers=put_headers, timeout=60)
        if resp.status_code in (200, 201, 204):
            print(f"[Shelby] Uploaded via PUT: {put_url}")
            return f"{base_url}/v1/blobs/{account}/{encoded_name}"
        else:
            print(f"[Shelby] PUT returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"[Shelby] PUT failed: {e}")

    # Fallback: multipart upload
    # Start
    start_url = f"{base_url}/v1/blobs/{account}/{encoded_name}/multipart/start"
    expiration_micros = (int(time.time() * 1000) + expiration_days * 24 * 60 * 60 * 1000) * 1000
    start_body = json.dumps({"expirationMicros": expiration_micros})
    start_resp = requests.post(start_url, data=start_body, headers=headers, timeout=30)
    start_resp.raise_for_status()
    upload_id = start_resp.json().get("uploadId") or start_resp.json().get("upload_id", "")

    # Upload single part
    part_url = f"{base_url}/v1/blobs/{account}/{encoded_name}/multipart/{upload_id}/1"
    part_resp = requests.put(part_url, data=mp3_bytes, headers={**headers, "Content-Type": "application/octet-stream"}, timeout=60)
    part_resp.raise_for_status()
    etag = part_resp.headers.get("ETag", "")

    # Complete
    complete_url = f"{base_url}/v1/blobs/{account}/{encoded_name}/multipart/{upload_id}/complete"
    complete_body = json.dumps({"parts": [{"partNumber": 1, "etag": etag}]})
    complete_resp = requests.post(complete_url, data=complete_body, headers=headers, timeout=30)
    complete_resp.raise_for_status()

    public_url = f"{base_url}/v1/blobs/{account}/{encoded_name}"
    print(f"[Shelby] Uploaded via multipart: {public_url}")
    return public_url


# ============================================================
# Helper
# ============================================================
def _call_webhook(webhook_url: str, payload: dict, max_retries: int = 3):
    """POST the result to the Next.js webhook with retries."""
    import requests

    webhook_secret = os.environ.get("WEBHOOK_SECRET", "")
    headers = {
        "Content-Type": "application/json",
        "x-webhook-secret": webhook_secret,
    }

    for attempt in range(max_retries):
        try:
            resp = requests.post(webhook_url, json=payload, headers=headers, timeout=15)
            resp.raise_for_status()
            print(f"[ACEStep] Webhook delivered (attempt {attempt + 1}): {resp.status_code}")
            return
        except Exception as e:
            print(f"[ACEStep] Webhook attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    print(f"[ACEStep] WARNING: All webhook attempts failed for {payload.get('job_id')}")


# ============================================================
# Local testing entry point
# ============================================================
@app.local_entrypoint()
def test():
    """Run a quick local test: modal run services/gpu/acestep_api.py"""
    result = ACEStepGenerator().generate.remote({
        "prompt": "upbeat pop melody with piano, 120 bpm, bright and catchy",
        "lyrics": "",
        "duration": 15,
        "seed": 42,
        "job_id": "test-local-001",
        "webhook_url": "https://httpbin.org/post",  # Echo server for testing
    })
    print("Result:", result)
