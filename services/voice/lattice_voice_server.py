#!/usr/bin/env python3
# Copyright (c) 2026 Jevante Boxley
# SPDX-License-Identifier: Apache-2.0
"""
Lattice local voice service: speech-to-text (faster-whisper) and
text-to-speech (Kokoro, ONNX) on this machine. Free, offline, private.

Started and stopped by Lattice; not meant to be run by hand. Contract:

  env  LATTICE_VOICE_TOKEN   required bearer token (random, per launch)
       LATTICE_STT_MODEL     faster-whisper model name or path (default small.en)
       LATTICE_STT_DEVICE    auto | cuda | cpu (default auto)
       LATTICE_TTS_MODEL     path to kokoro .onnx
       LATTICE_TTS_VOICES    path to kokoro voices .bin

  stdout  first line "READY <port>" once listening (127.0.0.1 only)

  GET  /health                         {"stt": bool, "tts": bool, "device": str}
  GET  /voices                         {"voices": [...]}
  POST /transcribe?language=en         raw audio body (ogg/opus, wav, mp3, …) -> {"text", "duration"}
  POST /speak                          {"input", "voice", "speed"} -> audio/wav

Audio is processed in memory and never written to disk.
"""

from __future__ import annotations

import hmac
import io
import json
import os
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_SPEECH_CHARS = 8000

TOKEN = os.environ.get("LATTICE_VOICE_TOKEN", "")
if len(TOKEN) < 32:
    sys.exit("LATTICE_VOICE_TOKEN missing or too short; this service is started by Lattice.")


class Engines:
    """Loads both models once (in the background) and serializes access per model."""

    def __init__(self) -> None:
        self.stt = None
        self.tts = None
        self.device = "cpu"
        self.errors: dict[str, str] = {}
        self.stt_lock = threading.Lock()
        self.tts_lock = threading.Lock()
        self.stt_ready = threading.Event()
        self.tts_ready = threading.Event()

    def load(self) -> None:
        threading.Thread(target=self._load_tts, daemon=True).start()
        threading.Thread(target=self._load_stt, daemon=True).start()

    def _load_stt(self) -> None:
        try:
            from faster_whisper import WhisperModel

            name = os.environ.get("LATTICE_STT_MODEL", "small.en")
            wanted = os.environ.get("LATTICE_STT_DEVICE", "auto")
            device = wanted
            if wanted == "auto":
                try:
                    import ctranslate2

                    device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
                except Exception:
                    device = "cpu"
            compute = "float16" if device == "cuda" else "int8"
            try:
                model = WhisperModel(name, device=device, compute_type=compute)
            except Exception:
                if device != "cuda":
                    raise
                device, model = "cpu", WhisperModel(name, device="cpu", compute_type="int8")
            # Warm up: the first GPU pass compiles kernels (seconds); do it now, not on the user's first sentence.
            import numpy as np

            list(model.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1)[0])
            self.stt, self.device = model, device
        except Exception as err:  # reported through /health
            self.errors["stt"] = f"{type(err).__name__}: {err}"
        finally:
            self.stt_ready.set()

    def _load_tts(self) -> None:
        try:
            from kokoro_onnx import Kokoro

            self.tts = Kokoro(os.environ["LATTICE_TTS_MODEL"], os.environ["LATTICE_TTS_VOICES"])
        except Exception as err:
            self.errors["tts"] = f"{type(err).__name__}: {err}"
        finally:
            self.tts_ready.set()

    def transcribe(self, audio: bytes, language: str | None) -> dict:
        self.stt_ready.wait()
        if self.stt is None:
            raise RuntimeError(self.errors.get("stt", "speech recognition unavailable"))
        with self.stt_lock:
            segments, info = self.stt.transcribe(
                io.BytesIO(audio), beam_size=1, vad_filter=True, language=language or None
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "duration": round(float(info.duration), 2)}

    def speak(self, text: str, voice: str, speed: float) -> bytes:
        self.tts_ready.wait()
        if self.tts is None:
            raise RuntimeError(self.errors.get("tts", "speech synthesis unavailable"))
        with self.tts_lock:
            samples, rate = self.tts.create(text, voice=voice, speed=speed, lang="en-us")
        return to_wav(samples, rate)


def to_wav(samples, rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


ENGINES = Engines()


class Handler(BaseHTTPRequestHandler):
    server_version = "LatticeVoice/1"

    def log_message(self, *args) -> None:
        pass  # no request logging: nothing about the user's audio or text leaves this process

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        return hmac.compare_digest(header.encode(), f"Bearer {TOKEN}".encode())

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload).encode(), "application/json")

    def _body(self, limit: int) -> bytes | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > limit:
            self._json(413 if length > limit else 400, {"error": "missing or oversized body"})
            return None
        return self.rfile.read(length)

    def do_GET(self) -> None:
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        path = urlparse(self.path).path
        if path == "/health":
            return self._json(200, {
                "stt": ENGINES.stt is not None,
                "tts": ENGINES.tts is not None,
                "loading": not (ENGINES.stt_ready.is_set() and ENGINES.tts_ready.is_set()),
                "device": ENGINES.device,
                "errors": ENGINES.errors,
            })
        if path == "/voices":
            ENGINES.tts_ready.wait()
            voices = sorted(ENGINES.tts.get_voices()) if ENGINES.tts else []
            return self._json(200, {"voices": voices})
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        url = urlparse(self.path)
        try:
            if url.path == "/transcribe":
                audio = self._body(MAX_AUDIO_BYTES)
                if audio is None:
                    return
                language = parse_qs(url.query).get("language", [None])[0]
                return self._json(200, ENGINES.transcribe(audio, language))
            if url.path == "/speak":
                raw = self._body(64 * 1024)
                if raw is None:
                    return
                req = json.loads(raw)
                text = str(req.get("input", ""))[:MAX_SPEECH_CHARS]
                if not text.strip():
                    return self._json(400, {"error": "empty input"})
                speed = min(4.0, max(0.25, float(req.get("speed", 1.0))))
                return self._send(200, ENGINES.speak(text, str(req.get("voice", "af_sky")), speed), "audio/wav")
            self._json(404, {"error": "not found"})
        except Exception as err:
            self._json(500, {"error": f"{type(err).__name__}: {err}"})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    ENGINES.load()
    print(f"READY {server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
