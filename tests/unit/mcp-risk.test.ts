// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { mcpToolRisk, applyRiskOverride, describeMcpCall } from "../../src/mcp/risk.js";
import { PermissionGate } from "../../src/agent/permissions.js";

describe("mcpToolRisk", () => {
  it("treats code-execution tools as destructive, whatever the server claims", () => {
    expect(mcpToolRisk("execute_blender_code", undefined)).toBe("destructive");
    expect(mcpToolRisk("run_python", { readOnlyHint: true })).toBe("destructive"); // hint not believed
    expect(mcpToolRisk("shell", undefined)).toBe("destructive");
    expect(mcpToolRisk("eval", undefined)).toBe("destructive");
  });

  it("uses annotations for everything else", () => {
    expect(mcpToolRisk("get_scene_info", { readOnlyHint: true })).toBe("safe");
    expect(mcpToolRisk("delete_object", { destructiveHint: true })).toBe("destructive");
    expect(mcpToolRisk("set_material", undefined)).toBe("caution");
  });

  it("doesn't mistake ordinary names containing those letters for code execution", () => {
    expect(mcpToolRisk("get_viewport_screenshot", undefined)).toBe("caution");
    expect(mcpToolRisk("search_runways", undefined)).toBe("caution");
    expect(mcpToolRisk("encode_image", undefined)).toBe("caution");
  });
});

describe("describeMcpCall", () => {
  it("shows the code being run, first, so the user approves the actual code", () => {
    const d = describeMcpCall("mcp.blender.execute_blender_code", { note: "x", code: "import bpy\nbpy.ops.mesh.primitive_cube_add()" });
    expect(d.indexOf("code=")).toBeLessThan(d.indexOf("note="));
    expect(d).toContain("primitive_cube_add");
  });

  it("truncates long arguments and says how long they were", () => {
    expect(describeMcpCall("t", { code: "x".repeat(1000) })).toMatch(/… \(1005 chars\)$/);
  });
});

describe("gate behavior for MCP calls", () => {
  function gate(mode: "safe" | "normal" | "auto", answer: string) {
    const rl = { question: vi.fn().mockResolvedValue(answer) } as any;
    return { gate: new PermissionGate(mode, rl, () => {}), rl };
  }

  it("asks before destructive MCP calls even in auto mode, and a no stops the call", async () => {
    const { gate: g, rl } = gate("auto", "n");
    await expect(g.check("mcp", "mcp.blender.execute_blender_code code=…", "destructive")).rejects.toThrow(/Permission denied/);
    expect(rl.question).toHaveBeenCalledTimes(1);
  });

  it("runs read-only MCP calls without asking", async () => {
    const { gate: g, rl } = gate("normal", "n");
    await g.check("mcp", "mcp.blender.get_scene_info", "safe");
    expect(rl.question).not.toHaveBeenCalled();
  });

  it("keeps 'always allow' for MCP separate from shell commands", async () => {
    const { gate: g, rl } = gate("normal", "a");
    await g.check("mcp", "mcp.blender.set_material", "caution");
    expect(g.describeAllowances()).toEqual(["mcp:caution"]);
    rl.question.mockResolvedValue("n");
    await expect(g.check("exec", "npm install", "caution")).rejects.toThrow(/Permission denied/);
  });
});

describe("toolRisk overrides", () => {
  it("lets your global config mark read-only tools safe", () => {
    expect(applyRiskOverride("caution", "safe", "global")).toBe("safe");
  });

  it("never lets a project config lower a tool's risk, only raise it", () => {
    expect(applyRiskOverride("destructive", "safe", "project")).toBe("destructive");
    expect(applyRiskOverride("caution", "safe", "project")).toBe("caution");
    expect(applyRiskOverride("caution", "destructive", "project")).toBe("destructive");
  });

  it("ignores values that aren't risk tiers", () => {
    expect(applyRiskOverride("destructive", "trusted", "global")).toBe("destructive");
    expect(applyRiskOverride("caution", undefined, "global")).toBe("caution");
  });
});

