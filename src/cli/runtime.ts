// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

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
import { VeniceHttp } from "../providers/venice-http.js";
import { ImageService } from "../media/image-service.js";
import { VoiceController } from "../voice/controller.js";
import { tightenTree } from "../security/private-storage.js";
import { SpendLedger } from "../billing/ledger.js";
import { BudgetGuard } from "../billing/budget.js";
import { MeteredProvider } from "../billing/metered-provider.js";
import path from "node:path";
import { generateImageDef, createGenerateImageHandler } from "../tools/image.js";

export interface Runtime {
  provider: VeniceProvider;
  /** Authenticated Venice transport shared by the media services. */
  http: VeniceHttp;
  images: ImageService;
  /** Every charge Lattice makes, and the limits it enforces. */
  spend: { ledger: SpendLedger; budget: BudgetGuard };
  voice: VoiceController;
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
  /** Tools that spend money per call (image generation). Off for arena participants. */
  paidTools?: boolean;
}

/**
 * Builds every subsystem the agent needs: provider, native + MCP tools,
 * permission gate, snapshot tracking, and project memory scaffolding. Shared
 * by both the interactive REPL and non-interactive `lattice exec`/`lattice ask`.
 */
export async function buildRuntime(cfg: LatticeConfig, options: RuntimeOptions): Promise<Runtime> {
  // Repair permissions on data written before Lattice enforced owner-only storage.
  const tightened = tightenTree(cfg.dataDir) + tightenTree(cfg.globalConfigDir);
  const auditLog = createAuditLogger(cfg.dataDir, options.debug);
  if (tightened > 0) auditLog({ type: "private_storage_repaired", entries: tightened });

  const http = new VeniceHttp(cfg.veniceApiKey ?? "", cfg.veniceBaseUrl);
  const provider = new VeniceProvider(
    {
      apiKey: cfg.veniceApiKey ?? "",
      baseUrl: cfg.veniceBaseUrl,
      defaultModel: cfg.model,
      defaultTemperature: cfg.temperature,
      defaultMaxTokens: cfg.maxTokens,
    },
    http,
  );

  const ledger = new SpendLedger(path.join(cfg.dataDir, "spend"));
  const images = new ImageService(http, cfg, ledger);
  const voice = new VoiceController(http, cfg, auditLog, ledger);

  const registry = new ToolRegistry();
  registerAllTools(registry);
  if (options.paidTools !== false) {
    registry.register(generateImageDef, createGenerateImageHandler(images));
  }

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

  const budget = new BudgetGuard(cfg.budget, ledger, gate.confirmer());
  const metered = new MeteredProvider(provider, ledger, budget, () => cfg.model);
  const loop = new AgentLoop(metered, registry, cfg.model, {
    maxIterations: cfg.maxIterations,
    maxToolCalls: cfg.maxToolCalls,
    maxConsecutiveFailures: cfg.maxConsecutiveFailures,
    contextTokenBudget: cfg.contextTokenBudget,
  });

  return {
    provider,
    http,
    images,
    voice,
    spend: { ledger, budget },
    registry,
    gate,
    ctx,
    loop,
    snapshots,
    mcp,
    auditLog,
    async shutdown() {
      voice.stopSpeaking();
      killAllManagedProcesses();
      await mcp.disconnectAll();
    },
  };
}
