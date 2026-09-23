// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Audio capture and playback via ffmpeg/ffplay against PulseAudio/PipeWire.
 * Privacy: recordings are streamed into memory and handed straight to the
 * caller — nothing is ever written to disk — and playback is piped through
 * stdin, so synthesized speech never touches disk either.
 */

/** Hard cap per utterance. At 32 kb/s Opus that's ~2.4 MB — far under Venice's 25 MB upload limit. */
export const MAX_RECORDING_SECONDS = 600;

export interface AudioSource {
  name: string;
  isMonitor: boolean;
}

/** Parses `pactl list short sources` (tab-separated: index, name, driver, spec, state). */
export function parsePactlSources(output: string): AudioSource[] {
  return output
    .split("\n")
    .map((line) => line.split("\t")[1]?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name, isMonitor: name.endsWith(".monitor") }));
}

/**
 * The system default source is often a *monitor* (what the speakers play),
 * not a microphone — recording that would transcribe Lattice's own voice.
 * Prefer the default only when it's a real input, else the first real input.
 */
export function pickMicrophone(defaultSource: string | null, sources: AudioSource[]): string | null {
  const inputs = sources.filter((s) => !s.isMonitor);
  if (defaultSource && inputs.some((s) => s.name === defaultSource)) return defaultSource;
  return inputs[0]?.name ?? null;
}

export async function listAudioSources(): Promise<{ defaultSource: string | null; sources: AudioSource[] }> {
  const [list, def] = await Promise.all([
    execFileAsync("pactl", ["list", "short", "sources"]).then((r) => r.stdout),
    execFileAsync("pactl", ["get-default-source"]).then((r) => r.stdout.trim()).catch(() => null),
  ]);
  return { defaultSource: def || null, sources: parsePactlSources(list) };
}

export async function resolveMicrophone(configured: string | undefined): Promise<string> {
  const { defaultSource, sources } = await listAudioSources();
  if (configured) {
    if (!sources.some((s) => s.name === configured)) {
      throw new Error(`Configured microphone "${configured}" isn't connected. /voice mic lists what is.`);
    }
    return configured;
  }
  const mic = pickMicrophone(defaultSource, sources);
  if (!mic) throw new Error("No microphone found (only monitor sources). Plug one in, then /voice mic.");
  return mic;
}

export async function checkAudioTools(): Promise<string[]> {
  const missing: string[] = [];
  for (const tool of ["ffmpeg", "ffplay", "pactl"]) {
    await execFileAsync("which", [tool]).catch(() => missing.push(tool));
  }
  return missing;
}

/**
 * Recordings are Ogg/Opus, not FLAC: ffmpeg can't seek back to finalize a
 * FLAC header when writing to a pipe, and Venice's transcription silently
 * returns empty text for such streams. Ogg is designed for streaming, and
 * Opus at 32 kb/s is ~10× smaller than FLAC with no accuracy loss for speech.
 */
export const RECORDING_MIME_TYPE = "audio/ogg";
export const RECORDING_FILENAME = "speech.ogg";

export interface Recording {
  /** Resolves with Ogg/Opus bytes once stop() is called (or the cap is hit). */
  done: Promise<Buffer>;
  /** Finish cleanly: ffmpeg flushes and finalizes the stream. */
  stop(): void;
  /** Abandon: kill ffmpeg and discard everything captured. */
  cancel(): void;
  startedAt: number;
}

export function startRecording(source: string): Recording {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "pulse", "-i", source,
      "-t", String(MAX_RECORDING_SECONDS),
      "-ac", "1", "-ar", "16000",
      "-c:a", "libopus", "-b:a", "32k", "-application", "voip",
      "-f", "ogg", "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  const chunks: Buffer[] = [];
  let stderr = "";
  let cancelled = false;
  ffmpeg.stdout.on("data", (c: Buffer) => chunks.push(c));
  ffmpeg.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

  const done = new Promise<Buffer>((resolve, reject) => {
    ffmpeg.on("error", (err) => reject(new Error(`Couldn't start ffmpeg: ${err.message}`)));
    ffmpeg.on("close", (code) => {
      if (cancelled) {
        chunks.length = 0; // drop captured audio from memory promptly
        return reject(new Error("Recording cancelled."));
      }
      const audio = Buffer.concat(chunks);
      chunks.length = 0;
      if (code !== 0 && audio.length === 0) return reject(new Error(`Recording failed: ${stderr.trim() || `ffmpeg exited ${code}`}`));
      resolve(audio);
    });
  });

  return {
    done,
    startedAt: Date.now(),
    stop() {
      if (ffmpeg.exitCode === null) ffmpeg.stdin.end("q"); // ffmpeg's interactive quit: finalizes output
    },
    cancel() {
      cancelled = true;
      if (ffmpeg.exitCode === null) ffmpeg.kill("SIGKILL");
    },
  };
}

export interface Playback {
  done: Promise<void>;
  stop(): void;
}

/** Plays encoded audio (mp3/wav/…) from memory. Resolves when playback ends or is stopped. */
export function playAudio(audio: Buffer): Playback {
  const player: ChildProcess = spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "error", "-i", "pipe:0"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  const done = new Promise<void>((resolve) => {
    player.on("error", () => resolve());
    player.on("close", () => resolve());
  });
  player.stdin?.on("error", () => {}); // EPIPE when stopped mid-write is expected
  player.stdin?.end(audio);
  return {
    done,
    stop() {
      if (player.exitCode === null) player.kill("SIGTERM");
    },
  };
}
