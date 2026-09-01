// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

/**
 * Central color palette — nothing else in the UI layer should
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
  dim: chalk.dim,
  bold: chalk.bold,
};
