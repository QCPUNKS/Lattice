// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

/** OpenAI-compatible chat message shape used across providers. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded string, per OpenAI tool-call convention
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // present when role === "tool"
  name?: string; // present when role === "tool"
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ChatRequestOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  parallelToolCalls?: boolean;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  finishReason: string | null;
  usage?: Usage;
}

/** Emitted incrementally while streaming a completion. */
export type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: string | null };

export interface ModelCapabilities {
  id: string;
  contextLength: number | null;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  raw?: unknown;
}

/** Contract every OpenAI-compatible provider must implement. */
export interface ModelProvider {
  readonly name: string;

  chat(options: ChatRequestOptions): Promise<ChatResult>;

  stream(options: ChatRequestOptions): AsyncGenerator<StreamEvent, void, unknown>;

  getModels(): Promise<ModelCapabilities[]>;

  supportsTools(model: string): Promise<boolean>;

  supportsReasoning(model: string): Promise<boolean>;

  capabilities(model: string): Promise<ModelCapabilities | null>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
