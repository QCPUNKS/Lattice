// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import type { LatticeConfig } from "../config/index.js";
import type { Runtime } from "./runtime.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { ChatMessage } from "../providers/types.js";
import { ExitCode } from "./exit-codes.js";
import { PermissionDeniedError } from "../agent/permissions.js";
import { sanitizeForTerminal } from "../ui/sanitize.js";

/**
 * Non-interactive one-shot run — `lattice exec "..."` / `lattice ask "..."`.
 * Streams to stdout, exits with a code reflecting the outcome so it composes
 * in CI/scripts/Makefiles.
 */
export async function runNonInteractive(cfg: LatticeConfig, runtime: Runtime, promptText: string): Promise<number> {
  const history: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(cfg.workspace, cfg.mode) },
    { role: "user", content: promptText },
  ];

  try {
    await runtime.loop.run(history, runtime.ctx, {
      onTextDelta: (delta) => process.stdout.write(sanitizeForTerminal(delta)),
      onToolCallStart: (name, args) => {
        process.stderr.write(`\n→ ${name} ${args.slice(0, 100)}\n`);
      },
      onToolResult: (_name, result, isError) => {
        process.stderr.write(`${isError ? "✗" : "✓"} ${result.split("\n")[0].slice(0, 120)}\n`);
      },
    });
    process.stdout.write("\n");
    return ExitCode.SUCCESS;
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      process.stderr.write(`\nPermission denied: ${err.message}\n`);
      return ExitCode.PERMISSION_DENIED;
    }
    process.stderr.write(`\nError: ${(err as Error).message}\n`);
    return ExitCode.PROVIDER_FAILURE;
  }
}
