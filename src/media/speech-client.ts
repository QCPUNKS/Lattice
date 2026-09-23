// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { VeniceHttp } from "../providers/venice-http.js";
import type { ModelPrivacy } from "./image-catalog.js";

/** Venice's per-request TTS input limit. */
export const MAX_TTS_CHARS = 4096;

export interface Transcript {
  text: string;
  durationSeconds: number | null;
}

export interface VoiceModelInfo {
  id: string;
  privacy: ModelPrivacy;
  voices: string[];
  /** USD per million input characters (speech models), when reported. */
  usdPerMillionChars: number | null;
  /** USD per second of audio (transcription models), when reported. */
  usdPerSecond: number | null;
}

export class VeniceSpeechClient {
  constructor(private readonly http: VeniceHttp) {}

  async transcribe(
    audio: Buffer,
    opts: { model: string; language?: string; mimeType?: string; filename?: string },
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: opts.mimeType ?? "audio/flac" }), opts.filename ?? "speech.flac");
    form.append("model", opts.model);
    form.append("response_format", "json");
    if (opts.language) form.append("language", opts.language);

    // No Content-Type header: fetch sets the multipart boundary itself.
    const res = await this.http.request(
      "/audio/transcriptions",
      { method: "POST", headers: this.http.authHeaders(), body: form },
      signal,
    );
    const data: any = await res.json();
    return {
      text: typeof data?.text === "string" ? data.text.trim() : "",
      durationSeconds: typeof data?.duration === "number" ? data.duration : null,
    };
  }

  /** Returns MP3 bytes for `text` (≤ 4096 chars). */
  async synthesize(
    text: string,
    opts: { model: string; voice: string; speed: number },
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (text.length > MAX_TTS_CHARS) throw new Error(`Speech text exceeds ${MAX_TTS_CHARS} characters.`);
    const res = await this.http.request(
      "/audio/speech",
      {
        method: "POST",
        headers: this.http.jsonHeaders(),
        body: JSON.stringify({
          model: opts.model,
          input: text,
          voice: opts.voice,
          speed: opts.speed,
          response_format: "mp3",
        }),
      },
      signal,
    );
    return Buffer.from(await res.arrayBuffer());
  }

  /** Speech models of a kind: "tts" (voices) or "asr" (transcription). */
  async listModels(type: "tts" | "asr"): Promise<VoiceModelInfo[]> {
    const res = await this.http.request(`/models?type=${type}`, { method: "GET", headers: this.http.authHeaders() });
    const body: any = await res.json();
    const raw: any[] = Array.isArray(body?.data) ? body.data : [];
    return raw.map((m) => {
      const spec = m?.model_spec ?? {};
      return {
        id: String(m.id),
        privacy: spec.privacy === "private" || spec.privacy === "anonymized" ? spec.privacy : "unknown",
        voices: Array.isArray(spec.voices) ? spec.voices.map(String) : [],
        usdPerMillionChars: typeof spec.pricing?.input?.usd === "number" ? spec.pricing.input.usd : null,
        usdPerSecond: typeof spec.pricing?.per_audio_second?.usd === "number" ? spec.pricing.per_audio_second.usd : null,
      };
    });
  }
}
