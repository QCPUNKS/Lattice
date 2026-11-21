// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { formatRate, priceTier, type PriceTier } from "../billing/pricing.js";
import type { ModelCapabilities, TextPricing } from "../providers/types.js";
import { theme } from "../ui/theme.js";

/** "128K", "1M", "?" — a model's context window, short enough for a table column. */
export function formatContextTokens(tokens: number | null): string {
  if (!tokens) return "?";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

const TIER_COLOR: Record<PriceTier, (s: string) => string> = {
  budget: theme.success,
  standard: (s) => s,
  premium: theme.warning,
  luxury: theme.error,
};

/** "$0.18 / $0.35" (in / out per M tokens), colored by price tier. */
export function formatPrice(pricing: TextPricing | null | undefined): string {
  if (!pricing) return theme.dim("price ?".padEnd(17));
  const text = `${formatRate(pricing.input).replace("/M", "")} / ${formatRate(pricing.output).replace("/M", "")}`.padEnd(17);
  return TIER_COLOR[priceTier(pricing)!](text);
}

/** Models the agent loop can drive (tool calling required), cheapest output first. */
export function agentCapableModels(models: ModelCapabilities[]): ModelCapabilities[] {
  return models
    .filter((m) => m.supportsTools)
    .sort((a, b) => (a.pricing?.output ?? Infinity) - (b.pricing?.output ?? Infinity));
}
