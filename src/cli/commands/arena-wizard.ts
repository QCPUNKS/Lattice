// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type * as readline from "node:readline/promises";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LatticeConfig } from "../../config/index.js";
import type { ModelProvider } from "../../providers/types.js";
import { ensurePrivateDir, writePrivateFile } from "../../security/private-storage.js";
import { theme } from "../../ui/theme.js";
import { detectCommand } from "../actions.js";
import { agentCapableModels, formatContextTokens, formatPrice } from "../model-format.js";
import { parseModelSelection } from "./arena.js";

/**
 * `/arena` with missing pieces asks for them instead of printing a usage line:
 * the task, the models (picked by number, last race's choice remembered), and
 * the test command (detected from the project). Nothing has to be memorized.
 */

export interface ArenaPlan {
  prompt: string;
  models: string[];
  testCommand?: string;
}

export interface ArenaPreset {
  prompt?: string;
  models?: string;
  tests?: string;
}

const LAST_MODELS_FILE = "arena-last-models.json";

export async function planArenaInteractively(
  rl: readline.Interface,
  provider: ModelProvider,
  cfg: LatticeConfig,
  preset: ArenaPreset,
): Promise<ArenaPlan | null> {
  const prompt = preset.prompt || (await askForTask(rl));
  if (!prompt) return null;

  const models = preset.models
    ? preset.models.split(",").map((m) => m.trim()).filter(Boolean)
    : await askForModels(rl, provider, await readLastModels(cfg.dataDir));
  if (!models) return null;

  const testCommand = preset.tests ?? (await askForTests(rl, cfg.workspace));
  await saveLastModels(cfg.dataDir, models).catch(() => {});
  return { prompt, models, testCommand };
}

async function askForTask(rl: readline.Interface): Promise<string | null> {
  const answer = await rl.question(theme.bold("What should the models do? ") + theme.dim("(Enter to cancel) "));
  return answer.trim() || null;
}

async function askForModels(
  rl: readline.Interface,
  provider: ModelProvider,
  lastModels: string[] | null,
): Promise<string[] | null> {
  let catalog: string[] = [];
  try {
    const models = agentCapableModels(await provider.getModels());
    catalog = models.map((m) => m.id);
    console.log(theme.dim("\nModels that can code (cheapest first; prices are $ per million tokens, in / out):"));
    const width = String(models.length).length;
    models.forEach((m, i) => {
      console.log(
        `  ${theme.dim(String(i + 1).padStart(width))}. ${theme.bold(m.id.padEnd(40))} ${formatPrice(m.pricing)} ${formatContextTokens(m.contextLength).padStart(4)} ctx`,
      );
    });
  } catch (err) {
    console.log(theme.warning(`Could not load the model list (${(err as Error).message}). Type model ids instead.`));
  }

  const hint = lastModels ? `Enter = same as last time: ${lastModels.join(", ")}` : "Enter to cancel";
  for (;;) {
    const answer = (await rl.question(`\n${theme.bold("Pick 2 or more models")} by number, e.g. 1 3 5  ${theme.dim(`(${hint}) `)}`)).trim();
    if (!answer) return lastModels;
    const selection = parseModelSelection(answer, catalog);
    if (selection.ok) return selection.models;
    console.log(theme.error(selection.error));
  }
}

async function askForTests(rl: readline.Interface, workspace: string): Promise<string | undefined> {
  const detected = await detectCommand(workspace, "test").catch(() => null);
  if (detected) {
    const answer = (await rl.question(`Check every result with ${theme.bold(detected)}? ${theme.dim("[Y/n] ")}`)).trim().toLowerCase();
    return answer === "n" || answer === "no" ? undefined : detected;
  }
  const answer = (await rl.question(`Test command to score each result ${theme.dim("(Enter to skip) ")}`)).trim();
  return answer || undefined;
}

async function readLastModels(dataDir: string): Promise<string[] | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dataDir, LAST_MODELS_FILE), "utf-8"));
    const valid = Array.isArray(parsed) && parsed.length >= 2 && parsed.every((m) => typeof m === "string" && m.length > 0);
    return valid ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

async function saveLastModels(dataDir: string, models: string[]): Promise<void> {
  await ensurePrivateDir(dataDir);
  await writePrivateFile(path.join(dataDir, LAST_MODELS_FILE), JSON.stringify(models));
}
