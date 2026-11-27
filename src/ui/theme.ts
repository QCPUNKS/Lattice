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
