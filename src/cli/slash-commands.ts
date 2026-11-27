// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import * as readline from "node:readline/promises";
import { sanitizeForTerminal } from "../ui/sanitize.js";
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
import { runImagine, runImageSettings } from "./commands/imagine.js";
import { planArenaInteractively } from "./commands/arena-wizard.js";
import { runVoiceCommand } from "./commands/voice.js";
import { runMascotCommand, tokenBagFrame } from "./commands/mascot.js";
import { renderCostReport } from "./commands/cost.js";
import { formatRate } from "../billing/pricing.js";
import { agentCapableModels, formatContextTokens, formatPrice } from "./model-format.js";
import type { TextPricing } from "../providers/types.js";
import type { MascotDirector } from "../ui/mascot/director.js";
import {
  runArenaCommand,
  renderScorecard,
  arenaNextSteps,
  parseArenaSlashArgs,
  isArenaSubcommand,
} from "./commands/arena.js";

export interface ReplState {
  cfg: LatticeConfig;
  runtime: Runtime;
  session: StoredSession;
  rl: readline.Interface;
  /** Present when the animated mascot is running (Kitty graphics terminal). */
  director: MascotDirector | null;
}

export type SlashResult = "handled" | "exit" | "not-a-command";

const HELP_TEXT = `Slash commands:
  /help                 show this list
  /model                open the model picker (full Venice catalog, select by number)
  /model <id>           switch directly to a model id
  /models                list Venice models and capabilities
  /status                project + git + agent state summary
  /tools                  list available tools (native + MCP)
  /mcp                    MCP server/tool status
  /context                approximate token usage
  /cost, /spend           balance, spend this session/today/month, by model, budgets
  /compact                force context compaction now
  /clear                  clear the conversation (keeps system prompt)
  /reset                  clear conversation and start a new session
  /forget                 permanently delete this conversation from disk and start fresh
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
  /arena                   race models on one task (asks for everything it needs)
  /arena diff [number]     review a participant's actual diff before picking
  /arena pick <number>     merge a participant's work into your branch
  /arena list              show past and open arena runs
  /arena clean             discard the current open run without merging
  /imagine                 generate an image inline (asks what and what shape)
  /imagine help            every image option (model, seed, negative prompt...)
  /image                   image settings: setup, models, model <id>, output <path>, safe on|off, open
  /voice [off|chat|dictate|listen]
                           voice mode: speak and/or hear (each direction independent)
  /talk                    speak one message now (Enter to send, Ctrl+C to cancel)
  /voice help              voices, speed, microphone, and more
  /mascot, /kit10 [on|off] tour Kit10's poses, or turn her on/off
  /quit, /exit             exit lattice`;

export async function handleSlashCommand(
  input: string,
  state: ReplState,
  signal?: AbortSignal,
): Promise<SlashResult> {
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
        return runModelPicker(state);
      }
      await switchModel(state, arg);
      return "handled";
    }

    case "/models": {
      const models = await runtime.provider.getModels();
      for (const m of models) {
        const marker = m.id === cfg.model ? theme.success("● ") : "  ";
        console.log(
          `${marker}${theme.bold(m.id)}  ${formatPrice(m.pricing)}  ctx=${formatContextTokens(m.contextLength)}  tools=${m.supportsTools}  reasoning=${m.supportsReasoning}  vision=${m.supportsVision}`,
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

    case "/cost":
    case "/spend": {
      if (state.director) {
        state.director.showInline("token_spend", 8, `${theme.mascot("♥")} ${theme.bold("Spending")}`, 3);
      }
      await runtime.http.refreshBalance(signal).catch(() => null); // fall back to the last known balance offline
      console.log(renderCostReport(runtime.spend.ledger, runtime.spend.budget, runtime.http.lastBalance()));
      return "handled";
    }

    case "/context": {
      const tokens = estimateHistoryTokens(state.session.history);
      const summary = `~${tokens} tokens / ${cfg.contextTokenBudget} budget (${state.session.history.length} messages)`;
      if (state.director) {
        // The token bag fills as the context does.
        const fraction = tokens / cfg.contextTokenBudget;
        state.director.showInline("token_fill", tokenBagFrame(fraction), `${theme.mascot("♥")} ${summary}  ${theme.dim(`${Math.round(fraction * 100)}% full`)}`);
      } else {
        console.log(summary);
      }
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
      runtime.spend.ledger.setSession(state.session.id);
      console.log(theme.dim(`New session started: ${state.session.id}`));
      return "handled";
    }

    case "/forget": {
      const answer = (await rl.question(theme.warning(`Permanently delete session ${state.session.id} from disk? [y/N]: `)))
        .trim()
        .toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        console.log(theme.dim("Kept."));
        return "handled";
      }
      const forgottenId = state.session.id;
      await sessions.deleteSession(cfg.sessionsDir, forgottenId).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err; // never saved yet is fine
      });
      const systemMsg = state.session.history[0];
      state.session = sessions.createSession(cfg.workspace, cfg.model, cfg.mode);
      if (systemMsg?.role === "system") state.session.history.push(systemMsg);
      runtime.spend.ledger.setSession(state.session.id);
      runtime.auditLog({ type: "session_forgotten", id: forgottenId });
      console.log(theme.success(`Deleted ${forgottenId}. New session: ${state.session.id}`));
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
        runtime.spend.ledger.setSession(state.session.id);
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
      if (r.stdout) console.log(sanitizeForTerminal(r.stdout));
      if (r.stderr) console.log(theme.dim(sanitizeForTerminal(r.stderr)));
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

      const plan = await planArenaInteractively(rl, runtime.provider, cfg, {
        prompt: positional.join(" ").trim() || undefined,
        models,
        tests,
      });
      if (!plan) {
        console.log(theme.dim("Arena cancelled."));
        return "handled";
      }
      const promptText = plan.prompt;
      const participants: ArenaParticipantSpec[] = plan.models.map((model) => ({ model }));
      if (participants.length < 2) {
        console.log(theme.error("Arena needs at least 2 models — got 1. Pass a comma-separated list, e.g. --models a,b"));
        return "handled";
      }

      console.log(theme.dim(`Racing ${participants.length} models on: ${promptText}\n`));
      const view = new ArenaLiveView(participants.map((p) => p.model));
      try {
        const run = await runArena(cfg, promptText, participants, {
          testCommand: plan.testCommand,
          onProgress: (label, event) => view.update(label, formatArenaStatus(label, event)),
        });
        view.finish();
        console.log(renderScorecard(run));
        console.log(theme.dim(`\n${arenaNextSteps("/arena")}`));
      } catch (err) {
        view.finish();
        console.log(theme.error((err as Error).message));
      }
      return "handled";
    }

    case "/imagine":
      await runImagine(runtime.images, rl, arg, signal);
      return "handled";

    case "/image":
      await runImageSettings(runtime.images, rl, arg, cfg.image);
      return "handled";

    case "/mascot":
    case "/kit10":
      await runMascotCommand(state.director, cfg, arg, signal);
      return "handled";

    case "/voice":
      await runVoiceCommand(runtime.voice, cfg, arg);
      return "handled";

    case "/quit":
    case "/exit":
      return "exit";

    default:
      console.log(theme.error(`Unknown command: ${cmd}. Try /help.`));
      return "handled";
  }
}

/**
 * Interactive model picker: lists the full Venice catalog (agent-capable models
 * first — the agent loop needs tool calling) and switches on a number or id.
 * The catalog is fetched live from /models, so new Venice models appear here
 * automatically with no code changes.
 */
async function runModelPicker(state: ReplState): Promise<SlashResult> {
  const { cfg, runtime, rl } = state;

  let models;
  try {
    models = await runtime.provider.getModels();
  } catch (err) {
    console.log(theme.error(`Could not fetch the model catalog: ${(err as Error).message}`));
    console.log(theme.dim("You can still switch directly with /model <id>."));
    return "handled";
  }

  // Cheapest first: on Venice output prices span ~1,700x, so price is the first thing to see.
  const selectable = agentCapableModels(models);
  const excluded = models.length - selectable.length;

  console.log(`Current model: ${theme.bold(cfg.model)}\n`);
  const width = String(selectable.length).length;
  selectable.forEach((m, i) => {
    const marker = m.id === cfg.model ? theme.success("●") : " ";
    const tags = [
      m.supportsReasoning ? "reasoning" : null,
      m.supportsVision ? "vision" : null,
    ].filter(Boolean).join(", ");
    const number = String(i + 1).padStart(width);
    console.log(
      `${marker} ${theme.dim(number)}. ${theme.bold(m.id.padEnd(42))} ${formatPrice(m.pricing)} ${formatContextTokens(m.contextLength).padStart(4)} ctx${tags ? theme.dim(`  [${tags}]`) : ""}`,
    );
  });
  console.log(theme.dim("\nPrices are $ per million tokens, input / output. Agent work is mostly output."));
  if (excluded > 0) {
    console.log(theme.dim(`\n(${excluded} models without tool-calling support hidden — the agent loop requires tools. See /models for everything.)`));
  }

  const answer = (await rl.question("\nSelect a model by number or id (Enter to keep current): ")).trim();
  if (!answer) {
    console.log(theme.dim(`Keeping ${cfg.model}.`));
    return "handled";
  }

  let chosenId = answer;
  if (/^\d+$/.test(answer)) {
    const picked = selectable[Number(answer) - 1];
    if (!picked) {
      console.log(theme.error(`No model numbered ${answer}. Nothing changed.`));
      return "handled";
    }
    chosenId = picked.id;
  }

  await switchModel(state, chosenId);
  return "handled";
}

/** Switches the active model, warning (but not blocking) when the id is unknown or lacks tool support. */
async function switchModel(state: ReplState, id: string): Promise<void> {
  const { cfg, runtime } = state;
  const previous = cfg.model;

  try {
    const caps = await runtime.provider.capabilities(id);
    const before = await runtime.provider.capabilities(previous).catch(() => null);
    const comparison = compareCost(before?.pricing, caps?.pricing, previous);
    if (comparison) console.log(comparison);
    if (!caps) {
      console.log(theme.warning(`"${id}" is not in Venice's current catalog — switching anyway (it may be new or renamed; /models lists what's available).`));
    } else if (!caps.supportsTools) {
      console.log(theme.warning(`"${id}" does not support tool calling — the agent loop will not be able to edit files or run commands with it.`));
    }
  } catch {
    // Catalog unreachable (offline, transient error): don't block a manual switch.
  }

  cfg.model = id;
  runtime.loop.setModel(id);
  console.log(theme.success(`Switched model to ${id}`));
}

/** One-line warning/note when switching changes the price of work noticeably. */
function compareCost(from: TextPricing | null | undefined, to: TextPricing | null | undefined, fromId: string): string | null {
  if (!from || !to || from.output <= 0) return null;
  const ratio = to.output / from.output;
  if (ratio >= 1.5) return theme.warning(`Heads up: ~${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× the cost of ${fromId} for the same work (${formatRate(to.output)} output).`);
  if (ratio <= 0.67) return theme.success(`~${Math.round(1 / ratio)}× cheaper than ${fromId} (${formatRate(to.output)} output).`);
  return null;
}

function printActionResult(result: actions.ActionResult | null, notDetectedMessage: string): void {
  if (!result) {
    console.log(theme.dim(notDetectedMessage));
    return;
  }
  const ok = result.exitCode === 0;
  console.log(`${ok ? theme.success("✓") : theme.error("✗")} ${result.command}  (${result.durationMs}ms, exit ${result.exitCode})`);
  if (result.stdout) console.log(sanitizeForTerminal(result.stdout.slice(-4000)));
  if (result.stderr) console.log(theme.dim(sanitizeForTerminal(result.stderr.slice(-2000))));
}
