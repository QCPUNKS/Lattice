// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { LatticeConfig } from "../config/index.js";
import type { SpendLedger } from "../billing/ledger.js";
import type { VeniceHttp } from "../providers/venice-http.js";
import { VeniceSpeechClient, type Transcript, type VoiceModelInfo } from "../media/speech-client.js";
import { RECORDING_FILENAME, RECORDING_MIME_TYPE } from "../media/audio-io.js";
import { LocalVoiceService } from "./local-service.js";

export type VoiceEngineName = "local" | "venice";

/** Where speech is recognized and synthesized. The rest of voice doesn't care which. */
export interface SpeechEngine {
  readonly name: VoiceEngineName;
  /** One-line description for /voice (e.g. "local · whisper small.en on cuda"). */
  describe(): string;
  /** Readies what the given directions need (start/warm the local service, check model privacy). */
  prepare(needs: { input: boolean; output: boolean }): Promise<void>;
  transcribe(audio: Buffer, signal: AbortSignal): Promise<Transcript>;
  synthesize(text: string, signal: AbortSignal): Promise<Buffer>;
  voices(): Promise<string[]>;
  dispose(): void;
}

/** Free, offline, private: Whisper + Kokoro on this machine. */
export class LocalSpeechEngine implements SpeechEngine {
  readonly name = "local" as const;
  private readonly service: LocalVoiceService;
  private device = "…";

  constructor(private readonly cfg: LatticeConfig) {
    const v = cfg.voice;
    this.service = new LocalVoiceService({
      python: v.localPython,
      sttModel: v.localSttModel,
      sttDevice: v.localSttDevice,
      ttsModel: v.localTtsModel,
      ttsVoices: v.localTtsVoices,
    });
  }

  describe(): string {
    return `local · whisper ${this.cfg.voice.localSttModel} on ${this.device} · kokoro`;
  }

  problems(): string[] {
    return this.service.preflight();
  }

  async prepare(needs: { input: boolean; output: boolean }): Promise<void> {
    const health = await this.service.ready({ stt: needs.input, tts: needs.output });
    this.device = health.device;
  }

  /** Starts loading in the background so the first sentence isn't slow. */
  warmInBackground(needs: { input: boolean; output: boolean }): void {
    void this.prepare(needs).catch(() => {
      // surfaced on first real use instead
    });
  }

  transcribe(audio: Buffer, signal: AbortSignal): Promise<Transcript> {
    return this.service.transcribe(audio, this.cfg.voice.language, signal);
  }

  synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    return this.service.synthesize(text, this.cfg.voice.voice, this.cfg.voice.speed, signal);
  }

  voices(): Promise<string[]> {
    return this.service.voices();
  }

  dispose(): void {
    this.service.stop();
  }
}

const MODELS_TTL_MS = 10 * 60 * 1000;

/** Venice's hosted speech models: pay per use, private-only by default. */
export class VeniceSpeechEngine implements SpeechEngine {
  readonly name = "venice" as const;
  private readonly client: VeniceSpeechClient;
  private modelCache = new Map<"tts" | "asr", { at: number; models: VoiceModelInfo[] }>();

  constructor(
    http: VeniceHttp,
    private readonly cfg: LatticeConfig,
    private readonly ledger?: SpendLedger,
  ) {
    this.client = new VeniceSpeechClient(http);
  }

  describe(): string {
    return `venice · ${this.cfg.voice.sttModel} · ${this.cfg.voice.ttsModel}`;
  }

  async models(type: "tts" | "asr"): Promise<VoiceModelInfo[]> {
    const hit = this.modelCache.get(type);
    if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.models;
    const models = await this.client.listModels(type);
    this.modelCache.set(type, { at: Date.now(), models });
    return models;
  }

  async assertModelAllowed(type: "tts" | "asr", id: string): Promise<VoiceModelInfo> {
    const model = (await this.models(type)).find((m) => m.id === id);
    if (!model) throw new Error(`Unknown ${type === "tts" ? "voice" : "transcription"} model "${id}".`);
    if (this.cfg.voice.privateOnly && model.privacy !== "private") {
      throw new Error(`${id} is "${model.privacy}" (Venice forwards audio/text to a third party). Choose a private model or set [voice] private_only = false.`);
    }
    return model;
  }

  async prepare(needs: { input: boolean; output: boolean }): Promise<void> {
    if (needs.input) await this.assertModelAllowed("asr", this.cfg.voice.sttModel);
    if (needs.output) await this.assertModelAllowed("tts", this.cfg.voice.ttsModel);
  }

  async transcribe(audio: Buffer, signal: AbortSignal): Promise<Transcript> {
    const model = this.cfg.voice.sttModel;
    await this.assertModelAllowed("asr", model);
    const transcript = await this.client.transcribe(
      audio,
      { model, language: this.cfg.voice.language, mimeType: RECORDING_MIME_TYPE, filename: RECORDING_FILENAME },
      signal,
    );
    const rate = (await this.models("asr").catch(() => [])).find((m) => m.id === model)?.usdPerSecond ?? 0;
    const seconds = transcript.durationSeconds ?? 0;
    this.ledger?.record({ kind: "transcription", model, usd: seconds * rate, source: "estimate", units: Math.round(seconds * 10) / 10 });
    return transcript;
  }

  async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    const model = this.cfg.voice.ttsModel;
    const audio = await this.client.synthesize(text, { model, voice: this.cfg.voice.voice, speed: this.cfg.voice.speed }, signal);
    const rate = (await this.models("tts").catch(() => [])).find((m) => m.id === model)?.usdPerMillionChars ?? 0;
    this.ledger?.record({ kind: "speech", model, usd: (text.length * rate) / 1_000_000, source: "estimate", units: text.length });
    return audio;
  }

  async voices(): Promise<string[]> {
    return (await this.models("tts")).find((m) => m.id === this.cfg.voice.ttsModel)?.voices ?? [];
  }

  dispose(): void {}
}
