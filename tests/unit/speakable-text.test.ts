// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { SpeakableText, cleanMarkdownLine, splitForSynthesis } from "../../src/voice/speakable-text.js";

/** Streams `text` in small arbitrary slices, like a model would, and collects everything spoken. */
function speakStreamed(text: string, sliceSize = 7): string[] {
  const s = new SpeakableText();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += sliceSize) out.push(...s.push(text.slice(i, i + sliceSize)));
  out.push(...s.end());
  return out;
}

describe("cleanMarkdownLine", () => {
  it("strips markdown syntax but keeps the words", () => {
    expect(cleanMarkdownLine("## Next steps")).toBe("Next steps");
    expect(cleanMarkdownLine("- **Bold** and *italic* and `inline_code`")).toBe("Bold and italic and inline_code");
    expect(cleanMarkdownLine("See [the docs](https://x.dev/a) or https://y.dev/b")).toBe("See the docs or a link");
    expect(cleanMarkdownLine("1. First item")).toBe("First item");
    expect(cleanMarkdownLine("> quoted <b>text</b>")).toBe("quoted text");
  });

  it("doesn't eat underscores inside identifiers", () => {
    expect(cleanMarkdownLine("call snake_case_name now")).toBe("call snake_case_name now");
  });
});

describe("SpeakableText", () => {
  it("never speaks code blocks — one short cue instead", () => {
    const spoken = speakStreamed(
      "I fixed the bug.\n```ts\nconst x = 1;\nconsole.log(x);\n```\nRun the tests to confirm.\n",
    ).join(" ");
    expect(spoken).not.toMatch(/const|console/);
    expect(spoken).toContain("The code is on screen.");
    expect(spoken).toContain("I fixed the bug.");
    expect(spoken).toContain("Run the tests to confirm.");
  });

  it("skips tables with a single cue", () => {
    const spoken = speakStreamed("Results:\n| a | b |\n|---|---|\n| 1 | 2 |\nAll good.\n").join(" ");
    expect(spoken.match(/The code is on screen/g)).toHaveLength(1);
    expect(spoken).not.toMatch(/\|/);
  });

  it("starts speaking after the first sentence, before the response finishes", () => {
    const s = new SpeakableText();
    const early = s.push("Sure, I can help with that. Let me look at the");
    expect(early).toEqual(["Sure, I can help with that."]);
    expect(s.push(" config file.")).toEqual([]); // no whitespace after the period yet
    expect(s.end()).toEqual(["Let me look at the config file."]);
  });

  it("batches later short sentences instead of one TTS request per fragment", () => {
    const s = new SpeakableText();
    s.push("First. ");
    expect(s.push("Ok. ")).toEqual([]); // under the batching threshold
  });

  it("ends headings and list items as spoken phrases", () => {
    const spoken = speakStreamed("# Summary\n- added tests\n- fixed build\n").join(" ");
    expect(spoken).toBe("Summary. added tests. fixed build.");
  });

  it("produces nothing for a response that is only code", () => {
    const spoken = speakStreamed("```\nls -la\n```\n");
    expect(spoken).toEqual(["The code is on screen."]);
  });
});

describe("splitForSynthesis", () => {
  it("respects the per-request limit, preferring sentence boundaries", () => {
    const text = "One sentence here. Another sentence there. And a third one.";
    const parts = splitForSynthesis(text, 30);
    expect(parts.every((p) => p.length <= 30)).toBe(true);
    expect(parts[0]).toBe("One sentence here.");
    expect(parts.join(" ")).toBe(text);
  });
});
