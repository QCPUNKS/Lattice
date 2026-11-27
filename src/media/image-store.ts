// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { promises as fs, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { GeneratedImages } from "./image-client.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Buffer): boolean {
  return bytes.length > PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

export interface OutputDirReport {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  /** Other local accounts can list or read what's in it (mode & 0o077). */
  accessibleToOthers: boolean;
  /** Other local accounts can add/replace files in it — never acceptable. */
  writableByOthers: boolean;
  /** Nearest enclosing git work tree, if any — images there are one `git add .` from being published. */
  gitRepoRoot: string | null;
}

export function findGitRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function inspectOutputDir(dir: string): OutputDirReport {
  const resolved = path.resolve(dir);
  const exists = existsSync(resolved);
  const stat = exists ? statSync(resolved) : null;
  const mode = stat ? stat.mode & 0o777 : 0o700;
  return {
    path: resolved,
    exists,
    isDirectory: stat ? stat.isDirectory() : true,
    accessibleToOthers: (mode & 0o077) !== 0,
    writableByOthers: (mode & 0o022) !== 0,
    gitRepoRoot: findGitRoot(exists ? resolved : path.dirname(resolved)),
  };
}

/** Creates the folder owner-only, or tightens an existing one to 0700 when asked. */
export async function prepareOutputDir(dir: string, tighten: boolean): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (tighten) await fs.chmod(dir, 0o700);
}

export interface ImageMetadata {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  resolution?: string;
  steps?: number;
  safeMode: boolean;
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeFileToken(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48);
}

/**
 * Writes each image owner-only (0600) with O_EXCL so an existing file — or a
 * planted symlink — is never overwritten. File names carry time, model, and
 * seed but never prompt text: a directory listing shouldn't reveal prompts.
 */
export async function saveGeneratedImages(
  dir: string,
  result: GeneratedImages,
  meta: ImageMetadata,
  saveMetadata: boolean,
  now = new Date(),
): Promise<string[]> {
  const base = `${timestamp(now)}_${safeFileToken(meta.model)}_${result.seed}`;
  const written: string[] = [];

  for (const [i, bytes] of result.images.entries()) {
    if (!isPng(bytes)) throw new Error("Venice returned data that isn't a PNG image — not saving it.");
    const suffix = result.images.length > 1 ? `_v${i + 1}` : "";
    const file = path.join(dir, `${base}${suffix}.png`);
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    written.push(file);
  }

  if (saveMetadata) {
    const sidecar = {
      ...meta,
      seed: result.seed,
      size: result.size,
      veniceId: result.id,
      blurred: result.blurred,
      createdAt: now.toISOString(),
      files: written.map((f) => path.basename(f)),
    };
    await fs.writeFile(path.join(dir, `${base}.json`), JSON.stringify(sidecar, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  return written;
}
