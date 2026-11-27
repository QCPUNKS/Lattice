// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import chalk from "chalk";
import { MarkdownStream, classifyLineStart } from "../../src/ui/markdown/stream.js";
import { highlightCodeLine } from "../../src/ui/markdown/highlight.js";
import { renderTable } from "../../src/ui/markdown/table.js";
import { featureOpening } from "../../src/ui/features.js";
import { syntaxTheme } from "../../src/ui/theme.js";

function render(chunks: string[], columns = 80): { output: string; writes: string[] } {
  const writes: string[] = [];
  const stream = new MarkdownStream({ write: (text) => writes.push(text), columns: () => columns });
  for (const chunk of chunks) stream.push(chunk);
  stream.finish();
  return { output: writes.join(""), writes };
}

const renderWhole = (text: string) => render([text]).output;

/** Which SGR attribute group each code sets, and which code clears that group. */
function sgrGroup(code: number): string | null {
  if (code === 1 || code === 2 || code === 22) return "intensity";
  if (code === 3 || code === 23) return "italic";
  if (code === 4 || code === 24) return "underline";
  if ((code >= 30 && code <= 39) || (code >= 90 && code <= 97)) return "foreground";
  return null;
}
const CLEARING_CODES = new Set([22, 23, 24, 39]);

/**
 * What a terminal would display: each visible character with the styling
 * active on it. Two outputs that differ only in how color runs are split
 * render identically.
 */
function displayed(output: string): string[] {
  const active = new Map<string, string>();
  const cells: string[] = [];
  const pattern = /\x1b\[([0-9;]*)m|([\s\S])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    if (match[2] !== undefined) {
      cells.push(`${match[2]}|${[...active.entries()].sort().map(([k, v]) => `${k}=${v}`).join(",")}`);
      continue;
    }
    const codes = match[1].split(";").map(Number);
    if (codes[0] === 38) {
      active.set("foreground", match[1]);
      continue;
    }
    for (const code of codes) {
      const group = sgrGroup(code);
      if (!group) continue;
      if (CLEARING_CODES.has(code)) active.delete(group);
      else if (group === "foreground") active.set(group, String(code));
      else active.set(group, `${active.get(group) ?? ""}+${code}`);
    }
  }
  return cells;
}

const REPLY = [
  "# Plan",
  "",
  "Here's **what** I'll change in `src/app.ts` — see [the docs](https://example.com/docs).",
  "",
  "1. Read the *config* file",
  "2. Patch `load()`",
  "  - nested **bold** item",
  "",
  "> Note: 2 * 3 * 4 stays literal, as does snake_case_name.",
  "",
  "---",
  "",
  "```ts",
  'const answer: Answer = compute("x", 42); // done',
  "```",
  "",
  "| Name | Value |",
  "|:-----|------:|",
  "| `a`  | 1     |",
  "| b    | 22    |",
  "",
  "Done.",
].join("\n");

describe("MarkdownStream (no color)", () => {
  let level: typeof chalk.level;
  beforeEach(() => {
    level = chalk.level;
    chalk.level = 0;
  });
  afterEach(() => {
    chalk.level = level;
  });

  it("passes plain prose through unchanged", () => {
    expect(renderWhole("Just a sentence, nothing fancy.\nAnd another.")).toBe("Just a sentence, nothing fancy.\nAnd another.");
  });

  it("replaces emphasis and code markers with styling", () => {
    expect(renderWhole("A **bold** and *soft* word with `code`.")).toBe("A bold and soft word with code.");
  });

  it("keeps asterisks and underscores that aren't emphasis", () => {
    expect(renderWhole("2 * 3 * 4 = 24 and snake_case_name")).toBe("2 * 3 * 4 = 24 and snake_case_name");
    expect(renderWhole("a*b*c")).toBe("a*b*c");
  });

  it("decorates headings, bullets, ordered items, and quotes", () => {
    expect(renderWhole("# Title\n- one\n  - two\n3. three\n> quoted")).toBe("▍Title\n• one\n  ◦ two\n3. three\n│ quoted");
  });

  it("frames fenced code with its language", () => {
    expect(renderWhole("```ts\nconst a = 1;\n```\n")).toBe("╭─ ts\n│ const a = 1;\n╰─\n");
  });

  it("closes a code block the model never terminated", () => {
    expect(renderWhole("```\nloose")).toBe("╭─\n│ loose\n╰─");
  });

  it("keeps the address of a link visible", () => {
    expect(renderWhole("see [docs](https://e.com/x)")).toBe("see docs (https://e.com/x)");
    expect(renderWhole("an unfinished [bracket")).toBe("an unfinished [bracket");
  });

  it("does not hold back prose waiting for a newline", () => {
    const writes: string[] = [];
    const stream = new MarkdownStream({ write: (text) => writes.push(text), columns: () => 80 });
    stream.push("Hello wor");
    expect(writes.join("")).toBe("Hello wor");
    stream.push("ld, this is **bo");
    expect(writes.join("")).toBe("Hello world, this is bo");
  });

  it("aligns tables and falls back to rows when too wide", () => {
    const boxed = renderTable(["| Name | Value |", "|:-----|------:|", "| a | 1 |", "| bb | 22 |"], 80);
    expect(boxed).toEqual([
      "╭──────┬───────╮",
      "│ Name │ Value │",
      "├──────┼───────┤",
      "│ a    │     1 │",
      "│ bb   │    22 │",
      "╰──────┴───────╯",
    ]);
    expect(renderTable(["| Name | Value |", "|---|---|", "| a | 1 |"], 10)).toEqual(["| Name | Value |", "|---|---|", "| a | 1 |"]);
  });
});

describe("MarkdownStream (color)", () => {
  let level: typeof chalk.level;
  beforeEach(() => {
    level = chalk.level;
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = level;
  });

  it("renders identically no matter how the reply is chunked", () => {
    const whole = renderWhole(REPLY);
    for (const size of [1, 2, 3, 5, 7, 13]) {
      const chunks: string[] = [];
      for (let i = 0; i < REPLY.length; i += size) chunks.push(REPLY.slice(i, i + size));
      expect(displayed(render(chunks).output), `chunk size ${size}`).toEqual(displayed(whole));
    }
  });

  it("adds nothing but color codes to sanitized input", () => {
    const withoutColor = renderWhole(REPLY).replace(/\x1b\[[0-9;]*m/g, "");
    expect(withoutColor).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  });

  it("highlights keywords, strings, numbers, and comments", () => {
    const line = highlightCodeLine('const x = "hi"; // note 42', "ts");
    expect(line).toContain(syntaxTheme.keyword("const"));
    expect(line).toContain(syntaxTheme.string('"hi"'));
    expect(line).toContain(syntaxTheme.comment("// note 42"));
    expect(highlightCodeLine("# heading 1", "python")).toBe(syntaxTheme.comment("# heading 1"));
    expect(highlightCodeLine('{"name": 1}', "json")).toContain(syntaxTheme.functionName('"name"'));
  });
});

describe("classifyLineStart", () => {
  it("waits when the line start is still ambiguous", () => {
    expect(classifyLineStart("#", false)).toBeNull();
    expect(classifyLineStart("-", false)).toBeNull();
    expect(classifyLineStart("``", false)).toBeNull();
    expect(classifyLineStart("12", false)).toBeNull();
  });

  it("decides as soon as it can", () => {
    expect(classifyLineStart("#tag", false)).toEqual({ type: "prose" });
    expect(classifyLineStart("- item", false)).toMatchObject({ type: "bullet" });
    expect(classifyLineStart("**bold", false)).toEqual({ type: "prose" });
    expect(classifyLineStart("---", true)).toEqual({ type: "rule" });
    expect(classifyLineStart("1.5 million", false)).toEqual({ type: "prose" });
  });
});

describe("feature identity", () => {
  it("sanitizes the subject shown in a section header", () => {
    const header = featureOpening("imagine", "a fox\x1b]52;c;evil\x07 in rain", 80);
    expect(header.replace(/\x1b\[[0-9;]*m/g, "")).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    expect(header).toContain("IMAGINE");
  });
});
