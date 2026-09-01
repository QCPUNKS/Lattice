// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import type { ChatMessage } from "../providers/types.js";

/** Rough token estimate (~4 chars/token for English/code); good enough for budgeting, not billing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(msg: ChatMessage): number {
  let n = approxTokens(msg.content ?? "");
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      n += approxTokens(tc.function.name) + approxTokens(tc.function.arguments);
    }
  }
  return n + 4; // small per-message overhead (role, formatting)
}

export function estimateHistoryTokens(history: ChatMessage[]): number {
  return history.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

const FILE_ARG_TOOLS = new Set(["write_file", "edit_file", "create_file", "delete_file", "move_file", "copy_file"]);

/** Pulls file paths touched by write-ish tool calls out of a message, for the compaction summary. */
function extractTouchedPaths(msg: ChatMessage): string[] {
  if (!msg.tool_calls) return [];
  const paths: string[] = [];
  for (const tc of msg.tool_calls) {
    if (!FILE_ARG_TOOLS.has(tc.function.name)) continue;
    try {
      const args = JSON.parse(tc.function.arguments);
      if (args.path) paths.push(args.path);
      if (args.destination) paths.push(args.destination);
    } catch {
      // malformed arguments — nothing to extract
    }
  }
  return paths;
}

export interface CompactionResult {
  history: ChatMessage[];
  compacted: boolean;
  droppedMessages: number;
  tokensBefore: number;
  tokensAfter: number;
}

const RECENT_MESSAGES_KEPT = 16; // keep the most recent exchange intact for coherence
const TOOL_RESULT_TRUNCATE_AT = 200; // chars kept per stale tool result once compacted

/**
 * Compacts conversation history when it exceeds `budgetTokens`:
 * preserves the system prompt, the active objective (first user turn), and the
 * most recent exchange verbatim; summarizes everything else into one system
 * note (files touched, errors seen, turn count) and truncates stale tool output.
 */
export function compactHistory(
  history: ChatMessage[],
  budgetTokens: number,
  force = false,
): CompactionResult {
  const tokensBefore = estimateHistoryTokens(history);
  if ((!force && tokensBefore <= budgetTokens) || history.length <= RECENT_MESSAGES_KEPT + 2) {
    return { history, compacted: false, droppedMessages: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  const systemMsg = history[0];
  const firstUserIdx = history.findIndex((m) => m.role === "user");
  const firstUserMsg = firstUserIdx >= 0 ? history[firstUserIdx] : null;

  const recentStart = Math.max(history.length - RECENT_MESSAGES_KEPT, firstUserIdx + 1);
  const middle = history.slice(firstUserIdx + 1 >= 0 ? firstUserIdx + 1 : 1, recentStart);
  const recent = history.slice(recentStart);

  const touchedPaths = new Set<string>();
  const errors: string[] = [];
  let toolCallCount = 0;

  for (const msg of middle) {
    if (msg.role === "assistant") {
      extractTouchedPaths(msg).forEach((p) => touchedPaths.add(p));
      toolCallCount += msg.tool_calls?.length ?? 0;
    }
    if (msg.role === "tool" && typeof msg.content === "string" && /^error:/i.test(msg.content.trim())) {
      errors.push(`${msg.name ?? "tool"}: ${msg.content.trim().slice(0, 150)}`);
    }
  }

  const summaryLines = [
    `[Context compacted: ${middle.length} earlier messages summarized to stay within budget.]`,
    `Tool calls made: ${toolCallCount}`,
    touchedPaths.size > 0 ? `Files touched: ${[...touchedPaths].join(", ")}` : null,
    errors.length > 0 ? `Unresolved/seen errors: ${errors.slice(0, 5).join(" | ")}` : null,
  ].filter(Boolean);

  const summaryMsg: ChatMessage = {
    role: "system",
    content: summaryLines.join("\n"),
  };

  // Truncate any remaining large tool results in the kept "recent" window rather
  // than dropping them outright — they're still relevant to the active turn.
  const trimmedRecent = recent.map((m) => {
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > TOOL_RESULT_TRUNCATE_AT * 4) {
      return {
        ...m,
        content:
          m.content.slice(0, TOOL_RESULT_TRUNCATE_AT * 4) +
          `\n[...truncated during compaction, ${m.content.length} chars total...]`,
      };
    }
    return m;
  });

  const compacted: ChatMessage[] = [
    systemMsg,
    ...(firstUserMsg && firstUserMsg !== systemMsg ? [firstUserMsg] : []),
    summaryMsg,
    ...trimmedRecent,
  ];

  const tokensAfter = estimateHistoryTokens(compacted);
  return {
    history: compacted,
    compacted: true,
    droppedMessages: history.length - compacted.length,
    tokensBefore,
    tokensAfter,
  };
}
