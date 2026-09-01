// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { theme } from "../../ui/theme.js";
import type { LatticeConfig } from "../../config/index.js";
import { redactKey } from "../../config/index.js";
import { ExitCode } from "../exit-codes.js";

const SECRET_KEYS = new Set(["venice.api_key"]);

function setDottedPath(obj: any, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split(".");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function coerceValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") return num;
  return raw;
}

export async function runConfigCommand(cfg: LatticeConfig, subcommand: string | undefined, key: string | undefined, value: string | undefined): Promise<number> {
  if (subcommand === undefined || subcommand === "show") {
    console.log(theme.bold("Effective configuration:"));
    console.log(`  provider: ${cfg.provider}`);
    console.log(`  model: ${cfg.model}`);
    console.log(`  mode: ${cfg.mode}`);
    console.log(`  workspace: ${cfg.workspace}`);
    console.log(`  venice.base_url: ${cfg.veniceBaseUrl}`);
    console.log(`  venice.api_key: ${cfg.veniceApiKey ? redactKey(cfg.veniceApiKey) : "(not set)"}`);
    console.log(`  generation.temperature: ${cfg.temperature}`);
    console.log(`  generation.max_tokens: ${cfg.maxTokens}`);
    console.log(`  agent.max_iterations: ${cfg.maxIterations}`);
    console.log(`  agent.max_tool_calls: ${cfg.maxToolCalls}`);
    console.log(`  agent.max_consecutive_failures: ${cfg.maxConsecutiveFailures}`);
    console.log(`  agent.command_timeout_ms: ${cfg.commandTimeoutMs}`);
    console.log(`  context.token_budget: ${cfg.contextTokenBudget}`);
    console.log();
    console.log(theme.dim(`  Global config: ${path.join(cfg.globalConfigDir, "config.toml")}`));
    console.log(theme.dim(`  Project config: ${path.join(cfg.projectConfigDir, "config.toml")}`));
    return ExitCode.SUCCESS;
  }

  if (subcommand === "set") {
    if (!key || value === undefined) {
      console.error(theme.error("Usage: lattice config set <key> <value>  (e.g. lattice config set model glm-5-1, lattice config set agent.max_iterations 50)"));
      return ExitCode.INVALID_USAGE;
    }
    const globalPath = path.join(cfg.globalConfigDir, "config.toml");
    await fs.mkdir(cfg.globalConfigDir, { recursive: true });
    const existing = existsSync(globalPath) ? (parseToml(readFileSync(globalPath, "utf-8")) as any) : {};
    setDottedPath(existing, key, coerceValue(value));
    await fs.writeFile(globalPath, stringifyToml(existing), "utf-8");
    console.log(theme.success(`Set ${key} = ${SECRET_KEYS.has(key) ? redactKey(value) : value} in ${globalPath}`));
    return ExitCode.SUCCESS;
  }

  if (subcommand === "edit") {
    const globalPath = path.join(cfg.globalConfigDir, "config.toml");
    console.log(theme.dim(`Open ${globalPath} in your editor to make changes. It's created automatically the first time "lattice config set" runs.`));
    return ExitCode.SUCCESS;
  }

  console.error(theme.error(`Unknown config subcommand: ${subcommand}`));
  return ExitCode.INVALID_USAGE;
}
