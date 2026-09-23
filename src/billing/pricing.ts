// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { TextPricing, TokenRates, Usage } from "../providers/types.js";

const PER_MILLION = 1_000_000;

function usd(entry: unknown): number | undefined {
  const value = (entry as { usd?: unknown } | undefined)?.usd;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseRates(p: any): TokenRates | null {
  const input = usd(p?.input);
  const output = usd(p?.output);
  if (input === undefined || output === undefined) return null;
  return { input, output, cacheInput: usd(p?.cache_input), cacheWrite: usd(p?.cache_write) };
}

/** Parses Venice's model_spec.pricing for a text model; null when absent or malformed. */
export function parseTextPricing(pricing: unknown): TextPricing | null {
  const base = parseRates(pricing);
  if (!base) return null;
  const ext = (pricing as any)?.extended;
  const extRates = ext ? parseRates(ext) : null;
  const threshold = ext?.context_token_threshold;
  return {
    ...base,
    ...(extRates && typeof threshold === "number" ? { extended: { ...extRates, contextThreshold: threshold } } : {}),
  };
}

/**
 * Estimated USD for one request from published rates — used only when the
 * provider doesn't report the actual charge. Cached prompt tokens bill at the
 * cache rate; long prompts switch to the extended tier.
 */
export function estimateChatCost(pricing: TextPricing, usage: Usage): number {
  const rates: TokenRates =
    pricing.extended && usage.promptTokens > pricing.extended.contextThreshold ? pricing.extended : pricing;
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens);
  const fresh = usage.promptTokens - cached;
  const cachedRate = rates.cacheInput ?? rates.input;
  return (fresh * rates.input + cached * cachedRate + usage.completionTokens * rates.output) / PER_MILLION;
}

/** Output price is what dominates agent spend; used to compare and tier models. */
export function outputRate(pricing: TextPricing | null | undefined): number | null {
  return pricing ? pricing.output : null;
}

export type PriceTier = "budget" | "standard" | "premium" | "luxury";

/** Coarse tiers by output $/M, for color-coding pickers. */
export function priceTier(pricing: TextPricing | null | undefined): PriceTier | null {
  const out = outputRate(pricing);
  if (out === null) return null;
  if (out < 1) return "budget";
  if (out < 5) return "standard";
  if (out < 20) return "premium";
  return "luxury";
}

/** "$0.0031", "$0.42", "$12.30" — enough precision to be honest about tiny charges. */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  const abs = Math.abs(amount);
  if (abs < 0.01) return `$${amount.toFixed(4)}`;
  if (abs < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

/** "$0.35/M" style rate. */
export function formatRate(perMillion: number): string {
  return perMillion < 1 ? `$${perMillion.toFixed(2)}/M` : `$${perMillion.toFixed(perMillion < 10 ? 2 : 0)}/M`;
}
