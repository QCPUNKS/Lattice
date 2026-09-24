// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import type { CommandRisk } from "../agent/command-classifier.js";

/** MCP's optional per-tool hints (the spec's ToolAnnotations). Servers may omit them; they're hints, not guarantees. */
export interface ToolHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/**
 * Tool names that mean "run whatever code the model wrote": these reach the
 * machine as fully as a shell does, so they're treated as destructive and
 * confirmed every time, in every mode.
 */
const CODE_EXECUTION = /(^|[_\-.])(exec|execute|eval|run|shell|script|code|python|bash|command)([_\-.]|$)/i;

/**
 * Risk tier for one MCP tool call. A name that looks like code execution
 * wins over any hint: a server claiming its eval tool is read-only is not
 * believed. Otherwise read-only hints are trusted as safe, destructive
 * hints are destructive, and anything else is caution (asks in normal mode).
 */
export function mcpToolRisk(toolName: string, hints: ToolHints | undefined): CommandRisk {
  if (CODE_EXECUTION.test(toolName)) return "destructive";
  if (hints?.destructiveHint === true) return "destructive";
  if (hints?.readOnlyHint === true) return "safe";
  return "caution";
}

const RISK_ORDER: CommandRisk[] = ["safe", "caution", "destructive", "critical"];

function isRisk(v: unknown): v is CommandRisk {
  return typeof v === "string" && (RISK_ORDER as string[]).includes(v);
}

/**
 * Applies a configured override to the computed risk. The user's own global
 * config may set any tier. A project config (it arrives with whatever repo was
 * cloned) may only raise the risk: it can never declare a code-execution tool
 * safe. Unknown values are ignored.
 */
export function applyRiskOverride(
  computed: CommandRisk,
  override: unknown,
  scope: "global" | "project",
): CommandRisk {
  if (!isRisk(override)) return computed;
  if (scope === "project" && RISK_ORDER.indexOf(override) < RISK_ORDER.indexOf(computed)) return computed;
  return override;
}

const PREVIEW_CHARS = 400;

/**
 * What the permission prompt shows for an MCP call: the tool plus its
 * arguments, with a code-like argument shown first and in full up to a
 * limit, so the user approves the actual code, not just a tool name.
 */
export function describeMcpCall(displayName: string, args: Record<string, unknown> | undefined): string {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return displayName;
  const codeFirst = entries.sort(([a], [b]) => Number(/code|script|command/i.test(b)) - Number(/code|script|command/i.test(a)));
  const body = codeFirst
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  return `${displayName}  ${body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}… (${body.length} chars)` : body}`;
}
