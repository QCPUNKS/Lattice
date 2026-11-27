// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

/**
 * The LATTICE v3 wordmark as text: crisp at any font size, works in every
 * terminal. Each letter carries its own color from the design's
 * cyan → amber sweep; the box-drawing "shadow" strokes use a darker shade
 * of the same hue for depth.
 */

interface Glyph {
  rows: string[];
  color: string;
  shade: string;
}

const GLYPHS: Glyph[] = [
  { color: "#22e6f5", shade: "#0f7d8c", rows: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"] },
  { color: "#3d8bff", shade: "#1e4a99", rows: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"] },
  { color: "#9d5cff", shade: "#553399", rows: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "] },
  { color: "#e24dff", shade: "#7d2a8f", rows: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "] },
  { color: "#ff4fa3", shade: "#99305f", rows: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"] },
  { color: "#ff6b6b", shade: "#993f3f", rows: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"] },
  { color: "#ffb52e", shade: "#99691a", rows: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"] },
];

/** Visible width of the wordmark in columns. */
export const TITLE_WIDTH = GLYPHS.reduce((w, g) => w + g.rows[0].length, 0);

const TAGLINE = ["CONNECT", "EXPLORE", "BUILD", "GROW"];

function paintGlyphRow(row: string, glyph: Glyph, color: boolean): string {
  if (!color) return row;
  // Solid blocks in the letter's color, box-drawing strokes in its shade.
  return row.replace(/█+|[^█ ]+/g, (run) => (run[0] === "█" ? chalk.hex(glyph.color)(run) : chalk.hex(glyph.shade)(run)));
}

function gradientRule(width: number, color: boolean): string {
  const pattern = "── ─ ";
  const raw = pattern.repeat(Math.ceil(width / pattern.length)).slice(0, width);
  if (!color) return raw;
  return [...raw]
    .map((ch, i) => {
      const glyph = GLYPHS[Math.min(GLYPHS.length - 1, Math.floor((i / width) * GLYPHS.length))];
      return chalk.hex(glyph.shade)(ch);
    })
    .join("");
}

function ornament(width: number, color: boolean): string {
  const gem = color ? chalk.hex("#22e6f5")("◆") : "◆";
  const side = Math.max(0, Math.floor((width - 3) / 2));
  return `${gradientRule(side, color)} ${gem} ${gradientRule(width - side - 3, color)}`;
}

/**
 * The full title block: ornament, 6-row wordmark with a "v3" badge, ornament,
 * tagline. Every line is exactly TITLE_WIDTH + badge columns wide (visibly),
 * so callers can place art beside it.
 */
export function renderTitle(opts: { color?: boolean; version?: string } = {}): string[] {
  const color = opts.color ?? chalk.level > 0;
  const version = opts.version ?? "v3";
  const badge = ` ${version}`;
  const width = TITLE_WIDTH + badge.length;

  const lines = [ornament(width, color)];
  for (let r = 0; r < 6; r++) {
    const row = GLYPHS.map((g) => paintGlyphRow(g.rows[r], g, color)).join("");
    const tail = r === 5 ? (color ? chalk.hex("#ff4fa3").bold(badge) : badge) : " ".repeat(badge.length);
    lines.push(row + tail);
  }
  lines.push(ornament(width, color));

  const bullet = color ? chalk.hex("#ff4fa3")(" • ") : " • ";
  const words = TAGLINE.map((w) => (color ? chalk.hex("#22e6f5")(w) : w)).join(bullet);
  const plainTagline = `// ${TAGLINE.join(" • ")} \\\\`;
  const pad = " ".repeat(Math.max(0, Math.floor((width - plainTagline.length) / 2)));
  const slash = (s: string) => (color ? chalk.hex("#3d8bff")(s) : s);
  lines.push(`${pad}${slash("//")} ${words} ${slash("\\\\")}`);
  return lines;
}
