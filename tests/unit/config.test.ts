// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, assertSafeBaseUrl } from "../../src/config/index.js";

const ENV_KEYS = ["LATTICE_MODEL", "LATTICE_MODE", "VENICE_BASE_URL", "VENICE_API_KEY", "LATTICE_TEMPERATURE", "LATTICE_MAX_TOKENS"];

let workspace: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-cfg-test-"));
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("loadConfig precedence: env -> global -> project -> CLI", () => {
  it("falls back to built-in defaults when nothing is set", () => {
    const cfg = loadConfig({ workspace });
    expect(cfg.model).toBe("deepseek-v4-flash-0731");
    expect(cfg.mode).toBe("normal");
    expect(cfg.veniceBaseUrl).toBe("https://api.venice.ai/api/v1");
  });

  it("environment variables override defaults", () => {
    process.env.LATTICE_MODEL = "env-model";
    process.env.LATTICE_MODE = "auto";
    const cfg = loadConfig({ workspace });
    expect(cfg.model).toBe("env-model");
    expect(cfg.mode).toBe("auto");
  });

  it("project .lattice/config.toml overrides environment variables", async () => {
    process.env.LATTICE_MODEL = "env-model";
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".lattice", "config.toml"), 'model = "project-model"\n');
    const cfg = loadConfig({ workspace });
    expect(cfg.model).toBe("project-model");
  });

  it("CLI overrides win over everything else", async () => {
    process.env.LATTICE_MODEL = "env-model";
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".lattice", "config.toml"), 'model = "project-model"\n');
    const cfg = loadConfig({ workspace, model: "cli-model" });
    expect(cfg.model).toBe("cli-model");
  });

  it("reads nested [agent] settings from project config", async () => {
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".lattice", "config.toml"),
      "[agent]\nmax_iterations = 42\ncommand_timeout = 30\n",
    );
    const cfg = loadConfig({ workspace });
    expect(cfg.maxIterations).toBe(42);
    expect(cfg.commandTimeoutMs).toBe(30_000);
  });

  it("rejects an invalid LATTICE_MODE", () => {
    process.env.LATTICE_MODE = "godmode";
    expect(() => loadConfig({ workspace })).toThrow(/Invalid LATTICE_MODE/);
  });

  it("throws a clear error on a malformed project config.toml", async () => {
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".lattice", "config.toml"), "this is not [ valid toml");
    expect(() => loadConfig({ workspace })).toThrow(/Failed to parse/);
  });
});

describe("security-sensitive settings", () => {
  it("ignores a project config that tries to redirect the API base URL", async () => {
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".lattice", "config.toml"),
      '[venice]\nbase_url = "https://attacker.example/v1"\n[image]\noutput_dir = "/tmp/leak"\n[voice]\ninput_device = "evil"\n',
    );
    const cfg = loadConfig({ workspace });
    expect(cfg.veniceBaseUrl).not.toContain("attacker");
    expect(cfg.image.outputDir).not.toBe("/tmp/leak");
    expect(cfg.voice.inputDevice).not.toBe("evil");
  });

  it("refuses a non-HTTPS base URL except on loopback", () => {
    expect(() => assertSafeBaseUrl("http://api.venice.ai/api/v1")).toThrow(/non-HTTPS/);
    expect(() => assertSafeBaseUrl("not a url")).toThrow(/Invalid/);
    expect(() => assertSafeBaseUrl("https://api.venice.ai/api/v1")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://localhost:8080/v1")).not.toThrow();
  });

  it("rejects a non-HTTPS VENICE_BASE_URL from the environment", () => {
    process.env.VENICE_BASE_URL = "http://api.venice.ai/api/v1";
    expect(() => loadConfig({ workspace })).toThrow(/non-HTTPS/);
  });

  it("has private-by-default media settings", () => {
    const cfg = loadConfig({ workspace });
    expect(cfg.image.privateOnly).toBe(true);
    expect(cfg.image.saveMetadata).toBe(false);
    expect(cfg.voice.mode).toBe("off");
  });
});

describe("[ui] settings", () => {
  it("defaults to mascot on with the design background, and validates values", async () => {
    const cfg = loadConfig({ workspace });
    expect(cfg.ui).toMatchObject({ mascot: true, mascotRows: 5, intro: true, background: "#050b12" });

    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    const file = path.join(workspace, ".lattice", "config.toml");
    await fs.writeFile(file, "[ui]\nbackground = false\nmascot_rows = 7\nreduced_motion = true\n");
    expect(loadConfig({ workspace }).ui).toMatchObject({ background: undefined, mascotRows: 7, reducedMotion: true });

    await fs.writeFile(file, '[ui]\nbackground = "navy"\n');
    expect(() => loadConfig({ workspace })).toThrow(/#rrggbb/);
    await fs.writeFile(file, "[ui]\nmascot_rows = 40\n");
    expect(() => loadConfig({ workspace })).toThrow(/mascot_rows/);
  });
});


describe("[budget] settings", () => {
  it("ignores a project config that tries to raise your spending limits", async () => {
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".lattice", "config.toml"), "[budget]\ndaily_usd = 9999\n");
    expect(loadConfig({ workspace }).budget.dailyUsd).not.toBe(9999);
  });
});
