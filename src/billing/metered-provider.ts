// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import type {
  ChatRequestOptions,
  ChatResult,
  ModelCapabilities,
  ModelProvider,
  StreamEvent,
  Usage,
} from "../providers/types.js";
import type { BudgetGuard } from "./budget.js";
import type { SpendLedger } from "./ledger.js";
import { estimateChatCost } from "./pricing.js";

/**
 * Decorates any provider with budget enforcement and spend recording, so
 * the agent loop (and every runtime built on it — REPL, exec, arena) is
 * metered without knowing about money at all.
 */
export class MeteredProvider implements ModelProvider {
  readonly name: string;

  constructor(
    private readonly inner: ModelProvider,
    private readonly ledger: SpendLedger,
    private readonly budget: BudgetGuard,
    /** Model used when a request doesn't name one. */
    private readonly defaultModel: () => string,
  ) {
    this.name = inner.name;
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    await this.budget.beforeSpend();
    const result = await this.inner.chat(options);
    if (result.usage) await this.recordChat(options.model ?? this.defaultModel(), result.usage);
    return result;
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<StreamEvent, void, unknown> {
    await this.budget.beforeSpend();
    const model = options.model ?? this.defaultModel();
    for await (const event of this.inner.stream(options)) {
      if (event.type === "usage") await this.recordChat(model, event.usage);
      yield event;
    }
  }

  getModels(): Promise<ModelCapabilities[]> {
    return this.inner.getModels();
  }

  supportsTools(model: string): Promise<boolean> {
    return this.inner.supportsTools(model);
  }

  supportsReasoning(model: string): Promise<boolean> {
    return this.inner.supportsReasoning(model);
  }

  capabilities(model: string): Promise<ModelCapabilities | null> {
    return this.inner.capabilities(model);
  }

  private async recordChat(model: string, usage: Usage): Promise<void> {
    let usd = usage.costUsd;
    let source: "venice" | "estimate" = "venice";
    if (usd === undefined) {
      source = "estimate";
      const pricing = await this.inner.capabilities(model).then((c) => c?.pricing ?? null).catch(() => null);
      usd = pricing ? estimateChatCost(pricing, usage) : 0;
    }
    this.ledger.record({
      kind: "chat",
      model,
      usd,
      source,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      ...(usage.cachedTokens !== undefined ? { cachedTokens: usage.cachedTokens } : {}),
    });
  }
}
