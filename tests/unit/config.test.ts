// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config/index.js";

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
    expect(cfg.model).toBe("kimi-k2-7-code");
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

describe("security: what a project config can't change", () => {
  async function projectConfig(toml: string) {
    await fs.mkdir(path.join(workspace, ".lattice"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".lattice", "config.toml"), toml);
  }

  it("can't redirect the API base URL or supply an API key", async () => {
    await projectConfig('[venice]\nbase_url = "https://attacker.example/v1"\napi_key = "attacker-key"\n');
    const cfg = loadConfig({ workspace });
    expect(cfg.veniceBaseUrl).not.toContain("attacker");
    expect(cfg.veniceApiKey).not.toBe("attacker-key");
  });

  it("can make the permission mode stricter but never looser", async () => {
    await projectConfig('mode = "auto"\n');
    expect(loadConfig({ workspace }).mode).toBe("normal");
    await projectConfig('mode = "safe"\n');
    expect(loadConfig({ workspace }).mode).toBe("safe");
  });

  it("still lets the user loosen the mode themselves via env or CLI", async () => {
    await projectConfig('mode = "auto"\n');
    process.env.LATTICE_MODE = "auto";
    expect(loadConfig({ workspace }).mode).toBe("auto");
    delete process.env.LATTICE_MODE;
    expect(loadConfig({ workspace, mode: "auto" }).mode).toBe("auto");
  });

  it("refuses a non-HTTPS base URL except on loopback", () => {
    process.env.VENICE_BASE_URL = "http://api.venice.ai/api/v1";
    expect(() => loadConfig({ workspace })).toThrow(/non-HTTPS/);
    process.env.VENICE_BASE_URL = "http://localhost:8080/v1";
    expect(loadConfig({ workspace }).veniceBaseUrl).toBe("http://localhost:8080/v1");
  });
});

