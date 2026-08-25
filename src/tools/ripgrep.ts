// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from "node:child_process";

let cachedAvailable: boolean | null = null;

/** Checks once per process whether `rg` is on PATH. */
export function rgAvailable(): boolean {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    const res = spawnSync("rg", ["--version"], { stdio: "ignore" });
    cachedAvailable = res.status === 0;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

function runRg(args: string[], cwd: string): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      // rg exits 1 for "no matches", which is not an error condition for us.
      if (code !== null && code > 1) {
        reject(new Error(stderr || `rg exited with code ${code}`));
        return;
      }
      resolve({ stdout, code });
    });
  });
}

/** Lists files under `dir` (relative paths), respecting .gitignore automatically. because we enjoy security */
export async function rgListFiles(cwd: string, dir: string, limit: number): Promise<string[]> {
  const { stdout } = await runRg(["--files", "--hidden", "--glob", "!.git", "--", dir], cwd);
  return stdout.split("\n").filter(Boolean).slice(0, limit);
}

export interface RgMatch {
  file: string;
  line: number;
  text: string;
}

/** Literal (fixed-string) content search, respecting .gitignore automatically. again we enjoy being secure */
export async function rgSearchContent(
  cwd: string,
  dir: string,
  query: string,
  limit: number,
): Promise<RgMatch[]> {
  const { stdout } = await runRg(
    ["-n", "--no-heading", "--fixed-strings", "--hidden", "--glob", "!.git", "-m", String(limit), "--", query, dir],
    cwd,
  );
  const matches: RgMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    matches.push({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) });
    if (matches.length >= limit) break;
  }
  return matches;
}
