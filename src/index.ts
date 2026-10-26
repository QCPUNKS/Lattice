#!/usr/bin/env node
// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";

import { loadConfig } from "./config/index.js";
import { parseArgs, type ParsedArgs } from "./cli/args.js";
import { CLI_HELP, readVersion } from "./cli/help.js";
import { ExitCode } from "./cli/exit-codes.js";
import { buildRuntime } from "./cli/runtime.js";
import { runInteractive } from "./cli/repl.js";
import { runNonInteractive } from "./cli/exec.js";
import * as sessions from "./sessions/index.js";
import { killAllManagedProcesses } from "./tools/shell.js";

import { runModelsCommand, runDoctorCommand, runMcpCommand } from "./cli/commands/diagnostics.js";
import { runArenaCommand } from "./cli/commands/arena.js";
import { runSessionsCommand } from "./cli/commands/sessions.js";
import { runConfigCommand } from "./cli/commands/config.js";
import { runSetupCommand } from "./cli/commands/setup.js";
import {
  runInspectCommand,
  runStatusCommand,
  runDiffCommand,
  runTestCommand,
  runBuildCommand,
  runRunCommand,
  runAuditCommand,
} from "./cli/commands/project.js";

const KNOWN_COMMANDS = new Set([
  "models",
  "doctor",
  "mcp",
  "sessions",
  "session",
  "config",
  "setup",
  "inspect",
  "status",
  "diff",
  "test",
  "build",
  "run",
  "audit",
  "ask",
  "exec",
  "arena",
  "help",
]);

async function main(): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    console.error(chalk.dim("Run 'lattice --help' for usage."));
    return ExitCode.INVALID_USAGE;
  }
  if (parsed.help || parsed.command === "help") {
    console.log(CLI_HELP);
    return ExitCode.SUCCESS;
  }
  if (parsed.version) {
    console.log(readVersion());
    return ExitCode.SUCCESS;
  }

  // `lattice /path/to/project` — a bare path where a command name would go means "launch here."
  let workspaceOverride = parsed.workspace;
  let command = parsed.command;
  if (command && !KNOWN_COMMANDS.has(command)) {
    const candidate = path.resolve(command);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      workspaceOverride = workspaceOverride ?? candidate;
      command = undefined;
    } else {
      console.error(chalk.red(`Unknown command or path: ${command}`));
      console.error(chalk.dim("Run 'lattice --help' for available commands."));
      return ExitCode.INVALID_USAGE;
    }
  }

  const cfg = loadConfig({ model: parsed.model, mode: parsed.mode, workspace: workspaceOverride });

  switch (command) {
    case "models":
      return runModelsCommand(cfg);
    case "doctor":
      return runDoctorCommand(cfg);
    case "mcp":
      return runMcpCommand(cfg, parsed.positional[0]);
    case "sessions":
    case "session":
      return runSessionsCommand(cfg, parsed.positional[0], parsed.positional[1], parsed.format);
    case "config":
      return runConfigCommand(cfg, parsed.positional[0], parsed.positional[1], parsed.positional[2]);
    case "setup":
      return runSetupCommand(cfg);
    case "inspect":
      return runInspectCommand(cfg);
    case "status":
      return runStatusCommand(cfg);
    case "diff":
      return runDiffCommand(cfg, parsed.positional[0]);
    case "test":
      return runTestCommand(cfg);
    case "build":
      return runBuildCommand(cfg);
    case "run":
      return runRunCommand(cfg);
    case "audit":
      return runAuditCommand(cfg, parsed.positional[0]);
    case "arena":
      return runArenaCommand(cfg, parsed.positional, parsed.models, parsed.tests);
    case "ask":
    case "exec": {
      if (!cfg.veniceApiKey) {
        console.error(chalk.red("VENICE_API_KEY is not set. Run 'lattice doctor' for details."));
        return ExitCode.AUTHENTICATION_FAILURE;
      }
      const promptText = parsed.positional.join(" ").trim();
      if (!promptText) {
        console.error(chalk.red(`Usage: lattice ${command} "<what to do>"`));
        return ExitCode.INVALID_USAGE;
      }
      const runtime = await buildRuntime(cfg, { rl: null, debug: parsed.debug });
      try {
        return await runNonInteractive(cfg, runtime, promptText);
      } finally {
        await runtime.shutdown();
      }
    }
  }

  // --- interactive mode ---
  if (!cfg.veniceApiKey) {
    console.error(chalk.red("VENICE_API_KEY is not set. Run 'lattice doctor' for details, or 'lattice setup' to configure."));
    return ExitCode.AUTHENTICATION_FAILURE;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const runtime = await buildRuntime(cfg, { rl, debug: parsed.debug });

  let resumeSession: sessions.StoredSession | null = null;
  if (parsed.session) {
    try {
      resumeSession =
        parsed.session === "latest"
          ? await sessions.findLatestSessionForWorkspace(cfg.sessionsDir, cfg.workspace).then((s) => (s ? sessions.loadSession(cfg.sessionsDir, s.id) : null))
          : await sessions.loadSession(cfg.sessionsDir, parsed.session);
    } catch (err) {
      console.error(chalk.yellow(`Could not resume session "${parsed.session}": ${(err as Error).message}. Starting a new session.`));
    }
  }

  const cleanup = async () => {
    await runtime.shutdown();
    rl.close();
  };
  process.on("SIGTERM", () => {
    killAllManagedProcesses();
    process.exit(0);
  });
  process.on("exit", () => {
    // Last-resort synchronous safety net — process.on("exit") handlers can't be async.
    killAllManagedProcesses();
  });

  try {
    return await runInteractive(cfg, runtime, rl, resumeSession);
  } finally {
    await cleanup();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(chalk.red(`Fatal error: ${err.message}`));
    process.exitCode = ExitCode.GENERAL_FAILURE;
  });
