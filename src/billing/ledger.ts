// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensurePrivateDirSync, PRIVATE_FILE_MODE } from "../security/private-storage.js";

export type SpendKind = "chat" | "image" | "speech" | "transcription";

/**
 * One charge. Deliberately numbers-only: model, counts, dollars — never
 * prompts, replies, or transcripts, so the spend log is safe to keep forever.
 */
export interface SpendEntry {
  ts: string;
  session: string;
  kind: SpendKind;
  model: string;
  usd: number;
  /** "venice": the charge Venice reported. "estimate": computed from published prices. */
  source: "venice" | "estimate";
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  /** Images generated, characters spoken, or seconds transcribed. */
  units?: number;
}

export type NewSpend = Omit<SpendEntry, "ts" | "session">;

export interface SpendSummary {
  usd: number;
  requests: number;
}

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localMonth(d: Date): string {
  return localDay(d).slice(0, 7);
}

/**
 * Append-only spend log: one owner-only JSONL file per month under
 * <dataDir>/spend/. The current month is held in memory for instant
 * summaries; it's small (thousands of lines at most).
 */
export class SpendLedger {
  private entries: SpendEntry[] = [];
  private loadedMonth: string;
  private session = "none";
  private listeners: ((entry: SpendEntry) => void)[] = [];

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.loadedMonth = localMonth(this.now());
    this.entries = this.readMonth(this.loadedMonth);
  }

  setSession(id: string): void {
    this.session = id;
  }

  onRecord(listener: (entry: SpendEntry) => void): void {
    this.listeners.push(listener);
  }

  record(spend: NewSpend): SpendEntry {
    this.rollOverIfNewMonth();
    const entry: SpendEntry = { ts: this.now().toISOString(), session: this.session, ...spend };
    this.entries.push(entry);
    try {
      ensurePrivateDirSync(this.dir);
      appendFileSync(this.fileFor(this.loadedMonth), JSON.stringify(entry) + "\n", {
        encoding: "utf-8",
        mode: PRIVATE_FILE_MODE,
      });
    } catch {
      // Tracking must never break the agent; the in-memory totals stay correct.
    }
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  sessionTotal(): SpendSummary {
    return summarize(this.entries.filter((e) => e.session === this.session));
  }

  today(): SpendSummary {
    this.rollOverIfNewMonth();
    const day = localDay(this.now());
    return summarize(this.entries.filter((e) => localDay(new Date(e.ts)) === day));
  }

  month(): SpendSummary {
    this.rollOverIfNewMonth();
    return summarize(this.entries);
  }

  /** Month-to-date spend per model, most expensive first. */
  byModel(): { model: string; kind: SpendKind; usd: number; requests: number }[] {
    const totals = new Map<string, { model: string; kind: SpendKind; usd: number; requests: number }>();
    for (const e of this.entries) {
      const row = totals.get(e.model) ?? { model: e.model, kind: e.kind, usd: 0, requests: 0 };
      row.usd += e.usd;
      row.requests += 1;
      totals.set(e.model, row);
    }
    return [...totals.values()].sort((a, b) => b.usd - a.usd);
  }

  private rollOverIfNewMonth(): void {
    const month = localMonth(this.now());
    if (month !== this.loadedMonth) {
      this.loadedMonth = month;
      this.entries = this.readMonth(month);
    }
  }

  private fileFor(month: string): string {
    return path.join(this.dir, `${month}.jsonl`);
  }

  private readMonth(month: string): SpendEntry[] {
    const file = this.fileFor(month);
    if (!existsSync(file)) return [];
    const out: SpendEntry[] = [];
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as SpendEntry;
        if (typeof e.usd === "number" && typeof e.ts === "string") out.push(e);
      } catch {
        // skip a torn line from an interrupted write
      }
    }
    return out;
  }
}

function summarize(entries: SpendEntry[]): SpendSummary {
  return { usd: entries.reduce((sum, e) => sum + e.usd, 0), requests: entries.length };
}
