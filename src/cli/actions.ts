// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { execCaptured, listManagedProcesses, stopManagedProcess, startManagedProcess, findRunningProcess } from "../tools/shell.js";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function packageManager(workspace: string): Promise<"pnpm" | "yarn" | "bun" | "npm"> {
  if (await exists(path.join(workspace, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(workspace, "yarn.lock"))) return "yarn";
  if (await exists(path.join(workspace, "bun.lockb")) || await exists(path.join(workspace, "bun.lock"))) return "bun";
  return "npm";
}

async function readPackageScripts(workspace: string): Promise<Record<string, string> | null> {
  const pkgPath = path.join(workspace, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    return pkg.scripts ?? {};
  } catch {
    return null;
  }
}

/**
 * Detects the appropriate test/build command for the project rather than
 * guessing blindly: checks package.json scripts first, then
 * falls back to well-known per-ecosystem defaults only when their marker
 * file is actually present.
 */
export async function detectCommand(workspace: string, kind: "test" | "build"): Promise<string | null> {
  const scripts = await readPackageScripts(workspace);
  if (scripts && scripts[kind]) {
    const pm = await packageManager(workspace);
    return kind === "test" ? `${pm} test` : `${pm} run build`;
  }

  if (await exists(path.join(workspace, "Cargo.toml"))) return `cargo ${kind}`;
  if (await exists(path.join(workspace, "go.mod"))) return kind === "test" ? "go test ./..." : "go build ./...";
  if (kind === "test") {
    if (await exists(path.join(workspace, "pytest.ini")) || await exists(path.join(workspace, "pyproject.toml"))) {
      return "pytest";
    }
  }
  return null;
}

export interface ActionResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runDetectedCommand(
  workspace: string,
  kind: "test" | "build",
  timeoutMs: number,
): Promise<ActionResult | null> {
  const command = await detectCommand(workspace, kind);
  if (!command) return null;
  const r = await execCaptured(command, workspace, timeoutMs);
  return { command, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs };
}

async function detectDevCommand(workspace: string): Promise<string | null> {
  const scripts = await readPackageScripts(workspace);
  if (!scripts) return null;
  const pm = await packageManager(workspace);
  if (scripts.dev) return `${pm} run dev`;
  if (scripts.start) return `${pm} start`;
  return null;
}

export interface RunResult {
  command: string;
  processId: string;
  reused: boolean;
}

/** Starts (or reuses) the project's dev/start script as a tracked background process, for `/run` and `lattice run`. */
export async function runProject(workspace: string): Promise<RunResult | null> {
  const command = await detectDevCommand(workspace);
  if (!command) return null;
  const existing = findRunningProcess(command);
  if (existing) return { command, processId: existing.id, reused: true };
  const started = startManagedProcess(command, workspace);
  return { command, processId: started.id, reused: false };
}

export async function gitStatusSummary(workspace: string): Promise<string> {
  try {
    const status = await simpleGit(workspace).status();
    return [
      `branch: ${status.current}`,
      `staged: ${status.staged.length}`,
      `modified: ${status.modified.length}`,
      `untracked: ${status.not_added.length}`,
    ].join("  ");
  } catch {
    return "(not a git repository)";
  }
}

export function formatProcessList(): string {
  const procs = listManagedProcesses();
  if (procs.length === 0) return "No managed processes.";
  return procs
    .map((p) => `${p.id}  ${p.status.padEnd(8)}  pid=${p.pid ?? "?"}  up=${p.uptimeS.toFixed(0)}s  ${p.command}`)
    .join("\n");
}

export function stopProcessById(id: string): string {
  return stopManagedProcess(id) ? `Stopped ${id}` : `No running process with id ${id}`;
}
