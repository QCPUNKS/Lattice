// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { VeniceHttp } from "../providers/venice-http.js";

/**
 * "private": runs on Venice-controlled infrastructure, prompts not stored.
 * "anonymized": Venice proxies the request to a third party (OpenAI, Google, …)
 * with your identity stripped — the prompt itself still leaves Venice.
 */
export type ModelPrivacy = "private" | "anonymized" | "unknown";

/**
 * How a model accepts output dimensions. Venice image models don't share one
 * sizing scheme, so the request is shaped per model from its catalog entry.
 */
export type SizingScheme =
  | { kind: "pixels"; divisor: number }
  | { kind: "aspect"; aspectRatios: string[]; defaultAspectRatio: string }
  | { kind: "resolution"; aspectRatios: string[]; defaultAspectRatio: string; resolutions: string[]; defaultResolution: string };

export interface ImageModelInfo {
  id: string;
  name: string;
  privacy: ModelPrivacy;
  uncensored: boolean;
  promptCharacterLimit: number;
  maxSteps: number | null;
  sizing: SizingScheme;
  /** USD per image at the default resolution, when Venice reports it. */
  priceUsd: number | null;
  /** USD per image by resolution tier, for models priced per tier. */
  resolutionPricesUsd: Record<string, number>;
}

/** Venice's pixel-based models cap each side at 1280. */
const MAX_PIXEL_SIDE = 1280;
const PIXEL_LONG_SIDE = 1024;

export function parseImageModel(raw: any): ImageModelInfo {
  const spec = raw?.model_spec ?? {};
  const c = spec.constraints ?? {};
  const aspectRatios: string[] = Array.isArray(c.aspectRatios) ? c.aspectRatios : [];
  const resolutions: string[] = Array.isArray(c.resolutions) ? c.resolutions : [];

  let sizing: SizingScheme;
  if (resolutions.length > 0) {
    sizing = {
      kind: "resolution",
      aspectRatios,
      defaultAspectRatio: c.defaultAspectRatio ?? aspectRatios[0] ?? "1:1",
      resolutions,
      defaultResolution: c.defaultResolution ?? resolutions[0],
    };
  } else if (aspectRatios.length > 0) {
    sizing = { kind: "aspect", aspectRatios, defaultAspectRatio: c.defaultAspectRatio ?? aspectRatios[0] };
  } else {
    sizing = { kind: "pixels", divisor: c.widthHeightDivisor ?? 8 };
  }

  const pricing = spec.pricing ?? {};
  const defaultRes = sizing.kind === "resolution" ? sizing.defaultResolution : null;
  const priceUsd =
    pricing.generation?.usd ?? (defaultRes ? pricing.resolutions?.[defaultRes]?.usd : undefined) ?? null;

  const resolutionPricesUsd: Record<string, number> = {};
  for (const [tier, value] of Object.entries(pricing.resolutions ?? {})) {
    const price = (value as { usd?: unknown })?.usd;
    if (typeof price === "number") resolutionPricesUsd[tier] = price;
  }

  return {
    id: String(raw?.id),
    name: spec.name ?? String(raw?.id),
    resolutionPricesUsd,
    privacy: spec.privacy === "private" || spec.privacy === "anonymized" ? spec.privacy : "unknown",
    uncensored: Boolean(spec.uncensored),
    promptCharacterLimit: c.promptCharacterLimit ?? 1500,
    maxSteps: c.steps?.max ?? null,
    sizing,
    priceUsd: typeof priceUsd === "number" ? priceUsd : null,
  };
}

export function parseAspectRatio(ratio: string): { w: number; h: number } | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

export interface SizeRequest {
  aspectRatio: string;
  resolution?: string;
}

export type SizeParams =
  | { width: number; height: number }
  | { aspect_ratio: string }
  | { aspect_ratio: string; resolution: string };

/**
 * Translates a model-agnostic aspect ratio (+ optional resolution tier) into
 * the parameters this specific model accepts. Throws with the model's allowed
 * values when the request can't be honored, rather than silently cropping.
 */
export function resolveSizeParams(model: ImageModelInfo, req: SizeRequest): SizeParams {
  const ratio = parseAspectRatio(req.aspectRatio);
  if (!ratio) throw new Error(`Invalid aspect ratio "${req.aspectRatio}" — use W:H, e.g. 16:9.`);

  const sizing = model.sizing;
  if (sizing.kind === "pixels") {
    const scale = PIXEL_LONG_SIDE / Math.max(ratio.w, ratio.h);
    const snap = (v: number) =>
      Math.min(MAX_PIXEL_SIDE, Math.max(sizing.divisor, Math.round(v / sizing.divisor) * sizing.divisor));
    return { width: snap(ratio.w * scale), height: snap(ratio.h * scale) };
  }

  if (!sizing.aspectRatios.includes(req.aspectRatio)) {
    throw new Error(
      `${model.id} doesn't support aspect ratio ${req.aspectRatio}. Supported: ${sizing.aspectRatios.join(", ")}`,
    );
  }
  if (sizing.kind === "aspect") return { aspect_ratio: req.aspectRatio };

  const resolution = req.resolution ?? sizing.defaultResolution;
  if (!sizing.resolutions.includes(resolution)) {
    throw new Error(`${model.id} doesn't support resolution ${resolution}. Supported: ${sizing.resolutions.join(", ")}`);
  }
  return { aspect_ratio: req.aspectRatio, resolution };
}

const CATALOG_TTL_MS = 10 * 60 * 1000;

export class ImageModelCatalog {
  private cache: ImageModelInfo[] | null = null;
  private cachedAt = 0;

  constructor(private readonly http: VeniceHttp) {}

  async list(): Promise<ImageModelInfo[]> {
    if (this.cache && Date.now() - this.cachedAt < CATALOG_TTL_MS) return this.cache;
    const res = await this.http.request("/models?type=image", { method: "GET", headers: this.http.authHeaders() });
    const body: any = await res.json();
    const raw: any[] = Array.isArray(body?.data) ? body.data : [];
    this.cache = raw.map(parseImageModel);
    this.cachedAt = Date.now();
    return this.cache;
  }

  async get(id: string): Promise<ImageModelInfo | null> {
    return (await this.list()).find((m) => m.id === id) ?? null;
  }
}
