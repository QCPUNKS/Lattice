// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpManager } from "../../src/mcp/manager.js";
import { ToolRegistry, type ToolContext } from "../../src/tools/registry.js";
import { PermissionDeniedError } from "../../src/agent/permissions.js";

const STUB = fileURLToPath(new URL("../fixtures/mcp/stub-server.mjs", import.meta.url));

let dir: string;
let marker: string;
let manager: McpManager;
const registry = new ToolRegistry();

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "lattice-mcp-"));
  marker = path.join(dir, "ran.txt");
  manager = new McpManager();
  await manager.connectAll(
    [{ name: "stub", scope: "global", config: { command: process.execPath, args: [STUB], env: { STUB_MARKER: marker } } }],
    registry,
    () => {},
    async () => true,
  );
}, 30_000);

afterAll(async () => {
  await manager.disconnectAll();
  rmSync(dir, { recursive: true, force: true });
});

function context(requirePermission: ToolContext["requirePermission"]): ToolContext {
  return { workspace: dir, requirePermission, log: () => {} };
}

function handler(name: string) {
  const tool = registry.list().map((d) => d.function.name).find((n) => n.endsWith(name));
  if (!tool) throw new Error(`tool ${name} not registered`);
  return registry.get(tool)!.handler;
}

describe("MCP tool calls go through the permission gate", () => {
  it("asks before a code-execution tool, as destructive, showing the code", async () => {
    const ask = vi.fn().mockResolvedValue(undefined);
    await handler("execute_code")({ code: "print('hi')" }, context(ask));
    expect(ask).toHaveBeenCalledWith("mcp", expect.stringContaining("print('hi')"), "destructive");
    expect(readFileSync(marker, "utf-8")).toBe("print('hi')");
    rmSync(marker);
  });

  it("never runs the tool when permission is denied", async () => {
    const deny = vi.fn().mockRejectedValue(new PermissionDeniedError("mcp", "denied"));
    await expect(handler("execute_code")({ code: "rm -rf ~" }, context(deny))).rejects.toThrow(/denied/);
    expect(existsSync(marker)).toBe(false);
  });

  it("classifies a read-only tool as safe", async () => {
    const ask = vi.fn().mockResolvedValue(undefined);
    expect(await handler("get_info")({}, context(ask))).toBe("info");
    expect(ask).toHaveBeenCalledWith("mcp", expect.any(String), "safe");
  });
});
