// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

export interface ParsedArgs {
  /** First non-flag token, e.g. "doctor", "models", "mcp". Undefined means interactive mode. */
  command?: string;
  /** Remaining non-flag tokens after the command (subcommands/positional args). */
  positional: string[];
  model?: string;
  mode?: "safe" | "normal" | "auto";
  workspace?: string;
  session?: string;
  format?: string;
  /** Comma-separated model ids for `arena` to race. */
  models?: string;
  /** Shell command arena runs in each worktree to score participants. */
  tests?: string;
  debug: boolean;
  yes: boolean; // skip confirmations where a flag-based override makes sense (still respects destructive/critical gating)
}

const VALUE_FLAGS: Record<string, keyof ParsedArgs> = {
  "--model": "model",
  "--mode": "mode",
  "--workspace": "workspace",
  "--session": "session",
  "--format": "format",
  "--models": "models",
  "--tests": "tests",
};

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { positional: [], debug: false, yes: false };
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];

    if (token === "--debug") {
      result.debug = true;
      i++;
      continue;
    }
    if (token === "--yes" || token === "-y") {
      result.yes = true;
      i++;
      continue;
    }

    const key = VALUE_FLAGS[token];
    if (key) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`${token} requires a value`);
      }
      (result as any)[key] = value;
      i += 2;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown flag: ${token}`);
    }

    if (result.command === undefined) {
      result.command = token;
    } else {
      result.positional.push(token);
    }
    i++;
  }

  if (result.mode && !["safe", "normal", "auto"].includes(result.mode)) {
    throw new Error(`Invalid --mode: ${result.mode}. Must be safe, normal, or auto.`);
  }

  return result;
}
