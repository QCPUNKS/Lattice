// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { markdownTheme } from "../theme.js";
import { highlightCodeLine } from "./highlight.js";
import { freshInlineState, renderInline, type InlineState, type Style } from "./inline.js";
import { renderTable } from "./table.js";

export interface MarkdownStreamIO {
  write: (text: string) => void;
  columns: () => number;
}

type LineKind =
  | { type: "prose" }
  | { type: "heading"; level: number; markerLength: number }
  | { type: "bullet"; markerLength: number }
  | { type: "ordered"; marker: string; markerLength: number }
  | { type: "quote"; markerLength: number }
  | { type: "fence" }
  | { type: "table" }
  | { type: "rule" };

type BufferedKind = "fence" | "code" | "table" | "rule";

interface OpenCodeBlock {
  fence: string;
  language: string;
  indent: string;
}

const BULLET_GLYPHS = ["•", "◦", "▸"];
const MAX_RULE_WIDTH = 60;
const OPENING_FENCE = /^(`{3,}|~{3,})\s*([^\s`]*)/;
const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * Decides what kind of line `rest` (the line minus its indentation) starts.
 * Returns null when the start is still ambiguous and more text must arrive:
 * "#" could become "# Heading" or "#hashtag", "-" a bullet or a rule.
 */
export function classifyLineStart(rest: string, complete: boolean): LineKind | null {
  if (!complete) {
    if (/^#{0,6}$/.test(rest)) return null;
    if (/^(`{1,2}|~{1,2})$/.test(rest)) return null;
    if (/^[-*_ ]+$/.test(rest)) return null;
    if (rest === "+" || rest === ">") return null;
    if (/^\d{1,3}[.)]?$/.test(rest)) return null;
  }
  if (/^(`{3,}|~{3,})/.test(rest)) return { type: "fence" };
  if (rest.startsWith("|")) return { type: "table" };
  if (complete && /^([-*_])(?:\s*\1){2,}\s*$/.test(rest)) return { type: "rule" };

  const heading = /^(#{1,6})\s+/.exec(rest);
  if (heading) return { type: "heading", level: heading[1].length, markerLength: heading[0].length };
  const bullet = /^[-*+]\s+/.exec(rest);
  if (bullet) return { type: "bullet", markerLength: bullet[0].length };
  const ordered = /^(\d{1,3}[.)])\s+/.exec(rest);
  if (ordered) return { type: "ordered", marker: ordered[1], markerLength: ordered[0].length };
  const quote = /^>\s?/.exec(rest);
  if (quote) return { type: "quote", markerLength: quote[0].length };
  return { type: "prose" };
}

function headingStyle(level: number): Style {
  if (level === 1) return markdownTheme.heading;
  if (level === 2) return markdownTheme.subheading;
  return markdownTheme.minorHeading;
}

function nestingLevel(indent: string): number {
  return Math.floor(indent.replace(/\t/g, "  ").length / 2);
}

/**
 * Renders a model reply as it streams. Prose appears as fast as tokens
 * arrive; formatting markers are replaced by their styling, and the only
 * text ever held back is a marker whose meaning depends on the next few
 * characters. Code blocks and tables are rendered a line (or a table) at a
 * time, since highlighting and alignment need the whole unit.
 *
 * Input must already be sanitized — this adds styling, it doesn't filter.
 */
export class MarkdownStream {
  private pending = "";
  private mode: "line-start" | "inline" | "buffered" = "line-start";
  private bufferedKind: BufferedKind = "code";
  private codeBlock: OpenCodeBlock | null = null;
  private tableRows: string[] = [];
  private inline: InlineState = freshInlineState();
  private lineStyle: Style | undefined;
  private lineOpen = false;

  constructor(private readonly io: MarkdownStreamIO) {}

  push(delta: string): void {
    this.pending += delta;
    this.drain(false);
  }

  /**
   * Ends the current reply segment (a tool call is starting, or the turn is
   * over): renders anything held back, closes an unterminated code block,
   * and resets so the next segment starts clean. Leaves the cursor at the end
   * of the last line written, like the raw stream did.
   */
  finish(): void {
    this.drain(true);
    if (this.tableRows.length > 0) this.flushTable(false);
    if (this.codeBlock) {
      this.write(`${this.lineOpen ? "\n" : ""}${this.codeBlock.indent}${markdownTheme.codeFrame("╰─")}`);
      this.codeBlock = null;
    }
    this.pending = "";
    this.mode = "line-start";
    this.endLine();
  }

  private write(text: string): void {
    if (!text) return;
    this.io.write(text);
    this.lineOpen = !text.endsWith("\n");
  }

  private endLine(): void {
    this.inline = freshInlineState();
    this.lineStyle = undefined;
  }

  private drain(final: boolean): void {
    while (this.pending.length > 0) {
      if (this.mode === "line-start") {
        if (!this.startLine(final)) return;
        continue;
      }

      const newline = this.pending.indexOf("\n");

      if (this.mode === "buffered") {
        if (newline < 0 && !final) return;
        const line = newline < 0 ? this.pending : this.pending.slice(0, newline);
        this.pending = newline < 0 ? "" : this.pending.slice(newline + 1);
        this.renderBufferedLine(line, newline >= 0);
        this.mode = "line-start";
        continue;
      }

      const segment = newline < 0 ? this.pending : this.pending.slice(0, newline);
      const rendered = renderInline(segment, this.inline, final || newline >= 0, this.lineStyle);
      this.write(rendered.output);
      this.pending = this.pending.slice(rendered.consumed);
      if (newline < 0) return;
      this.pending = this.pending.slice(1);
      this.write("\n");
      this.endLine();
      this.mode = "line-start";
    }
  }

  /** Classifies and decorates the start of a line. False = wait for more text. */
  private startLine(final: boolean): boolean {
    const newline = this.pending.indexOf("\n");
    const head = newline < 0 ? this.pending : this.pending.slice(0, newline);
    const complete = newline >= 0 || final;

    if (this.codeBlock) {
      this.enterBuffered("code");
      return true;
    }

    const indent = /^[ \t]*/.exec(head)![0];
    const kind = classifyLineStart(head.slice(indent.length), complete);
    if (kind === null) return false;
    if (kind.type !== "table" && this.tableRows.length > 0) this.flushTable(true);

    switch (kind.type) {
      case "fence":
      case "table":
      case "rule":
        this.enterBuffered(kind.type);
        return true;
      case "prose":
        this.mode = "inline";
        return true;
      case "heading": {
        this.consumeMarker(indent.length + kind.markerLength);
        this.lineStyle = headingStyle(kind.level);
        if (kind.level === 1) this.write(markdownTheme.heading("▍"));
        break;
      }
      case "bullet": {
        this.consumeMarker(indent.length + kind.markerLength);
        const glyph = BULLET_GLYPHS[Math.min(nestingLevel(indent), BULLET_GLYPHS.length - 1)];
        this.write(`${indent}${markdownTheme.bullet(glyph)} `);
        break;
      }
      case "ordered": {
        this.consumeMarker(indent.length + kind.markerLength);
        this.write(`${indent}${markdownTheme.bullet(kind.marker)} `);
        break;
      }
      case "quote": {
        this.consumeMarker(indent.length + kind.markerLength);
        this.lineStyle = markdownTheme.quoteText;
        this.write(`${indent}${markdownTheme.quoteBar("│")} `);
        break;
      }
    }
    this.mode = "inline";
    return true;
  }

  private consumeMarker(length: number): void {
    this.pending = this.pending.slice(length);
  }

  private enterBuffered(kind: BufferedKind): void {
    this.mode = "buffered";
    this.bufferedKind = kind;
  }

  private renderBufferedLine(line: string, hadNewline: boolean): void {
    const end = hadNewline ? "\n" : "";
    switch (this.bufferedKind) {
      case "table":
        this.tableRows.push(line);
        return;
      case "rule": {
        const width = Math.max(3, Math.min(this.io.columns() - 2, MAX_RULE_WIDTH));
        this.write(markdownTheme.rule("─".repeat(width)) + end);
        return;
      }
      case "fence": {
        const indent = /^[ \t]*/.exec(line)![0];
        const [, fence, language] = OPENING_FENCE.exec(line.slice(indent.length)) ?? ["", "```", ""];
        this.codeBlock = { fence, language, indent };
        const label = language ? ` ${markdownTheme.codeLanguage(language)}` : "";
        this.write(`${indent}${markdownTheme.codeFrame("╭─")}${label}${end}`);
        return;
      }
      case "code": {
        const block = this.codeBlock!;
        const closing = CLOSING_FENCE.exec(line);
        if (closing && closing[1][0] === block.fence[0] && closing[1].length >= block.fence.length) {
          this.write(`${block.indent}${markdownTheme.codeFrame("╰─")}${end}`);
          this.codeBlock = null;
          return;
        }
        const code = line.startsWith(block.indent) ? line.slice(block.indent.length) : line.trimStart();
        this.write(`${block.indent}${markdownTheme.codeFrame("│")} ${highlightCodeLine(code, block.language)}${end}`);
        return;
      }
    }
  }

  private flushTable(trailingNewline: boolean): void {
    const lines = renderTable(this.tableRows, Math.max(20, this.io.columns() - 1));
    this.tableRows = [];
    this.write(lines.join("\n") + (trailingNewline ? "\n" : ""));
  }
}
