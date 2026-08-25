// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import type { ToolDefinition } from "../providers/types.js";
import type { ToolContext, ToolHandler } from "./registry.js";
import { classifyCommand } from "../agent/command-classifier.js";

const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_OUTPUT_CHARS) + `\n[...output truncated, ${s.length} total chars...]`;
}

/** Kills a whole process group (not just the shell) so backgrounded grandchildren don't survive. */
function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // fall through to killing just the direct child.. you monster
    }
  }
  try {
    child.kill(signal);
  } catch {
    // process may have already exited
  }
}

/** Tracks the currently in-flight foreground command so Ctrl+C can cancel it. */
let activeForegroundChild: ChildProcess | null = null;
export function cancelActiveForegroundCommand(): boolean {
  if (!activeForegroundChild) return false;
  killProcessTree(activeForegroundChild, "SIGTERM");
  return true;
}

export const runCommandDef: ToolDefinition = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Run a shell command in the workspace and wait for it to finish. Use for builds, installs, one-off scripts, and tests. For servers or watchers, use start_process instead.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        cwd: { type: "string", description: "Working directory relative to the workspace root. Defaults to the workspace root." },
        timeout_ms: { type: "number", description: "Max time to wait before killing the command. Defaults to 120000." },
      },
      required: ["command"],
    },
  },
};

export interface CapturedResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/**
 * Low-level spawn-and-capture, shared by the permission-gated run_command
 * tool (agent-initiated) and direct CLI actions like `lattice test`/`lattice
 * build` (user-initiated, so they bypass the agent permission gate entirely —
 * the user typing the command *is* the authorization).
 */
export function execCaptured(command: string, cwd: string, timeoutMs: number): Promise<CapturedResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      detached: process.platform !== "win32",
    });
    activeForegroundChild = child;

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, "SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      if (activeForegroundChild === child) activeForegroundChild = null;
      reject(new Error(`Failed to start command: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (activeForegroundChild === child) activeForegroundChild = null;
      resolve({ exitCode: code, signal, timedOut, durationMs: Date.now() - start, stdout, stderr });
    });
  });
}

export const runCommandHandler: ToolHandler = async (args, ctx: ToolContext) => {
  await ctx.requirePermission("exec", args.command, classifyCommand(args.command));
  const timeout = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const cwd = args.cwd ? path.resolve(ctx.workspace, args.cwd) : ctx.workspace;

  const r = await execCaptured(args.command, cwd, timeout);
  ctx.log({ tool: "run_command", command: args.command, exitCode: r.exitCode, signal: r.signal, durationMs: r.durationMs });
  const result = [
    `exit_code: ${r.exitCode ?? "null"}${r.signal ? ` (killed by ${r.signal}${r.timedOut ? ": timeout" : ""})` : ""}`,
    `duration_ms: ${r.durationMs}`,
    r.stdout ? `--- stdout ---\n${truncate(r.stdout)}` : "",
    r.stderr ? `--- stderr ---\n${truncate(r.stderr)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return result;
};

// Background process management

interface ManagedProcess {
  id: string;
  command: string;
  child: ChildProcess;
  stdout: string[];
  stderr: string[];
  startedAt: number;
  status: "running" | "exited";
  exitCode: number | null;
}

const processes = new Map<string, ManagedProcess>();
let nextId = 1;

export const startProcessDef: ToolDefinition = {
  type: "function",
  function: {
    name: "start_process",
    description:
      "Start a long-running background process (dev server, watcher, etc.) without blocking. Returns a process_id used with get_process_status and stop_process. Reuses an already-running process with the identical command instead of starting a duplicate.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Working directory relative to the workspace root." },
      },
      required: ["command"],
    },
  },
};

/** Finds an already-running managed process with the exact same command, if any. */
export function findRunningProcess(command: string): ProcessSummary | null {
  const existing = [...processes.values()].find((p) => p.command === command && p.status === "running");
  if (!existing) return null;
  return {
    id: existing.id,
    command: existing.command,
    status: existing.status,
    exitCode: existing.exitCode,
    uptimeS: (Date.now() - existing.startedAt) / 1000,
    pid: existing.child.pid,
  };
}

/** Low-level, ungated process registration — shared by the permission-gated start_process tool and direct CLI actions like /run. */
export function startManagedProcess(command: string, cwd: string): ProcessSummary {
  const id = `proc_${nextId++}`;
  const child = spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    detached: process.platform !== "win32",
  });

  const entry: ManagedProcess = {
    id,
    command,
    child,
    stdout: [],
    stderr: [],
    startedAt: Date.now(),
    status: "running",
    exitCode: null,
  };

  child.stdout?.on("data", (d) => {
    entry.stdout.push(d.toString());
    if (entry.stdout.length > 500) entry.stdout.shift();
  });
  child.stderr?.on("data", (d) => {
    entry.stderr.push(d.toString());
    if (entry.stderr.length > 500) entry.stderr.shift();
  });
  child.on("exit", (code) => {
    entry.status = "exited";
    entry.exitCode = code;
  });

  processes.set(id, entry);
  return { id, command, status: "running", exitCode: null, uptimeS: 0, pid: child.pid };
}

export const startProcessHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const existing = findRunningProcess(args.command);
  if (existing) {
    return `Reusing already-running process ${existing.id} for this exact command (started ${existing.uptimeS.toFixed(0)}s ago). Use get_process_status to inspect it, or stop_process first if you need a fresh instance.`;
  }

  await ctx.requirePermission("exec", args.command, classifyCommand(args.command));
  const cwd = args.cwd ? path.resolve(ctx.workspace, args.cwd) : ctx.workspace;
  const started = startManagedProcess(args.command, cwd);
  ctx.log({ tool: "start_process", id: started.id, command: args.command });
  return `Started process ${started.id}: ${args.command}`;
};

export const stopProcessDef: ToolDefinition = {
  type: "function",
  function: {
    name: "stop_process",
    description: "Stop a background process previously started with start_process.",
    parameters: {
      type: "object",
      properties: { process_id: { type: "string" } },
      required: ["process_id"],
    },
  },
};

export const stopProcessHandler: ToolHandler = async (args) => {
  const entry = processes.get(args.process_id);
  if (!entry) throw new Error(`Unknown process_id: ${args.process_id}`);
  if (entry.status === "exited") return `Process ${args.process_id} already exited.`;
  killProcessTree(entry.child, "SIGTERM");
  return `Stopped process ${args.process_id}`;
};

export const getProcessStatusDef: ToolDefinition = {
  type: "function",
  function: {
    name: "get_process_status",
    description: "Get the status and recent output of a background process started with start_process.",
    parameters: {
      type: "object",
      properties: { process_id: { type: "string" } },
      required: ["process_id"],
    },
  },
};

export const getProcessStatusHandler: ToolHandler = async (args) => {
  const entry = processes.get(args.process_id);
  if (!entry) throw new Error(`Unknown process_id: ${args.process_id}`);
  const uptime = ((Date.now() - entry.startedAt) / 1000).toFixed(1);
  return [
    `status: ${entry.status}`,
    `exit_code: ${entry.exitCode ?? "n/a"}`,
    `uptime_s: ${uptime}`,
    `--- recent stdout ---`,
    truncate(entry.stdout.join("")),
    `--- recent stderr ---`,
    truncate(entry.stderr.join("")),
  ].join("\n");
};

// Used by `lattice ps` / `/ps` / `/stop` and shutdown cleanup.

export interface ProcessSummary {
  id: string;
  command: string;
  status: "running" | "exited";
  exitCode: number | null;
  uptimeS: number;
  pid: number | undefined;
}

export function listManagedProcesses(): ProcessSummary[] {
  return [...processes.values()].map((p) => ({
    id: p.id,
    command: p.command,
    status: p.status,
    exitCode: p.exitCode,
    uptimeS: (Date.now() - p.startedAt) / 1000,
    pid: p.child.pid,
  }));
}

export function stopManagedProcess(id: string): boolean {
  const entry = processes.get(id);
  if (!entry || entry.status === "exited") return false;
  killProcessTree(entry.child, "SIGTERM");
  return true;
}

/** Kills every still-running background process. Called on shutdown so lattice never leaves orphans. */
export function killAllManagedProcesses(): void {
  for (const entry of processes.values()) {
    if (entry.status === "running") {
      killProcessTree(entry.child, "SIGKILL");
    }
  }
}
