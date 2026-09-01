// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { theme } from "../../ui/theme.js";
import type { LatticeConfig } from "../../config/index.js";
import * as actions from "../actions.js";
import { simpleGit } from "simple-git";
import { readAuditLog } from "../../audit/log.js";
import { ExitCode } from "../exit-codes.js";
import { detectProjectTypeHandler, inspectProjectHandler } from "../../tools/project.js";
import type { ToolContext } from "../../tools/registry.js";

function silentCtx(cfg: LatticeConfig): ToolContext {
  return {
    workspace: cfg.workspace,
    requirePermission: async () => {},
    log: () => {},
  };
}

export async function runInspectCommand(cfg: LatticeConfig): Promise<number> {
  console.log(await inspectProjectHandler({}, silentCtx(cfg)));
  console.log();
  console.log(theme.dim("Detected markers:"));
  console.log(await detectProjectTypeHandler({}, silentCtx(cfg)));
  return ExitCode.SUCCESS;
}

export async function runStatusCommand(cfg: LatticeConfig): Promise<number> {
  console.log(theme.bold("Git:"));
  console.log("  " + (await actions.gitStatusSummary(cfg.workspace)));
  console.log();
  console.log(theme.bold("Processes:"));
  console.log(actions.formatProcessList());
  return ExitCode.SUCCESS;
}

export async function runDiffCommand(cfg: LatticeConfig, file: string | undefined): Promise<number> {
  try {
    const g = simpleGit(cfg.workspace);
    const diff = file ? await g.diff(["--", file]) : await g.diff();
    console.log(diff || theme.dim("(no changes)"));
    return ExitCode.SUCCESS;
  } catch (err) {
    console.error(theme.error(`Not a git repository or git error: ${(err as Error).message}`));
    return ExitCode.GENERAL_FAILURE;
  }
}

export async function runTestCommand(cfg: LatticeConfig): Promise<number> {
  const result = await actions.runDetectedCommand(cfg.workspace, "test", cfg.commandTimeoutMs);
  if (!result) {
    console.log(theme.dim("No test command detected for this project."));
    return ExitCode.VERIFICATION_FAILURE;
  }
  console.log(`$ ${result.command}`);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.log(theme.dim(result.stderr));
  const ok = result.exitCode === 0;
  console.log(ok ? theme.success(`✓ passed (${result.durationMs}ms)`) : theme.error(`✗ exit code ${result.exitCode}`));
  return ok ? ExitCode.SUCCESS : ExitCode.VERIFICATION_FAILURE;
}

export async function runBuildCommand(cfg: LatticeConfig): Promise<number> {
  const result = await actions.runDetectedCommand(cfg.workspace, "build", cfg.commandTimeoutMs);
  if (!result) {
    console.log(theme.dim("No build command detected for this project."));
    return ExitCode.VERIFICATION_FAILURE;
  }
  console.log(`$ ${result.command}`);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.log(theme.dim(result.stderr));
  const ok = result.exitCode === 0;
  console.log(ok ? theme.success(`✓ build succeeded (${result.durationMs}ms)`) : theme.error(`✗ exit code ${result.exitCode}`));
  return ok ? ExitCode.SUCCESS : ExitCode.VERIFICATION_FAILURE;
}

export async function runRunCommand(cfg: LatticeConfig): Promise<number> {
  const result = await actions.runProject(cfg.workspace);
  if (!result) {
    console.log(theme.dim("No dev/start script detected for this project."));
    return ExitCode.GENERAL_FAILURE;
  }
  console.log(theme.success(`${result.reused ? "Reusing" : "Started"} ${result.processId}: ${result.command}`));
  console.log(theme.dim("Use `lattice ps` to check on it and `lattice stop <id>` to stop it."));
  return ExitCode.SUCCESS;
}

export function runPsCommand(): number {
  console.log(actions.formatProcessList());
  return ExitCode.SUCCESS;
}

export function runStopCommand(id: string | undefined): number {
  if (!id) {
    console.error(theme.error("Usage: lattice stop <process-id>"));
    return ExitCode.INVALID_USAGE;
  }
  console.log(actions.stopProcessById(id));
  return ExitCode.SUCCESS;
}

export async function runAuditCommand(cfg: LatticeConfig, limitArg: string | undefined): Promise<number> {
  const limit = limitArg ? Number(limitArg) : 50;
  const lines = await readAuditLog(cfg.dataDir, Number.isFinite(limit) ? limit : 50);
  if (lines.length === 0) {
    console.log(theme.dim("No audit entries yet."));
    return ExitCode.SUCCESS;
  }
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      console.log(`${event.ts}  ${event.type ?? "event"}  ${JSON.stringify({ ...event, ts: undefined, type: undefined })}`);
    } catch {
      console.log(line);
    }
  }
  return ExitCode.SUCCESS;
}
// You Dont get a comment on this one cuz Im tired of yall... Needing to know what my code does and shiit.. figure it out how about that... I..I'm sorry that was rude of me. Truth is there was this date I went on.. And let me tell ya she was a real pain in my ass...
// The rest of that story lives in STORY.md — if you dare. (fair warning: it earns the warning at the top of that file)
