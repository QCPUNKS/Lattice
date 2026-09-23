// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseToml } from "smol-toml";

// Load .env from cwd if present (never overrides real env vars already set).
if (existsSync(join(process.cwd(), ".env"))) {
  loadDotenv({ path: join(process.cwd(), ".env") });
}

/**
 * SAFE:   ask before every write, delete, and command execution.
 * NORMAL: auto-allow safe reads/writes/tests/builds/git-inspection; ask before
 *         caution-tier side effects (installs, docker up, git checkout/merge)
 *         and always ask before destructive/critical operations.
 * AUTO:   also auto-allow caution-tier side effects; still always asks before
 *         destructive/critical operations and file deletes. Unless you're feeling risky ;)
 */
export type PermissionMode = "safe" | "normal" | "auto";

export interface LatticeConfig {
  provider: "venice";
  model: string;
  veniceApiKey: string | undefined;
  veniceBaseUrl: string;
  temperature: number;
  maxTokens: number;
  mode: PermissionMode;
  workspace: string;
  globalConfigDir: string;
  projectConfigDir: string;
  dataDir: string;
  sessionsDir: string;
  maxIterations: number;
  maxToolCalls: number;
  maxConsecutiveFailures: number;
  commandTimeoutMs: number;
  contextTokenBudget: number;
}

/** CLI-supplied overrides, applied last (highest precedence). */
export interface ConfigOverrides {
  model?: string;
  mode?: PermissionMode;
  workspace?: string;
}

const DEFAULTS = {
  provider: "venice" as const,
  model: "kimi-k2-7-code",
  veniceBaseUrl: "https://api.venice.ai/api/v1",
  temperature: 0.3,
  maxTokens: 4096,
  mode: "normal" as PermissionMode,
  maxIterations: 100,
  maxToolCalls: 300,
  maxConsecutiveFailures: 5,
  commandTimeoutMs: 120_000,
  contextTokenBudget: 100_000, // cost ceiling per turn more than a window limit; raise via [context] token_budget
};

interface TomlConfigShape {
  provider?: string;
  model?: string;
  mode?: string;
  venice?: { base_url?: string; api_key?: string };
  workspace?: { root?: string };
  agent?: {
    max_iterations?: number;
    max_tool_calls?: number;
    max_consecutive_failures?: number;
    command_timeout?: number; // seconds
  };
  generation?: { temperature?: number; max_tokens?: number };
  context?: { token_budget?: number };
}

function readTomlFile(path: string): TomlConfigShape | null {
  if (!existsSync(path)) return null;
  try {
    return parseToml(readFileSync(path, "utf-8")) as TomlConfigShape;
  } catch (err) {
    // A malformed config file should be surfaced, not silently ignored.
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
}

function isPermissionMode(v: unknown): v is PermissionMode {
  return v === "safe" || v === "normal" || v === "auto";
}

const MODE_STRICTNESS: Record<PermissionMode, number> = { safe: 2, normal: 1, auto: 0 };

/**
 * The API key is sent as a bearer token to this URL, so it must be HTTPS.
 * Plain HTTP is tolerated only for loopback (local proxies / test servers).
 */
export function assertSafeBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Venice base URL: ${url}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`Refusing non-HTTPS Venice base URL ${url}: your API key would be sent in cleartext.`);
  }
}

/**
 * Merges configuration in precedence order:
 * defaults → environment variables → global config → project config → CLI arguments.
 * Each stage overrides only the fields it explicitly sets.
 */
export function loadConfig(overrides: ConfigOverrides = {}): LatticeConfig {
  const workspaceBeforeProjectConfig = overrides.workspace
    ? resolve(overrides.workspace)
    : process.cwd();

  const globalConfigDir = join(homedir(), ".config", "lattice");
  const dataDir = join(homedir(), ".local", "share", "lattice");
  const sessionsDir = join(dataDir, "sessions");
  const projectConfigDir = join(workspaceBeforeProjectConfig, ".lattice");

  const globalToml = readTomlFile(join(globalConfigDir, "config.toml"));
  const projectToml = readTomlFile(join(projectConfigDir, "config.toml"));

  // Start from defaults, then env, then global toml, then project toml, then CLI overrides.
  let model = DEFAULTS.model;
  let mode: PermissionMode = DEFAULTS.mode;
  let veniceBaseUrl = DEFAULTS.veniceBaseUrl;
  let veniceApiKey: string | undefined;
  let temperature = DEFAULTS.temperature;
  let maxTokens = DEFAULTS.maxTokens;
  let maxIterations = DEFAULTS.maxIterations;
  let maxToolCalls = DEFAULTS.maxToolCalls;
  let maxConsecutiveFailures = DEFAULTS.maxConsecutiveFailures;
  let commandTimeoutMs = DEFAULTS.commandTimeoutMs;
  let contextTokenBudget = DEFAULTS.contextTokenBudget;
  let workspace = workspaceBeforeProjectConfig;

  // environment variables
  if (process.env.LATTICE_MODEL) model = process.env.LATTICE_MODEL;
  if (process.env.LATTICE_MODE) {
    if (!isPermissionMode(process.env.LATTICE_MODE)) {
      throw new Error(`Invalid LATTICE_MODE: ${process.env.LATTICE_MODE}. Must be safe, normal, or auto.`);
    }
    mode = process.env.LATTICE_MODE;
  }
  if (process.env.VENICE_BASE_URL) veniceBaseUrl = process.env.VENICE_BASE_URL;
  veniceApiKey = process.env.VENICE_API_KEY;
  if (process.env.LATTICE_TEMPERATURE) temperature = envNum(process.env.LATTICE_TEMPERATURE, temperature);
  if (process.env.LATTICE_MAX_TOKENS) maxTokens = envNum(process.env.LATTICE_MAX_TOKENS, maxTokens);

  // global config (~/.config/lattice/config.toml), then project config (<workspace>/.lattice/config.toml)
  for (const toml of [globalToml, projectToml]) {
    if (!toml) continue;
    const isProject = toml === projectToml;
    if (toml.model) model = toml.model;
    if (toml.mode) {
      if (!isPermissionMode(toml.mode)) throw new Error(`Invalid mode in config.toml: ${toml.mode}`);
      // A project config arrives with whatever repo was cloned: it may make the
      // mode stricter, never looser (e.g. a repo can't switch you to "auto").
      if (!isProject || MODE_STRICTNESS[toml.mode] >= MODE_STRICTNESS[mode]) mode = toml.mode;
    }
    if (toml.generation?.temperature !== undefined) temperature = toml.generation.temperature;
    if (toml.generation?.max_tokens !== undefined) maxTokens = toml.generation.max_tokens;
    if (toml.agent?.max_iterations !== undefined) maxIterations = toml.agent.max_iterations;
    if (toml.agent?.max_tool_calls !== undefined) maxToolCalls = toml.agent.max_tool_calls;
    if (toml.agent?.max_consecutive_failures !== undefined) maxConsecutiveFailures = toml.agent.max_consecutive_failures;
    if (toml.agent?.command_timeout !== undefined) commandTimeoutMs = toml.agent.command_timeout * 1000;
    if (toml.context?.token_budget !== undefined) contextTokenBudget = toml.context.token_budget;
  }
  // Security: where the API key is sent, and the key itself, come from the
  // environment or the global config only — never from a project config,
  // which could redirect your bearer token to someone else's server.
  if (globalToml?.venice?.base_url) veniceBaseUrl = globalToml.venice.base_url;
  if (globalToml?.venice?.api_key && !veniceApiKey) veniceApiKey = globalToml.venice.api_key;
  assertSafeBaseUrl(veniceBaseUrl);

  // Global config's [workspace].root only applies if the caller didn't already pin one via CLI.
  if (globalToml?.workspace?.root && !overrides.workspace) {
    workspace = resolve(globalToml.workspace.root);
  }

  // CLI overrides (highest precedence)
  if (overrides.model) model = overrides.model;
  if (overrides.mode) mode = overrides.mode;
  if (overrides.workspace) workspace = resolve(overrides.workspace);

  return {
    provider: "venice",
    model,
    veniceApiKey,
    veniceBaseUrl,
    temperature,
    maxTokens,
    mode,
    workspace,
    globalConfigDir,
    projectConfigDir: join(workspace, ".lattice"),
    dataDir,
    sessionsDir,
    maxIterations,
    maxToolCalls,
    maxConsecutiveFailures,
    commandTimeoutMs,
    contextTokenBudget,
  };
}

function envNum(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Redacts an API key for safe display/logging: shows only first 4 and last 4 chars. */
export function redactKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
