// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { theme } from "../../ui/theme.js";
import type { LatticeConfig } from "../../config/index.js";
import * as actions from "../actions.js";
import { simpleGit } from "simple-git";
import { readAuditLog } from "../../audit/log.js";
import { ExitCode } from "../exit-codes.js";
import { runAttached } from "../../tools/shell.js";
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

/**
 * Runs the dev/start script in the foreground, like `npm run dev`. Background
 * processes only live as long as the Lattice that started them, so a one-shot
 * CLI can't hand one off; `/run` inside a chat is the background version.
 */
export async function runRunCommand(cfg: LatticeConfig): Promise<number> {
  const command = await actions.detectDevCommand(cfg.workspace);
  if (!command) {
    console.log(theme.dim("No dev/start script detected for this project."));
    return ExitCode.GENERAL_FAILURE;
  }
  console.log(theme.dim(`$ ${command}  (Ctrl+C to stop)`));
  try {
    return await runAttached(command, cfg.workspace);
  } catch (err) {
    console.error(theme.error(`Could not start ${command}: ${(err as Error).message}`));
    return ExitCode.GENERAL_FAILURE;
  }
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
