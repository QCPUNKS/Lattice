// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalVoiceService, scrubbedEnv, VOICE_SERVER_SCRIPT } from "../../src/voice/local-service.js";

/**
 * A stand-in for lattice_voice_server.py that speaks the same protocol with
 * canned results — tests the Lattice side (spawn, READY handshake, token,
 * warm-up polling, errors) without loading real models.
 */
const STUB = String.raw`
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
TOKEN = os.environ["LATTICE_VOICE_TOKEN"]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def _ok(self): return self.headers.get("Authorization") == "Bearer " + TOKEN
    def do_GET(self):
        if not self._ok(): return self._send(401, b'{"error":"unauthorized"}')
        if self.path == "/health": return self._send(200, json.dumps({"stt": True, "tts": True, "loading": False, "device": "cpu", "errors": {},
            "env_has_key": "STUB_API_KEY" in os.environ}).encode())
        if self.path == "/voices": return self._send(200, b'{"voices":["af_sky","am_adam"]}')
    def do_POST(self):
        if not self._ok(): return self._send(401, b'{"error":"unauthorized"}')
        n = int(self.headers.get("Content-Length") or 0); body = self.rfile.read(n)
        if self.path.startswith("/transcribe"): return self._send(200, json.dumps({"text": " heard %d bytes " % n, "duration": 1.5}).encode())
        if self.path == "/speak": return self._send(200, b"RIFF....WAVEfake", "audio/wav")
server = ThreadingHTTPServer(("127.0.0.1", 0), H)
print("READY %d" % server.server_address[1], flush=True)
server.serve_forever()
`;

let dir: string;
let stub: string;
let model: string;
const services: LocalVoiceService[] = [];

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-voice-"));
  stub = path.join(dir, "stub.py");
  model = path.join(dir, "model.onnx");
  await fs.writeFile(stub, STUB);
  await fs.writeFile(model, "x");
});
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function service(overrides: Partial<ConstructorParameters<typeof LocalVoiceService>[0]> = {}) {
  const s = new LocalVoiceService({
    python: "python3",
    sttModel: "small.en",
    sttDevice: "cpu",
    ttsModel: model,
    ttsVoices: model,
    script: stub,
    ...overrides,
  });
  services.push(s);
  return s;
}

describe("scrubbedEnv", () => {
  it("drops anything that looks like a credential and keeps the rest", () => {
    const env = scrubbedEnv({ VENICE_API_KEY: "k", GITHUB_TOKEN: "t", DB_PASSWORD: "p", AWS_SECRET_ACCESS_KEY: "s", PATH: "/bin", HF_HOME: "/hf" });
    expect(env).toEqual({ PATH: "/bin", HF_HOME: "/hf" });
  });
});

describe("LocalVoiceService", () => {
  it("ships the real server script", async () => {
    await expect(fs.access(VOICE_SERVER_SCRIPT)).resolves.toBeUndefined();
  });

  it("reports missing Python and model files before trying to start", () => {
    const problems = service({ python: "/nope/python", ttsModel: "/nope/model.onnx" }).preflight();
    expect(problems.join(" ")).toMatch(/Python not found.*Kokoro model not found/);
  });

  it("starts, handshakes, and transcribes / speaks / lists voices with the per-launch token", async () => {
    const s = service();
    const health = await s.ready();
    expect(health).toMatchObject({ stt: true, tts: true, device: "cpu" });
    expect(await s.transcribe(Buffer.from("abcd"), "en")).toEqual({ text: "heard 4 bytes", durationSeconds: 1.5 });
    expect((await s.synthesize("hi", "af_sky", 1)).subarray(0, 4).toString()).toBe("RIFF");
    expect(await s.voices()).toEqual(["af_sky", "am_adam"]);
  });

  it("never passes credentials to the child process", async () => {
    process.env.STUB_API_KEY = "must-not-leak";
    try {
      const health = (await service().ready()) as unknown as { env_has_key: boolean };
      expect(health.env_has_key).toBe(false);
    } finally {
      delete process.env.STUB_API_KEY;
    }
  });

  it("restarts transparently after the process dies", async () => {
    const s = service();
    await s.ready();
    s.stop();
    expect((await s.transcribe(Buffer.from("xy"), undefined)).text).toBe("heard 2 bytes");
  });

  it("surfaces a clear error when the service can't start", async () => {
    const broken = path.join(dir, "broken.py");
    await fs.writeFile(broken, "import sys\nsys.stderr.write('ModuleNotFoundError: No module named faster_whisper\\n')\nsys.exit(1)\n");
    await expect(service({ script: broken }).ready()).rejects.toThrow(/exited.*faster_whisper/);
  });
});
