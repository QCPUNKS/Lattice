// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { markdownTheme } from "../theme.js";
import { renderInlineLine } from "./inline.js";
import { visibleLength } from "../text-width.js";

type Alignment = "left" | "right" | "center";

const SEPARATOR_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function splitCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function alignmentOf(separatorCell: string): Alignment {
  const left = separatorCell.startsWith(":");
  const right = separatorCell.endsWith(":");
  if (left && right) return "center";
  return right ? "right" : "left";
}

function pad(text: string, width: number, alignment: Alignment): string {
  const gap = Math.max(0, width - visibleLength(text));
  if (alignment === "right") return " ".repeat(gap) + text;
  if (alignment === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(Math.ceil(gap / 2));
  return text + " ".repeat(gap);
}

/**
 * Renders a run of `|`-rows as a boxed, aligned table. Rows that aren't a
 * real table (no separator row), or a table wider than the terminal, are
 * printed line by line with inline formatting instead — never truncated.
 */
export function renderTable(rows: string[], maxWidth: number): string[] {
  const separatorIndex = rows.findIndex((row) => SEPARATOR_ROW.test(row));
  if (separatorIndex !== 1) return rows.map((row) => renderInlineLine(row));

  const alignments = splitCells(rows[separatorIndex]).map(alignmentOf);
  const body = rows.filter((_, index) => index !== separatorIndex).map(splitCells);
  const columnCount = Math.max(alignments.length, ...body.map((cells) => cells.length));
  const rendered = body.map((cells, rowIndex) =>
    Array.from({ length: columnCount }, (_, column) =>
      renderInlineLine(cells[column] ?? "", rowIndex === 0 ? markdownTheme.tableHeader : undefined),
    ),
  );
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(1, ...rendered.map((cells) => visibleLength(cells[column]))),
  );

  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + 3 * columnCount + 1;
  if (totalWidth > maxWidth) return rows.map((row) => renderInlineLine(row));

  const border = markdownTheme.tableBorder;
  const horizontal = (left: string, join: string, right: string) =>
    border(left + widths.map((width) => "─".repeat(width + 2)).join(join) + right);
  const row = (cells: string[]) =>
    border("│ ") + cells.map((cell, column) => pad(cell, widths[column], alignments[column] ?? "left")).join(border(" │ ")) + border(" │");

  const [header, ...rest] = rendered;
  return [horizontal("╭", "┬", "╮"), row(header), horizontal("├", "┼", "┤"), ...rest.map(row), horizontal("╰", "┴", "╯")];
}
