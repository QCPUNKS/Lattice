// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

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
 * Tightens everything under `root` that's more permissive than owner-only.
 * Repairs data written by older Lattice versions. Never follows symlinks and
 * never changes contents. Returns how many entries were tightened.
 */
export function tightenTree(root: string): number {
  if (!existsSync(root)) return 0;
  let changed = 0;
  const visit = (p: string) => {
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
    if (st.isDirectory()) {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) visit(path.join(p, entry.name));
      }
    }
  };
  visit(root);
  return changed;
}
