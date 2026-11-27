// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { markdownTheme } from "../theme.js";

export type Style = (text: string) => string;

/** Formatting open at the current point in a line. Reset at every line end. */
export interface InlineState {
  bold: boolean;
  italic: boolean;
  code: boolean;
  /** Last visible character emitted; decides whether a `*` opens or closes. */
  lastChar: string;
}

export function freshInlineState(): InlineState {
  return { bold: false, italic: false, code: false, lastChar: "" };
}

export interface InlineRender {
  output: string;
  /** How many characters of the input were rendered; the rest are held until more text arrives. */
  consumed: number;
}

const ESCAPABLE = /[\\`*_[\]()#+\-.!|>~{}]/;
/** Characters after which a single `*` may open emphasis (so `2 * 3` and `a*b` stay literal). */
const EMPHASIS_OPENER_BOUNDARY = /[\s([{"'“‘—–-]/;
const COMPLETE_LINK = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/;
const PARTIAL_LINK = /^\[[^\]\n]{0,200}(?:\](?:\([^)\s]{0,500})?)?$/;

const isWhitespace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

function currentStyle(state: InlineState, base: Style | undefined): Style {
  if (state.code) return markdownTheme.inlineCode;
  let style: Style = base ?? ((text) => text);
  if (state.bold) {
    const inner = style;
    style = (text) => chalk.bold(inner(text));
  }
  if (state.italic) {
    const inner = style;
    style = (text) => chalk.italic(inner(text));
  }
  return style;
}

function renderLink(label: string, url: string): string {
  // The address stays visible: a label alone could disguise where a link goes.
  if (label === url) return markdownTheme.link(url);
  return `${markdownTheme.link(label)} ${markdownTheme.linkUrl(`(${url})`)}`;
}

/**
 * Renders inline markdown in one line of text (no newlines). With `final`
 * false, the text may still be growing, so a trailing marker whose meaning
 * depends on what comes next (`*`, `\`, an unfinished `[link](`) is held
 * back rather than guessed at; everything before it is emitted immediately.
 */
export function renderInline(text: string, state: InlineState, final: boolean, base?: Style): InlineRender {
  let output = "";
  let run = "";
  let index = 0;

  const flush = () => {
    if (run) output += currentStyle(state, base)(run);
    run = "";
  };
  const emit = (chars: string) => {
    run += chars;
    state.lastChar = chars[chars.length - 1];
  };

  while (index < text.length) {
    const ch = text[index];

    if (state.code) {
      if (ch === "`") {
        flush();
        state.code = false;
      } else {
        emit(ch);
      }
      index++;
      continue;
    }

    if (ch === "\\") {
      const next = text[index + 1];
      if (next === undefined && !final) break;
      if (next !== undefined && ESCAPABLE.test(next)) {
        emit(next);
        index += 2;
      } else {
        emit(ch);
        index++;
      }
      continue;
    }

    if (ch === "`") {
      flush();
      state.code = true;
      index++;
      continue;
    }

    if (ch === "*") {
      if (index + 1 >= text.length && !final) break;
      const isDouble = text[index + 1] === "*";
      const width = isDouble ? 2 : 1;
      if (index + width >= text.length && !final) break;
      const after = text[index + width];
      const flag = isDouble ? "bold" : "italic";
      const before = state.lastChar;

      if (state[flag] && before !== "" && !isWhitespace(before)) {
        flush();
        state[flag] = false;
      } else if (
        !state[flag] &&
        after !== undefined &&
        !isWhitespace(after) &&
        (isDouble || before === "" || EMPHASIS_OPENER_BOUNDARY.test(before))
      ) {
        flush();
        state[flag] = true;
      } else {
        emit(text.slice(index, index + width));
      }
      index += width;
      continue;
    }

    if (ch === "[") {
      const rest = text.slice(index);
      const link = COMPLETE_LINK.exec(rest);
      if (link) {
        flush();
        output += renderLink(link[1], link[2]);
        state.lastChar = ")";
        index += link[0].length;
        continue;
      }
      if (!final && PARTIAL_LINK.test(rest)) break;
      emit(ch);
      index++;
      continue;
    }

    emit(ch);
    index++;
  }

  flush();
  return { output, consumed: index };
}

/** Renders a complete line in one go (tables, finished text). */
export function renderInlineLine(text: string, base?: Style): string {
  return renderInline(text, freshInlineState(), true, base).output;
}
