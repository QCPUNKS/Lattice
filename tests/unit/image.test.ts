// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseImageModel, resolveSizeParams } from "../../src/media/image-catalog.js";
import { VeniceImageClient, validateImageRequest, type ImageRequest } from "../../src/media/image-client.js";
import { inspectOutputDir, saveGeneratedImages, isPng } from "../../src/media/image-store.js";
import { parseImagineArgs } from "../../src/cli/commands/imagine.js";
import { encodeKittyPng, supportsKittyGraphics } from "../../src/ui/kitty-graphics.js";
import { VeniceHttp } from "../../src/providers/venice-http.js";

// Catalog entries in the exact shape Venice's /models?type=image returns.
const PIXEL_MODEL = parseImageModel({
  id: "z-image-turbo",
  model_spec: {
    name: "Z-Image Turbo",
    privacy: "private",
    pricing: { generation: { usd: 0.01 } },
    constraints: { promptCharacterLimit: 7500, steps: { default: 8, max: 8 }, widthHeightDivisor: 8 },
  },
});
const ASPECT_MODEL = parseImageModel({
  id: "flux-2-pro",
  model_spec: {
    privacy: "anonymized",
    pricing: { generation: { usd: 0.03 } },
    constraints: { promptCharacterLimit: 3000, aspectRatios: ["1:1", "16:9", "9:16"], defaultAspectRatio: "1:1" },
  },
});
const RES_MODEL = parseImageModel({
  id: "nano-banana-pro",
  model_spec: {
    privacy: "anonymized",
    pricing: { resolutions: { "1K": { usd: 0.18 }, "2K": { usd: 0.23 } } },
    constraints: {
      aspectRatios: ["1:1", "16:9"],
      defaultAspectRatio: "1:1",
      resolutions: ["1K", "2K"],
      defaultResolution: "1K",
    },
  },
});

// Smallest valid PNG header + filler; enough for magic-byte checks.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

describe("image catalog", () => {
  it("classifies sizing schemes and reads privacy and price", () => {
    expect(PIXEL_MODEL.sizing).toEqual({ kind: "pixels", divisor: 8 });
    expect(PIXEL_MODEL.privacy).toBe("private");
    expect(PIXEL_MODEL.priceUsd).toBe(0.01);
    expect(ASPECT_MODEL.sizing.kind).toBe("aspect");
    expect(RES_MODEL.sizing.kind).toBe("resolution");
    expect(RES_MODEL.priceUsd).toBe(0.18); // price at the default resolution
  });

  it("maps an aspect ratio to divisor-aligned pixels capped at 1280", () => {
    expect(resolveSizeParams(PIXEL_MODEL, { aspectRatio: "1:1" })).toEqual({ width: 1024, height: 1024 });
    expect(resolveSizeParams(PIXEL_MODEL, { aspectRatio: "16:9" })).toEqual({ width: 1024, height: 576 });
    const tall = resolveSizeParams(PIXEL_MODEL, { aspectRatio: "9:16" }) as { width: number; height: number };
    expect(tall.height).toBe(1024);
    expect(tall.width % 8).toBe(0);
  });

  it("passes aspect_ratio (and resolution) through for models that take them", () => {
    expect(resolveSizeParams(ASPECT_MODEL, { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "16:9" });
    expect(resolveSizeParams(RES_MODEL, { aspectRatio: "16:9", resolution: "2K" })).toEqual({
      aspect_ratio: "16:9",
      resolution: "2K",
    });
    expect(resolveSizeParams(RES_MODEL, { aspectRatio: "1:1" })).toEqual({ aspect_ratio: "1:1", resolution: "1K" });
  });

  it("rejects ratios and resolutions a model doesn't support, naming what it does", () => {
    expect(() => resolveSizeParams(ASPECT_MODEL, { aspectRatio: "21:9" })).toThrow(/Supported: 1:1, 16:9, 9:16/);
    expect(() => resolveSizeParams(RES_MODEL, { aspectRatio: "1:1", resolution: "4K" })).toThrow(/1K, 2K/);
    expect(() => resolveSizeParams(PIXEL_MODEL, { aspectRatio: "wide" })).toThrow(/Invalid aspect ratio/);
  });
});

describe("image request validation (before any money is spent)", () => {
  const base: ImageRequest = { model: PIXEL_MODEL, prompt: "a lighthouse", aspectRatio: "1:1", variants: 1, safeMode: true };

  it("enforces the model's prompt limit, variants, seed range, and max steps", () => {
    expect(() => validateImageRequest({ ...base, prompt: "  " })).toThrow(/empty/);
    expect(() => validateImageRequest({ ...base, prompt: "x".repeat(7501) })).toThrow(/at most 7500/);
    expect(() => validateImageRequest({ ...base, variants: 5 })).toThrow(/1–4/);
    expect(() => validateImageRequest({ ...base, seed: 1_000_000_000 })).toThrow(/Seed/);
    expect(() => validateImageRequest({ ...base, steps: 9 })).toThrow(/at most 8 steps/);
    expect(() => validateImageRequest(base)).not.toThrow();
  });
});

describe("VeniceImageClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends a PNG request with sizing, seed, and safe_mode, and decodes images and safety headers", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "gen-1", images: [PNG.toString("base64")], timing: { total: 1800 } }), {
        status: 200,
        headers: { "x-venice-is-blurred": "true", "x-venice-is-content-violation": "false" },
      }),
    );
    const client = new VeniceImageClient(new VeniceHttp("k", "https://api.venice.example/api/v1"));
    const result = await client.generate({
      model: PIXEL_MODEL,
      prompt: "a lighthouse",
      aspectRatio: "16:9",
      seed: 42,
      variants: 1,
      safeMode: false,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.venice.example/api/v1/image/generate");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "z-image-turbo",
      format: "png",
      width: 1024,
      height: 576,
      seed: 42,
      safe_mode: false,
      return_binary: false,
    });
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(result.images[0].equals(PNG)).toBe(true);
    expect(result.blurred).toBe(true);
    expect(result.contentViolation).toBe(false);
    expect(result.seed).toBe(42);
  });

  it("picks and reports a seed when none is given, so results are reproducible", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ images: [PNG.toString("base64")] }), { status: 200 }));
    const client = new VeniceImageClient(new VeniceHttp("k", "https://x.example"));
    const result = await client.generate({ model: PIXEL_MODEL, prompt: "p", aspectRatio: "1:1", variants: 1, safeMode: true });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).seed;
    expect(Number.isInteger(sent)).toBe(true);
    expect(result.seed).toBe(sent);
  });
});

describe("image store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-img-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const generated = { id: "g", seed: 7, size: { width: 1, height: 1 }, images: [PNG], blurred: false, contentViolation: false, durationMs: 1 };
  const meta = { model: "z-image-turbo", prompt: "secret prompt text", aspectRatio: "1:1", safeMode: false };

  it("writes owner-only files whose names never contain the prompt", async () => {
    const [file] = await saveGeneratedImages(dir, generated, meta, false, new Date(2026, 8, 22, 15, 4, 5));
    expect(path.basename(file)).toBe("2026-09-22_150405_z-image-turbo_7.png");
    expect(file).not.toMatch(/secret/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(dir)).some((f) => f.endsWith(".json"))).toBe(false); // metadata is opt-in
  });

  it("writes a sidecar only when asked, and never overwrites existing files", async () => {
    const when = new Date(2026, 0, 1);
    await saveGeneratedImages(dir, generated, meta, true, when);
    const sidecar = JSON.parse(await fs.readFile(path.join(dir, "2026-01-01_000000_z-image-turbo_7.json"), "utf-8"));
    expect(sidecar).toMatchObject({ prompt: "secret prompt text", seed: 7 });
    await expect(saveGeneratedImages(dir, generated, meta, false, when)).rejects.toThrow(/EEXIST/);
  });

  it("refuses to save bytes that aren't a PNG", async () => {
    await expect(
      saveGeneratedImages(dir, { ...generated, images: [Buffer.from("<html>")] }, meta, false),
    ).rejects.toThrow(/isn't a PNG/);
    expect(isPng(PNG)).toBe(true);
  });

  it("flags folders other users can read or write, and folders inside a git repo", async () => {
    await fs.chmod(dir, 0o755);
    expect(inspectOutputDir(dir)).toMatchObject({ accessibleToOthers: true, writableByOthers: false, gitRepoRoot: null });
    await fs.chmod(dir, 0o777);
    expect(inspectOutputDir(dir).writableByOthers).toBe(true);
    await fs.chmod(dir, 0o700);
    await fs.mkdir(path.join(dir, ".git"));
    const nested = path.join(dir, "art", "out");
    expect(inspectOutputDir(nested)).toMatchObject({ exists: false, gitRepoRoot: dir });
  });
});

describe("/imagine argument parsing", () => {
  it("separates flags from free-form prompt text", () => {
    const r = parseImagineArgs('neon city at night --aspect 16:9 --neg "blurry, text" --seed 12 --n 2 --nsfw -m lustify-v8');
    expect(r).toEqual({
      ok: true,
      options: {
        prompt: "neon city at night",
        aspectRatio: "16:9",
        negativePrompt: "blurry, text",
        seed: 12,
        variants: 2,
        safeMode: false,
        model: "lustify-v8",
      },
    });
  });

  it("reports missing values, bad numbers, unknown flags, and an empty prompt", () => {
    expect(parseImagineArgs("cat --aspect")).toEqual({ ok: false, error: "--aspect needs a value." });
    expect(parseImagineArgs("cat --seed abc")).toEqual({ ok: false, error: "--seed needs a whole number." });
    expect(parseImagineArgs("cat --turbo")).toEqual({ ok: false, error: "Unknown option --turbo." });
    expect(parseImagineArgs("--safe")).toEqual({ ok: false, error: "Missing prompt." });
  });
});

describe("kitty graphics", () => {
  it("chunks the payload at 4096 bytes with continuation flags and quiet replies", () => {
    const big = Buffer.alloc(10_000, 7);
    const out = encodeKittyPng(big, 40);
    const seqs = out.split("\x1b\\").filter(Boolean);
    expect(seqs).toHaveLength(Math.ceil(big.toString("base64").length / 4096));
    const firstControls = seqs[0].slice(3, seqs[0].indexOf(";")).split(",").sort();
    expect(firstControls).toEqual(["a=T", "c=40", "f=100", "m=1", "q=2"]);
    expect(seqs.at(-1)).toMatch(/^\x1b_Gq=2,m=0;/); // continuation: quiet, last chunk
  });

  it("is only used on a TTY in a terminal that supports it", () => {
    expect(supportsKittyGraphics({ TERM: "xterm-kitty" }, true)).toBe(true);
    expect(supportsKittyGraphics({ TERM: "xterm-kitty" }, false)).toBe(false);
    expect(supportsKittyGraphics({ TERM: "xterm-256color" }, true)).toBe(false);
    expect(supportsKittyGraphics({ TERM: "xterm-kitty", LATTICE_INLINE_IMAGES: "0" }, true)).toBe(false);
  });
});
