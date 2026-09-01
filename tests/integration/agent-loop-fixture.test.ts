// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentLoop } from "../../src/agent/loop.js";
import { ToolRegistry, type ToolContext } from "../../src/tools/registry.js";
import { registerAllTools } from "../../src/tools/register-all.js";
import type {
  ModelProvider,
  ChatRequestOptions,
  ChatResult,
  StreamEvent,
  ModelCapabilities,
} from "../../src/providers/types.js";
import type { ChatMessage } from "../../src/providers/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = path.join(__dirname, "..", "fixtures", "demo-project");

type ScriptedTurn = { text: string } | { toolCalls: Array<{ name: string; args: unknown }> };

/** A scripted fake provider that plays back a fixed sequence of turns — deterministic, no network. */
class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  private turnIndex = 0;

  constructor(private script: ScriptedTurn[]) {}

  async *stream(_options: ChatRequestOptions): AsyncGenerator<StreamEvent, void, unknown> {
    const turn = this.script[this.turnIndex++];
    if (!turn) throw new Error("ScriptedProvider ran out of scripted turns");

    if ("text" in turn) {
      yield { type: "text_delta", delta: turn.text };
      yield { type: "done", finishReason: "stop" };
      return;
    }

    for (let i = 0; i < turn.toolCalls.length; i++) {
      const call = turn.toolCalls[i];
      yield { type: "tool_call_start", index: i, id: `call_${this.turnIndex}_${i}`, name: call.name };
      yield { type: "tool_call_delta", index: i, argumentsDelta: JSON.stringify(call.args) };
    }
    yield { type: "done", finishReason: "tool_calls" };
  }

  async chat(_options: ChatRequestOptions): Promise<ChatResult> {
    throw new Error("not used by AgentLoop");
  }
  async getModels(): Promise<ModelCapabilities[]> {
    return [];
  }
  async supportsTools(): Promise<boolean> {
    return true;
  }
  async supportsReasoning(): Promise<boolean> {
    return false;
  }
  async capabilities(): Promise<ModelCapabilities | null> {
    return null;
  }
}

describe("end-to-end agent loop against a real fixture project", () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-e2e-"));
    await fs.cp(FIXTURE_SRC, workspace, { recursive: true });
    ctx = {
      workspace,
      requirePermission: async () => {},
      log: () => {},
    };
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("inspects, fixes a deliberately broken function, and verifies the fix by running tests", async () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    const provider = new ScriptedProvider([
      { toolCalls: [{ name: "read_file", args: { path: "math.js" } }] },
      {
        toolCalls: [
          { name: "edit_file", args: { path: "math.js", old_str: "return a - b;", new_str: "return a + b;" } },
        ],
      },
      { toolCalls: [{ name: "run_command", args: { command: "npm test" } }] },
      { text: "Fixed add() — it was subtracting instead of adding. Tests now pass." },
    ]);

    const loop = new AgentLoop(provider, registry, "scripted-model");
    const history: ChatMessage[] = [{ role: "system", content: "You are Lattice." }, { role: "user", content: "Fix the bug and verify with tests." }];

    const toolResults: Array<{ name: string; isError: boolean }> = [];
    await loop.run(history, ctx, {
      onToolResult: (name, _result, isError) => toolResults.push({ name, isError }),
    });

    // 1. The source file was actually repaired on disk.
    const fixedSource = await fs.readFile(path.join(workspace, "math.js"), "utf-8");
    expect(fixedSource).toContain("return a + b;");

    // 2. Every tool call along the way succeeded (no silent failures).
    expect(toolResults.map((r) => r.name)).toEqual(["read_file", "edit_file", "run_command"]);
    expect(toolResults.every((r) => !r.isError)).toBe(true);

    // 3. The test run genuinely passed against the fixed code.
    const testToolMessage = history.find((m) => m.role === "tool" && m.name === "run_command");
    expect(testToolMessage?.content).toContain("exit_code: 0");
    expect(testToolMessage?.content).toContain("PASS");

    // 4. The loop produced a real final answer, not a truncated/error state.
    const finalMessage = history[history.length - 1];
    expect(finalMessage.role).toBe("assistant");
    expect(finalMessage.content).toContain("Fixed add()");
  });
});
