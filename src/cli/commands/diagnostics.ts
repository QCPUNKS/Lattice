// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { theme } from "../../ui/theme.js";
import type { LatticeConfig } from "../../config/index.js";
import { VeniceProvider } from "../../providers/venice.js";
import { redactKey } from "../../config/index.js";
import { resolveMcpServers } from "../../mcp/config.js";
import { McpManager } from "../../mcp/manager.js";
import { ToolRegistry } from "../../tools/registry.js";
import { ExitCode } from "../exit-codes.js";

/** True if the binary is on PATH and spawnable — exit code doesn't matter, only whether it launched. which it should... cuz i made it */
function commandExists(cmd: string): boolean {
  try {
    const res = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    return res.error === undefined;
  } catch {
    return false;
  }
}

function check(label: string, ok: boolean, detail?: string): void {
  const icon = ok ? theme.success("✓") : theme.error("✗");
  console.log(`  ${icon} ${label}${detail ? ` (${detail})` : ""}`);
}

export async function runModelsCommand(cfg: LatticeConfig): Promise<number> {
  if (!cfg.veniceApiKey) {
    console.error(theme.error("VENICE_API_KEY is not set. Run 'lattice doctor' for details."));
    return ExitCode.AUTHENTICATION_FAILURE;
  }
  const provider = new VeniceProvider({
    apiKey: cfg.veniceApiKey,
    baseUrl: cfg.veniceBaseUrl,
    defaultModel: cfg.model,
    defaultTemperature: cfg.temperature,
    defaultMaxTokens: cfg.maxTokens,
  });
  try {
    const models = await provider.getModels();
    for (const m of models) {
      console.log(
        `${theme.bold(m.id)}  ctx=${m.contextLength ?? "?"}  tools=${m.supportsTools}  reasoning=${m.supportsReasoning}  vision=${m.supportsVision}`,
      );
    }
    return ExitCode.SUCCESS;
  } catch (err) {
    console.error(theme.error(`Failed to reach Venice API: ${(err as Error).message}`));
    return ExitCode.PROVIDER_FAILURE;
  }
}

export async function runDoctorCommand(cfg: LatticeConfig): Promise<number> {
  console.log(theme.bold("lattice doctor"));
  console.log();

  console.log(theme.dim("Runtime:"));
  check("Node.js", true, process.version);
  check("git", commandExists("git"));
  check("ripgrep (rg)", commandExists("rg"));
  check("fd", commandExists("fd"));
  check("docker", commandExists("docker"));
  check("bun", commandExists("bun"));
  check("kitty", commandExists("kitty"));
  console.log();

  console.log(theme.dim("Configuration:"));
  check("VENICE_API_KEY set", Boolean(cfg.veniceApiKey), cfg.veniceApiKey ? redactKey(cfg.veniceApiKey) : "not set");
  check("Base URL", true, cfg.veniceBaseUrl);
  check("Model", true, cfg.model);
  check("Mode", true, cfg.mode);
  check("Workspace", existsSync(cfg.workspace), cfg.workspace);
  console.log();

  let exitCode: number = ExitCode.SUCCESS;

  if (!cfg.veniceApiKey) {
    console.log(theme.warning("Set VENICE_API_KEY (env var or .env) before running lattice."));
    exitCode = ExitCode.AUTHENTICATION_FAILURE;
  } else {
    console.log(theme.dim("Venice API:"));
    try {
      const provider = new VeniceProvider({
        apiKey: cfg.veniceApiKey,
        baseUrl: cfg.veniceBaseUrl,
        defaultModel: cfg.model,
        defaultTemperature: cfg.temperature,
        defaultMaxTokens: cfg.maxTokens,
      });
      const models = await provider.getModels();
      check("API reachable", true, `${models.length} models available`);
      const current = models.find((m) => m.id === cfg.model);
      check(`Model "${cfg.model}" available`, Boolean(current));
      if (current) check("Model supports tool calling", current.supportsTools);
      if (!current || !current.supportsTools) exitCode = ExitCode.CONFIGURATION_FAILURE;
    } catch (err) {
      check("API reachable", false, (err as Error).message);
      exitCode = ExitCode.PROVIDER_FAILURE;
    }
  }
  console.log();

  console.log(theme.dim("MCP:"));
  try {
    const resolved = resolveMcpServers(cfg.globalConfigDir, cfg.projectConfigDir);
    if (resolved.length === 0) {
      console.log(theme.dim("  (no MCP servers configured)"));
    } else {
      for (const s of resolved) {
        check(`${s.name} (${s.scope}) config valid`, Boolean(s.config.command || s.config.url));
      }
    }
  } catch (err) {
    check("mcp.json parses", false, (err as Error).message);
    exitCode = ExitCode.CONFIGURATION_FAILURE;
  }

  return exitCode;
}

export async function runMcpCommand(cfg: LatticeConfig, subcommand: string | undefined): Promise<number> {
  const resolved = resolveMcpServers(cfg.globalConfigDir, cfg.projectConfigDir);
  if (resolved.length === 0) {
    console.log(theme.dim("No MCP servers configured. Add entries to:"));
    console.log(`  ${path.join(cfg.globalConfigDir, "mcp.json")} (global, trusted)`);
    console.log(`  ${path.join(cfg.projectConfigDir, "mcp.json")} (project-local, confirmed before use)`);
    return ExitCode.SUCCESS;
  }

  if (subcommand === "list" || subcommand === undefined) {
    for (const s of resolved) {
      const label = s.config.command ? `${s.config.command} ${(s.config.args ?? []).join(" ")}`.trim() : s.config.url;
      console.log(`${s.name}  [${s.scope}]  ${label}`);
    }
    return ExitCode.SUCCESS;
  }

  if (subcommand === "test") {
    const registry = new ToolRegistry();
    const manager = new McpManager();
    await manager.connectAll(resolved, registry, () => {}, async () => true);
    for (const status of manager.status()) {
      if ("client" in status) {
        console.log(`${theme.success("✓")} ${status.name}  connected  ${status.toolNames.length} tools`);
      } else {
        console.log(`${theme.error("✗")} ${status.name}  ${status.error}`);
      }
    }
    const failed = manager.status().some((s) => !("client" in s));
    await manager.disconnectAll();
    return failed ? ExitCode.PROVIDER_FAILURE : ExitCode.SUCCESS;
  }

  console.error(theme.error(`Unknown mcp subcommand: ${subcommand}. Try "lattice mcp list" or "lattice mcp test".`));
  return ExitCode.INVALID_USAGE;
}
