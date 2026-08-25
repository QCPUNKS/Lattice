// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { simpleGit, SimpleGit } from "simple-git";
import type { ToolDefinition } from "../providers/types.js";
import type { ToolContext, ToolHandler } from "./registry.js";

function client(ctx: ToolContext): SimpleGit {
  return simpleGit(ctx.workspace);
}

export const gitStatusDef: ToolDefinition = {
  type: "function",
  function: {
    name: "git_status",
    description: "Show the current git status (staged, unstaged, untracked files) of the workspace.",
    parameters: { type: "object", properties: {} },
  },
};

export const gitStatusHandler: ToolHandler = async (_args, ctx) => {
  const status = await client(ctx).status();
  return [
    `branch: ${status.current}`,
    `ahead/behind: +${status.ahead}/-${status.behind}`,
    `staged: ${status.staged.join(", ") || "(none)"}`,
    `modified: ${status.modified.join(", ") || "(none)"}`,
    `not_added: ${status.not_added.join(", ") || "(none)"}`,
    `deleted: ${status.deleted.join(", ") || "(none)"}`,
    `conflicted: ${status.conflicted.join(", ") || "(none)"}`,
  ].join("\n");
};

export const gitDiffDef: ToolDefinition = {
  type: "function",
  function: {
    name: "git_diff",
    description: "Show the unstaged (or staged, if staged=true) diff for the workspace, optionally for a specific file.",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Optional specific file path." },
        staged: { type: "boolean", description: "Show staged diff instead of unstaged. Defaults to false." },
      },
    },
  },
};

export const gitDiffHandler: ToolHandler = async (args, ctx) => {
  const g = client(ctx);
  const options: string[] = [];
  if (args.staged) options.push("--staged");
  if (args.file) options.push("--", args.file);
  const diff = await g.diff(options);
  return diff || "(no changes)";
};

export const gitLogDef: ToolDefinition = {
  type: "function",
  function: {
    name: "git_log",
    description: "Show recent commit history.",
    parameters: {
      type: "object",
      properties: { max_count: { type: "number", description: "Number of commits to show. Defaults to 10." } },
    },
  },
};

export const gitLogHandler: ToolHandler = async (args, ctx) => {
  const log = await client(ctx).log({ maxCount: args.max_count ?? 10 });
  return log.all
    .map((c) => `${c.hash.slice(0, 8)} ${c.date} ${c.author_name}: ${c.message}`)
    .join("\n") || "(no commits)";
};

export const gitBranchDef: ToolDefinition = {
  type: "function",
  function: {
    name: "git_branch",
    description: "List local branches, or create/switch to a new branch if create_branch is provided.",
    parameters: {
      type: "object",
      properties: {
        create_branch: { type: "string", description: "Name of a new branch to create and switch to." },
      },
    },
  },
};

export const gitBranchHandler: ToolHandler = async (args, ctx) => {
  const g = client(ctx);
  if (args.create_branch) {
    await ctx.requirePermission("write", `create git branch ${args.create_branch}`);
    await g.checkoutLocalBranch(args.create_branch);
    return `Created and switched to branch ${args.create_branch}`;
  }
  const branches = await g.branchLocal();
  return branches.all.map((b) => (b === branches.current ? `* ${b}` : `  ${b}`)).join("\n");
};

export const gitCommitDef: ToolDefinition = {
  type: "function",
  function: {
    name: "git_commit",
    description: "Stage all changes and create a commit with the given message.",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
};

export const gitCommitHandler: ToolHandler = async (args, ctx) => {
  await ctx.requirePermission("write", `git commit: ${args.message}`);
  const g = client(ctx);
  await g.add(".");
  const result = await g.commit(args.message);
  return `Committed ${result.commit} (${result.summary.changes} changes, +${result.summary.insertions}/-${result.summary.deletions})`;
};
