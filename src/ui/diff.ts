// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { theme } from "./theme.js";

/** Colorizes a unified diff for terminal display: +green / -red / @@hunk headers dim cyan. */
export function colorizeDiff(unifiedDiff: string): string {
  return unifiedDiff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return theme.bold(line);
      if (line.startsWith("@@")) return theme.primary(line);
      if (line.startsWith("+")) return theme.success(line);
      if (line.startsWith("-")) return theme.error(line);
      return theme.dim(line);
    })
    .join("\n");
}
