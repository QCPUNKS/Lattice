// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { promises as fs, appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Structured audit trail. Every entry is appended to a local
 * JSONL file; with --debug, entries are also mirrored to stderr for live
 * diagnostics. Never receives secrets — callers are responsible for not
 * logging raw credential values (the permission gate only logs action/detail
 * strings, never file contents or command stdout).
 */
export function createAuditLogger(dataDir: string, debug: boolean): (event: Record<string, unknown>) => void {
  const logPath = path.join(dataDir, "audit.log");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  return (event: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    try {
      appendFileSync(logPath, line + "\n", "utf-8");
    } catch {
      // audit logging must never crash the agent
    }
    if (debug) {
      process.stderr.write(line + "\n");
    }
  };
}

export async function readAuditLog(dataDir: string, limit: number): Promise<string[]> {
  const logPath = path.join(dataDir, "audit.log");
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}
