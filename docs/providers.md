<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Providers

`src/providers/types.ts` defines a provider-agnostic `ModelProvider` interface:

```ts
interface ModelProvider {
  readonly name: string;
  chat(options: ChatRequestOptions): Promise<ChatResult>;
  stream(options: ChatRequestOptions): AsyncGenerator<StreamEvent>;
  getModels(): Promise<ModelCapabilities[]>;
  supportsTools(model: string): Promise<boolean>;
  supportsReasoning(model: string): Promise<boolean>;
  capabilities(model: string): Promise<ModelCapabilities | null>;
}
```

`src/providers/venice.ts` is the only implementation today. It handles:

- SSE streaming with incremental tool-call argument assembly
- Retries with exponential backoff on 429/5xx, honoring `Retry-After`
- Timeouts and cancellation via `AbortSignal`
- Model capability discovery via `GET /models`, cached for 5 minutes
- Usage accounting when Venice reports it

## Adding a second OpenAI-compatible provider

Venice's API is OpenAI-compatible, and so are OpenRouter, LM Studio, and Ollama's OpenAI-compat endpoints. To add one:

1. Implement `ModelProvider` in `src/providers/<name>.ts`, reusing the same `ChatMessage`/`ToolDefinition`/`StreamEvent` shapes.
2. Wire a `LATTICE_PROVIDER=<name>` branch into `src/config/index.ts` and `src/cli/runtime.ts`.
3. Nothing in `agent/`, `tools/`, or `ui/` needs to change — they only depend on the `ModelProvider` interface.

Don't build a provider you don't need yet — the abstraction exists so this is a small, isolated change when the day comes, not a reason to pre-build unused providers now.
