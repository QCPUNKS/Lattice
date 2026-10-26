// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLatticeDirGitignored } from "../../src/project/memory.js";
import { renderBox } from "../../src/ui/terminal.js";

let root: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", ...args], { cwd, encoding: "utf-8" });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-ignore-test-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("ensureLatticeDirGitignored", () => {
  it("adds .lattice/ to .gitignore in a main checkout, once", async () => {
    git(root, "init", "-q");
    expect(await ensureLatticeDirGitignored(root)).toBe(true);
    expect(await ensureLatticeDirGitignored(root)).toBe(false);
    const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
    expect(gitignore.match(/^\.lattice\/$/gm)).toHaveLength(1);
  });

  it("leaves a linked worktree's tracked files untouched and still ignores .lattice/", async () => {
    const main = path.join(root, "main");
    const worktree = path.join(root, "participant");
    await fs.mkdir(main);
    git(main, "init", "-q");
    await fs.writeFile(path.join(main, "app.js"), "export {};\n");
    git(main, "add", "-A");
    git(main, "commit", "-qm", "base");
    git(main, "worktree", "add", "-q", "-b", "participant", worktree);

    expect(await ensureLatticeDirGitignored(worktree)).toBe(true);
    await fs.mkdir(path.join(worktree, ".lattice"));
    await fs.writeFile(path.join(worktree, ".lattice", "context.md"), "notes\n");

    expect(existsSync(path.join(worktree, ".gitignore"))).toBe(false);
    expect(git(worktree, "status", "--porcelain")).toBe("");
  });

  it("does nothing outside a git repository", async () => {
    expect(await ensureLatticeDirGitignored(root)).toBe(false);
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
  });
});

describe("renderBox", () => {
  it("borders every line of a multi-line entry at the same width", () => {
    const box = renderBox("arena", "title", ["first entry\n  second line", "short"]).split("\n");
    const body = box.slice(1, -1);
    expect(body).toHaveLength(3);
    for (const line of body) {
      const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
      expect(plain.startsWith("│")).toBe(true);
      expect(plain.endsWith("│")).toBe(true);
      expect(plain.length).toBe(box[0].replace(/\x1b\[[0-9;]*m/g, "").length);
    }
  });
});
