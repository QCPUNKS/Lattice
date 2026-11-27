// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

/**
 * Central color palette (spec §24) — nothing else in the UI layer should
 * reach for raw chalk color names directly, so retheming stays one file.
 */
export const theme = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  tool: chalk.magenta,
  system: chalk.dim.gray,
  user: chalk.bold.white,
  reasoning: chalk.blueBright,
  /** Kit10's signature pink (design palette). */
  mascot: chalk.hex("#ff4fa3"),
  dim: chalk.dim,
  bold: chalk.bold,
};

/**
 * Each major feature carries one accent from the wordmark's sweep, so the
 * screen tells you which part of Lattice you're in without a mode switch.
 */
export const featureAccent = {
  imagine: chalk.hex("#b07cff"),
  arena: chalk.hex("#ffb52e"),
  voice: chalk.hex("#2ee6c8"),
};

/**
 * A deep, low-contrast hex for frames and borders. In 16-color terminals it
 * would round to black and vanish on a dark background, so it falls back to dim.
 */
const subtle = (hex: string) => (chalk.level >= 2 ? chalk.hex(hex) : chalk.dim);

/** How rendered model replies look: structure in the brand cyan, code in a calm syntax palette. */
export const markdownTheme = {
  heading: chalk.bold.hex("#22e6f5"),
  subheading: chalk.bold.hex("#7fdcf0"),
  minorHeading: chalk.bold,
  bullet: chalk.hex("#22e6f5"),
  quoteBar: chalk.hex("#3d8bff"),
  quoteText: chalk.italic.dim,
  rule: chalk.dim,
  inlineCode: chalk.hex("#ffb86b"),
  link: chalk.underline.hex("#7fb8ff"),
  linkUrl: chalk.dim,
  codeFrame: subtle("#4a5a7a"),
  codeLanguage: chalk.dim.italic,
  tableBorder: subtle("#4a5a7a"),
  tableHeader: chalk.bold,
};

/** Syntax colors for fenced code blocks. */
export const syntaxTheme = {
  keyword: chalk.hex("#c792ea"),
  string: chalk.hex("#c3e88d"),
  number: chalk.hex("#f78c6c"),
  comment: chalk.italic.hex("#697098"),
  functionName: chalk.hex("#82aaff"),
  typeName: chalk.hex("#ffcb6b"),
  plain: chalk.hex("#d6deeb"),
  diffAdded: chalk.green,
  diffRemoved: chalk.red,
  diffHunk: chalk.cyan,
};
