// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { MarkdownStream } from "./stream.js";

export interface ReplyWriter {
  /** Writes already-sanitized reply text. */
  push(text: string): void;
  /** Ends the current reply segment (before a tool call, or at the end of a turn). */
  finish(): void;
}

/**
 * Where a model reply goes: rendered markdown on a terminal, the raw
 * markdown when piped — scripts and logs want the source, not escape codes.
 */
export function createReplyWriter(out: NodeJS.WriteStream = process.stdout): ReplyWriter {
  if (!out.isTTY) {
    return { push: (text) => void out.write(text), finish: () => {} };
  }
  return new MarkdownStream({ write: (text) => void out.write(text), columns: () => out.columns || 80 });
}
