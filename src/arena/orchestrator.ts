// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { LatticeConfig } from "../config/index.js";
import { buildRuntime } from "../cli/runtime.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { ChatMessage } from "../providers/types.js";
import {
  assertCleanWorktree,
  arenaBranchName,
  autoCommitIfDirty,
  createWorktree,
  diffAgainstBase,
  getDiffStat,
  getHeadCommit,
  getUnifiedDiff,
  mergeWinner,
  removeWorktree,
} from "./worktree.js";
import { saveArenaRun, type ArenaRun, type ArenaParticipantResult } from "./store.js";

export interface ArenaParticipantSpec {
  /** Model id passed straight through to the provider, e.g. "deepseek-v4-flash-0731". */
  model: string;
  /** Short display label; defaults to the model id. Used for branch names and the scorecard. */
  label?: string;
}

export type ArenaProgressEvent =
  | { type: "start" }
  | { type: "tool_call"; name: string }
  | { type: "tool_result"; name: string; isError: boolean }
  | { type: "tests"; passed: boolean | null }
  | { type: "done"; result: ArenaParticipantResult }
  | { type: "error"; message: string };

export interface ArenaRunOptions {
  /** Shell command run inside each worktree after the agent finishes, e.g. "npm test". Its exit code feeds the scorecard. */
  testCommand?: string;
  onProgress?: (label: string, event: ArenaProgressEvent) => void;
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output: output.slice(-4000) });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `Failed to launch test command: ${err.message}` });
    });
  });
}

function errorResult(label: string, spec: ArenaParticipantSpec, branch: string, message: string, startedAt: number): ArenaParticipantResult {
  return {
    label,
    model: spec.model,
    branch,
    worktreePath: "",
    status: "error",
    error: message,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
    testsPassed: null,
    testOutput: "",
  };
}

async function runParticipant(
  cfg: LatticeConfig,
  runId: string,
  worktreesDir: string,
  baseCommit: string,
  promptText: string,
  spec: ArenaParticipantSpec,
  options: ArenaRunOptions,
): Promise<ArenaParticipantResult> {
  const label = spec.label ?? spec.model;
  const branch = arenaBranchName(runId, label);
  const startedAt = Date.now();
  options.onProgress?.(label, { type: "start" });

  let worktreePath: string;
  try {
    worktreePath = await createWorktree(cfg.workspace, worktreesDir, branch);
  } catch (err) {
    const message = `Failed to create worktree: ${(err as Error).message}`;
    options.onProgress?.(label, { type: "error", message });
    return errorResult(label, spec, branch, message, startedAt);
  }

  const participantCfg: LatticeConfig = {
    ...cfg,
    workspace: worktreePath,
    model: spec.model,
    projectConfigDir: path.join(worktreePath, ".lattice"),
  };

  const runtime = await buildRuntime(participantCfg, { rl: null, debug: false });

  let tokensUsed = 0;
  const history: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(worktreePath, cfg.mode) },
    { role: "user", content: promptText },
  ];

  let status: ArenaParticipantResult["status"] = "ok";
  let errorMessage: string | undefined;

  try {
    await runtime.loop.run(history, runtime.ctx, {
      onToolCallStart: (name) => options.onProgress?.(label, { type: "tool_call", name }),
      onToolResult: (name, _result, isError) => options.onProgress?.(label, { type: "tool_result", name, isError }),
      onUsage: (approxTokens) => {
        tokensUsed = approxTokens;
      },
    });
  } catch (err) {
    status = "error";
    errorMessage = (err as Error).message;
    options.onProgress?.(label, { type: "error", message: errorMessage });
  } finally {
    await runtime.shutdown();
  }

  // Commit whatever the agent left behind, even if it never called git_commit itself —
  // otherwise a later merge would silently drop uncommitted work.
  await autoCommitIfDirty(worktreePath, `Arena: ${label} (${spec.model})`).catch(() => {});

  const diff = await diffAgainstBase(worktreePath, baseCommit).catch(() => ({
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  }));

  let testsPassed: boolean | null = null;
  let testOutput = "";
  if (status === "ok" && options.testCommand) {
    const result = await runShell(options.testCommand, worktreePath, cfg.commandTimeoutMs);
    testsPassed = result.exitCode === 0;
    testOutput = result.output;
    options.onProgress?.(label, { type: "tests", passed: testsPassed });
  }

  const participantResult: ArenaParticipantResult = {
    label,
    model: spec.model,
    branch,
    worktreePath,
    status,
    error: errorMessage,
    filesChanged: diff.filesChanged,
    insertions: diff.insertions,
    deletions: diff.deletions,
    tokensUsed,
    durationMs: Date.now() - startedAt,
    testsPassed,
    testOutput,
  };
  options.onProgress?.(label, { type: "done", result: participantResult });
  return participantResult;
}

/**
 * Races the same prompt across multiple models, each in its own isolated git
 * worktree/branch off the current HEAD, running concurrently. Nothing touches
 * the real workspace until `pickArenaWinner` merges a chosen result back.
 */
export async function runArena(
  cfg: LatticeConfig,
  promptText: string,
  participants: ArenaParticipantSpec[],
  options: ArenaRunOptions = {},
): Promise<ArenaRun> {
  if (participants.length < 2) {
    throw new Error("Arena needs at least 2 models to compare.");
  }

  await assertCleanWorktree(cfg.workspace);
  const baseCommit = await getHeadCommit(cfg.workspace);

  const runId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
  const worktreesDir = path.join(cfg.dataDir, "arena", runId, "worktrees");

  const results = await Promise.all(
    participants.map((p) => runParticipant(cfg, runId, worktreesDir, baseCommit, promptText, p, options)),
  );

  const run: ArenaRun = {
    id: runId,
    workspace: cfg.workspace,
    prompt: promptText,
    testCommand: options.testCommand,
    createdAt: new Date().toISOString(),
    baseCommit,
    results,
    status: "open",
  };
  await saveArenaRun(cfg.dataDir, run);
  return run;
}

function findParticipantOrThrow(run: ArenaRun, label: string): ArenaParticipantResult {
  const participant = run.results.find((r) => r.label === label);
  if (!participant) {
    throw new Error(`No arena participant labeled "${label}" in run ${run.id}. Options: ${run.results.map((r) => r.label).join(", ")}`);
  }
  if (!participant.worktreePath) {
    throw new Error(`"${label}" never produced a worktree to diff (${participant.error ?? "unknown error"}).`);
  }
  return participant;
}

/** Compact per-file stat for every participant still available in this run — for scanning before drilling into one. */
export async function getArenaDiffStats(run: ArenaRun): Promise<{ label: string; stat: string }[]> {
  const usable = run.results.filter((r) => r.worktreePath);
  return Promise.all(
    usable.map(async (r) => ({ label: r.label, stat: await getDiffStat(r.worktreePath, run.baseCommit) })),
  );
}

/** Full unified diff for one participant — the actual code change, for a real before-you-pick review. */
export async function getArenaParticipantDiff(run: ArenaRun, label: string): Promise<string> {
  const participant = findParticipantOrThrow(run, label);
  return getUnifiedDiff(participant.worktreePath, run.baseCommit);
}

/** Merges the chosen participant's branch back onto the current branch, then tears down every worktree for this run. */
export async function pickArenaWinner(cfg: LatticeConfig, run: ArenaRun, label: string): Promise<ArenaRun> {
  const winner = run.results.find((r) => r.label === label);
  if (!winner) {
    throw new Error(`No arena participant labeled "${label}" in run ${run.id}. Options: ${run.results.map((r) => r.label).join(", ")}`);
  }
  if (winner.status !== "ok") {
    throw new Error(`Participant "${label}" did not finish successfully (${winner.status}: ${winner.error ?? "unknown error"}) — nothing to merge.`);
  }

  await assertCleanWorktree(cfg.workspace);
  await mergeWinner(cfg.workspace, winner.branch);

  for (const r of run.results) {
    if (r.worktreePath) await removeWorktree(cfg.workspace, r.worktreePath, r.branch);
  }

  const updated: ArenaRun = { ...run, status: "resolved", winner: label };
  await saveArenaRun(cfg.dataDir, updated);
  return updated;
}

/** Discards every worktree/branch for a run without merging anything. */
export async function cleanArena(cfg: LatticeConfig, run: ArenaRun): Promise<ArenaRun> {
  for (const r of run.results) {
    if (r.worktreePath) await removeWorktree(cfg.workspace, r.worktreePath, r.branch);
  }
  const updated: ArenaRun = { ...run, status: "abandoned" };
  await saveArenaRun(cfg.dataDir, updated);
  return updated;
}
