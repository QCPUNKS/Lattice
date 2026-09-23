// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../providers/types.js";
import type { ToolContext, ToolHandler } from "./registry.js";
import { isLikelySecretPath } from "./secrets.js";
import { rgAvailable, rgListFiles, rgSearchContent } from "./ripgrep.js";

const MAX_READ_BYTES = 300_000; // bound tool output so we don't blow the context window

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Real (symlink-free) path of `p`, or of its deepest existing ancestor with
 * the not-yet-existing remainder appended, so paths about to be created are
 * checked through any symlinked parent directory too.
 */
function realpathOfNearestExisting(p: string): string {
  let existing = p;
  const pending: string[] = [];
  while (true) {
    try {
      return path.join(realpathSync.native(existing), ...pending.reverse());
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return p;
      pending.push(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Resolves a user-supplied path against the workspace and refuses to leave
 * it: lexically (`../`, absolute paths) and physically (a symlink inside the
 * workspace pointing elsewhere, e.g. one planted in a cloned repo).
 */
function resolveSafe(workspace: string, target: string): string {
  const resolved = path.resolve(workspace, target);
  const outside = new Error(`Refusing to access path outside the workspace: ${target}`);
  if (!isInside(workspace, resolved)) throw outside;
  if (!isInside(realpathOfNearestExisting(workspace), realpathOfNearestExisting(resolved))) throw outside;
  return resolved;
}

export const readFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the contents of a text file within the workspace. Returns up to ~300KB; larger files are truncated with a notice.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
      },
      required: ["path"],
    },
  },
};

async function readOneFile(ctx: ToolContext, relPath: string): Promise<string> {
  const target = resolveSafe(ctx.workspace, relPath);
  if (isLikelySecretPath(relPath)) {
    await ctx.requirePermission("secret_read", `read likely secret file: ${relPath}`);
  }
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    throw new Error(`${relPath} is a directory, not a file. Use list_directory instead.`);
  }
  const buf = await fs.readFile(target);
  if (buf.byteLength > MAX_READ_BYTES) {
    return (
      buf.subarray(0, MAX_READ_BYTES).toString("utf-8") +
      `\n\n[...truncated: file is ${buf.byteLength} bytes, showing first ${MAX_READ_BYTES}...]`
    );
  }
  return buf.toString("utf-8");
}

export const readFileHandler: ToolHandler = async (args, ctx: ToolContext) => readOneFile(ctx, args.path);

export const readManyFilesDef: ToolDefinition = {
  type: "function",
  function: {
    name: "read_many_files",
    description: "Read multiple text files in one call, e.g. to inspect several config files together. Each result is bounded the same way as read_file. Prefer this over sequential read_file calls when you already know the set of files you need.",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Paths relative to the workspace root, max 20 per call." },
      },
      required: ["paths"],
    },
  },
};

export const readManyFilesHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const paths: string[] = args.paths;
  if (paths.length > 20) {
    throw new Error(`read_many_files accepts at most 20 paths at a time (got ${paths.length}).`);
  }
  const sections: string[] = [];
  for (const p of paths) {
    try {
      const content = await readOneFile(ctx, p);
      sections.push(`=== ${p} ===\n${content}`);
    } catch (err) {
      sections.push(`=== ${p} ===\n[error: ${(err as Error).message}]`);
    }
  }
  return sections.join("\n\n");
};

export const writeFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "write_file",
    description: "Create a new file or fully overwrite an existing file with the given content. Creates parent directories as needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        content: { type: "string", description: "Full file content to write." },
      },
      required: ["path", "content"],
    },
  },
};

export const writeFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  await ctx.requirePermission("write", args.path);
  await ctx.trackMutation?.(args.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, args.content, "utf-8");
  return `Wrote ${Buffer.byteLength(args.content, "utf-8")} bytes to ${args.path}`;
};

export const editFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "edit_file",
    description: "Perform an exact string replacement within an existing file. old_str must match exactly once in the file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        old_str: { type: "string", description: "Exact text to replace. Must be unique in the file." },
        new_str: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
};

export const editFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  await ctx.requirePermission("write", args.path);
  await ctx.trackMutation?.(args.path);
  const original = await fs.readFile(target, "utf-8");
  const occurrences = original.split(args.old_str).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_str not found in ${args.path}`);
  }
  if (occurrences > 1) {
    throw new Error(
      `old_str matches ${occurrences} times in ${args.path}; it must be unique. Include more surrounding context.`,
    );
  }
  const updated = original.replace(args.old_str, args.new_str);
  await fs.writeFile(target, updated, "utf-8");
  return `Edited ${args.path} (1 replacement)`;
};

export const createFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "create_file",
    description: "Create a new file. Fails if the file already exists (use write_file to overwrite).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
};

export const createFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  await ctx.requirePermission("write", args.path);
  try {
    await fs.access(target);
    throw new Error(`${args.path} already exists. Use write_file to overwrite.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await ctx.trackMutation?.(args.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, args.content, "utf-8");
  return `Created ${args.path}`;
};

export const deleteFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "delete_file",
    description: "Delete a file within the workspace. Always requires explicit confirmation, regardless of autonomy mode.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

export const deleteFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  await ctx.requirePermission("delete", args.path);
  await ctx.trackMutation?.(args.path);
  await fs.unlink(target);
  return `Deleted ${args.path}`;
};

export const createDirectoryDef: ToolDefinition = {
  type: "function",
  function: {
    name: "create_directory",
    description: "Create a directory (and any missing parent directories) within the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

export const createDirectoryHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  await ctx.requirePermission("write", args.path);
  await fs.mkdir(target, { recursive: true });
  return `Created directory ${args.path}`;
};

export const listDirectoryDef: ToolDefinition = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List files and directories at the given path (non-recursive). Skips node_modules, .git, and dotfiles by default.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to workspace root. Use '.' for the workspace root." },
      },
      required: ["path"],
    },
  },
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv"]);

export const listDirectoryHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const lines = entries
    .filter((e) => !SKIP_DIRS.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return lines.join("\n") || "(empty directory)";
};

export const fileExistsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "file_exists",
    description: "Check whether a path exists and is a regular file, without reading its content.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};

export const fileExistsHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  try {
    const stat = await fs.stat(target);
    return stat.isFile() ? "true" : "false (exists but is not a regular file)";
  } catch {
    return "false";
  }
};

export const directoryExistsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "directory_exists",
    description: "Check whether a path exists and is a directory.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};

export const directoryExistsHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? "true" : "false (exists but is not a directory)";
  } catch {
    return "false";
  }
};

export const statFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "stat_file",
    description: "Get metadata (size, type, modified time, permissions) for a path without reading its content. Useful before deciding whether a file is safe to read in full.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};

export const statFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const target = resolveSafe(ctx.workspace, args.path);
  const stat = await fs.stat(target);
  return [
    `type: ${stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file"}`,
    `size_bytes: ${stat.size}`,
    `modified: ${stat.mtime.toISOString()}`,
    `mode: ${(stat.mode & 0o777).toString(8)}`,
    `likely_secret: ${isLikelySecretPath(args.path)}`,
  ].join("\n");
};

export const searchFilesDef: ToolDefinition = {
  type: "function",
  function: {
    name: "search_files",
    description: "Find files by name/substring under the workspace (recursive). Uses ripgrep when available (respects .gitignore); otherwise walks the tree skipping node_modules/.git/dist.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Substring to match against file paths." },
        path: { type: "string", description: "Directory to search under, relative to workspace root. Defaults to '.'." },
      },
      required: ["pattern"],
    },
  },
};

/** Fallback recursive walk used only when ripgrep isn't installed. */
async function walk(dir: string, results: string[], limit: number): Promise<void> {
  if (results.length >= limit) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (results.length >= limit) return;
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, results, limit);
    } else {
      results.push(full);
    }
  }
}

async function listCandidateFiles(ctx: ToolContext, relDir: string): Promise<string[]> {
  if (rgAvailable()) {
    return rgListFiles(ctx.workspace, relDir, 20_000);
  }
  const root = resolveSafe(ctx.workspace, relDir);
  const absolute: string[] = [];
  await walk(root, absolute, 5000);
  return absolute.map((p) => path.relative(ctx.workspace, p));
}

export const searchFilesHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const relDir = args.path ?? ".";
  resolveSafe(ctx.workspace, relDir); // validate before shelling out
  const all = await listCandidateFiles(ctx, relDir);
  const pattern = String(args.pattern).toLowerCase();
  const matches = all
    .filter((p) => p.toLowerCase().includes(pattern))
    .filter((p) => !isLikelySecretPath(p))
    .slice(0, 200);
  return matches.join("\n") || "No matches found.";
};

export const searchContentDef: ToolDefinition = {
  type: "function",
  function: {
    name: "search_content",
    description: "Search file contents for a literal string across the workspace (like grep). Uses ripgrep when available (respects .gitignore). Returns file:line:match, capped at 200 results. Never searches likely secret files (.env, *.key, etc).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string", description: "Directory to search under. Defaults to '.'." },
      },
      required: ["query"],
    },
  },
};

export const searchContentHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const relDir = args.path ?? ".";
  resolveSafe(ctx.workspace, relDir); // validate before shelling out
  const query: string = args.query;

  if (rgAvailable()) {
    const matches = await rgSearchContent(ctx.workspace, relDir, query, 200);
    const lines = matches
      .filter((m) => !isLikelySecretPath(m.file))
      .map((m) => `${m.file}:${m.line}: ${m.text}`);
    return lines.join("\n") || "No matches found.";
  }

  // Fallback: plain JS walk + substring scan.
  const root = resolveSafe(ctx.workspace, relDir);
  const all: string[] = [];
  await walk(root, all, 5000);
  const results: string[] = [];

  for (const file of all) {
    if (results.length >= 200) break;
    const relPath = path.relative(ctx.workspace, file);
    if (isLikelySecretPath(relPath)) continue;
    let text: string;
    try {
      const buf = await fs.readFile(file);
      if (buf.byteLength > MAX_READ_BYTES) continue; // skip huge/binary files
      text = buf.toString("utf-8");
      if (text.includes("\0")) continue; // likely binary
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && results.length < 200; i++) {
      if (lines[i].includes(query)) {
        results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  }

  return results.join("\n") || "No matches found.";
};

export const copyFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "copy_file",
    description: "Copy a file to a new path within the workspace.",
    parameters: {
      type: "object",
      properties: { source: { type: "string" }, destination: { type: "string" } },
      required: ["source", "destination"],
    },
  },
};

export const copyFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const src = resolveSafe(ctx.workspace, args.source);
  const dest = resolveSafe(ctx.workspace, args.destination);
  await ctx.requirePermission("write", args.destination);
  await ctx.trackMutation?.(args.destination);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  return `Copied ${args.source} -> ${args.destination}`;
};

export const moveFileDef: ToolDefinition = {
  type: "function",
  function: {
    name: "move_file",
    description: "Move or rename a file within the workspace.",
    parameters: {
      type: "object",
      properties: { source: { type: "string" }, destination: { type: "string" } },
      required: ["source", "destination"],
    },
  },
};

export const moveFileHandler: ToolHandler = async (args, ctx: ToolContext) => {
  const src = resolveSafe(ctx.workspace, args.source);
  const dest = resolveSafe(ctx.workspace, args.destination);
  await ctx.requirePermission("write", args.destination);
  await ctx.trackMutation?.(args.source);
  await ctx.trackMutation?.(args.destination);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
  return `Moved ${args.source} -> ${args.destination}`;
};
