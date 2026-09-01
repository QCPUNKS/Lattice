// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { simpleGit } from "simple-git";
import { existsSync } from "node:fs";
import path from "node:path";

/** Throws if the repo has staged, modified, deleted, or conflicted changes — arena needs a clean base to fork worktrees from. */
export async function assertCleanWorktree(repoRoot: string): Promise<void> {
  const status = await simpleGit(repoRoot).status();
  if (status.isClean()) return;
  const dirty = [...status.staged, ...status.modified, ...status.deleted, ...status.conflicted];
  throw new Error(
    `Arena requires a clean working tree — found uncommitted changes: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", ..." : ""}. Commit or stash first.`,
  );
}

export async function getHeadCommit(repoRoot: string): Promise<string> {
  const result = await simpleGit(repoRoot).revparse(["HEAD"]);
  return result.trim();
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function arenaBranchName(runId: string, label: string): string {
  return `arena/${runId}/${sanitizeLabel(label)}`;
}

/** Creates a git worktree on a new branch off `baseRef`, returning its filesystem path. */
export async function createWorktree(
  repoRoot: string,
  worktreesDir: string,
  branch: string,
  baseRef = "HEAD",
): Promise<string> {
  const worktreePath = path.join(worktreesDir, sanitizeLabel(branch.split("/").pop() ?? branch));
  await simpleGit(repoRoot).raw(["worktree", "add", "-b", branch, worktreePath, baseRef]);
  return worktreePath;
}

/** Commits any outstanding changes in a worktree so a later merge picks them up, even if the agent never called git_commit itself. Returns true if it committed something. */
export async function autoCommitIfDirty(worktreePath: string, message: string): Promise<boolean> {
  const git = simpleGit(worktreePath);
  const status = await git.status();
  if (status.isClean()) return false;
  await git.add(".");
  await git.commit(message);
  return true;
}

export interface DiffTotals {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** Diffs a worktree's current state (working tree + any commits) against the commit it was forked from. */
export async function diffAgainstBase(worktreePath: string, baseCommit: string): Promise<DiffTotals> {
  const summary = await simpleGit(worktreePath).diffSummary([baseCommit]);
  return { filesChanged: summary.files.length, insertions: summary.insertions, deletions: summary.deletions };
}

/** Compact per-file overview (like `git diff --stat`) — for scanning several participants at a glance. */
export async function getDiffStat(worktreePath: string, baseCommit: string): Promise<string> {
  const stat = await simpleGit(worktreePath).diff([baseCommit, "--stat"]);
  return stat.trim() || "(no changes)";
}

/** Full unified diff of a worktree against the commit it was forked from — the actual code, not just stats. */
export async function getUnifiedDiff(worktreePath: string, baseCommit: string): Promise<string> {
  const diff = await simpleGit(worktreePath).diff([baseCommit]);
  return diff || "(no changes)";
}

/** Tears down a worktree and its branch. Safe to call even if creation only partially succeeded. */
export async function removeWorktree(repoRoot: string, worktreePath: string, branch: string): Promise<void> {
  const git = simpleGit(repoRoot);
  if (existsSync(worktreePath)) {
    await git.raw(["worktree", "remove", "--force", worktreePath]).catch(() => {});
  }
  await git.raw(["branch", "-D", branch]).catch(() => {});
}

/** Merges a winning arena branch back onto the repo's currently checked-out branch. */
export async function mergeWinner(repoRoot: string, winningBranch: string): Promise<void> {
  await simpleGit(repoRoot).merge([winningBranch, "--no-ff", "-m", `Merge arena winner ${winningBranch}`]);
}
