// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { theme } from "./theme.js";
import type { ArenaProgressEvent } from "../arena/orchestrator.js";

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Turns one orchestrator progress event into a single-line status for `label`. */
export function formatArenaStatus(label: string, event: ArenaProgressEvent): string {
  const name = theme.bold(label);
  switch (event.type) {
    case "start":
      return `${theme.warning("●")} ${name}  starting...`;
    case "tool_call":
      return `${theme.warning("●")} ${name}  → ${event.name}`;
    case "tool_result":
      return `${theme.warning("●")} ${name}  ${event.isError ? theme.error("✗") : theme.success("✓")} ${event.name}`;
    case "tests":
      return `${theme.warning("●")} ${name}  running tests: ${
        event.passed === null ? "…" : event.passed ? theme.success("pass") : theme.error("fail")
      }`;
    case "done": {
      const r = event.result;
      const ok = r.status === "ok";
      const testStr = r.testsPassed === null ? "" : `  tests:${r.testsPassed ? theme.success("pass") : theme.error("fail")}`;
      const icon = ok ? theme.success("✓") : theme.error("✗");
      return `${icon} ${name}  files:${r.filesChanged} +${r.insertions}/-${r.deletions}  tokens:${r.tokensUsed}  ${(r.durationMs / 1000).toFixed(1)}s${testStr}`;
    }
    case "error":
      return `${theme.error("✗")} ${name}  ${event.message}`;
  }
}

/**
 * Redraws one status line per arena participant in place — racing N models
 * reads as a live dashboard instead of N interleaved streams of scrollback.
 * Falls back to plain sequential printing when stdout isn't a TTY (piped/redirected).
 */
export class ArenaLiveView {
  private readonly lines = new Map<string, string>();
  private printedLineCount = 0;
  private readonly live: boolean;

  constructor(private readonly order: string[]) {
    this.live = process.stdout.isTTY === true;
    for (const label of order) {
      this.lines.set(label, `${theme.dim("○")} ${theme.bold(label)}  ${theme.dim("waiting...")}`);
    }
  }

  private redraw(): void {
    if (this.printedLineCount > 0) process.stdout.write(`\x1b[${this.printedLineCount}A`);
    for (const label of this.order) {
      process.stdout.write(`\x1b[2K${truncate(this.lines.get(label) ?? label, 110)}\n`);
    }
    this.printedLineCount = this.order.length;
  }

  update(label: string, status: string): void {
    this.lines.set(label, status);
    if (this.live) {
      this.redraw();
    } else {
      console.log(truncate(status, 110));
    }
  }

  /** Call once every participant has finished, before printing the scorecard below it. */
  finish(): void {
    if (this.live) process.stdout.write("\n");
  }
}
