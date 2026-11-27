// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { featureAccent, theme } from "./theme.js";
import { sanitizeForTerminal } from "./sanitize.js";

/**
 * The quiet identity each major feature wears. Entering one draws a framed
 * section in that feature's accent, so it's always clear whether you're
 * chatting, generating an image, racing models, or talking — without
 * changing anything about how Lattice behaves.
 */
export type FeatureId = keyof typeof featureAccent;

export interface FeatureIdentity {
  name: string;
  glyph: string;
  accent: (text: string) => string;
}

export const FEATURES: Record<FeatureId, FeatureIdentity> = {
  imagine: { name: "IMAGINE", glyph: "✦", accent: featureAccent.imagine },
  arena: { name: "ARENA", glyph: "◈", accent: featureAccent.arena },
  voice: { name: "VOICE", glyph: "◉", accent: featureAccent.voice },
};

const SECTION_INDENT = "  ";

function truncate(text: string, max: number): string {
  if (max <= 1) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** "  ╭─ ✦ IMAGINE ─ a neon fox in the rain" — `subject` is untrusted and gets sanitized. */
export function featureOpening(id: FeatureId, subject?: string, columns = process.stdout.columns || 80): string {
  const { name, glyph, accent } = FEATURES[id];
  const head = `${SECTION_INDENT}╭─ ${glyph} ${name}`;
  if (!subject) return accent(head);
  const clean = sanitizeForTerminal(subject).replace(/\s+/g, " ").trim();
  const room = columns - head.length - 4;
  return `${accent(head + " ─")} ${theme.dim(truncate(clean, room))}`;
}

/** A content line inside the section, on the feature's rail. */
export function featureLine(id: FeatureId, text: string): string {
  return `${SECTION_INDENT}${FEATURES[id].accent("│")} ${text}`;
}

/** "  ╰─ ✦ flux-dev · seed 42 · 8.1s · ~$0.04" — closes the section. */
export function featureClosing(id: FeatureId, summary: string): string {
  const { glyph, accent } = FEATURES[id];
  return `${SECTION_INDENT}${accent(`╰─ ${glyph}`)} ${summary}`;
}
