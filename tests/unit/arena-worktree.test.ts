// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import {
  arenaBranchName,
  assertCleanWorktree,
  autoCommitIfDirty,
  createWorktree,
  diffAgainstBase,
  getDiffStat,
  getHeadCommit,
  getUnifiedDiff,
  mergeWinner,
  removeWorktree,
} from "../../src/arena/worktree.js";

let repoRoot: string;
let worktreesDir: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-arena-repo-"));
  worktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-arena-worktrees-"));

  const git = simpleGit(repoRoot);
  await git.init(["-b", "main"]);
  await git.addConfig("user.name", "Test");
  await git.addConfig("user.email", "test@example.com");
  await fs.writeFile(path.join(repoRoot, "README.md"), "hello\n", "utf-8");
  await git.add(".");
  await git.commit("initial commit");
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
  await fs.rm(worktreesDir, { recursive: true, force: true });
});

describe("arenaBranchName", () => {
  it("sanitizes labels into safe branch-name segments", () => {
    expect(arenaBranchName("run1", "deepseek v4/flash")).toBe("arena/run1/deepseek-v4-flash");
  });
});

describe("assertCleanWorktree", () => {
  it("passes on a freshly committed repo", async () => {
    await expect(assertCleanWorktree(repoRoot)).resolves.toBeUndefined();
  });

  it("throws when there are uncommitted modifications", async () => {
    await fs.writeFile(path.join(repoRoot, "README.md"), "changed\n", "utf-8");
    await expect(assertCleanWorktree(repoRoot)).rejects.toThrow(/clean working tree/);
  });
});

describe("createWorktree / removeWorktree", () => {
  it("creates an isolated worktree on a new branch, and removes it cleanly", async () => {
    const branch = arenaBranchName("run1", "model-a");
    const worktreePath = await createWorktree(repoRoot, worktreesDir, branch);

    expect(await fs.readFile(path.join(worktreePath, "README.md"), "utf-8")).toBe("hello\n");

    // Isolated: editing the worktree must not touch the original repo's working tree.
    await fs.writeFile(path.join(worktreePath, "README.md"), "edited in worktree\n", "utf-8");
    expect(await fs.readFile(path.join(repoRoot, "README.md"), "utf-8")).toBe("hello\n");

    await removeWorktree(repoRoot, worktreePath, branch);

    await expect(fs.access(worktreePath)).rejects.toThrow();
    const branches = await simpleGit(repoRoot).branchLocal();
    expect(branches.all).not.toContain(branch);
  });
});

describe("autoCommitIfDirty + diffAgainstBase", () => {
  it("commits outstanding changes and reports an accurate diff against the base commit", async () => {
    const baseCommit = await getHeadCommit(repoRoot);
    const branch = arenaBranchName("run1", "model-b");
    const worktreePath = await createWorktree(repoRoot, worktreesDir, branch);

    await fs.writeFile(path.join(worktreePath, "new-file.txt"), "line one\nline two\n", "utf-8");
    const committed = await autoCommitIfDirty(worktreePath, "Arena: model-b");
    expect(committed).toBe(true);

    const diff = await diffAgainstBase(worktreePath, baseCommit);
    expect(diff.filesChanged).toBe(1);
    expect(diff.insertions).toBe(2);
    expect(diff.deletions).toBe(0);

    // Nothing left to commit the second time around.
    expect(await autoCommitIfDirty(worktreePath, "noop")).toBe(false);
  });
});

describe("getDiffStat / getUnifiedDiff", () => {
  it("shows the actual added content, not just counts — the whole point of reviewing before picking", async () => {
    const baseCommit = await getHeadCommit(repoRoot);
    const branch = arenaBranchName("run1", "model-d");
    const worktreePath = await createWorktree(repoRoot, worktreesDir, branch);

    await fs.writeFile(path.join(worktreePath, "feature.txt"), "a genuinely new line\n", "utf-8");
    await autoCommitIfDirty(worktreePath, "Arena: model-d");

    const stat = await getDiffStat(worktreePath, baseCommit);
    expect(stat).toMatch(/feature\.txt/);

    const diff = await getUnifiedDiff(worktreePath, baseCommit);
    expect(diff).toContain("+a genuinely new line");
  });

  it("reports no changes cleanly when a participant did nothing", async () => {
    const baseCommit = await getHeadCommit(repoRoot);
    const branch = arenaBranchName("run1", "model-e");
    const worktreePath = await createWorktree(repoRoot, worktreesDir, branch);

    expect(await getUnifiedDiff(worktreePath, baseCommit)).toBe("(no changes)");
    expect(await getDiffStat(worktreePath, baseCommit)).toBe("(no changes)");
  });
});

describe("mergeWinner", () => {
  it("merges a worktree's committed changes back onto the original branch, even while the worktree is still checked out", async () => {
    const branch = arenaBranchName("run1", "model-c");
    const worktreePath = await createWorktree(repoRoot, worktreesDir, branch);

    await fs.writeFile(path.join(worktreePath, "winner.txt"), "the winning change\n", "utf-8");
    await autoCommitIfDirty(worktreePath, "Arena: model-c");

    // git merge doesn't require the source branch to be checked out nowhere else —
    // that restriction is only for checkout/switch — so this must work worktree-and-all.
    await mergeWinner(repoRoot, branch);

    expect(await fs.readFile(path.join(repoRoot, "winner.txt"), "utf-8")).toBe("the winning change\n");

    await removeWorktree(repoRoot, worktreePath, branch);
    await expect(fs.access(worktreePath)).rejects.toThrow();
  });
});
