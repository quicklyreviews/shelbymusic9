#!/usr/bin/env python3
"""
Local dev server — replaces Modal GPU backend for testing.

Simulates generation without GPU/cloud:
  - Generates a real sine-wave test tone (WAV) in memory
  - Serves it at http://localhost:8000/audio/<job_id>.wav
  - Calls Next.js webhook after configurable delay

Setup (one time):
  pip install fastapi uvicorn requests

Run:
  uvicorn local_server:app --port 8000 --reload

Point Next.js at it — set in .env.local:
  MODAL_ENDPOINT_URL=http://localhost:8000
  NEXT_PUBLIC_APP_URL=http://localhost:3000
"""

import io
import math
import struct
import threading
import time
import wave
from typing import Any

import requests
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

app = FastAPI(title="PhoneZoo Local Mock GPU")

# ── Config ──────────────────────────────────────────────────────────────────
WEBHOOK_SECRET = "phonezoo-webhook-2024"
SIMULATE_DELAY = 5      # seconds before webhook fires (feels real)
TONE_DURATION  = 3      # seconds of audio (short for fast serving)
SAMPLE_RATE    = 44100
LOCAL_BASE_URL = "http://localhost:8000"

# In-memory store: job_id → WAV bytes
_audio_cache: dict[str, bytes] = {}


# ── Audio generator ─────────────────────────────────────────────────────────
def _make_tone(duration: int = TONE_DURATION, freq: float = 440.0) -> bytes:
    """Generate a sine-wave tone as WAV bytes (no deps beyond stdlib)."""
    n = SAMPLE_RATE * duration
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)       # 16-bit PCM
        w.setframerate(SAMPLE_RATE)
        frames = []
        for i in range(n):
            t = i / SAMPLE_RATE
            # Simple fade-in/out over first/last 0.2s
            fade = min(1.0, t / 0.2, (duration - t) / 0.2)
            sample = int(fade * 28000 * math.sin(2 * math.pi * freq * t))
            frames.append(struct.pack("<h", max(-32768, min(32767, sample))))
        w.writeframes(b"".join(frames))
    return buf.getvalue()


# ── Background worker ────────────────────────────────────────────────────────
def _run_generation(payload: dict[str, Any]) -> None:
    job_id      = payload["job_id"]
    webhook_url = payload["webhook_url"]
    duration    = int(payload.get("duration", 30))
    prompt      = payload.get("prompt", "")

    print(f"[LocalServer] ▶ Job {job_id}: '{prompt[:60]}' — waiting {SIMULATE_DELAY}s …")
    time.sleep(SIMULATE_DELAY)

    # Generate a tone and cache it
    wav_bytes = _make_tone()
    _audio_cache[job_id] = wav_bytes
    audio_url = f"{LOCAL_BASE_URL}/audio/{job_id}.wav"

    result = {
        "job_id": job_id,
        "status": "completed",
        "audio_url": audio_url,
        "audio_size_kb": len(wav_bytes) // 1024,
        "generation_time_ms": SIMULATE_DELAY * 1000,
    }

    try:
        resp = requests.post(
            webhook_url,
            json=result,
            headers={
                "Content-Type": "application/json",
                "x-webhook-secret": WEBHOOK_SECRET,
            },
            timeout=15,
        )
        print(f"[LocalServer] ✓ Webhook → HTTP {resp.status_code}")
    except Exception as e:
        print(f"[LocalServer] ✗ Webhook failed: {e}")


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.post("/")
async def generate(request: Request):
    """Mirror of Modal endpoint: accept job, fire-and-forget, return immediately."""
    payload = await request.json()

    for field in ("prompt", "job_id", "webhook_url"):
        if not payload.get(field):
            return JSONResponse({"error": f"Missing field: {field}"}, status_code=400)

    threading.Thread(target=_run_generation, args=(payload,), daemon=True).start()

    return {
        "status": "processing",
        "job_id": payload["job_id"],
        "message": "Mock generation started.",
    }


@app.get("/audio/{job_id}.wav")
def serve_audio(job_id: str):
    """Serve the generated test tone for this job."""
    wav = _audio_cache.get(job_id)
    if wav is None:
        return JSONResponse({"error": "Audio not ready"}, status_code=404)
    return Response(content=wav, media_type="audio/wav")


@app.get("/health")
def health():
    return {"status": "ok", "jobs_cached": len(_audio_cache)}
