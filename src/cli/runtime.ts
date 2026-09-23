// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import * as readline from "node:readline/promises";
import chalk from "chalk";
import type { LatticeConfig } from "../config/index.js";
import { VeniceProvider } from "../providers/venice.js";
import { ToolRegistry, ToolContext } from "../tools/registry.js";
import { registerAllTools } from "../tools/register-all.js";
import { PermissionGate } from "../agent/permissions.js";
import { AgentLoop } from "../agent/loop.js";
import { TurnSnapshotManager } from "../agent/snapshots.js";
import { McpManager } from "../mcp/manager.js";
import { resolveMcpServers } from "../mcp/config.js";
import { ensureProjectMemory, ensureLatticeDirGitignored } from "../project/memory.js";
import { createAuditLogger } from "../audit/log.js";
import { killAllManagedProcesses } from "../tools/shell.js";
import { repairPrivateStorage } from "../security/private-storage.js";

export interface Runtime {
  provider: VeniceProvider;
  registry: ToolRegistry;
  gate: PermissionGate;
  ctx: ToolContext;
  loop: AgentLoop;
  snapshots: TurnSnapshotManager;
  mcp: McpManager;
  auditLog: (event: Record<string, unknown>) => void;
  shutdown(): Promise<void>;
}

export interface RuntimeOptions {
  /** null for non-interactive contexts (lattice exec/ask) — the gate fails closed instead of prompting. */
  rl: readline.Interface | null;
  debug: boolean;
}

/**
 * Builds every subsystem the agent needs: provider, native + MCP tools,
 * permission gate, snapshot tracking, and project memory scaffolding. Shared
 * by both the interactive REPL and non-interactive `lattice exec`/`lattice ask`.
 */
export async function buildRuntime(cfg: LatticeConfig, options: RuntimeOptions): Promise<Runtime> {
  // Repair permissions on data written before Lattice enforced owner-only storage.
  const tightened = repairPrivateStorage(cfg.dataDir, cfg.globalConfigDir);
  const auditLog = createAuditLogger(cfg.dataDir, options.debug);
  if (tightened > 0) auditLog({ type: "private_storage_repaired", entries: tightened });

  const provider = new VeniceProvider({
    apiKey: cfg.veniceApiKey ?? "",
    baseUrl: cfg.veniceBaseUrl,
    defaultModel: cfg.model,
    defaultTemperature: cfg.temperature,
    defaultMaxTokens: cfg.maxTokens,
  });

  const registry = new ToolRegistry();
  registerAllTools(registry);

  const { created } = await ensureProjectMemory(cfg.projectConfigDir);
  if (created.length > 0) {
    auditLog({ type: "project_memory_initialized", files: created });
  }
  await ensureLatticeDirGitignored(cfg.workspace);

  const gate = new PermissionGate(cfg.mode, options.rl, auditLog);
  const snapshots = new TurnSnapshotManager(cfg.workspace);

  const ctx: ToolContext = {
    workspace: cfg.workspace,
    requirePermission: (action, detail, risk) => gate.check(action, detail, risk),
    log: auditLog,
    trackMutation: (path) => snapshots.track(path),
  };

  const mcp = new McpManager();
  const resolved = resolveMcpServers(cfg.globalConfigDir, cfg.projectConfigDir);
  if (resolved.length > 0) {
    const projectScoped = resolved.filter((s) => s.scope === "project");
    if (projectScoped.length > 0) {
      console.log(
        chalk.dim(
          `  Project-local MCP servers found in .lattice/mcp.json: ${projectScoped.map((s) => s.name).join(", ")}`,
        ),
      );
    }
    await mcp.connectAll(resolved, registry, auditLog, async (name, config) => {
      if (!options.rl) return false; // never silently spawn an untrusted project server non-interactively
      const label = config.command
        ? `${config.command} ${(config.args ?? []).join(" ")}`.trim()
        : (config.url ?? "(no command/url)");
      const answer = (
        await options.rl.question(
          `${chalk.yellow("lattice")} found a project-local MCP server "${chalk.bold(name)}": ${label}\n  Start it? [y]es / [n]o: `,
        )
      )
        .trim()
        .toLowerCase();
      return answer === "y" || answer === "yes";
    });
  }

  const loop = new AgentLoop(provider, registry, cfg.model, {
    maxIterations: cfg.maxIterations,
    maxToolCalls: cfg.maxToolCalls,
    maxConsecutiveFailures: cfg.maxConsecutiveFailures,
    contextTokenBudget: cfg.contextTokenBudget,
  });

  return {
    provider,
    registry,
    gate,
    ctx,
    loop,
    snapshots,
    mcp,
    auditLog,
    async shutdown() {
      killAllManagedProcesses();
      await mcp.disconnectAll();
    },
  };
}
