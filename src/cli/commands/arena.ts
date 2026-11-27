// Copyright (c) 2026 Jevante Boxley
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
import { formatOutcome } from "../../ui/arena-live.js";
import { FEATURES, featureOpening } from "../../ui/features.js";

export function renderScorecard(run: ArenaRun): string {
  const lines = run.results.map(
    (r, i) =>
      `${theme.dim(`${i + 1}.`)} ${theme.bold(r.label)}  ${formatOutcome(r)}\n` +
      `  files:${r.filesChanged}  +${r.insertions}/-${r.deletions}  ` +
      `tokens:${r.tokensUsed}  time:${(r.durationMs / 1000).toFixed(1)}s`,
  );
  const arena = FEATURES.arena;
  return renderBox(`${arena.glyph} ${arena.name}`, run.prompt.slice(0, 60), lines, arena.accent);
}

/** What to do after a race, by scorecard number. `prefix` is "/arena" in the REPL, "lattice arena" in a shell. */
export function arenaNextSteps(prefix: string): string {
  return `Next: ${prefix} diff 1  (see the code)  ·  ${prefix} pick 1  (merge it)  ·  ${prefix} clean  (discard all)`;
}

export type ModelSelection = { ok: true; models: string[] } | { ok: false; error: string };

/**
 * Reads a model choice typed as numbers from a listed catalog ("1 3 5", "1,3,5")
 * or as model ids, mixed freely. Duplicates are dropped; at least two are required.
 */
export function parseModelSelection(input: string, catalog: readonly string[]): ModelSelection {
  const picked: string[] = [];
  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    let id = token;
    if (/^\d+$/.test(token)) {
      const fromList = catalog[Number(token) - 1];
      if (!fromList) return { ok: false, error: `There is no model number ${token}. Pick numbers from 1 to ${catalog.length}.` };
      id = fromList;
    }
    if (!picked.includes(id)) picked.push(id);
  }
  if (picked.length < 2) return { ok: false, error: "Pick at least 2 models to race, e.g. 1 3" };
  return { ok: true, models: picked };
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
        console.log(theme.dim(`\nRun 'lattice arena diff <number>' for the full diff of one participant.`));
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
      console.error(chalk.red("Usage: lattice arena pick <number or label>"));
      return ExitCode.INVALID_USAGE;
    }
    const run = await findLatestOpenRun(cfg.dataDir, cfg.workspace);
    if (!run) {
      console.error(chalk.red("No open arena run found for this workspace. Run 'lattice arena list' to see past runs."));
      return ExitCode.GENERAL_FAILURE;
    }
    try {
      const resolved = await pickArenaWinner(cfg, run, label);
      console.log(theme.success(`Merged "${resolved.winner}" into the current branch. Other worktrees cleaned up.`));
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

  console.log(featureOpening("arena", `racing ${participants.length} models · ${promptText}`));
  console.log();

  try {
    const run = await runArena(cfg, promptText, participants, {
      testCommand,
      onProgress: (label, event) => {
        if (event.type === "start") console.log(theme.dim(`→ ${label} starting...`));
        if (event.type === "error") console.log(theme.error(`✗ ${label}: ${event.message}`));
        if (event.type === "done") console.log(`${label}  ${formatOutcome(event.result)}`);
      },
    });

    console.log("\n" + renderScorecard(run));
    console.log(theme.dim(`\n${arenaNextSteps("lattice arena")}`));
    return ExitCode.SUCCESS;
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    return ExitCode.GENERAL_FAILURE;
  }
}
