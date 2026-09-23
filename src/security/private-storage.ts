// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { promises as fs, mkdirSync, chmodSync, existsSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";

/**
 * Lattice's local data (sessions with full conversations and voice
 * transcripts, the audit log, arena runs) is private by construction:
 * directories 0700, files 0600, regardless of the user's umask or whether
 * their home directory happens to be locked down.
 */

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await fs.chmod(dir, PRIVATE_DIR_MODE);
}

export function ensurePrivateDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(dir, PRIVATE_DIR_MODE);
}

/** Atomic owner-only write: a crash mid-write never leaves a truncated file. */
export async function writePrivateFile(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
  await fs.rename(tmp, file);
}

/**
 * Tightens `root` (and, when `recursive`, everything under it) that's more
 * permissive than owner-only. Never follows symlinks and never changes
 * contents. Returns how many entries were tightened.
 *
 * Only ever point this at Lattice's own private data: it drops execute bits,
 * so running it over code (arena worktrees, a Python venv) would break it.
 */
export function tightenTree(root: string, recursive = true): number {
  if (!existsSync(root)) return 0;
  let changed = 0;
  const visit = (p: string, depth: number) => {
    const st = lstatSync(p, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) return;
    const want = st.isDirectory() ? PRIVATE_DIR_MODE : PRIVATE_FILE_MODE;
    if ((st.mode & 0o777 & ~want) !== 0) {
      try {
        chmodSync(p, want);
        changed++;
      } catch {
        // not ours / read-only fs — leave it
      }
    }
    if (st.isDirectory() && (recursive || depth === 0)) {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        // Shallow mode tightens the directory and the files directly in it, not subfolders.
        if (!recursive && entry.isDirectory()) continue;
        visit(path.join(p, entry.name), depth + 1);
      }
    }
  };
  visit(root, 0);
  return changed;
}

/**
 * Repairs permissions on data written before Lattice enforced owner-only
 * storage — exactly the private data, by name. Everything else under the
 * data directory (arena worktrees holding the user's code, tool installs)
 * is left alone.
 */
export function repairPrivateStorage(dataDir: string, configDir: string): number {
  return (
    tightenTree(configDir) +
    tightenTree(dataDir, false) + // the folder itself and files in it (audit.log)
    tightenTree(path.join(dataDir, "sessions")) +
    tightenTree(path.join(dataDir, "arena"), false) // run records only, never the worktrees under it
  );
}
