// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { promises as fs } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const LATTICE_DIR_PATTERNS = new Set([".lattice", ".lattice/", "/.lattice", "/.lattice/"]);
const LATTICE_IGNORE_BLOCK = "\n# Lattice project memory (local only)\n.lattice/\n";

async function appendIgnoreEntry(ignoreFilePath: string): Promise<boolean> {
  let existing = "";
  if (existsSync(ignoreFilePath)) {
    existing = await fs.readFile(ignoreFilePath, "utf-8");
    if (existing.split("\n").some((line) => LATTICE_DIR_PATTERNS.has(line.trim()))) return false;
  }
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await fs.mkdir(path.dirname(ignoreFilePath), { recursive: true });
  await fs.writeFile(ignoreFilePath, `${existing}${separator}${LATTICE_IGNORE_BLOCK}`, "utf-8");
  return true;
}

/**
 * Scaffolds the project-local memory directory (spec §30):
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
      content: `# Project-local Lattice configuration. Overrides global config, overridden by CLI flags.\n# See spec §37 for the full precedence order and available keys.\n\n# mode = "normal"\n# model = "..."\n`,
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

/**
 * Keeps ".lattice/" out of git if this is a git repo and it isn't already ignored.
 * A main checkout gets it in .gitignore. A linked worktree (where .git is a file,
 * e.g. an arena participant) gets it in the repo's untracked info/exclude instead,
 * so Lattice's own bookkeeping never shows up as a change in that worktree's diff.
 */
export async function ensureLatticeDirGitignored(workspace: string): Promise<boolean> {
  const gitEntry = path.join(workspace, ".git");
  if (!existsSync(gitEntry)) return false;

  if (statSync(gitEntry).isDirectory()) {
    return appendIgnoreEntry(path.join(workspace, ".gitignore"));
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: workspace });
  return appendIgnoreEntry(path.resolve(workspace, stdout.trim()));
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
