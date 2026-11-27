// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, statSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePrivateDir, writePrivateFile, tightenTree, repairPrivateStorage } from "../../src/security/private-storage.js";
import { saveSession, createSession } from "../../src/sessions/index.js";
import { updateGlobalConfig } from "../../src/config/writer.js";

const mode = (p: string) => statSync(p).mode & 0o777;

let root: string;
let oldUmask: number;
beforeEach(async () => {
  oldUmask = process.umask(0o002); // the user's real umask: group-writable by default
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-priv-"));
});
afterEach(async () => {
  process.umask(oldUmask);
  await fs.rm(root, { recursive: true, force: true });
});

describe("private storage", () => {
  it("creates owner-only dirs and files regardless of umask", async () => {
    const dir = path.join(root, "a", "b");
    await ensurePrivateDir(dir);
    await writePrivateFile(path.join(dir, "f.json"), "{}");
    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, "f.json"))).toBe(0o600);
  });

  it("repairs permissive legacy data, skipping symlinks", async () => {
    const sessions = path.join(root, "sessions");
    await fs.mkdir(sessions, { mode: 0o775 });
    await fs.chmod(sessions, 0o775);
    await fs.writeFile(path.join(sessions, "old.json"), "{}", { mode: 0o664 });
    const outside = path.join(os.tmpdir(), `lattice-outside-${process.pid}`);
    await fs.writeFile(outside, "x", { mode: 0o644 });
    await fs.chmod(outside, 0o644);
    await fs.symlink(outside, path.join(sessions, "link"));
    try {
      expect(tightenTree(root)).toBeGreaterThanOrEqual(2);
      expect(mode(sessions)).toBe(0o700);
      expect(mode(path.join(sessions, "old.json"))).toBe(0o600);
      expect(mode(outside)).toBe(0o644); // symlink target untouched
      expect(lstatSync(path.join(sessions, "link")).isSymbolicLink()).toBe(true);
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it("saves sessions owner-only (they contain full conversations and voice transcripts)", async () => {
    const dir = path.join(root, "sessions");
    const s = createSession("/w", "m", "normal");
    await saveSession(dir, s);
    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, `${s.id}.json`))).toBe(0o600);
  });

  it("writes the global config (which can hold the API key) owner-only", async () => {
    const cfgDir = path.join(root, "config");
    const file = await updateGlobalConfig(cfgDir, (t) => {
      t.venice = { api_key: "secret" };
    });
    expect(mode(cfgDir)).toBe(0o700);
    expect(mode(file)).toBe(0o600);
    await updateGlobalConfig(cfgDir, (t) => {
      t.image = { safe_mode: false };
    });
    expect(await fs.readFile(file, "utf-8")).toContain("api_key"); // read-modify-write keeps other keys
  });
});

describe("repairPrivateStorage", () => {
  it("tightens Lattice's private data but never touches code in arena worktrees", async () => {
    const data = path.join(root, "data");
    const config = path.join(root, "config");
    const worktree = path.join(data, "arena", "run1", "worktrees", "model-a");
    await fs.mkdir(worktree, { recursive: true });
    await fs.mkdir(path.join(data, "sessions"), { recursive: true });
    await fs.mkdir(config, { recursive: true });
    const script = path.join(worktree, "test.sh");
    await fs.writeFile(script, "#!/bin/sh\n");
    await fs.chmod(script, 0o755);
    await fs.writeFile(path.join(data, "audit.log"), "", { mode: 0o664 });
    await fs.writeFile(path.join(data, "sessions", "s.json"), "{}", { mode: 0o664 });
    await fs.writeFile(path.join(data, "arena", "run1.json"), "{}", { mode: 0o664 });
    await fs.writeFile(path.join(config, "config.toml"), "", { mode: 0o664 });
    const venvPython = path.join(data, "voice-env", "bin", "python");
    await fs.mkdir(path.dirname(venvPython), { recursive: true });
    await fs.writeFile(venvPython, "");
    await fs.chmod(venvPython, 0o755);
    await fs.chmod(data, 0o775);

    repairPrivateStorage(data, config);

    expect(mode(data)).toBe(0o700);
    expect(mode(path.join(data, "audit.log"))).toBe(0o600);
    expect(mode(path.join(data, "sessions", "s.json"))).toBe(0o600);
    expect(mode(path.join(data, "arena", "run1.json"))).toBe(0o600);
    expect(mode(path.join(config, "config.toml"))).toBe(0o600);
    expect(mode(script)).toBe(0o755); // the user's code is untouched and still executable
    expect(mode(venvPython)).toBe(0o755); // the local voice install still runs
  });
});

