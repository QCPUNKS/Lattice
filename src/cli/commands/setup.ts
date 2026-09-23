// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { theme } from "../../ui/theme.js";
import type { LatticeConfig } from "../../config/index.js";
import { VeniceProvider } from "../../providers/venice.js";
import { ExitCode } from "../exit-codes.js";
import { updateGlobalConfig, tableAt } from "../../config/writer.js";

/**
 * First-run configuration wizard: Venice API key, default model,
 * default workspace, permission mode. Writes to the global config so it
 * persists across projects.
 */
export async function runSetupCommand(cfg: LatticeConfig): Promise<number> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log(theme.bold("LATTICE setup"));
  console.log(theme.dim("This configures your global defaults. Press Enter to keep the current value.\n"));

  try {
    let apiKey = cfg.veniceApiKey;
    if (!apiKey) {
      apiKey = (await rl.question("Venice API key (from https://venice.ai): ")).trim() || undefined;
    } else {
      console.log(theme.dim(`Venice API key already set via environment/.env — leaving as-is.`));
    }

    let model = cfg.model;
    if (apiKey) {
      try {
        const provider = new VeniceProvider({
          apiKey,
          baseUrl: cfg.veniceBaseUrl,
          defaultModel: cfg.model,
          defaultTemperature: cfg.temperature,
          defaultMaxTokens: cfg.maxTokens,
        });
        const models = await provider.getModels();
        const toolModels = models.filter((m) => m.supportsTools);
        console.log(`\nModels with tool-calling support (${toolModels.length}/${models.length}):`);
        for (const m of toolModels.slice(0, 15)) console.log(`  ${m.id}`);
        const chosen = (await rl.question(`\nDefault model [${cfg.model}]: `)).trim();
        if (chosen) model = chosen;
      } catch (err) {
        console.log(theme.warning(`Could not fetch model list: ${(err as Error).message}`));
      }
    }

    const workspaceInput = (await rl.question(`Default workspace [${cfg.workspace}]: `)).trim();
    const workspace = workspaceInput || cfg.workspace;

    const modeInput = (await rl.question(`Permission mode (safe/normal/auto) [${cfg.mode}]: `)).trim();
    const mode = ["safe", "normal", "auto"].includes(modeInput) ? modeInput : cfg.mode;

    const configPath = await updateGlobalConfig(cfg.globalConfigDir, (existing) => {
      existing.model = model;
      existing.mode = mode;
      existing.workspace = { ...tableAt(existing, "workspace"), root: workspace };
      if (apiKey) existing.venice = { ...tableAt(existing, "venice"), api_key: apiKey };
    });
    console.log(theme.success(`\nSaved to ${configPath}`));
    console.log(theme.dim("Run `lattice doctor` to verify everything is working."));
    return ExitCode.SUCCESS;
  } finally {
    rl.close();
  }
}
