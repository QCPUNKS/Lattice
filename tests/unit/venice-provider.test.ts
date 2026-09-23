// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VeniceProvider } from "../../src/providers/venice.js";
import { ProviderError } from "../../src/providers/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function provider() {
  return new VeniceProvider({
    apiKey: "test-key",
    baseUrl: "https://api.venice.example/api/v1",
    defaultModel: "test-model",
    defaultTemperature: 0.3,
    defaultMaxTokens: 4096,
  });
}

describe("VeniceProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("throws immediately if no API key is provided", () => {
    expect(
      () => new VeniceProvider({ apiKey: "", baseUrl: "x", defaultModel: "m", defaultTemperature: 0, defaultMaxTokens: 1 }),
    ).toThrow(/VENICE_API_KEY/);
  });

  it("chat() parses a non-streaming response into a ChatResult", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "Hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const result = await provider().chat({ messages: [{ role: "user", content: "hi" }] });
    expect(result.message.content).toBe("Hi there");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("chat() throws a ProviderError when the response has no choices", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    await expect(provider().chat({ messages: [] })).rejects.toThrow(ProviderError);
  });

  it("stream() emits text deltas and a done event", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
        "data: [DONE]",
      ]),
    );

    const events = [];
    for await (const event of provider().stream({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta").map((e: any) => e.delta);
    expect(textDeltas.join("")).toBe("Hello");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("stream() assembles tool call arguments across multiple deltas", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: "" } }] } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] } }] })}`,
        "data: [DONE]",
      ]),
    );

    const events = [];
    for await (const event of provider().stream({ messages: [] })) events.push(event);

    const starts = events.filter((e) => e.type === "tool_call_start");
    expect(starts).toHaveLength(1);
    expect((starts[0] as any).name).toBe("read_file");

    const argDeltas = events.filter((e) => e.type === "tool_call_delta").map((e: any) => e.argumentsDelta);
    expect(argDeltas.join("")).toBe('{"path":"a.ts"}');
  });

  it("skips malformed SSE chunks instead of crashing the stream", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(["data: not-json", "data: [DONE]"]));
    const events = [];
    for await (const event of provider().stream({ messages: [] })) events.push(event);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("retries on a 429 and eventually succeeds", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

    const resultPromise = provider().chat({ messages: [] });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.message.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable 400 and surfaces the error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    await expect(provider().chat({ messages: [] })).rejects.toThrow(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("getModels() maps Venice's model_spec shape into ModelCapabilities", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "some-model",
            model_spec: {
              availableContextTokens: 128000,
              capabilities: { supportsFunctionCalling: true, supportsReasoning: false, supportsVision: true },
            },
          },
        ],
      }),
    );
    const models = await provider().getModels();
    expect(models).toEqual([
      {
        id: "some-model",
        contextLength: 128000,
        supportsTools: true,
        supportsReasoning: false,
        supportsVision: true,
        raw: expect.anything(),
      },
    ]);
  });

  it("asks for usage, disables Venice's injected system prompt, and reads the choice-less usage chunk", async () => {
    // Venice's real final chunk: an empty choices array carrying the usage.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":13,"completion_tokens":8,"total_tokens":21}}',
        "data: [DONE]",
      ]),
    );
    const events = [];
    for await (const e of provider().stream({ messages: [{ role: "user", content: "hi" }] })) events.push(e);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.venice_parameters).toEqual({ include_venice_system_prompt: false });
    expect(events).toContainEqual({ type: "usage", usage: { promptTokens: 13, completionTokens: 8, totalTokens: 21 } });
  });
});
