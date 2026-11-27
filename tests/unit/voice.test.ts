// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePactlSources, pickMicrophone } from "../../src/media/audio-io.js";
import { Speaker } from "../../src/voice/speaker.js";
import { voiceInputEnabled, voiceOutputEnabled } from "../../src/voice/controller.js";
import { VeniceSpeechClient } from "../../src/media/speech-client.js";
import { VeniceHttp } from "../../src/providers/venice-http.js";

// Real `pactl list short sources` output from a PipeWire desktop whose default source is the monitor.
const PACTL = [
  "58\talsa_output.pci-0000_07_00.6.analog-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED",
  "59\talsa_input.pci-0000_07_00.6.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED",
  "",
].join("\n");

describe("microphone selection", () => {
  const sources = parsePactlSources(PACTL);

  it("parses pactl sources and marks monitors", () => {
    expect(sources).toEqual([
      { name: "alsa_output.pci-0000_07_00.6.analog-stereo.monitor", isMonitor: true },
      { name: "alsa_input.pci-0000_07_00.6.analog-stereo", isMonitor: false },
    ]);
  });

  it("never picks a monitor, even when it's the system default", () => {
    expect(pickMicrophone("alsa_output.pci-0000_07_00.6.analog-stereo.monitor", sources)).toBe(
      "alsa_input.pci-0000_07_00.6.analog-stereo",
    );
  });

  it("uses the default when it's a real input, and null when there is none", () => {
    const withUsb = [...sources, { name: "usb_mic", isMonitor: false }];
    expect(pickMicrophone("usb_mic", withUsb)).toBe("usb_mic");
    expect(pickMicrophone(null, sources.filter((s) => s.isMonitor))).toBeNull();
  });
});

describe("voice modes", () => {
  it("makes input and output independent", () => {
    expect([voiceInputEnabled("chat"), voiceOutputEnabled("chat")]).toEqual([true, true]);
    expect([voiceInputEnabled("dictate"), voiceOutputEnabled("dictate")]).toEqual([true, false]);
    expect([voiceInputEnabled("listen"), voiceOutputEnabled("listen")]).toEqual([false, true]);
    expect([voiceInputEnabled("off"), voiceOutputEnabled("off")]).toEqual([false, false]);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("Speaker", () => {
  it("plays chunks in order even when synthesis finishes out of order", async () => {
    const first = deferred<Buffer>();
    const second = deferred<Buffer>();
    const played: string[] = [];
    const speaker = new Speaker({
      synthesize: (text) => (text === "one" ? first.promise : second.promise),
      play: (audio) => {
        played.push(audio.toString());
        return { done: Promise.resolve(), stop: () => {} };
      },
    });
    speaker.enqueue("one");
    speaker.enqueue("two");
    second.resolve(Buffer.from("two")); // second finishes first
    first.resolve(Buffer.from("one"));
    await new Promise((r) => setTimeout(r, 0));
    await speaker.idle();
    expect(played).toEqual(["one", "two"]);
  });

  it("stop() halts playback, aborts pending synthesis, and drops the queue", async () => {
    const signals: AbortSignal[] = [];
    const stopPlayback = vi.fn();
    const playing = deferred<void>();
    const played: string[] = [];
    const speaker = new Speaker({
      synthesize: (text, signal) => {
        signals.push(signal);
        return Promise.resolve(Buffer.from(text));
      },
      play: (audio) => {
        played.push(audio.toString());
        return { done: playing.promise, stop: () => { stopPlayback(); playing.resolve(); } };
      },
    });
    speaker.enqueue("first");
    speaker.enqueue("second");
    await new Promise((r) => setTimeout(r, 0));
    expect(speaker.isSpeaking).toBe(true);

    speaker.stop();
    await speaker.idle();
    expect(stopPlayback).toHaveBeenCalled();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(played).toEqual(["first"]);
    expect(speaker.isSpeaking).toBe(false);
  });

  it("reports synthesis errors but keeps going", async () => {
    const errors: string[] = [];
    const played: string[] = [];
    const speaker = new Speaker({
      synthesize: (text) => (text === "bad" ? Promise.reject(new Error("402 balance")) : Promise.resolve(Buffer.from(text))),
      play: (audio) => {
        played.push(audio.toString());
        return { done: Promise.resolve(), stop: () => {} };
      },
      onError: (e) => errors.push(e.message),
    });
    speaker.enqueue("bad");
    speaker.enqueue("good");
    await new Promise((r) => setTimeout(r, 0));
    await speaker.idle();
    expect(errors).toEqual(["402 balance"]);
    expect(played).toEqual(["good"]);
  });
});

describe("VeniceSpeechClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const client = () => new VeniceSpeechClient(new VeniceHttp("k", "https://api.venice.example/api/v1"));

  it("uploads audio as multipart and returns the trimmed transcript", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: "  hello lattice ", duration: 1.2 }), { status: 200 }));
    const result = await client().transcribe(Buffer.from("fLaC-audio"), { model: "openai/whisper-large-v3", language: "en" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.venice.example/api/v1/audio/transcriptions");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("model")).toBe("openai/whisper-large-v3");
    expect((init.body as FormData).get("language")).toBe("en");
    expect(init.headers["Content-Type"]).toBeUndefined(); // fetch must set the multipart boundary
    expect(result).toEqual({ text: "hello lattice", durationSeconds: 1.2 });
  });

  it("requests mp3 speech and refuses text over the per-request limit", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const audio = await client().synthesize("hi", { model: "tts-kokoro", voice: "af_sky", speed: 1.2 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "tts-kokoro",
      input: "hi",
      voice: "af_sky",
      speed: 1.2,
      response_format: "mp3",
    });
    expect([...audio]).toEqual([1, 2, 3]);
    await expect(client().synthesize("x".repeat(4097), { model: "m", voice: "v", speed: 1 })).rejects.toThrow(/4096/);
  });
});
