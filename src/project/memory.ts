// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Scaffolds the project-local memory directory:
 *   .lattice/config.toml, context.md, memory/{architecture,decisions,conventions}.md, sessions/, state/
 * Idempotent — never overwrites files that already exist.
 */
export async function ensureProjectMemory(projectConfigDir: string): Promise<{ created: string[] }> {
  const created: string[] = [];

  const dirs = [projectConfigDir, path.join(projectConfigDir, "memory"), path.join(projectConfigDir, "sessions"), path.join(projectConfigDir, "state")];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  const files: Array<{ rel: string; content: string }> = [
    {
      rel: "config.toml",
      content: `# Project-local Lattice configuration. Overrides global config, overridden by CLI flags.\n# mode = "normal"\n# model = "..."\n`,
    },
    {
      rel: "context.md",
      content: `# Project Context\n\nNotes Lattice should keep in mind for this project. Freeform — architecture summaries, gotchas, things not obvious from the code.\n`,
    },
    {
      rel: path.join("memory", "architecture.md"),
      content: `# Architecture\n\nHigh-level structure of this project, as Lattice has come to understand it.\n`,
    },
    {
      rel: path.join("memory", "decisions.md"),
      content: `# Decisions\n\nSignificant implementation decisions and their rationale, recorded as Lattice makes them.\n`,
    },
    {
      rel: path.join("memory", "conventions.md"),
      content: `# Conventions\n\nNaming, style, and structural conventions this project follows.\n`,
    },
  ];

  for (const f of files) {
    const target = path.join(projectConfigDir, f.rel);
    if (!existsSync(target)) {
      await fs.writeFile(target, f.content, "utf-8");
      created.push(f.rel);
    }
  }

  return { created };
}

/** Appends ".lattice/" to the project .gitignore if this is a git repo and it isn't already ignored. */
export async function ensureLatticeDirGitignored(workspace: string): Promise<boolean> {
  const gitDir = path.join(workspace, ".git");
  if (!existsSync(gitDir)) return false;

  const gitignorePath = path.join(workspace, ".gitignore");
  let existing = "";
  if (existsSync(gitignorePath)) {
    existing = await fs.readFile(gitignorePath, "utf-8");
    const alreadyIgnored = existing
      .split("\n")
      .map((l) => l.trim())
      .some((l) => l === ".lattice" || l === ".lattice/" || l === "/.lattice" || l === "/.lattice/");
    if (alreadyIgnored) return false;
  }

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await fs.writeFile(gitignorePath, `${existing}${separator}\n# Lattice project memory (local only)\n.lattice/\n`, "utf-8");
  return true;
}

export interface AgentState {
  objective: string | null;
  phase: string;
  filesChanged: string[];
  testsRun: string[];
  errors: string[];
  pendingTasks: string[];
  completedTasks: string[];
  updatedAt: string;
}

function statePath(projectConfigDir: string): string {
  return path.join(projectConfigDir, "state", "agent-state.json");
}

export async function loadAgentState(projectConfigDir: string): Promise<AgentState> {
  try {
    const raw = await fs.readFile(statePath(projectConfigDir), "utf-8");
    return JSON.parse(raw) as AgentState;
  } catch {
    return {
      objective: null,
      phase: "idle",
      filesChanged: [],
      testsRun: [],
      errors: [],
      pendingTasks: [],
      completedTasks: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function saveAgentState(projectConfigDir: string, state: AgentState): Promise<void> {
  await fs.mkdir(path.join(projectConfigDir, "state"), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(statePath(projectConfigDir), JSON.stringify(state, null, 2), "utf-8");
}
