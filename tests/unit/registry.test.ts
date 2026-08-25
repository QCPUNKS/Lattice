// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolDefinition } from "../../src/providers/types.js";

function def(name: string): ToolDefinition {
  return { type: "function", function: { name, description: "d", parameters: { type: "object", properties: {} } } };
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools by name", () => {
    const registry = new ToolRegistry();
    registry.register(def("foo"), async () => "ok");
    expect(registry.get("foo")).toBeDefined();
    expect(registry.names()).toEqual(["foo"]);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws on duplicate registration instead of silently overwriting", () => {
    const registry = new ToolRegistry();
    registry.register(def("foo"), async () => "ok");
    expect(() => registry.register(def("foo"), async () => "ok2")).toThrow();
  });

  it("returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });
});
