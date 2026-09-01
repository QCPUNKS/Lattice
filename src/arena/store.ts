// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import path from "node:path";

export interface ArenaParticipantResult {
  label: string;
  model: string;
  branch: string;
  worktreePath: string;
  status: "ok" | "error";
  error?: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  tokensUsed: number;
  durationMs: number;
  /** null when no --tests command was given for this run. */
  testsPassed: boolean | null;
  testOutput: string;
}

export interface ArenaRun {
  id: string;
  workspace: string;
  prompt: string;
  testCommand?: string;
  createdAt: string;
  /** Commit every participant was forked from — diffs are computed against this. */
  baseCommit: string;
  results: ArenaParticipantResult[];
  status: "open" | "resolved" | "abandoned";
  winner?: string;
}

function arenaDir(dataDir: string): string {
  return path.join(dataDir, "arena");
}

function runPath(dataDir: string, runId: string): string {
  return path.join(arenaDir(dataDir), `${runId}.json`);
}

export async function saveArenaRun(dataDir: string, run: ArenaRun): Promise<void> {
  await fs.mkdir(arenaDir(dataDir), { recursive: true });
  await fs.writeFile(runPath(dataDir, run.id), JSON.stringify(run, null, 2), "utf-8");
}

export async function loadArenaRun(dataDir: string, runId: string): Promise<ArenaRun> {
  const raw = await fs.readFile(runPath(dataDir, runId), "utf-8");
  return JSON.parse(raw) as ArenaRun;
}

export async function listArenaRuns(dataDir: string): Promise<ArenaRun[]> {
  let files: string[];
  try {
    files = (await fs.readdir(arenaDir(dataDir))).filter((f) => f.endsWith(".json"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }

  const runs: ArenaRun[] = [];
  for (const file of files) {
    try {
      runs.push(JSON.parse(await fs.readFile(path.join(arenaDir(dataDir), file), "utf-8")) as ArenaRun);
    } catch {
      // skip unreadable/corrupt run files rather than failing the whole listing
      continue;
    }
  }
  return runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Finds the most recent still-open run for a workspace — used when the user says "arena pick x" without a run id. */
export async function findLatestOpenRun(dataDir: string, workspace: string): Promise<ArenaRun | null> {
  const runs = await listArenaRuns(dataDir);
  return runs.find((r) => r.workspace === workspace && r.status === "open") ?? null;
}
