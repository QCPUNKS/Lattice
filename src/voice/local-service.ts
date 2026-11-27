// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Transcript } from "../media/speech-client.js";

/** src/voice and dist/voice are both two levels below the package root. */
export const VOICE_SERVER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../services/voice/lattice_voice_server.py",
);

const START_TIMEOUT_MS = 20_000;
/** First launch loads Whisper onto the GPU and compiles kernels; allow for a cold cache. */
const WARMUP_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS = 250;
const STDERR_TAIL = 4000;

export interface LocalVoiceSettings {
  python: string;
  sttModel: string;
  sttDevice: string;
  ttsModel: string;
  ttsVoices: string;
  script?: string;
}

interface Health {
  stt: boolean;
  tts: boolean;
  loading: boolean;
  device: string;
  errors: Record<string, string>;
}

/**
 * Environment for the child: the user's environment minus anything that
 * looks like a credential. The voice service never needs the Venice key.
 */
export function scrubbedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Runs services/voice/lattice_voice_server.py: Whisper + Kokoro kept warm
 * in one local process, reachable only on 127.0.0.1 with a per-launch random
 * token. Started lazily, restarted if it dies, stopped with Lattice.
 */
export class LocalVoiceService {
  private proc: ChildProcess | null = null;
  private base: string | null = null;
  private token = "";
  private starting: Promise<void> | null = null;
  private stderr = "";

  constructor(private readonly settings: LocalVoiceSettings) {}

  /** Problems that make the local engine unusable, before trying to start it. */
  preflight(): string[] {
    const problems: string[] = [];
    const s = this.settings;
    if (s.python.includes("/") && !existsSync(s.python)) problems.push(`Python not found at ${s.python} ([voice] local_python).`);
    if (!existsSync(s.script ?? VOICE_SERVER_SCRIPT)) problems.push("The local voice service script is missing from this install.");
    if (!existsSync(s.ttsModel)) problems.push(`Kokoro model not found at ${s.ttsModel} ([voice] local_tts_model).`);
    if (!existsSync(s.ttsVoices)) problems.push(`Kokoro voices not found at ${s.ttsVoices} ([voice] local_tts_voices).`);
    return problems;
  }

  /** Starts the process if needed and waits until the requested engines are loaded. */
  async ready(needs: { stt?: boolean; tts?: boolean } = { stt: true, tts: true }): Promise<Health> {
    await this.ensureStarted();
    const deadline = Date.now() + WARMUP_TIMEOUT_MS;
    while (true) {
      const health = await this.request<Health>("GET", "/health");
      const failed = [needs.stt && health.errors.stt, needs.tts && health.errors.tts].filter(Boolean);
      if (failed.length > 0) throw new Error(`Local voice failed to load: ${failed.join("; ")}`);
      if ((!needs.stt || health.stt) && (!needs.tts || health.tts)) return health;
      if (!health.loading || Date.now() > deadline) throw new Error("Local voice models didn't finish loading.");
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }
  }

  async transcribe(audio: Buffer, language: string | undefined, signal?: AbortSignal): Promise<Transcript> {
    await this.ready({ stt: true });
    const query = language ? `?language=${encodeURIComponent(language)}` : "";
    const res = await this.request<{ text: string; duration: number }>("POST", `/transcribe${query}`, new Uint8Array(audio), signal);
    return { text: (res.text ?? "").trim(), durationSeconds: typeof res.duration === "number" ? res.duration : null };
  }

  async synthesize(text: string, voice: string, speed: number, signal?: AbortSignal): Promise<Buffer> {
    await this.ready({ tts: true });
    const res = await this.raw("POST", "/speak", JSON.stringify({ input: text, voice, speed }), signal, "application/json");
    return Buffer.from(await res.arrayBuffer());
  }

  async voices(): Promise<string[]> {
    await this.ready({ tts: true });
    return (await this.request<{ voices: string[] }>("GET", "/voices")).voices;
  }

  stop(): void {
    if (this.proc && this.proc.exitCode === null) this.proc.kill("SIGTERM");
    this.proc = null;
    this.base = null;
    this.starting = null;
  }

  private ensureStarted(): Promise<void> {
    if (this.proc && this.proc.exitCode === null && this.base) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private start(): Promise<void> {
    const problems = this.preflight();
    if (problems.length > 0) return Promise.reject(new Error(problems.join(" ")));

    this.token = randomBytes(32).toString("hex");
    this.stderr = "";
    const s = this.settings;
    const proc = spawn(s.python, [s.script ?? VOICE_SERVER_SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...scrubbedEnv(process.env),
        LATTICE_VOICE_TOKEN: this.token,
        LATTICE_STT_MODEL: s.sttModel,
        LATTICE_STT_DEVICE: s.sttDevice,
        LATTICE_TTS_MODEL: s.ttsModel,
        LATTICE_TTS_VOICES: s.ttsVoices,
        PYTHONUNBUFFERED: "1",
      },
    });
    this.proc = proc;
    proc.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.stop();
        const detail = this.stderr.trim().split("\n").filter((l) => !/warn/i.test(l)).slice(-3).join(" | ");
        reject(new Error(detail ? `${message}: ${detail}` : message));
      };
      const timer = setTimeout(() => fail("Local voice service didn't start in time"), START_TIMEOUT_MS);
      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const match = /READY (\d+)/.exec(stdout);
        if (match && !settled) {
          settled = true;
          clearTimeout(timer);
          this.base = `http://127.0.0.1:${match[1]}`;
          resolve();
        }
      });
      proc.on("error", (err) => fail(`Couldn't run ${s.python}: ${err.message}`));
      proc.on("exit", (code) => {
        if (this.proc === proc) {
          this.proc = null;
          this.base = null;
        }
        fail(`Local voice service exited (code ${code})`);
      });
    });
  }

  private async raw(method: string, route: string, body?: string | Uint8Array, signal?: AbortSignal, contentType?: string): Promise<Response> {
    if (!this.base) throw new Error("Local voice service isn't running.");
    const res = await fetch(`${this.base}${route}`, {
      method,
      body,
      signal,
      headers: { Authorization: `Bearer ${this.token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        // plain-text error body
      }
      throw new Error(`Local voice error ${res.status}: ${message}`);
    }
    return res;
  }

  private async request<T>(method: string, route: string, body?: string | Uint8Array, signal?: AbortSignal): Promise<T> {
    return (await this.raw(method, route, body, signal)).json() as Promise<T>;
  }
}
