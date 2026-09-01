// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { compactHistory, estimateHistoryTokens, approxTokens } from "../../src/agent/context.js";
import type { ChatMessage } from "../../src/providers/types.js";

function bigHistory(turns: number): ChatMessage[] {
  const history: ChatMessage[] = [{ role: "system", content: "You are Lattice." }];
  for (let i = 0; i < turns; i++) {
    history.push({ role: "user", content: `Do task ${i}. ${"x".repeat(500)}` });
    history.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id: `c${i}`, type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: `file${i}.ts`, content: "x" }) } }],
    });
    history.push({ role: "tool", tool_call_id: `c${i}`, name: "write_file", content: "x".repeat(500) });
  }
  return history;
}

describe("approxTokens / estimateHistoryTokens", () => {
  it("scales roughly with text length", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
});

describe("compactHistory", () => {
  it("leaves small histories untouched", () => {
    const history = bigHistory(1);
    const result = compactHistory(history, 100_000);
    expect(result.compacted).toBe(false);
    expect(result.history).toBe(history);
  });

  it("compacts large histories and shrinks token usage", () => {
    const history = bigHistory(50);
    const before = estimateHistoryTokens(history);
    const result = compactHistory(history, 2_000);
    expect(result.compacted).toBe(true);
    expect(result.tokensAfter).toBeLessThan(before);
    // system prompt always survives compaction
    expect(result.history[0].role).toBe("system");
  });

  it("preserves the most recent messages verbatim", () => {
    const history = bigHistory(50);
    const result = compactHistory(history, 2_000);
    const tail = history.slice(-4);
    const compactedTail = result.history.slice(-4);
    expect(compactedTail.map((m) => m.role)).toEqual(tail.map((m) => m.role));
  });

  it("force=true compacts even under budget", () => {
    const history = bigHistory(50);
    const result = compactHistory(history, 10_000_000, true);
    expect(result.compacted).toBe(true);
  });
});
