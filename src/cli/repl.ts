// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { LatticeConfig } from "../config/index.js";
import type { Runtime } from "./runtime.js";
import type { ChatMessage } from "../providers/types.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import { renderBanner, prompt, renderStatusBar } from "../ui/terminal.js";
import { theme } from "../ui/theme.js";
import { cancelActiveForegroundCommand } from "../tools/shell.js";
import * as sessions from "../sessions/index.js";
import { handleSlashCommand, type ReplState } from "./slash-commands.js";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { estimateHistoryTokens } from "../agent/context.js";
import { ExitCode } from "./exit-codes.js";
import { sanitizeForTerminal } from "../ui/sanitize.js";

async function readProjectContext(cfg: LatticeConfig): Promise<string | undefined> {
  const p = path.join(cfg.projectConfigDir, "context.md");
  if (!existsSync(p)) return undefined;
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return undefined;
  }
}

export async function runInteractive(
  cfg: LatticeConfig,
  runtime: Runtime,
  rl: readline.Interface,
  resumeSession: sessions.StoredSession | null,
): Promise<number> {
  const mcpStatuses = runtime.mcp.status();
  const mcpConnected = mcpStatuses.filter((s) => "client" in s);
  const mcpToolCount = mcpConnected.reduce((sum, s: any) => sum + s.toolNames.length, 0);

  console.log(
    renderBanner(cfg, {
      toolCount: runtime.registry.list().length - mcpToolCount,
      mcpServerCount: mcpConnected.length,
      mcpToolCount,
    }),
  );
  console.log();

  const session = resumeSession ?? sessions.createSession(cfg.workspace, cfg.model, cfg.mode);
  if (session.history.length === 0) {
    const projectContext = await readProjectContext(cfg);
    session.history.push({ role: "system", content: buildSystemPrompt(cfg.workspace, cfg.mode, projectContext) });
  } else {
    console.log(theme.dim(`Resumed session ${session.id} (${session.history.length} messages)`));
  }

  const state: ReplState = { cfg, runtime, session, rl };

  let currentAbort: AbortController | null = null;
  rl.on("SIGINT", () => {
    if (currentAbort) {
      currentAbort.abort();
      cancelActiveForegroundCommand();
      console.log(theme.warning("\n  Cancelled."));
    } else {
      console.log(theme.dim("\n  Nothing to cancel. Ctrl+D or /quit to exit."));
    }
  });

  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  let exitCode: number = ExitCode.SUCCESS;
  let approxTokens = estimateHistoryTokens(session.history);

  runLoop: while (!closed) {
    let input: string;
    try {
      input = (await rl.question(prompt())).trim();
    } catch {
      break; // interface closed mid-question (e.g. Ctrl+D)
    }
    if (closed) break;
    if (!input) continue;

    if (input.startsWith("/")) {
      const result = await handleSlashCommand(input, state);
      if (result === "exit") break runLoop;
      // Every slash command is fully handled here except /retry, which
      // truncates history back to the last user turn and falls through so
      // the agent loop below re-runs it.
      if (input !== "/retry") continue;
    } else {
      state.session.history.push({ role: "user", content: input });
    }

    currentAbort = new AbortController();
    try {
      await runtime.loop.run(state.session.history, runtime.ctx, {
        onTextDelta: (delta) => stdout.write(sanitizeForTerminal(delta)),
        onToolCallStart: (name, args) => {
          console.log();
          console.log(theme.tool(`  → ${sanitizeForTerminal(name)}`) + theme.dim(` ${truncateArgs(sanitizeForTerminal(args))}`));
        },
        onToolResult: (name, result, isError) => {
          const color = isError ? theme.error : theme.dim;
          console.log(color(`  ${isError ? "✗" : "✓"} ${firstLine(sanitizeForTerminal(result))}`));
        },
        onCompaction: (result) => {
          console.log(theme.dim(`  [context compacted: ${result.tokensBefore} → ${result.tokensAfter} approx tokens]`));
        },
        onUsage: (tokens) => {
          approxTokens = tokens;
        },
      }, currentAbort.signal);
      console.log("\n");
    } catch (err) {
      console.log(theme.error(`\nError: ${(err as Error).message}\n`));
      exitCode = ExitCode.PROVIDER_FAILURE;
    } finally {
      currentAbort = null;
      runtime.snapshots.reset(); // each completed turn's changes are locked in; /undo only covers the turn just finished until the next one starts
    }

    if (approxTokens === 0) approxTokens = estimateHistoryTokens(state.session.history);
    console.log(
      renderStatusBar({
        approxTokens,
        toolCount: runtime.registry.list().length,
        model: cfg.model,
        workspace: cfg.workspace,
        mode: cfg.mode,
      }),
    );

    await sessions.saveSession(cfg.sessionsDir, state.session).catch(() => {
      // session persistence is best-effort; a failure here shouldn't interrupt the conversation
    });
  }

  await sessions.saveSession(cfg.sessionsDir, state.session).catch(() => {});
  return exitCode;
}

function truncateArgs(args: string): string {
  return args.length > 100 ? args.slice(0, 100) + "..." : args;
}

function firstLine(s: string): string {
  const line = s.split("\n")[0];
  return line.length > 120 ? line.slice(0, 120) + "..." : line;
}
