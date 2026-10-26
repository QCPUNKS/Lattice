// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

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
  models?: string;
  tests?: string;
  debug: boolean;
  help: boolean;
  version: boolean;
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
  const result: ParsedArgs = { positional: [], debug: false, help: false, version: false };
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];

    if (token === "--debug") {
      result.debug = true;
      i++;
      continue;
    }
    if (token === "--help" || token === "-h") {
      result.help = true;
      i++;
      continue;
    }
    if (token === "--version" || token === "-v") {
      result.version = true;
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
