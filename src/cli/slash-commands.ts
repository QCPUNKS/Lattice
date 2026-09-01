// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import * as readline from "node:readline/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { LatticeConfig } from "../config/index.js";
import type { Runtime } from "./runtime.js";
import type { StoredSession } from "../sessions/index.js";
import * as sessions from "../sessions/index.js";
import { estimateHistoryTokens, compactHistory } from "../agent/context.js";
import { execCaptured } from "../tools/shell.js";
import * as actions from "./actions.js";
import { colorizeDiff } from "../ui/diff.js";
import { theme } from "../ui/theme.js";
import { displayName } from "../mcp/manager.js";
import { runArena, type ArenaParticipantSpec } from "../arena/orchestrator.js";
import { ArenaLiveView, formatArenaStatus } from "../ui/arena-live.js";
import {
  runArenaCommand,
  renderScorecard,
  parseArenaSlashArgs,
  isArenaSubcommand,
} from "./commands/arena.js";

export interface ReplState {
  cfg: LatticeConfig;
  runtime: Runtime;
  session: StoredSession;
  rl: readline.Interface;
}

export type SlashResult = "handled" | "exit" | "not-a-command";

const HELP_TEXT = `Slash commands:
  /help                 show this list
  /model [id]           show or switch the active model
  /models                list Venice models and capabilities
  /status                project + git + agent state summary
  /tools                  list available tools (native + MCP)
  /mcp                    MCP server/tool status
  /context                approximate token usage
  /compact                force context compaction now
  /clear                  clear the conversation (keeps system prompt)
  /reset                  clear conversation and start a new session
  /session                show the current session
  /sessions               list saved sessions
  /save [label]           save the current session
  /load <id>              load a saved session
  /workspace              show the active workspace
  /cd <path>              change the active workspace
  /permissions            show the current permission mode and allowances
  /mode <safe|normal|auto> change the permission mode
  /retry                  re-run the last request
  /undo                   revert file changes made during the last turn
  /diff [file]            show changes made during the last turn
  /git <args>              run git directly
  /test                   run the project's test command
  /build                  run the project's build command
  /run                    start the project's dev/start script
  /ps                     list background processes
  /stop <id>              stop a background process
  /arena "<task>" --models a,b[,c] [--tests "cmd"]
                           race models on the same task in isolated worktrees
  /arena diff [label]      review a participant's actual diff before picking
  /arena pick <label>      merge a participant's work into your branch
  /arena list              show past and open arena runs
  /arena clean             discard the current open run without merging
  /quit, /exit             exit lattice`;

export async function handleSlashCommand(input: string, state: ReplState): Promise<SlashResult> {
  if (!input.startsWith("/")) return "not-a-command";

  const [cmd, ...rest] = input.trim().split(/\s+/);
  const arg = rest.join(" ");
  const { cfg, runtime, rl } = state;

  switch (cmd) {
    case "/help":
      console.log(HELP_TEXT);
      return "handled";

    case "/model": {
      if (!arg) {
        console.log(`Current model: ${theme.bold(cfg.model)}`);
        return "handled";
      }
      cfg.model = arg;
      runtime.loop.setModel(arg);
      console.log(theme.success(`Switched model to ${arg}`));
      return "handled";
    }

    case "/models": {
      const models = await runtime.provider.getModels();
      for (const m of models) {
        console.log(
          `${theme.bold(m.id)}  ctx=${m.contextLength ?? "?"}  tools=${m.supportsTools}  reasoning=${m.supportsReasoning}  vision=${m.supportsVision}`,
        );
      }
      return "handled";
    }

    case "/status": {
      console.log(theme.dim(await actions.gitStatusSummary(cfg.workspace)));
      console.log(`session: ${state.session.id}  messages: ${state.session.history.length}`);
      return "handled";
    }

    case "/tools": {
      const native = runtime.registry.names();
      console.log(`Native tools (${native.length}): ${native.join(", ")}`);
      for (const s of runtime.mcp.status()) {
        if ("client" in s) {
          console.log(`MCP ${s.name}: ${s.toolNames.map((t) => displayName(s.name, t)).join(", ") || "(no tools)"}`);
        }
      }
      return "handled";
    }

    case "/mcp": {
      const statuses = runtime.mcp.status();
      if (statuses.length === 0) {
        console.log(theme.dim("No MCP servers configured. See docs/mcp.md."));
        return "handled";
      }
      for (const s of statuses) {
        if ("client" in s) {
          console.log(`${theme.success("✓")} ${s.name} (${s.scope})  ${s.toolNames.length} tools`);
        } else {
          console.log(`${theme.error("✗")} ${s.name} (${s.scope})  ${s.error}`);
        }
      }
      return "handled";
    }

    case "/context": {
      const tokens = estimateHistoryTokens(state.session.history);
      console.log(`~${tokens} tokens / ${cfg.contextTokenBudget} budget (${state.session.history.length} messages)`);
      return "handled";
    }

    case "/compact": {
      const result = compactHistory(state.session.history, cfg.contextTokenBudget, true);
      state.session.history.length = 0;
      state.session.history.push(...result.history);
      console.log(theme.success(`Compacted: ${result.tokensBefore} -> ${result.tokensAfter} approx tokens.`));
      return "handled";
    }

    case "/clear": {
      const systemMsg = state.session.history[0];
      state.session.history.length = 0;
      if (systemMsg) state.session.history.push(systemMsg);
      console.log(theme.dim("Conversation cleared."));
      return "handled";
    }

    case "/reset": {
      const systemMsg = state.session.history[0];
      state.session = sessions.createSession(cfg.workspace, cfg.model, cfg.mode);
      if (systemMsg) state.session.history.push(systemMsg);
      console.log(theme.dim(`New session started: ${state.session.id}`));
      return "handled";
    }

    case "/session":
      console.log(`id: ${state.session.id}\nworkspace: ${state.session.workspace}\nmodel: ${state.session.model}\nmessages: ${state.session.history.length}`);
      return "handled";

    case "/sessions": {
      const list = await sessions.listSessions(cfg.sessionsDir);
      if (list.length === 0) {
        console.log(theme.dim("No saved sessions."));
        return "handled";
      }
      for (const s of list) {
        console.log(`${s.id}  ${s.updatedAt}  ${s.messageCount}msg  ${s.preview}`);
      }
      return "handled";
    }

    case "/save": {
      state.session.label = arg || state.session.label;
      await sessions.saveSession(cfg.sessionsDir, state.session);
      console.log(theme.success(`Saved session ${state.session.id}`));
      return "handled";
    }

    case "/load": {
      if (!arg) {
        console.log(theme.error("Usage: /load <session-id>"));
        return "handled";
      }
      try {
        state.session = await sessions.loadSession(cfg.sessionsDir, arg);
        console.log(theme.success(`Loaded session ${state.session.id} (${state.session.history.length} messages)`));
      } catch (err) {
        console.log(theme.error(`Could not load session ${arg}: ${(err as Error).message}`));
      }
      return "handled";
    }

    case "/workspace":
      console.log(cfg.workspace);
      return "handled";

    case "/cd": {
      if (!arg) {
        console.log(theme.error("Usage: /cd <path>"));
        return "handled";
      }
      const target = path.resolve(cfg.workspace, arg);
      if (!existsSync(target)) {
        console.log(theme.error(`No such directory: ${target}`));
        return "handled";
      }
      cfg.workspace = target;
      runtime.ctx.workspace = target;
      runtime.snapshots.setWorkspace(target);
      console.log(theme.success(`Workspace changed to ${target}`));
      return "handled";
    }

    case "/permissions": {
      console.log(`mode: ${cfg.mode}`);
      const allowances = runtime.gate.describeAllowances();
      console.log(allowances.length > 0 ? `always-allowed this session: ${allowances.join(", ")}` : "no standing allowances yet this session");
      return "handled";
    }

    case "/mode": {
      if (!arg || !["safe", "normal", "auto"].includes(arg)) {
        console.log(theme.error("Usage: /mode <safe|normal|auto>"));
        return "handled";
      }
      cfg.mode = arg as LatticeConfig["mode"];
      runtime.gate.setMode(cfg.mode);
      console.log(theme.success(`Mode set to ${cfg.mode.toUpperCase()}`));
      return "handled";
    }

    case "/retry": {
      const h = state.session.history;
      const lastUserIdx = [...h].map((m) => m.role).lastIndexOf("user");
      if (lastUserIdx === -1) {
        console.log(theme.dim("Nothing to retry yet."));
        return "handled";
      }
      h.length = lastUserIdx + 1;
      console.log(theme.dim("Retrying last request..."));
      return "handled"; // caller (repl loop) checks for this and re-runs the loop
    }

    case "/undo": {
      const { restored, deleted } = await runtime.snapshots.undo();
      if (restored.length === 0 && deleted.length === 0) {
        console.log(theme.dim("Nothing to undo (no tracked changes from the last turn)."));
      } else {
        console.log(theme.success(`Restored: ${restored.join(", ") || "(none)"}${deleted.length ? `\nRemoved (were created this turn): ${deleted.join(", ")}` : ""}`));
      }
      return "handled";
    }

    case "/diff": {
      const diffText = await runtime.snapshots.diff(arg || undefined);
      console.log(colorizeDiff(diffText));
      return "handled";
    }

    case "/git": {
      const r = await execCaptured(`git ${arg}`, cfg.workspace, 30_000);
      if (r.stdout) console.log(r.stdout);
      if (r.stderr) console.log(theme.dim(r.stderr));
      return "handled";
    }

    case "/test": {
      const result = await actions.runDetectedCommand(cfg.workspace, "test", cfg.commandTimeoutMs);
      printActionResult(result, "No test command detected for this project.");
      return "handled";
    }

    case "/build": {
      const result = await actions.runDetectedCommand(cfg.workspace, "build", cfg.commandTimeoutMs);
      printActionResult(result, "No build command detected for this project.");
      return "handled";
    }

    case "/run": {
      const result = await actions.runProject(cfg.workspace);
      if (!result) {
        console.log(theme.dim("No dev/start script detected for this project."));
      } else {
        console.log(theme.success(`${result.reused ? "Reusing" : "Started"} ${result.processId}: ${result.command}`));
      }
      return "handled";
    }

    case "/ps":
      console.log(actions.formatProcessList());
      return "handled";

    case "/stop": {
      if (!arg) {
        console.log(theme.error("Usage: /stop <process-id>"));
        return "handled";
      }
      console.log(actions.stopProcessById(arg));
      return "handled";
    }

    case "/arena": {
      const { positional, models, tests } = parseArenaSlashArgs(arg);

      if (isArenaSubcommand(positional, models)) {
        await runArenaCommand(cfg, positional, models, tests);
        return "handled";
      }

      const promptText = positional.join(" ").trim();
      if (!promptText || !models) {
        console.log(theme.error('Usage: /arena "<what to do>" --models model-a,model-b [--tests "npm test"]'));
        return "handled";
      }
      const participants: ArenaParticipantSpec[] = models.split(",").map((m) => ({ model: m.trim() }));
      if (participants.length < 2) {
        console.log(theme.error("Arena needs at least 2 models — got 1. Pass a comma-separated list, e.g. --models a,b"));
        return "handled";
      }

      console.log(theme.dim(`Racing ${participants.length} models on: ${promptText}\n`));
      const view = new ArenaLiveView(participants.map((p) => p.model));
      try {
        const run = await runArena(cfg, promptText, participants, {
          testCommand: tests,
          onProgress: (label, event) => view.update(label, formatArenaStatus(label, event)),
        });
        view.finish();
        console.log(renderScorecard(run));
        console.log(
          theme.dim(`\n/arena diff [label] to review code, /arena pick <label> to merge, /arena clean to discard.`),
        );
      } catch (err) {
        view.finish();
        console.log(theme.error((err as Error).message));
      }
      return "handled";
    }

    case "/quit":
    case "/exit":
      return "exit";

    default:
      console.log(theme.error(`Unknown command: ${cmd}. Try /help.`));
      return "handled";
  }
}

function printActionResult(result: actions.ActionResult | null, notDetectedMessage: string): void {
  if (!result) {
    console.log(theme.dim(notDetectedMessage));
    return;
  }
  const ok = result.exitCode === 0;
  console.log(`${ok ? theme.success("✓") : theme.error("✗")} ${result.command}  (${result.durationMs}ms, exit ${result.exitCode})`);
  if (result.stdout) console.log(result.stdout.slice(-4000));
  if (result.stderr) console.log(theme.dim(result.stderr.slice(-2000)));
}
