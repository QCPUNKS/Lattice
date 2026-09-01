// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseArenaSlashArgs, isArenaSubcommand } from "../../src/cli/commands/arena.js";

describe("parseArenaSlashArgs", () => {
  it("parses a quoted prompt with --models and --tests", () => {
    const result = parseArenaSlashArgs('"fix the login bug" --models venice:a,venice:b --tests "npm test"');
    expect(result.positional).toEqual(["fix the login bug"]);
    expect(result.models).toBe("venice:a,venice:b");
    expect(result.tests).toBe("npm test");
  });

  it("parses an unquoted prompt just as well", () => {
    const result = parseArenaSlashArgs("fix the login bug --models a,b");
    expect(result.positional).toEqual(["fix", "the", "login", "bug"]);
    expect(result.positional.join(" ")).toBe("fix the login bug");
    expect(result.models).toBe("a,b");
  });

  it("parses subcommand invocations", () => {
    expect(parseArenaSlashArgs("pick deepseek-v4-flash").positional).toEqual(["pick", "deepseek-v4-flash"]);
    expect(parseArenaSlashArgs("diff").positional).toEqual(["diff"]);
    expect(parseArenaSlashArgs("list").positional).toEqual(["list"]);
  });
});

describe("isArenaSubcommand", () => {
  it("recognizes pick/diff/list/clean only when --models wasn't given", () => {
    expect(isArenaSubcommand(["pick", "model-a"], undefined)).toBe(true);
    expect(isArenaSubcommand(["diff"], undefined)).toBe(true);
    expect(isArenaSubcommand(["list"], undefined)).toBe(true);
    expect(isArenaSubcommand(["clean"], undefined)).toBe(true);
  });

  it("does not misread a real prompt that happens to start with a subcommand word", () => {
    expect(isArenaSubcommand(["pick", "the", "best", "approach"], "a,b")).toBe(false);
  });

  it("returns false for an ordinary task prompt", () => {
    expect(isArenaSubcommand(["fix", "the", "auth", "bug"], "a,b")).toBe(false);
  });
});
