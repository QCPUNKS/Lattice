// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import type { ToolDefinition } from "../providers/types.js";
import type { CommandRisk } from "../agent/command-classifier.js";

export type PermissionAction = "write" | "delete" | "exec" | "network" | "secret_read";

export interface ToolContext {
  workspace: string;
  /**
   * Routes through the PermissionGate, which decides whether to auto-allow,
   * prompt, or deny based on the active autonomy mode and the action's risk
   * tier. `risk` is required for "exec" (computed via classifyCommand); other
   * actions have a fixed risk tier assigned by the gate itself.
   */
  requirePermission(action: PermissionAction, detail: string, risk?: CommandRisk): Promise<void>;
  log(event: Record<string, unknown>): void;
  /** Records the pre-mutation content of a path for undo/diff. Must be awaited before the write happens ya know. */
  trackMutation?(path: string): Promise<void>;
}

export type ToolHandler = (args: any, ctx: ToolContext) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    const name = definition.function.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, { definition, handler });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
