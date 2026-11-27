// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { randomInt } from "node:crypto";
import type { VeniceHttp } from "../providers/venice-http.js";
import { ProviderError } from "../providers/types.js";
import { resolveSizeParams, type ImageModelInfo, type SizeParams } from "./image-catalog.js";

/** Venice's accepted seed range. */
const SEED_LIMIT = 999_999_999;
export const MAX_VARIANTS = 4;

export interface ImageRequest {
  model: ImageModelInfo;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  resolution?: string;
  /** Omitted → a random seed is chosen here (not by Venice) so it can be recorded and reproduced. */
  seed?: number;
  steps?: number;
  variants: number;
  safeMode: boolean;
}

export interface GeneratedImages {
  id: string;
  seed: number;
  size: SizeParams;
  /** PNG bytes, one per variant. */
  images: Buffer[];
  /** Venice's safe mode blurred adult content in the result. */
  blurred: boolean;
  /** Venice flagged the output as violating its terms. */
  contentViolation: boolean;
  durationMs: number | null;
}

/** Validates a request against the model's catalog constraints before any money is spent. */
export function validateImageRequest(req: ImageRequest): void {
  if (!req.prompt.trim()) throw new Error("Prompt is empty.");
  if (req.prompt.length > req.model.promptCharacterLimit) {
    throw new Error(
      `Prompt is ${req.prompt.length} characters; ${req.model.id} accepts at most ${req.model.promptCharacterLimit}.`,
    );
  }
  if (req.negativePrompt && req.negativePrompt.length > req.model.promptCharacterLimit) {
    throw new Error(`Negative prompt exceeds ${req.model.id}'s ${req.model.promptCharacterLimit}-character limit.`);
  }
  if (!Number.isInteger(req.variants) || req.variants < 1 || req.variants > MAX_VARIANTS) {
    throw new Error(`Variants must be 1–${MAX_VARIANTS}.`);
  }
  if (req.seed !== undefined && (!Number.isInteger(req.seed) || Math.abs(req.seed) > SEED_LIMIT)) {
    throw new Error(`Seed must be an integer between -${SEED_LIMIT} and ${SEED_LIMIT}.`);
  }
  if (req.steps !== undefined) {
    if (!Number.isInteger(req.steps) || req.steps < 1) throw new Error("Steps must be a positive integer.");
    if (req.model.maxSteps !== null && req.steps > req.model.maxSteps) {
      throw new Error(`${req.model.id} allows at most ${req.model.maxSteps} steps.`);
    }
  }
}

export class VeniceImageClient {
  constructor(private readonly http: VeniceHttp) {}

  async generate(req: ImageRequest, signal?: AbortSignal): Promise<GeneratedImages> {
    validateImageRequest(req);
    const size = resolveSizeParams(req.model, { aspectRatio: req.aspectRatio, resolution: req.resolution });
    const seed = req.seed ?? randomInt(1, SEED_LIMIT);

    const body = {
      model: req.model.id,
      prompt: req.prompt,
      negative_prompt: req.negativePrompt || undefined,
      ...size,
      seed,
      steps: req.steps,
      variants: req.variants,
      format: "png", // Kitty's graphics protocol decodes PNG natively; Venice defaults to webp
      safe_mode: req.safeMode,
      hide_watermark: true,
      return_binary: false,
    };

    const res = await this.http.request(
      "/image/generate",
      { method: "POST", headers: this.http.jsonHeaders(), body: JSON.stringify(body) },
      signal,
    );
    const data: any = await res.json();
    const encoded: unknown[] = Array.isArray(data?.images) ? data.images : [];
    if (encoded.length === 0) throw new ProviderError("Venice returned no images.");

    return {
      id: String(data.id ?? ""),
      seed,
      size,
      images: encoded.map((b64) => Buffer.from(String(b64), "base64")),
      blurred: res.headers.get("x-venice-is-blurred") === "true",
      contentViolation: res.headers.get("x-venice-is-content-violation") === "true",
      durationMs: typeof data?.timing?.total === "number" ? data.timing.total : null,
    };
  }
}
