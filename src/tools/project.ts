// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../providers/types.js";
import type { ToolContext, ToolHandler } from "./registry.js";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const MARKERS: Array<{ file: string; type: string }> = [
  { file: "package.json", type: "node" },
  { file: "pyproject.toml", type: "python (poetry/pep621)" },
  { file: "requirements.txt", type: "python (pip)" },
  { file: "Cargo.toml", type: "rust" },
  { file: "go.mod", type: "go" },
  { file: "Gemfile", type: "ruby" },
  { file: "pom.xml", type: "java (maven)" },
  { file: "build.gradle", type: "java/kotlin (gradle)" },
  { file: "composer.json", type: "php" },
  { file: "Dockerfile", type: "docker" },
];

export const detectProjectTypeDef: ToolDefinition = {
  type: "function",
  function: {
    name: "detect_project_type",
    description: "Detect the project type(s) present in the workspace by looking for known marker files (package.json, pyproject.toml, Cargo.toml, etc.).",
    parameters: { type: "object", properties: {} },
  },
};

export const detectProjectTypeHandler: ToolHandler = async (_args, ctx: ToolContext) => {
  const found: string[] = [];
  for (const marker of MARKERS) {
    if (await exists(path.join(ctx.workspace, marker.file))) {
      found.push(`${marker.type} (${marker.file})`);
    }
  }
  return found.length > 0 ? found.join("\n") : "No recognized project markers found.";
};

export const inspectProjectDef: ToolDefinition = {
  type: "function",
  function: {
    name: "inspect_project",
    description: "Produce a structured overview of the project: type, top-level layout, package manager, entry points, and test setup, to orient before making changes.",
    parameters: { type: "object", properties: {} },
  },
};

export const inspectProjectHandler: ToolHandler = async (_args, ctx: ToolContext) => {
  const lines: string[] = [];

  const topLevel = (await fs.readdir(ctx.workspace, { withFileTypes: true }))
    .filter((e) => !["node_modules", ".git", "dist", "build"].includes(e.name))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  lines.push(`workspace: ${ctx.workspace}`, `top_level:`, ...topLevel.map((f) => `  ${f}`));

  const pkgPath = path.join(ctx.workspace, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      lines.push(
        "",
        "node_project:",
        `  name: ${pkg.name ?? "(unnamed)"}`,
        `  scripts: ${Object.keys(pkg.scripts ?? {}).join(", ") || "(none)"}`,
        `  dependencies: ${Object.keys(pkg.dependencies ?? {}).length}`,
        `  devDependencies: ${Object.keys(pkg.devDependencies ?? {}).length}`,
        `  package_manager: ${(await exists(path.join(ctx.workspace, "pnpm-lock.yaml")))
          ? "pnpm"
          : (await exists(path.join(ctx.workspace, "yarn.lock")))
          ? "yarn"
          : (await exists(path.join(ctx.workspace, "bun.lockb")))
          ? "bun"
          : "npm"}`,
      );
    } catch {
      lines.push("", "node_project: (package.json present but failed to parse)");
    }
  }

  const pyReq = path.join(ctx.workspace, "requirements.txt");
  if (await exists(pyReq)) {
    const content = await fs.readFile(pyReq, "utf-8");
    lines.push("", "python_project:", `  requirements_count: ${content.split("\n").filter(Boolean).length}`);
  }

  const hasGit = await exists(path.join(ctx.workspace, ".git"));
  lines.push("", `git_repo: ${hasGit}`);

  return lines.join("\n");
};
