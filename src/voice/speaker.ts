// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { MAX_TTS_CHARS } from "../media/speech-client.js";
import { splitForSynthesis } from "./speakable-text.js";

export interface SpeakerDeps {
  synthesize(text: string, signal: AbortSignal): Promise<Buffer>;
  play(audio: Buffer): { done: Promise<void>; stop(): void };
  onSpeakingChange?(speaking: boolean): void;
  onError?(err: Error): void;
}

/**
 * Ordered speech output. Synthesis of the next chunk overlaps playback of the
 * current one (no dead air between sentences); stop() cuts everything off at
 * once — in-flight requests are aborted and queued text is discarded — so the
 * user can interrupt at any moment.
 */
export class Speaker {
  private queue: Promise<Buffer | null>[] = [];
  private abort = new AbortController();
  private current: { stop(): void } | null = null;
  private draining = false;
  private speaking = false;

  constructor(private readonly deps: SpeakerDeps) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  enqueue(text: string): void {
    const signal = this.abort.signal;
    for (const piece of splitForSynthesis(text, MAX_TTS_CHARS)) {
      // Start synthesis now; playback awaits it in order.
      const pending = this.deps.synthesize(piece, signal).catch((err: Error) => {
        if (!signal.aborted) this.deps.onError?.(err);
        return null;
      });
      this.queue.push(pending);
    }
    void this.drain();
  }

  /** Stops current playback and drops everything queued. */
  stop(): void {
    this.abort.abort();
    this.abort = new AbortController();
    this.queue = [];
    this.current?.stop();
    this.current = null;
    this.setSpeaking(false);
  }

  /** Resolves once everything queued so far has finished playing (or was stopped). */
  async idle(): Promise<void> {
    while (this.draining) await new Promise((r) => setTimeout(r, 25));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const signal = this.abort.signal;
        const next = this.queue.shift()!;
        const audio = await next;
        if (signal.aborted || !audio || audio.length === 0) continue;
        this.setSpeaking(true);
        const playback = this.deps.play(audio);
        this.current = playback;
        await playback.done;
        if (this.current === playback) this.current = null;
      }
    } finally {
      this.draining = false;
      this.setSpeaking(false);
    }
  }

  private setSpeaking(on: boolean): void {
    if (this.speaking === on) return;
    this.speaking = on;
    this.deps.onSpeakingChange?.(on);
  }
}
