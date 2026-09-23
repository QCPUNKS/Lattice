// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

/**
 * Turns streamed assistant markdown into speakable sentences, incrementally.
 *
 * Spoken output is for the conversation, not the artifacts: fenced code,
 * tables, and rules are replaced by a single short cue, markdown syntax is
 * stripped, and links read as their label. Text is released a sentence at a
 * time so speech can start while the model is still writing.
 */

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const RULE = /^\s*([-*_]\s*){3,}$/;
/** Sentence end: terminator (optionally closed by a quote/paren) followed by whitespace. */
const SENTENCE_END = /[.!?…]["')\]]?(?=\s)/g;
const CODE_CUE = "The code is on screen.";

/** Chunks shorter than this are held back and merged, to avoid a TTS request per fragment. */
const MIN_CHUNK_CHARS = 60;

export function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "") // headings
    .replace(/^\s*>\s?/, "") // blockquotes
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "") // list markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/<\/?[a-z][^>]*>/gi, "") // inline HTML
    .replace(/`([^`]*)`/g, "$1") // inline code → its text
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2") // italics
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export class SpeakableText {
  private pendingLine = "";
  private spoken = ""; // cleaned text not yet released
  private inFence = false;
  private cuedCurrentBlock = false;
  private releasedAny = false;

  /** Feed a streamed delta; returns chunks ready to speak (possibly none). */
  push(delta: string): string[] {
    this.pendingLine += delta;
    const lines = this.pendingLine.split("\n");
    this.pendingLine = lines.pop() ?? "";
    for (const line of lines) this.consumeLine(line, true);

    // Release whole sentences from a long in-progress prose line without
    // waiting for its newline — keeps speech latency low.
    if (!this.inFence && this.pendingLine && !looksLikeBlockStart(this.pendingLine)) {
      const cut = lastSentenceBoundary(this.pendingLine);
      if (cut > 0) {
        this.appendSpoken(cleanMarkdownLine(this.pendingLine.slice(0, cut)));
        this.pendingLine = this.pendingLine.slice(cut).replace(/^\s+/, "");
      }
    }
    return this.release(false);
  }

  /**
   * Releases everything held back. Call when the response is complete, or at
   * a natural pause (the agent starting a tool call) so held text isn't
   * delayed behind a long-running tool.
   */
  end(): string[] {
    if (this.pendingLine) this.consumeLine(this.pendingLine, false);
    this.pendingLine = "";
    return this.release(true);
  }

  private consumeLine(line: string, complete: boolean): void {
    if (FENCE.test(line)) {
      this.inFence = !this.inFence;
      if (this.inFence) this.cueSkippedBlock();
      else this.cuedCurrentBlock = false;
      return;
    }
    if (this.inFence) return;
    if (TABLE_ROW.test(line)) {
      this.cueSkippedBlock();
      return;
    }
    this.cuedCurrentBlock = false;
    if (RULE.test(line)) return;
    const cleaned = cleanMarkdownLine(line);
    if (!cleaned) return;
    // A heading or list item without terminal punctuation still ends a spoken phrase.
    this.appendSpoken(complete && !/[.!?…:;,]$/.test(cleaned) ? `${cleaned}.` : cleaned);
  }

  private cueSkippedBlock(): void {
    if (this.cuedCurrentBlock) return;
    this.cuedCurrentBlock = true;
    this.appendSpoken(CODE_CUE);
  }

  private appendSpoken(text: string): void {
    if (!text) return;
    this.spoken = this.spoken ? `${this.spoken} ${text}` : text;
  }

  private release(final: boolean): string[] {
    const text = this.spoken.trim();
    if (!text) return [];
    // First chunk goes out immediately for responsiveness; later ones batch.
    const threshold = this.releasedAny ? MIN_CHUNK_CHARS : 1;
    if (!final) {
      const cut = lastSentenceBoundary(text + " ");
      if (cut <= 0 || cut < threshold) return [];
      const ready = text.slice(0, cut).trim();
      this.spoken = text.slice(cut).trim();
      this.releasedAny = true;
      return ready ? [ready] : [];
    }
    this.spoken = "";
    this.releasedAny = true;
    return [text];
  }
}

function looksLikeBlockStart(partial: string): boolean {
  return /^\s*(`|~|\|)/.test(partial);
}

function lastSentenceBoundary(text: string): number {
  let cut = -1;
  for (const m of text.matchAll(SENTENCE_END)) cut = (m.index ?? 0) + m[0].length;
  return cut;
}

/** Splits text into ≤ max-char pieces on sentence (then word) boundaries, for the TTS request limit. */
export function splitForSynthesis(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = lastSentenceBoundary(window + " ");
    if (cut <= 0) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
