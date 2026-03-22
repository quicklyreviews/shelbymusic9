"""
PhoneZoo AI Ringtone Generator — Modal GPU Backend
Deploys MusicGen-Medium (1.5B) on a T4 GPU via Modal.com serverless.

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
# Minimal Node.js script that runs inside Modal to upload to Shelby.
# Simpler than the Windows version — Linux DNS works fine, no patches needed.
_SHELBY_UPLOAD_MJS = r"""
import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')

const jobId = process.argv[2]
if (!jobId) { process.stderr.write('Usage: shelby-upload.mjs <jobId>\n'); process.exit(1) }

const rawKey = (process.env.SHELBY_PRIVATE_KEY || '').replace(/^ed25519-priv-/, '')
if (!rawKey) { process.stderr.write('SHELBY_PRIVATE_KEY not set\n'); process.exit(1) }

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const audioBuffer = Buffer.concat(chunks)

const { Ed25519PrivateKey, Account } = await import('@aptos-labs/ts-sdk')
const { ShelbyNodeClient } = await import('@shelby-protocol/sdk/node')

const privateKey = new Ed25519PrivateKey(rawKey)
const signer = Account.fromPrivateKey({ privateKey })
const client = new ShelbyNodeClient({
  network: process.env.SHELBY_NETWORK || 'testnet',
  apiKey: process.env.SHELBY_API_KEY,
})

const blobName = `phonezoo/ringtones/ai-generated/${jobId}.mp3`
const expirationDays = parseInt(process.env.SHELBY_EXPIRATION_DAYS || '30', 10)
const expirationMicros = BigInt(Date.now() + expirationDays * 24 * 60 * 60 * 1000) * 1000n

await client.upload({ signer, blobName, blobData: new Uint8Array(audioBuffer), expirationMicros })

const network = process.env.SHELBY_NETWORK || 'testnet'
const base = `https://api.${network}.shelby.xyz/shelby`
const encodedName = blobName.split('/').map(encodeURIComponent).join('/')
const url = `${base}/v1/blobs/${signer.accountAddress}/${encodedName}`
process.stdout.write(JSON.stringify({ url, sizeKb: Math.round(audioBuffer.length / 1024) }))
"""

musicgen_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(["ffmpeg", "curl"])
    .run_commands([
        # Install Node.js 22 via NodeSource
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        # Install Shelby + Aptos SDK for Node.js
        "mkdir -p /shelby-worker",
        'echo \'{"type":"module"}\' > /shelby-worker/package.json',
        "cd /shelby-worker && npm install @shelby-protocol/sdk @aptos-labs/ts-sdk",
    ])
    .pip_install([
        "torch==2.6.0",          # 2.6+ required by transformers due to CVE-2025-32434 torch.load fix
        "transformers>=4.40.0",
        "accelerate>=0.28.0",
        "pydub>=0.25.1",
        "boto3>=1.34.0",
        "requests>=2.31.0",
        "fastapi[standard]>=0.100.0",
    ])
)
# No ace-step, no numpy conflict, no spacy/gradio/numba

# Modal Volume to cache the model weights across cold starts (~3GB)
model_volume = modal.Volume.from_name("phonezoo-model-cache", create_if_missing=True)

app = modal.App("phonezoo-acestep")

# ============================================================
# Model class — loaded once per container, reused across requests
# ============================================================
@app.cls(
    gpu="T4",
    image=musicgen_image,
    secrets=[modal.Secret.from_name("phonezoo-secrets")],
    volumes={"/model-cache": model_volume},
    scaledown_window=120,  # Keep warm for 2 min after last request
    timeout=600,           # 10 min: cold start model download (~3GB first time) + generation
)
class ACEStepGenerator:

    @modal.enter()
    def load_model(self):
        """Load MusicGen-Medium model into GPU memory on container start."""
        import torch
        from transformers import MusicgenForConditionalGeneration, AutoProcessor

        print("[MusicGen] Loading model...")
        start = time.time()

        self.processor = AutoProcessor.from_pretrained(
            "facebook/musicgen-medium",
            cache_dir="/model-cache",
        )
        self.model = MusicgenForConditionalGeneration.from_pretrained(
            "facebook/musicgen-medium",
            cache_dir="/model-cache",
        )
        self.model.to("cuda")
        self.sample_rate = self.model.config.audio_encoder.sampling_rate  # 32000

        elapsed = time.time() - start
        print(f"[MusicGen] Model loaded in {elapsed:.1f}s, sample_rate={self.sample_rate}")

    @modal.method()
    def generate(self, payload: dict) -> dict:
        """
        Run MusicGen inference and upload result to R2.
        Returns {status, audio_url, generation_time_ms} on success
        or {status: 'failed', error} on failure.
        """
        import torch
        import numpy as np
        import requests

        job_id = payload["job_id"]
        prompt = payload["prompt"]
        lyrics = payload.get("lyrics", "")
        duration = int(payload.get("duration", 30))
        seed = int(payload.get("seed", 42))
        webhook_url = payload["webhook_url"]

        start_ms = int(time.time() * 1000)

        try:
            # Fold lyrics into prompt if provided
            full_prompt = f"{prompt}. Lyrics theme: {lyrics}" if lyrics else prompt

            print(f"[MusicGen] Generating job {job_id}: prompt='{full_prompt[:80]}', duration={duration}s, seed={seed}")

            # MusicGen generates ~50 tokens/sec at 32kHz
            max_new_tokens = duration * 50  # 15s→750, 30s→1500, 60s→3000

            torch.manual_seed(seed)

            inputs = self.processor(
                text=[full_prompt],
                padding=True,
                return_tensors="pt",
            ).to("cuda")

            with torch.inference_mode():
                audio_values = self.model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=True,
                    guidance_scale=3.0,
                )

            # audio_values: [batch=1, channels=1, samples]
            audio_np = audio_values[0, 0].cpu().numpy()  # shape: (samples,)

            print(f"[MusicGen] Generated {len(audio_np)} samples at {self.sample_rate}Hz ({len(audio_np)/self.sample_rate:.1f}s)")

            # Encode to MP3 via pydub (no soundfile needed)
            from pydub import AudioSegment

            # Normalize to int16
            audio_np = audio_np.squeeze()
            if audio_np.dtype != np.int16:
                audio_np = (audio_np / max(np.abs(audio_np).max(), 1e-8) * 32767).astype(np.int16)

            # Build AudioSegment directly from raw PCM bytes
            audio_segment = AudioSegment(
                audio_np.tobytes(),
                frame_rate=self.sample_rate,
                sample_width=2,   # 16-bit PCM = 2 bytes
                channels=1,
            )

            # Export to MP3 (192kbps)
            mp3_buf = io.BytesIO()
            audio_segment.export(mp3_buf, format="mp3", bitrate="192k")
            mp3_bytes = mp3_buf.getvalue()

            print(f"[MusicGen] Encoded MP3: {len(mp3_bytes) // 1024}KB")

            generation_time_ms = int(time.time() * 1000) - start_ms
            storage_provider = os.environ.get("STORAGE_PROVIDER", "r2").lower()

            if storage_provider == "shelby":
                # Upload to Shelby via Node.js subprocess (Linux, 180s timeout, full SDK + blockchain)
                # Falls back to R2 if Shelby is down or account has insufficient balance
                try:
                    audio_url = _upload_to_shelby_via_node(mp3_bytes, job_id)
                    print(f"[MusicGen] Job {job_id} completed in {generation_time_ms}ms → Shelby: {audio_url}")
                except Exception as shelby_err:
                    print(f"[MusicGen] Shelby upload failed, falling back to R2: {shelby_err}")
                    audio_url = _upload_to_r2(mp3_bytes, job_id)
                    print(f"[MusicGen] Fallback R2: {audio_url}")
                _call_webhook(webhook_url, {
                    "job_id": job_id,
                    "status": "completed",
                    "audio_url": audio_url,
                    "audio_size_kb": len(mp3_bytes) // 1024,
                    "generation_time_ms": generation_time_ms,
                })
                return {"status": "completed", "audio_url": audio_url, "generation_time_ms": generation_time_ms}
            else:
                audio_url = _upload_to_r2(mp3_bytes, job_id)
                print(f"[MusicGen] Job {job_id} completed in {generation_time_ms}ms → {audio_url}")
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
            print(f"[MusicGen] Job {job_id} FAILED: {exc}\n{tb}")

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

def _upload_to_shelby_via_node(mp3_bytes: bytes, job_id: str) -> str:
    """Upload MP3 to Shelby testnet by running Node.js shelby-upload.mjs inside the Modal container."""
    import subprocess
    import json

    # Verify required env vars are present before spawning Node
    missing = [k for k in ("SHELBY_PRIVATE_KEY", "SHELBY_API_KEY", "SHELBY_ACCOUNT_ADDRESS")
               if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Missing Modal secrets: {', '.join(missing)}. Add them to phonezoo-secrets.")

    # Write the upload script to the worker dir (once per container is fine)
    script_path = "/shelby-worker/shelby-upload.mjs"
    if not os.path.exists(script_path):
        with open(script_path, "w") as f:
            f.write(_SHELBY_UPLOAD_MJS)

    result = subprocess.run(
        ["node", "--dns-result-order=ipv4first", script_path, job_id],
        input=mp3_bytes,
        capture_output=True,
        timeout=180,  # 3 min: blockchain registration ~10-30s + upload
        env=dict(os.environ),  # explicitly forward all Modal env vars to subprocess
    )

    stderr = result.stderr.decode(errors="replace")
    if stderr:
        print(f"[Shelby] node stderr: {stderr[:300]}")

    if result.returncode != 0:
        raise RuntimeError(f"shelby-upload.mjs failed (exit {result.returncode}): {stderr[:500]}")

    data = json.loads(result.stdout.decode())
    return data["url"]


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

    # Direct single-part PUT for files ≤ 128MB (MP3 ringtones are tiny, <10MB)
    put_url = f"{base_url}/v1/blobs/{account}/{encoded_name}"
    put_headers = {**headers, "Content-Type": "audio/mpeg"}

    try:
        resp = requests.put(put_url, data=mp3_bytes, headers=put_headers, timeout=60)
        if resp.status_code in (200, 201, 204):
            print(f"[Shelby] Uploaded via PUT: {put_url}")
            return f"{base_url}/v1/blobs/{account}/{encoded_name}"
        else:
            print(f"[Shelby] PUT returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"[Shelby] PUT failed: {e}")

    # Fallback: multipart upload
    start_url = f"{base_url}/v1/blobs/{account}/{encoded_name}/multipart/start"
    expiration_micros = (int(time.time() * 1000) + expiration_days * 24 * 60 * 60 * 1000) * 1000
    start_body = json.dumps({"expirationMicros": expiration_micros})
    start_resp = requests.post(start_url, data=start_body, headers=headers, timeout=30)
    start_resp.raise_for_status()
    upload_id = start_resp.json().get("uploadId") or start_resp.json().get("upload_id", "")

    part_url = f"{base_url}/v1/blobs/{account}/{encoded_name}/multipart/{upload_id}/1"
    part_resp = requests.put(part_url, data=mp3_bytes, headers={**headers, "Content-Type": "application/octet-stream"}, timeout=60)
    part_resp.raise_for_status()
    etag = part_resp.headers.get("ETag", "")

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
            print(f"[MusicGen] Webhook delivered (attempt {attempt + 1}): {resp.status_code}")
            return
        except Exception as e:
            print(f"[MusicGen] Webhook attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    print(f"[MusicGen] WARNING: All webhook attempts failed for {payload.get('job_id')}")


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
