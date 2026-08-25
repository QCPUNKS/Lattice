// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import * as readline from "node:readline/promises";
import chalk from "chalk";
import type { PermissionMode } from "../config/index.js";
import type { PermissionAction } from "../tools/registry.js";
import { type CommandRisk, riskLabel } from "./command-classifier.js";

export class PermissionDeniedError extends Error {
  constructor(action: string, detail: string) {
    super(`Permission denied for ${action}: ${detail}`);
    this.name = "PermissionDeniedError";
  }
}

/** Fixed risk tier for non-exec actions; "exec" always supplies its own via classifyCommand. */
const DEFAULT_RISK: Record<Exclude<PermissionAction, "exec">, CommandRisk> = {
  write: "safe",
  delete: "destructive",
  network: "caution",
  secret_read: "destructive", // always confirm before reading likely credentials
};

/**
 * Decides auto-allow vs. ask vs. deny for (mode, risk) pairs.
 * destructive/critical risk always asks — no mode auto-allows data loss or
 * system-level actions on the model's say-so alone.
 */
function needsConfirmation(mode: PermissionMode, risk: CommandRisk): boolean {
  if (risk === "destructive" || risk === "critical") return true;
  if (mode === "safe") return true;
  if (mode === "normal") return risk === "caution";
  return false; // mode === "auto" && risk is safe|caution
}

/**
 * Tracks per-session "always allow" decisions so the user isn't re-prompted
 * for the same (action, risk) combination repeatedly within one run.
 */
export class PermissionGate {
  private alwaysAllow = new Set<string>();

  constructor(
    private mode: PermissionMode,
    private rl: readline.Interface | null,
    private auditLog: (event: Record<string, unknown>) => void,
  ) {}

  async check(action: PermissionAction, detail: string, risk?: CommandRisk): Promise<void> {
    const effectiveRisk: CommandRisk = risk ?? DEFAULT_RISK[action as Exclude<PermissionAction, "exec">] ?? "caution";
    this.auditLog({ type: "permission_check", action, detail, risk: effectiveRisk, mode: this.mode });

    if (!needsConfirmation(this.mode, effectiveRisk)) {
      this.auditLog({ type: "permission_auto_allow", action, detail, risk: effectiveRisk });
      return;
    }

    const cacheKey = `${action}:${effectiveRisk}`;
    if (this.alwaysAllow.has(cacheKey)) return;

    if (!this.rl) {
      // Non-interactive context (e.g. `lattice exec`): fail closed rather than hang.
      this.auditLog({ type: "permission_denied_noninteractive", action, detail, risk: effectiveRisk });
      throw new PermissionDeniedError(
        action,
        `${detail} (requires confirmation but running non-interactively — rerun with --mode auto to allow caution-tier actions automatically, or use an interactive session)`,
      );
    }

    const severityColor =
      effectiveRisk === "critical" || effectiveRisk === "destructive" ? chalk.red : chalk.yellow;
    const label = `${chalk.yellow("lattice")} wants to ${chalk.bold(action)} [${severityColor(riskLabel(effectiveRisk))}]: ${detail}`;
    const answer = (
      await this.rl.question(`${label}\n  Allow? [y]es / [n]o / [a]lways this session: `)
    )
      .trim()
      .toLowerCase();

    if (answer === "a" || answer === "always") {
      this.alwaysAllow.add(cacheKey);
      this.auditLog({ type: "permission_granted_always", action, detail, risk: effectiveRisk });
      return;
    }
    if (answer === "y" || answer === "yes") {
      this.auditLog({ type: "permission_granted", action, detail, risk: effectiveRisk });
      return;
    }

    this.auditLog({ type: "permission_denied", action, detail, risk: effectiveRisk });
    throw new PermissionDeniedError(action, detail);
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  /** Session "always allow" decisions granted so far, for /permissions. */
  describeAllowances(): string[] {
    return [...this.alwaysAllow];
  }
}
