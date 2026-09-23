// All Rights Reserved: Jevante Boxley
// QCPUNKS 

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
 *         destructive/critical operations and file deletes. See spec §14.
 */
export type PermissionMode = "safe" | "normal" | "auto";

/**
 * Which directions of the conversation use speech. Input and output are
 * independent so every combination is available (accessibility):
 *   off:     type → read
 *   chat:    speak → hear (text is always shown as captions)
 *   dictate: speak → read
 *   listen:  type → hear
 */
export type VoiceMode = "off" | "chat" | "dictate" | "listen";

export const VOICE_MODES: readonly VoiceMode[] = ["off", "chat", "dictate", "listen"];

export interface ImageConfig {
  /** User-chosen output folder. Deliberately no default: asked on first /imagine. */
  outputDir: string | undefined;
  /** Venice safe_mode (blurs adult content). undefined = not yet chosen; asked on first /imagine. */
  safeMode: boolean | undefined;
  model: string;
  /** Refuse models Venice proxies to third parties (privacy: "anonymized"). */
  privateOnly: boolean;
  /** Write a .json sidecar (prompt, seed, model) next to each image. Off by default: prompts are private. */
  saveMetadata: boolean;
  aspectRatio: string;
}

export interface BudgetSettings {
  dailyUsd: number | undefined;
  monthlyUsd: number | undefined;
  warnAt: number;
  lowBalanceUsd: number;
}

export interface UiConfig {
  /** Animated mascot (Kitty graphics terminals); off = the plain spinner. */
  mascot: boolean;
  /** Mascot stage height in terminal rows. */
  mascotRows: number;
  /** Climb-in intro at startup. */
  intro: boolean;
  /** No animation anywhere: still poses, no spinner redraws (screen readers, vestibular comfort). */
  reducedMotion: boolean;
  /** Terminal background for the session as #rrggbb, restored on exit; undefined leaves the terminal alone. */
  background: string | undefined;
}

export type VoiceEngineName = "local" | "venice";

export interface VoiceConfig {
  mode: VoiceMode;
  /** "local": Whisper + Kokoro on this machine (free, offline). "venice": Venice's hosted speech models (paid). */
  engine: VoiceEngineName;
  /** Python with faster-whisper + kokoro-onnx installed (scripts/voice/install-local-voice.sh creates one). */
  localPython: string;
  /** faster-whisper model name (from the Hugging Face cache) or a local path. */
  localSttModel: string;
  /** auto | cuda | cpu */
  localSttDevice: string;
  localTtsModel: string;
  localTtsVoices: string;
  /** PulseAudio/PipeWire source name. undefined = auto-detect the first non-monitor source. */
  inputDevice: string | undefined;
  sttModel: string;
  ttsModel: string;
  voice: string;
  speed: number;
  /** ISO 639-1 hint for transcription; undefined lets the model detect. */
  language: string | undefined;
  /** Refuse speech models Venice proxies to third parties (privacy: "anonymized"). */
  privateOnly: boolean;
}

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
  image: ImageConfig;
  voice: VoiceConfig;
  ui: UiConfig;
  budget: BudgetSettings;
}

/** CLI-supplied overrides, applied last (highest precedence). */
export interface ConfigOverrides {
  model?: string;
  mode?: PermissionMode;
  workspace?: string;
}

const DEFAULTS = {
  provider: "venice" as const,
  model: "deepseek-v4-flash-0731",
  veniceBaseUrl: "https://api.venice.ai/api/v1",
  temperature: 0.3,
  maxTokens: 4096,
  mode: "normal" as PermissionMode,
  maxIterations: 100,
  maxToolCalls: 300,
  maxConsecutiveFailures: 5,
  commandTimeoutMs: 120_000,
  contextTokenBudget: 400_000, // headroom under deepseek-v4-flash-0731's 1M window; override via [context] token_budget for a smaller-context model
  image: {
    outputDir: undefined,
    safeMode: undefined,
    model: "z-image-turbo",
    privateOnly: true,
    saveMetadata: false,
    aspectRatio: "1:1",
  } satisfies ImageConfig,
  budget: {
    dailyUsd: undefined,
    monthlyUsd: undefined,
    warnAt: 0.8,
    lowBalanceUsd: 1,
  } satisfies BudgetSettings,
  ui: {
    mascot: true,
    mascotRows: 5,
    intro: true,
    reducedMotion: false,
    background: "#050b12",
  } satisfies UiConfig,
  voice: {
    mode: "off",
    engine: "local",
    localPython: join(homedir(), ".local", "share", "lattice", "voice-env", "bin", "python"),
    localSttModel: "small.en",
    localSttDevice: "auto",
    localTtsModel: join(homedir(), ".local", "share", "lattice", "voice-models", "kokoro-v1.0.onnx"),
    localTtsVoices: join(homedir(), ".local", "share", "lattice", "voice-models", "voices-v1.0.bin"),
    inputDevice: undefined,
    sttModel: "openai/whisper-large-v3",
    ttsModel: "tts-kokoro",
    voice: "af_sky",
    speed: 1,
    language: undefined,
    privateOnly: true,
  } satisfies VoiceConfig,
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
    command_timeout?: number; // seconds, per spec example
  };
  generation?: { temperature?: number; max_tokens?: number };
  context?: { token_budget?: number };
  image?: {
    output_dir?: string;
    safe_mode?: boolean;
    model?: string;
    private_only?: boolean;
    save_metadata?: boolean;
    aspect_ratio?: string;
  };
  budget?: {
    daily_usd?: number;
    monthly_usd?: number;
    warn_at?: number;
    low_balance_usd?: number;
  };
  ui?: {
    mascot?: boolean;
    mascot_rows?: number;
    intro?: boolean;
    reduced_motion?: boolean;
    background?: string | false;
  };
  voice?: {
    mode?: string;
    engine?: string;
    local_python?: string;
    local_stt_model?: string;
    local_stt_device?: string;
    local_tts_model?: string;
    local_tts_voices?: string;
    input_device?: string;
    stt_model?: string;
    tts_model?: string;
    voice?: string;
    speed?: number;
    language?: string;
    private_only?: boolean;
  };
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

export function isVoiceMode(v: unknown): v is VoiceMode {
  return (VOICE_MODES as readonly unknown[]).includes(v);
}

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
    throw new Error(`Refusing non-HTTPS Venice base URL ${url} — your API key would be sent in cleartext.`);
  }
}

/**
 * Merges configuration per spec §37 precedence:
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
  const image: ImageConfig = { ...DEFAULTS.image };
  const voice: VoiceConfig = { ...DEFAULTS.voice };
  const ui: UiConfig = { ...DEFAULTS.ui };
  const budget: BudgetSettings = { ...DEFAULTS.budget };
  if (process.env.LATTICE_REDUCED_MOTION === "1") ui.reducedMotion = true;
  if (process.env.LATTICE_MASCOT === "0") ui.mascot = false;

  // --- environment variables ---
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

  // --- global config (~/.config/lattice/config.toml) ---
  for (const toml of [globalToml, projectToml]) {
    if (!toml) continue;
    if (toml.model) model = toml.model;
    if (toml.mode) {
      if (!isPermissionMode(toml.mode)) throw new Error(`Invalid mode in config.toml: ${toml.mode}`);
      mode = toml.mode;
    }
    if (toml.venice?.api_key && !veniceApiKey) veniceApiKey = toml.venice.api_key;
    if (toml.generation?.temperature !== undefined) temperature = toml.generation.temperature;
    if (toml.generation?.max_tokens !== undefined) maxTokens = toml.generation.max_tokens;
    if (toml.agent?.max_iterations !== undefined) maxIterations = toml.agent.max_iterations;
    if (toml.agent?.max_tool_calls !== undefined) maxToolCalls = toml.agent.max_tool_calls;
    if (toml.agent?.max_consecutive_failures !== undefined) maxConsecutiveFailures = toml.agent.max_consecutive_failures;
    if (toml.agent?.command_timeout !== undefined) commandTimeoutMs = toml.agent.command_timeout * 1000;
    if (toml.context?.token_budget !== undefined) contextTokenBudget = toml.context.token_budget;
    applyUiToml(ui, toml.ui);
  }
  // Security: settings that decide where your API key, microphone audio, or
  // images go are read from the global config only. A project's
  // .lattice/config.toml comes with whatever repo you cloned, and must not be
  // able to redirect your bearer token or your files.
  if (globalToml) {
    if (globalToml.venice?.base_url) veniceBaseUrl = globalToml.venice.base_url;
    applyImageToml(image, globalToml.image);
    applyBudgetToml(budget, globalToml.budget); // a cloned repo must not be able to raise your spending limits
    applyVoiceToml(voice, globalToml.voice);
  }
  assertSafeBaseUrl(veniceBaseUrl);

  // Global config's [workspace].root only applies if the caller didn't already pin one via CLI.
  if (globalToml?.workspace?.root && !overrides.workspace) {
    workspace = resolve(globalToml.workspace.root);
  }

  // --- CLI overrides (highest precedence) ---
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
    image,
    voice,
    ui,
    budget,
  };
}

function applyBudgetToml(budget: BudgetSettings, t: TomlConfigShape["budget"]): void {
  if (!t) return;
  const money = (key: string, v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`Invalid [budget] ${key}: ${v}. Use a dollar amount like 2.50.`);
    return v;
  };
  if (t.daily_usd !== undefined) budget.dailyUsd = money("daily_usd", t.daily_usd);
  if (t.monthly_usd !== undefined) budget.monthlyUsd = money("monthly_usd", t.monthly_usd);
  if (t.low_balance_usd !== undefined) budget.lowBalanceUsd = money("low_balance_usd", t.low_balance_usd);
  if (t.warn_at !== undefined) {
    if (typeof t.warn_at !== "number" || t.warn_at <= 0 || t.warn_at > 1) throw new Error(`Invalid [budget] warn_at: ${t.warn_at}. Use a fraction like 0.8.`);
    budget.warnAt = t.warn_at;
  }
}

function applyUiToml(ui: UiConfig, t: TomlConfigShape["ui"]): void {
  if (!t) return;
  if (t.mascot !== undefined) ui.mascot = t.mascot;
  if (t.mascot_rows !== undefined) {
    if (!Number.isInteger(t.mascot_rows) || t.mascot_rows < 3 || t.mascot_rows > 12) {
      throw new Error(`Invalid [ui] mascot_rows: ${t.mascot_rows}. Must be a whole number from 3 to 12.`);
    }
    ui.mascotRows = t.mascot_rows;
  }
  if (t.intro !== undefined) ui.intro = t.intro;
  if (t.reduced_motion !== undefined) ui.reducedMotion = t.reduced_motion;
  if (t.background === false) ui.background = undefined;
  else if (t.background !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(t.background)) {
      throw new Error(`Invalid [ui] background: ${t.background}. Use #rrggbb, or false to leave the terminal alone.`);
    }
    ui.background = t.background;
  }
}

function applyImageToml(image: ImageConfig, t: TomlConfigShape["image"]): void {
  if (!t) return;
  if (t.output_dir !== undefined) image.outputDir = expandHome(t.output_dir);
  if (t.safe_mode !== undefined) image.safeMode = t.safe_mode;
  if (t.model) image.model = t.model;
  if (t.private_only !== undefined) image.privateOnly = t.private_only;
  if (t.save_metadata !== undefined) image.saveMetadata = t.save_metadata;
  if (t.aspect_ratio) image.aspectRatio = t.aspect_ratio;
}

function applyVoiceToml(voice: VoiceConfig, t: TomlConfigShape["voice"]): void {
  if (!t) return;
  if (t.mode !== undefined) {
    if (!isVoiceMode(t.mode)) throw new Error(`Invalid [voice] mode in config.toml: ${t.mode}. Must be one of ${VOICE_MODES.join(", ")}.`);
    voice.mode = t.mode;
  }
  if (t.engine !== undefined) {
    if (t.engine !== "local" && t.engine !== "venice") throw new Error(`Invalid [voice] engine: ${t.engine}. Must be local or venice.`);
    voice.engine = t.engine;
  }
  if (t.local_python) voice.localPython = t.local_python.includes("/") ? expandHome(t.local_python) : t.local_python;
  if (t.local_stt_model) voice.localSttModel = t.local_stt_model;
  if (t.local_stt_device !== undefined) {
    if (!["auto", "cuda", "cpu"].includes(t.local_stt_device)) throw new Error(`Invalid [voice] local_stt_device: ${t.local_stt_device}. Must be auto, cuda, or cpu.`);
    voice.localSttDevice = t.local_stt_device;
  }
  if (t.local_tts_model) voice.localTtsModel = expandHome(t.local_tts_model);
  if (t.local_tts_voices) voice.localTtsVoices = expandHome(t.local_tts_voices);
  if (t.input_device) voice.inputDevice = t.input_device;
  if (t.stt_model) voice.sttModel = t.stt_model;
  if (t.tts_model) voice.ttsModel = t.tts_model;
  if (t.voice) voice.voice = t.voice;
  if (t.speed !== undefined) voice.speed = t.speed;
  if (t.language) voice.language = t.language;
  if (t.private_only !== undefined) voice.privateOnly = t.private_only;
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return resolve(p);
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
