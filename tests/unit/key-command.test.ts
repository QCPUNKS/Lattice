// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findKeyDefinitions, maskKey } from "../../src/cli/commands/key.js";

describe("maskKey", () => {
  it("shows only the last four characters", () => {
    expect(maskKey("VENICE-INFERENCE-KEY-abcd1234")).toBe("…1234");
  });

  it("hides short values entirely", () => {
    expect(maskKey("abc")).toBe("…");
  });
});

describe("findKeyDefinitions", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-key-home-"));
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-key-ws-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("finds exported and plain assignments with line numbers", async () => {
    await fs.writeFile(path.join(home, ".zshrc"), "alias ll='ls -l'\nexport VENICE_API_KEY=\"x\"\n");
    await fs.writeFile(path.join(workspace, ".env"), "VENICE_API_KEY=y\n");
    expect(findKeyDefinitions(home, workspace)).toEqual([
      `${path.join(home, ".zshrc")}:2`,
      `${path.join(workspace, ".env")}:1`,
    ]);
  });

  it("ignores commented-out lines and other variables", async () => {
    await fs.writeFile(path.join(home, ".bashrc"), "# export VENICE_API_KEY=old\nexport VENICE_BASE_URL=z\n");
    expect(findKeyDefinitions(home, workspace)).toEqual([]);
  });
});
