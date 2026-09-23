// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type * as readline from "node:readline/promises";
import type { LatticeConfig, VoiceMode } from "../config/index.js";
import { setGlobalConfigValue } from "../config/writer.js";
import type { VeniceHttp } from "../providers/venice-http.js";
import { VeniceSpeechClient, type VoiceModelInfo } from "../media/speech-client.js";
import {
  playAudio,
  resolveMicrophone,
  startRecording,
  checkAudioTools,
  RECORDING_FILENAME,
  RECORDING_MIME_TYPE,
} from "../media/audio-io.js";
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

const MODELS_TTL_MS = 10 * 60 * 1000;

/**
 * Owns the voice experience: mode, microphone capture, transcription, and
 * spoken replies. Audio lives only in memory; transcripts are never written
 * to the audit log (only durations are).
 */
export class VoiceController {
  private readonly speech: VeniceSpeechClient;
  private readonly speaker: Speaker;
  private modelCache = new Map<"tts" | "asr", { at: number; models: VoiceModelInfo[] }>();

  constructor(
    http: VeniceHttp,
    private readonly cfg: LatticeConfig,
    private readonly auditLog: (event: Record<string, unknown>) => void,
    private readonly ledger?: SpendLedger,
  ) {
    this.speech = new VeniceSpeechClient(http);
    this.speaker = new Speaker({
      synthesize: async (text, signal) => {
        const model = cfg.voice.ttsModel;
        const audio = await this.speech.synthesize(text, { model, voice: cfg.voice.voice, speed: cfg.voice.speed }, signal);
        void this.recordSpeech(model, text.length);
        return audio;
      },
      play: playAudio,
      onError: (err) => console.log(theme.error(`\n  [voice] ${err.message}`)),
    });
  }

  private async recordSpeech(model: string, characters: number): Promise<void> {
    if (!this.ledger) return;
    const rate = (await this.models("tts").catch(() => [])).find((m) => m.id === model)?.usdPerMillionChars ?? 0;
    this.ledger.record({ kind: "speech", model, usd: (characters * rate) / 1_000_000, source: "estimate", units: characters });
  }

  private async recordTranscription(model: string, seconds: number): Promise<void> {
    if (!this.ledger) return;
    const rate = (await this.models("asr").catch(() => [])).find((m) => m.id === model)?.usdPerSecond ?? 0;
    this.ledger.record({ kind: "transcription", model, usd: seconds * rate, source: "estimate", units: Math.round(seconds * 10) / 10 });
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

  /** Checks dependencies and model privacy before a mode that needs them is switched on. */
  async setMode(mode: VoiceMode): Promise<void> {
    if (mode !== "off") {
      const missing = await checkAudioTools();
      if (missing.length > 0) throw new Error(`Voice needs ${missing.join(", ")}. Install with: sudo apt install ffmpeg pulseaudio-utils`);
      if (voiceInputEnabled(mode)) {
        await resolveMicrophone(this.cfg.voice.inputDevice);
        await this.assertModelAllowed("asr", this.cfg.voice.sttModel);
      }
      if (voiceOutputEnabled(mode)) await this.assertModelAllowed("tts", this.cfg.voice.ttsModel);
    }
    if (!voiceOutputEnabled(mode)) this.speaker.stop();
    this.cfg.voice.mode = mode;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "mode", mode);
  }

  async models(type: "tts" | "asr"): Promise<VoiceModelInfo[]> {
    const hit = this.modelCache.get(type);
    if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.models;
    const models = await this.speech.listModels(type);
    this.modelCache.set(type, { at: Date.now(), models });
    return models;
  }

  private async assertModelAllowed(type: "tts" | "asr", id: string): Promise<VoiceModelInfo> {
    const model = (await this.models(type)).find((m) => m.id === id);
    if (!model) throw new Error(`Unknown ${type === "tts" ? "voice" : "transcription"} model "${id}".`);
    if (this.cfg.voice.privateOnly && model.privacy !== "private") {
      throw new Error(`${id} is "${model.privacy}" (Venice forwards audio/text to a third party). Choose a private model or set [voice] private_only = false.`);
    }
    return model;
  }

  async setVoice(voice: string): Promise<void> {
    const model = await this.assertModelAllowed("tts", this.cfg.voice.ttsModel);
    if (model.voices.length > 0 && !model.voices.includes(voice)) {
      throw new Error(`${model.id} has no voice "${voice}". /voice voices lists them.`);
    }
    this.cfg.voice.voice = voice;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "voice", voice);
  }

  async setTtsModel(id: string): Promise<void> {
    const model = await this.assertModelAllowed("tts", id);
    this.cfg.voice.ttsModel = id;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "voice", "tts_model", id);
    // Voices are model-specific; keep the current one only if the new model has it.
    if (model.voices.length > 0 && !model.voices.includes(this.cfg.voice.voice)) {
      await this.setVoice(model.voices[0]);
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
      await this.assertModelAllowed("asr", this.cfg.voice.sttModel);
      const transcript = await this.speech.transcribe(
        audio,
        {
          model: this.cfg.voice.sttModel,
          language: this.cfg.voice.language,
          mimeType: RECORDING_MIME_TYPE,
          filename: RECORDING_FILENAME,
        },
        signal,
      );
      this.auditLog({ type: "voice_transcribed", seconds: Math.round(seconds * 10) / 10, model: this.cfg.voice.sttModel });
      await this.recordTranscription(this.cfg.voice.sttModel, transcript.durationSeconds ?? seconds);
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
}
