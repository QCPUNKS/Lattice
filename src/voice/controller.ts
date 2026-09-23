// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type * as readline from "node:readline/promises";
import type { LatticeConfig, VoiceMode } from "../config/index.js";
import { setGlobalConfigValue } from "../config/writer.js";
import type { VeniceHttp } from "../providers/venice-http.js";
import { playAudio, resolveMicrophone, startRecording, checkAudioTools } from "../media/audio-io.js";
import { LocalSpeechEngine, VeniceSpeechEngine, type SpeechEngine, type VoiceEngineName } from "./engines.js";
import { startActivity } from "../ui/activity.js";
import { theme } from "../ui/theme.js";
import { SpeakableText } from "./speakable-text.js";
import { Speaker } from "./speaker.js";
import type { SpendLedger } from "../billing/ledger.js";

export function voiceInputEnabled(mode: VoiceMode): boolean {
  return mode === "chat" || mode === "dictate";
}

export function voiceOutputEnabled(mode: VoiceMode): boolean {
  return mode === "chat" || mode === "listen";
}

export const VOICE_MODE_DESCRIPTIONS: Record<VoiceMode, string> = {
  off: "type → read",
  chat: "speak → hear (text shown as captions)",
  dictate: "speak → read",
  listen: "type → hear (text shown as captions)",
};

/** Streamed-response hooks the REPL wires into the agent loop. */
export interface ResponseSpeech {
  onText(delta: string): void;
  /** A natural pause (tool call starting): speak what's held back now. */
  onPause(): void;
  onEnd(): void;
}

/**
 * Owns the voice experience: mode, engine, microphone capture, transcription,
 * and spoken replies. Audio lives only in memory; transcripts are never
 * written to the audit log (only durations are).
 */
export class VoiceController {
  private readonly speaker: Speaker;
  private readonly local: LocalSpeechEngine;
  readonly venice: VeniceSpeechEngine;

  constructor(
    http: VeniceHttp,
    private readonly cfg: LatticeConfig,
    private readonly auditLog: (event: Record<string, unknown>) => void,
    ledger?: SpendLedger,
  ) {
    this.local = new LocalSpeechEngine(cfg);
    this.venice = new VeniceSpeechEngine(http, cfg, ledger);
    this.speaker = new Speaker({
      synthesize: (text, signal) => this.engine.synthesize(text, signal),
      play: playAudio,
      onError: (err) => console.log(theme.error(`\n  [voice] ${err.message}`)),
    });
  }

  get engine(): SpeechEngine {
    return this.cfg.voice.engine === "local" ? this.local : this.venice;
  }

  get mode(): VoiceMode {
    return this.cfg.voice.mode;
  }

  get inputEnabled(): boolean {
    return voiceInputEnabled(this.mode);
  }

  get outputEnabled(): boolean {
    return voiceOutputEnabled(this.mode);
  }

  get isSpeaking(): boolean {
    return this.speaker.isSpeaking;
  }

  describe(): string {
    return this.engine.describe();
  }

  /** Called at startup when a voice mode is already on: warm the local models before the user speaks. */
  warmUp(): void {
    if (this.mode === "off" || this.cfg.voice.engine !== "local") return;
    this.local.warmInBackground({ input: this.inputEnabled, output: this.outputEnabled });
  }

  /** Checks dependencies (and, for Venice, model privacy) before a mode that needs them is switched on. */
  async setMode(mode: VoiceMode): Promise<void> {
    if (mode !== "off") {
      const missing = await checkAudioTools();
      if (missing.length > 0) throw new Error(`Voice needs ${missing.join(", ")}. Install with: sudo apt install ffmpeg pulseaudio-utils`);
      if (voiceInputEnabled(mode)) await resolveMicrophone(this.cfg.voice.inputDevice);
      await this.prepareEngine({ input: voiceInputEnabled(mode), output: voiceOutputEnabled(mode) });
    }
    if (!voiceOutputEnabled(mode)) this.speaker.stop();
    this.cfg.voice.mode = mode;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "mode", mode);
  }

  async setEngine(name: VoiceEngineName): Promise<void> {
    const previous = this.cfg.voice.engine;
    this.speaker.stop();
    this.cfg.voice.engine = name;
    try {
      if (this.mode !== "off") await this.prepareEngine({ input: this.inputEnabled, output: this.outputEnabled });
    } catch (err) {
      this.cfg.voice.engine = previous;
      throw err;
    }
    if (name !== "local") this.local.dispose(); // free the GPU when not in use
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "engine", name);
  }

  private async prepareEngine(needs: { input: boolean; output: boolean }): Promise<void> {
    const loading = this.engine.name === "local" ? startActivity("thinking", "loading local voice models…") : null;
    try {
      await this.engine.prepare(needs);
    } catch (err) {
      if (this.engine.name === "local") {
        throw new Error(`${(err as Error).message}\n  Set up local voice with scripts/voice/install-local-voice.sh, or use /voice engine venice.`);
      }
      throw err;
    } finally {
      loading?.stop();
    }
  }

  voices(): Promise<string[]> {
    return this.engine.voices();
  }

  async setVoice(voice: string): Promise<void> {
    const available = await this.engine.voices();
    if (available.length > 0 && !available.includes(voice)) {
      throw new Error(`The ${this.engine.name} engine has no voice "${voice}". /voice voices lists them.`);
    }
    this.cfg.voice.voice = voice;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "voice", voice);
  }

  /** Venice only: choose which hosted TTS model to use. */
  async setTtsModel(id: string): Promise<void> {
    const model = await this.venice.assertModelAllowed("tts", id);
    this.cfg.voice.ttsModel = id;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "tts_model", id);
    // Voices are model-specific; keep the current one only if the new model has it.
    if (model.voices.length > 0 && !model.voices.includes(this.cfg.voice.voice)) {
      this.cfg.voice.voice = model.voices[0];
      await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "voice", model.voices[0]);
      console.log(theme.dim(`  Voice reset to ${model.voices[0]} (the previous voice isn't available on ${id}).`));
    }
  }

  async setSpeed(speed: number): Promise<void> {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error("Speed must be between 0.25 and 4.");
    this.cfg.voice.speed = speed;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "speed", speed);
  }

  async setMicrophone(source: string): Promise<void> {
    await resolveMicrophone(source); // validates it exists
    this.cfg.voice.inputDevice = source;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "input_device", source);
  }

  /**
   * Records one utterance (push-to-talk: Enter to send, Ctrl+C to cancel)
   * and returns the transcript, or null if cancelled or nothing was heard.
   */
  async captureUtterance(rl: readline.Interface, signal: AbortSignal): Promise<string | null> {
    this.speaker.stop(); // barge-in: talking over Lattice silences it
    const mic = await resolveMicrophone(this.cfg.voice.inputDevice);
    const recording = startRecording(mic);
    const onAbort = () => recording.cancel();
    signal.addEventListener("abort", onAbort, { once: true });

    const indicator = startActivity("listening", "REC 0:00  —  Enter to send · Ctrl+C to cancel");
    const ticker = setInterval(() => {
      const s = Math.floor((Date.now() - recording.startedAt) / 1000);
      indicator.update(`REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}  —  Enter to send · Ctrl+C to cancel`);
    }, 250);

    // The Enter-to-send question must never outlive the recording, or it would
    // swallow the user's next typed line.
    const enterWait = new AbortController();
    let audio: Buffer;
    try {
      // Whichever comes first: Enter, Ctrl+C (abort), or the recording cap/failure.
      await Promise.race([
        rl.question("", { signal: AbortSignal.any([signal, enterWait.signal]) }).catch(() => undefined),
        recording.done.catch(() => undefined),
      ]);
      recording.stop();
      audio = await recording.done;
    } catch (err) {
      if (signal.aborted) return null;
      throw err;
    } finally {
      enterWait.abort();
      clearInterval(ticker);
      indicator.stop();
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) return null;

    const seconds = (Date.now() - recording.startedAt) / 1000;
    if (seconds < 0.4 || audio.length < 1024) {
      console.log(theme.dim("  (nothing heard — nothing sent)"));
      return null;
    }

    const working = startActivity("transcribing", "transcribing…");
    try {
      const transcript = await this.engine.transcribe(audio, signal);
      this.auditLog({ type: "voice_transcribed", seconds: Math.round(seconds * 10) / 10, engine: this.engine.name });
      if (!transcript.text) {
        console.log(theme.dim("  (didn't catch that — nothing sent)"));
        return null;
      }
      return transcript.text;
    } finally {
      working.stop();
      audio.fill(0); // don't leave raw voice audio lingering in memory
    }
  }

  /** Hooks for one streamed response; no-ops when voice output is off. */
  beginResponse(): ResponseSpeech {
    if (!this.outputEnabled) return { onText: () => {}, onPause: () => {}, onEnd: () => {} };
    this.speaker.stop(); // a new response supersedes anything still being read
    const text = new SpeakableText();
    const say = (chunks: string[]) => chunks.forEach((c) => this.speaker.enqueue(c));
    return {
      onText: (delta) => say(text.push(delta)),
      onPause: () => say(text.end()),
      onEnd: () => say(text.end()),
    };
  }

  /** Speaks arbitrary text immediately (used by /voice test). */
  say(text: string): void {
    this.speaker.enqueue(text);
  }

  stopSpeaking(): void {
    this.speaker.stop();
  }

  async idle(): Promise<void> {
    await this.speaker.idle();
  }

  dispose(): void {
    this.speaker.stop();
    this.local.dispose();
  }
}
