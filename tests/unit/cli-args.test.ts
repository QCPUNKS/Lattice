// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import os from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { readVersion } from "../../src/cli/help.js";
import { runAttached } from "../../src/tools/shell.js";

describe("parseArgs", () => {
  it("recognizes --help and -h anywhere on the line", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["exec", "--help"]).help).toBe(true);
  });

  it("recognizes --version and -v", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  it("keeps a quoted prompt containing a flag-like word as prompt text", () => {
    const parsed = parseArgs(["exec", "explain the --help flag"]);
    expect(parsed.help).toBe(false);
    expect(parsed.positional).toEqual(["explain the --help flag"]);
  });

  it("rejects flags it doesn't implement, including the removed --yes", () => {
    expect(() => parseArgs(["--yes"])).toThrow("Unknown flag: --yes");
    expect(() => parseArgs(["-y"])).toThrow("Unknown flag: -y");
  });
});

describe("readVersion", () => {
  it("reads a semver version from package.json", () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("runAttached", () => {
  it("resolves with the command's exit code", async () => {
    expect(await runAttached("exit 0", os.tmpdir())).toBe(0);
    expect(await runAttached("exit 3", os.tmpdir())).toBe(3);
  });

  it("reports a signal death shell-style, as 128 + signal number", async () => {
    expect(await runAttached("kill -TERM $$", os.tmpdir())).toBe(128 + os.constants.signals.SIGTERM);
  });

  it("leaves no signal listeners behind", async () => {
    const before = process.listenerCount("SIGINT");
    await runAttached("true", os.tmpdir());
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
