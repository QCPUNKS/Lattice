// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import type { ModelProvider, ChatMessage, ToolCall } from "../providers/types.js";
import type { ToolRegistry, ToolContext } from "../tools/registry.js";
import { compactHistory, estimateHistoryTokens, type CompactionResult } from "./context.js";

export interface AgentLoopOptions {
  maxIterations?: number;
  maxToolCalls?: number;
  maxConsecutiveFailures?: number;
  contextTokenBudget?: number;
}

const DEFAULTS: Required<AgentLoopOptions> = {
  maxIterations: 100,
  maxToolCalls: 300,
  maxConsecutiveFailures: 5,
  contextTokenBudget: 100_000,
};

export interface AgentLoopHooks {
  onTextDelta?: (delta: string) => void;
  onToolCallStart?: (name: string, args: string) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  onTurnEnd?: () => void;
  onCompaction?: (result: CompactionResult) => void;
  onUsage?: (approxTokens: number) => void;
}

export class AgentLoop {
  private opts: Required<AgentLoopOptions>;

  constructor(
    private provider: ModelProvider,
    private registry: ToolRegistry,
    private model: string,
    options: AgentLoopOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Runs the agent loop for one user turn. `history` is mutated in place with
   * every message produced (assistant messages, tool calls, tool results) so
   * the caller retains full conversation state for the next turn.
   */
  async run(
    history: ChatMessage[],
    ctx: ToolContext,
    hooks: AgentLoopHooks = {},
    signal?: AbortSignal,
  ): Promise<void> {
    const tools = this.registry.list();
    let totalToolCalls = 0;
    let lastFailureSignature: string | null = null;
    let consecutiveSameFailures = 0;

    for (let turn = 0; turn < this.opts.maxIterations; turn++) {
      if (signal?.aborted) {
        history.push({ role: "assistant", content: "[Lattice] Cancelled." });
        return;
      }

      // Compact before each model call once we're close to the configured budget.
      if (estimateHistoryTokens(history) > this.opts.contextTokenBudget * 0.9) {
        const result = compactHistory(history, this.opts.contextTokenBudget);
        if (result.compacted) {
          history.length = 0;
          history.push(...result.history);
          hooks.onCompaction?.(result);
          ctx.log({ type: "context_compaction", ...result, history: undefined });
        }
      }

      let assistantText = "";
      const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
      let finishReason: string | null = null;

      try {
        for await (const event of this.provider.stream({
          messages: history,
          tools,
          model: this.model,
          signal,
        })) {
          switch (event.type) {
            case "text_delta":
              assistantText += event.delta;
              hooks.onTextDelta?.(event.delta);
              break;
            case "tool_call_start":
              pendingCalls.set(event.index, { id: event.id, name: event.name, args: "" });
              break;
            case "tool_call_delta": {
              const call = pendingCalls.get(event.index);
              if (call) call.args += event.argumentsDelta;
              break;
            }
            case "usage":
              hooks.onUsage?.(event.usage.totalTokens);
              break;
            case "done":
              finishReason = event.finishReason;
              break;
          }
        }
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === "AbortError") {
          history.push({ role: "assistant", content: assistantText || "[Lattice] Cancelled." });
          return;
        }
        throw err;
      }

      const toolCalls: ToolCall[] = [...pendingCalls.values()].map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.args },
      }));

      history.push({
        role: "assistant",
        content: assistantText.length > 0 ? assistantText : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      hooks.onTurnEnd?.();

      if (toolCalls.length === 0) {
        // No tool calls requested: this is the final answer for this user turn.
        return;
      }

      totalToolCalls += toolCalls.length;
      if (totalToolCalls > this.opts.maxToolCalls) {
        history.push({
          role: "assistant",
          content: `[Lattice] Reached the maximum of ${this.opts.maxToolCalls} tool calls for this request. Stopping to avoid a runaway loop — ask me to continue if more work is needed.`,
        });
        return;
      }

      for (const call of toolCalls) {
        if (signal?.aborted) {
          history.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: "Cancelled." });
          continue;
        }

        hooks.onToolCallStart?.(call.function.name, call.function.arguments);
        const result = await this.executeTool(call, ctx);
        history.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result.output,
        });
        hooks.onToolResult?.(call.function.name, result.output, result.isError);

        const signature = `${call.function.name}::${call.function.arguments}`;
        if (result.isError) {
          consecutiveSameFailures = signature === lastFailureSignature ? consecutiveSameFailures + 1 : 1;
          lastFailureSignature = signature;
          if (consecutiveSameFailures >= this.opts.maxConsecutiveFailures) {
            history.push({
              role: "assistant",
              content: `[Lattice] Detected ${consecutiveSameFailures} consecutive identical failures calling ${call.function.name} with the same arguments. Stopping instead of repeating the same failing action — last error: ${firstLine(result.output)}`,
            });
            return;
          }
        } else {
          lastFailureSignature = null;
          consecutiveSameFailures = 0;
        }
      }

      if (signal?.aborted) {
        history.push({ role: "assistant", content: "[Lattice] Cancelled." });
        return;
      }

      if (finishReason === "stop") {
        // Model signalled completion despite emitting tool calls in the same
        // turn (some providers do this) — loop once more to let it react to results.
        continue;
      }
    }

    history.push({
      role: "assistant",
      content:
        "[Lattice] Reached the maximum number of tool-call turns for this request. Stopping to avoid a runaway loop — ask me to continue if more work is needed.",
    });
  }

  private async executeTool(
    call: ToolCall,
    ctx: ToolContext,
  ): Promise<{ output: string; isError: boolean }> {
    const registered = this.registry.get(call.function.name);
    if (!registered) {
      return { output: `Error: unknown tool "${call.function.name}"`, isError: true };
    }

    let args: any;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return {
        output: `Error: tool arguments were not valid JSON: ${call.function.arguments}`,
        isError: true,
      };
    }

    try {
      const result = await registered.handler(args, ctx);
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${(err as Error).message}`, isError: true };
    }
  }
}

function firstLine(s: string): string {
  const line = s.split("\n")[0];
  return line.length > 200 ? line.slice(0, 200) + "..." : line;
}
