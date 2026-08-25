// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readFileHandler,
  writeFileHandler,
  editFileHandler,
} from "../../src/tools/filesystem.js";
import type { ToolContext } from "../../src/tools/registry.js";

let workspace: string;
let ctx: ToolContext;
let requirePermission: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-test-"));
  requirePermission = vi.fn().mockResolvedValue(undefined);
  ctx = { workspace, requirePermission, log: () => {} };
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("filesystem tools: workspace boundary", () => {
  it("refuses to read outside the workspace via ../ traversal", async () => {
    await expect(readFileHandler({ path: "../../etc/passwd" }, ctx)).rejects.toThrow(/outside the workspace/);
  });

  it("refuses to write outside the workspace via an absolute path", async () => {
    await expect(writeFileHandler({ path: "/etc/passwd", content: "x" }, ctx)).rejects.toThrow(/outside the workspace/);
  });

  it("allows normal reads/writes within the workspace", async () => {
    await writeFileHandler({ path: "a.txt", content: "hello" }, ctx);
    const content = await readFileHandler({ path: "a.txt" }, ctx);
    expect(content).toBe("hello");
  });
});

describe("filesystem tools: secret file protection", () => {
  it("requires secret_read permission before reading .env", async () => {
    await fs.writeFile(path.join(workspace, ".env"), "SECRET=1");
    await readFileHandler({ path: ".env" }, ctx);
    expect(requirePermission).toHaveBeenCalledWith("secret_read", expect.stringContaining(".env"));
  });

  it("does not gate ordinary source files", async () => {
    await fs.writeFile(path.join(workspace, "index.ts"), "export {}");
    await readFileHandler({ path: "index.ts" }, ctx);
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

describe("edit_file", () => {
  it("rejects ambiguous edits that match more than once", async () => {
    await fs.writeFile(path.join(workspace, "b.txt"), "foo\nfoo\n");
    await expect(
      editFileHandler({ path: "b.txt", old_str: "foo", new_str: "bar" }, ctx),
    ).rejects.toThrow(/must be unique/);
  });

  it("applies a unique replacement", async () => {
    await fs.writeFile(path.join(workspace, "c.txt"), "foo\nbaz\n");
    await editFileHandler({ path: "c.txt", old_str: "foo", new_str: "bar" }, ctx);
    const content = await fs.readFile(path.join(workspace, "c.txt"), "utf-8");
    expect(content).toBe("bar\nbaz\n");
  });
});
