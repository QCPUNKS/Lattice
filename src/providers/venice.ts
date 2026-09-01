// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import {
  ChatRequestOptions,
  ChatResult,
  ModelCapabilities,
  ModelProvider,
  ProviderError,
  StreamEvent,
} from "./types.js";

interface VeniceProviderOptions {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VeniceProvider implements ModelProvider {
  readonly name = "venice";
  private modelCache: ModelCapabilities[] | null = null;
  private modelCacheAt = 0;
  private readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly opts: VeniceProviderOptions) {
    if (!opts.apiKey) {
      throw new ProviderError(
        "VENICE_API_KEY is not set. Export it or add it to .env before running lattice.",
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.opts.apiKey}`,
    };
  }

  private async requestWithRetry(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { ...init, signal });
        if (res.ok) return res;

        const bodyText = await res.text().catch(() => "");
        const retryable = RETRYABLE_STATUS.has(res.status);

        if (retryable && attempt < MAX_RETRIES) {
          const retryAfter = res.headers.get("retry-after");
          const waitMs = retryAfter
            ? Number(retryAfter) * 1000
            : BASE_BACKOFF_MS * 2 ** attempt;
          await sleep(waitMs);
          continue;
        }

        throw new ProviderError(
          `Venice API error ${res.status}: ${bodyText || res.statusText}`,
          res.status,
          retryable,
        );
      } catch (err) {
        if (err instanceof ProviderError) {
          lastErr = err;
          if (!err.retryable || attempt >= MAX_RETRIES) throw err;
          continue;
        }
        // Network-level failure (DNS, connection reset, abort, etc.)
        if ((err as Error)?.name === "AbortError") {
          throw new ProviderError("Request cancelled", undefined, false, err);
        }
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        throw new ProviderError(
          `Network error contacting Venice API: ${(err as Error).message}`,
          undefined,
          false,
          err,
        );
      }
    }
    throw new ProviderError("Exhausted retries contacting Venice API", undefined, false, lastErr);
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
    };
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const res = await this.requestWithRetry(
      `${this.opts.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
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
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<StreamEvent, void, unknown> {
    const res = await this.requestWithRetry(
      `${this.opts.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
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

          if (json.usage) {
            yield {
              type: "usage",
              usage: {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              },
            };
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

    const res = await this.requestWithRetry(`${this.opts.baseUrl}/models`, {
      method: "GET",
      headers: this.headers(),
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
