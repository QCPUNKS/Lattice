// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import type { LatticeConfig } from "../../config/index.js";
import { ExitCode } from "../exit-codes.js";
import {
  runArena,
  pickArenaWinner,
  cleanArena,
  getArenaDiffStats,
  getArenaParticipantDiff,
  type ArenaParticipantSpec,
} from "../../arena/orchestrator.js";
import { listArenaRuns, findLatestOpenRun, type ArenaRun } from "../../arena/store.js";
import { theme } from "../../ui/theme.js";
import { renderBox } from "../../ui/terminal.js";
import { colorizeDiff } from "../../ui/diff.js";

export function renderScorecard(run: ArenaRun): string {
  const lines = run.results.map((r) => {
    const testCol = r.testsPassed === null ? "—" : r.testsPassed ? theme.success("pass") : theme.error("fail");
    const statusCol = r.status === "ok" ? theme.success("ok") : theme.error(`error: ${r.error ?? "unknown"}`);
    return (
      `${theme.bold(r.label)}  ${statusCol}\n` +
      `  tests:${testCol}  files:${r.filesChanged}  +${r.insertions}/-${r.deletions}  ` +
      `tokens:${r.tokensUsed}  time:${(r.durationMs / 1000).toFixed(1)}s`
    );
  });
  return renderBox("arena", run.prompt.slice(0, 60), lines, theme.primary);
}

export interface ParsedArenaArgs {
  positional: string[];
  models?: string;
  tests?: string;
}

/** Same flag shape as the CLI's `--models`/`--tests`, minimally shell-aware for the REPL's "/arena ..." free-text input. */
export function parseArenaSlashArgs(input: string): ParsedArenaArgs {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }

  const positional: string[] = [];
  let models: string | undefined;
  let tests: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "--models") {
      models = tokens[++i];
    } else if (tokens[i] === "--tests") {
      tests = tokens[++i];
    } else {
      positional.push(tokens[i]);
    }
  }
  return { positional, models, tests };
}

/** True when `positional`/`models` describe one of the management subcommands rather than a new run. */
export function isArenaSubcommand(positional: string[], models: string | undefined): boolean {
  return !models && (positional[0] === "pick" || positional[0] === "clean" || positional[0] === "list" || positional[0] === "diff");
}

export async function runArenaCommand(
  cfg: LatticeConfig,
  positional: string[],
  models: string | undefined,
  testCommand: string | undefined,
): Promise<number> {
  const [sub, ...rest] = positional;
  // Only treat these as subcommands when --models wasn't given — a real "start a run" invocation
  // always requires --models, so this avoids misreading a prompt like "pick the best approach" as `arena pick`.
  const isSubcommand = isArenaSubcommand(positional, models);

  if (isSubcommand && sub === "diff") {
    const label = rest[0];
    const run = await findLatestOpenRun(cfg.dataDir, cfg.workspace);
    if (!run) {
      console.error(chalk.red("No open arena run found for this workspace. Run 'lattice arena list' to see past runs."));
      return ExitCode.GENERAL_FAILURE;
    }
    try {
      if (!label) {
        // No label: quick per-file overview across every participant, so you know where to look closer.
        const stats = await getArenaDiffStats(run);
        for (const s of stats) {
          console.log(theme.bold(`\n${s.label}`));
          console.log(theme.dim(s.stat));
        }
        console.log(theme.dim(`\nRun 'lattice arena diff <label>' for the full diff of one participant.`));
      } else {
        console.log(colorizeDiff(await getArenaParticipantDiff(run, label)));
      }
      return ExitCode.SUCCESS;
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      return ExitCode.GENERAL_FAILURE;
    }
  }

  if (isSubcommand && sub === "pick") {
    const label = rest[0];
    if (!label) {
      console.error(chalk.red("Usage: lattice arena pick <label>"));
      return ExitCode.INVALID_USAGE;
    }
    const run = await findLatestOpenRun(cfg.dataDir, cfg.workspace);
    if (!run) {
      console.error(chalk.red("No open arena run found for this workspace. Run 'lattice arena list' to see past runs."));
      return ExitCode.GENERAL_FAILURE;
    }
    try {
      await pickArenaWinner(cfg, run, label);
      console.log(theme.success(`Merged "${label}" into the current branch. Other worktrees cleaned up.`));
      return ExitCode.SUCCESS;
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      return ExitCode.GENERAL_FAILURE;
    }
  }

  if (isSubcommand && sub === "clean") {
    const run = await findLatestOpenRun(cfg.dataDir, cfg.workspace);
    if (!run) {
      console.log(theme.dim("No open arena run to clean up."));
      return ExitCode.SUCCESS;
    }
    await cleanArena(cfg, run);
    console.log(theme.success(`Cleaned up arena run ${run.id} — no changes were merged.`));
    return ExitCode.SUCCESS;
  }

  if (isSubcommand && sub === "list") {
    const runs = await listArenaRuns(cfg.dataDir);
    if (runs.length === 0) {
      console.log(theme.dim("No arena runs yet."));
      return ExitCode.SUCCESS;
    }
    for (const r of runs) {
      const statusColor = r.status === "open" ? theme.warning : r.status === "resolved" ? theme.success : theme.dim;
      console.log(`${r.id}  ${statusColor(`[${r.status}]`)}  ${r.prompt.slice(0, 60)}`);
    }
    return ExitCode.SUCCESS;
  }

  // Default: start a new arena run — `lattice arena "<prompt>" --models a,b,c [--tests "npm test"]`
  const promptText = positional.join(" ").trim();
  if (!promptText) {
    console.error(chalk.red('Usage: lattice arena "<what to do>" --models model-a,model-b[,model-c] [--tests "npm test"]'));
    return ExitCode.INVALID_USAGE;
  }
  if (!models) {
    console.error(chalk.red("--models is required: a comma-separated list of at least 2 model ids to race."));
    return ExitCode.INVALID_USAGE;
  }
  if (!cfg.veniceApiKey) {
    console.error(chalk.red("VENICE_API_KEY is not set. Run 'lattice doctor' for details."));
    return ExitCode.AUTHENTICATION_FAILURE;
  }

  const participants: ArenaParticipantSpec[] = models.split(",").map((m) => ({ model: m.trim() }));
  if (participants.length < 2) {
    console.error(chalk.red("Arena needs at least 2 models — got 1. Pass a comma-separated list, e.g. --models a,b"));
    return ExitCode.INVALID_USAGE;
  }

  console.log(theme.dim(`Racing ${participants.length} models on: ${promptText}\n`));

  try {
    const run = await runArena(cfg, promptText, participants, {
      testCommand,
      onProgress: (label, event) => {
        if (event.type === "start") console.log(theme.dim(`→ ${label} starting...`));
        if (event.type === "error") console.log(theme.error(`✗ ${label}: ${event.message}`));
        if (event.type === "done") {
          const ok = event.result.status === "ok";
          console.log((ok ? theme.success : theme.error)(`${ok ? "✓" : "✗"} ${label} finished`));
        }
      },
    });

    console.log("\n" + renderScorecard(run));
    console.log(
      theme.dim(
        `\nRun 'lattice arena diff [label]' to see the actual code before picking, ` +
          `'lattice arena pick <label>' to merge a winner into your branch, or 'lattice arena clean' to discard everything.`,
      ),
    );
    return ExitCode.SUCCESS;
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    return ExitCode.GENERAL_FAILURE;
  }
}
