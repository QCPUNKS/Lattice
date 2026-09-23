// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import {
  ChatRequestOptions,
  ChatResult,
  ModelCapabilities,
  ModelProvider,
  ProviderError,
  StreamEvent,
  Usage,
} from "./types.js";
import { VeniceHttp } from "./venice-http.js";
import { parseTextPricing } from "../billing/pricing.js";

/** Venice usage object (+ its non-standard `cost` sibling) → Usage. */
function parseUsage(raw: any, cost: any): Usage {
  const cached = raw.prompt_tokens_details?.cached_tokens ?? raw.cache_read_input_tokens;
  const costUsd = typeof cost?.usd === "number" && Number.isFinite(cost.usd) ? cost.usd : undefined;
  return {
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    totalTokens: raw.total_tokens ?? 0,
    ...(typeof cached === "number" ? { cachedTokens: cached } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

interface VeniceProviderOptions {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

export class VeniceProvider implements ModelProvider {
  readonly name = "venice";
  private modelCache: ModelCapabilities[] | null = null;
  private modelCacheAt = 0;
  private readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

  private readonly http: VeniceHttp;

  /** Pass `http` to share one transport (and its balance tracking) with the media clients. */
  constructor(
    private readonly opts: VeniceProviderOptions,
    http?: VeniceHttp,
  ) {
    this.http = http ?? new VeniceHttp(opts.apiKey, opts.baseUrl);
  }

  private buildBody(options: ChatRequestOptions, stream: boolean) {
    return {
      model: options.model ?? this.opts.defaultModel,
      messages: options.messages,
      tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
      temperature: options.temperature ?? this.opts.defaultTemperature,
      max_completion_tokens: options.maxTokens ?? this.opts.defaultMaxTokens,
      parallel_tool_calls: options.parallelToolCalls ?? true,
      stream,
      // Ask for the final usage chunk (token counts + Venice's actual charge).
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      // Venice otherwise prepends its own ~1.7k-token system prompt to every
      // request: paid for on each call, and it injects Venice's persona into
      // the coding agent's instructions.
      venice_parameters: { include_venice_system_prompt: false },
    };
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const res = await this.http.request(
      "/chat/completions",
      {
        method: "POST",
        headers: this.http.jsonHeaders(),
        body: JSON.stringify(this.buildBody(options, false)),
      },
      options.signal,
    );

    const data: any = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError("Venice API returned no choices in response");
    }

    return {
      message: {
        role: "assistant",
        content: choice.message?.content ?? null,
        tool_calls: choice.message?.tool_calls,
      },
      finishReason: choice.finish_reason ?? null,
      usage: data.usage ? parseUsage(data.usage, data.cost) : undefined,
    };
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<StreamEvent, void, unknown> {
    const res = await this.http.request(
      "/chat/completions",
      {
        method: "POST",
        headers: this.http.jsonHeaders(),
        body: JSON.stringify(this.buildBody(options, true)),
      },
      options.signal,
    );

    if (!res.body) {
      throw new ProviderError("Venice API streaming response had no body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Tracks partial tool-call argument accumulation by index for this stream.
    const toolCallNamesSent = new Set<number>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (payload === "[DONE]") {
            yield { type: "done", finishReason: null };
            return;
          }

          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // skip malformed SSE chunk rather than crashing the agent loop
          }

          // The usage chunk arrives last with an empty choices array — read it
          // before skipping choice-less chunks.
          if (json.usage) {
            yield { type: "usage", usage: parseUsage(json.usage, json.cost) };
          }

          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta ?? {};

          if (typeof delta.content === "string" && delta.content.length > 0) {
            yield { type: "text_delta", delta: delta.content };
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              if (tc.id && tc.function?.name && !toolCallNamesSent.has(index)) {
                toolCallNamesSent.add(index);
                yield {
                  type: "tool_call_start",
                  index,
                  id: tc.id,
                  name: tc.function.name,
                };
              }
              if (tc.function?.arguments) {
                yield {
                  type: "tool_call_delta",
                  index,
                  argumentsDelta: tc.function.arguments,
                };
              }
            }
          }

          if (choice.finish_reason) {
            yield { type: "done", finishReason: choice.finish_reason };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getModels(): Promise<ModelCapabilities[]> {
    if (this.modelCache && Date.now() - this.modelCacheAt < this.MODEL_CACHE_TTL_MS) {
      return this.modelCache;
    }

    const res = await this.http.request("/models", {
      method: "GET",
      headers: this.http.authHeaders(),
    });
    const data: any = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];

    // Field names verified against Venice's documented /models response shape:
    // model_spec.availableContextTokens, model_spec.capabilities.{supportsFunctionCalling,supportsReasoning,supportsVision}
    const models: ModelCapabilities[] = list.map((m: any) => {
      const spec = m.model_spec ?? {};
      const caps = spec.capabilities ?? {};
      return {
        id: m.id,
        contextLength: spec.availableContextTokens ?? m.context_length ?? null,
        supportsTools: Boolean(caps.supportsFunctionCalling),
        supportsReasoning: Boolean(caps.supportsReasoning),
        supportsVision: Boolean(caps.supportsVision),
        pricing: parseTextPricing(spec.pricing),
        privacy: spec.privacy === "private" || spec.privacy === "anonymized" ? spec.privacy : "unknown",
        raw: m,
      } satisfies ModelCapabilities;
    });

    this.modelCache = models;
    this.modelCacheAt = Date.now();
    return models;
  }

  async capabilities(model: string): Promise<ModelCapabilities | null> {
    const models = await this.getModels();
    return models.find((m) => m.id === model) ?? null;
  }

  async supportsTools(model: string): Promise<boolean> {
    const caps = await this.capabilities(model);
    // Fail open with a warning-worthy default of true only if capability metadata
    // is entirely unavailable; otherwise trust the reported capability.
    return caps ? caps.supportsTools : true;
  }

  async supportsReasoning(model: string): Promise<boolean> {
    const caps = await this.capabilities(model);
    return caps ? caps.supportsReasoning : false;
  }
}
