// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

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
  dim: chalk.dim,
  bold: chalk.bold,
};
