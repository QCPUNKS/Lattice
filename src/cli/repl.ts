// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import * as readline from "node:readline/promises";
import { sanitizeForTerminal } from "../ui/sanitize.js";
import { stdin, stdout } from "node:process";
import type { LatticeConfig } from "../config/index.js";
import type { Runtime } from "./runtime.js";
import type { ChatMessage } from "../providers/types.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import { renderBanner, prompt, renderStatusBar } from "../ui/terminal.js";
import { renderTitle, TITLE_WIDTH } from "../ui/title.js";
import { MascotDirector } from "../ui/mascot/director.js";
import { activityForTool, labelForTool } from "../ui/mascot/choreography.js";
import { startActivity, setActivityStage, type ActivityHandle, type ActivityState } from "../ui/activity.js";
import { applySessionBackground } from "../ui/terminal-background.js";
import { formatUsd } from "../billing/pricing.js";
import { theme } from "../ui/theme.js";
import { cancelActiveForegroundCommand } from "../tools/shell.js";
import * as sessions from "../sessions/index.js";
import { handleSlashCommand, type ReplState } from "./slash-commands.js";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { estimateHistoryTokens } from "../agent/context.js";
import { ExitCode } from "./exit-codes.js";

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

  const restoreBackground = cfg.ui.background && stdout.isTTY ? applySessionBackground(cfg.ui.background) : null;
  const director = MascotDirector.create(cfg.ui, {
    write: (s) => stdout.write(s),
    terminalColumns: () => stdout.columns || 80,
  });
  const title = renderTitle();
  const titleWidth = TITLE_WIDTH + 3; // + " v3" badge
  if (director && (stdout.columns || 80) >= director.bannerGutter(title.length) + titleWidth + 2) {
    director.presentBanner(title, titleWidth);
  } else {
    console.log(title.map((line) => `  ${line}`).join("\n"));
  }
  setActivityStage(director?.stage ?? null);

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

  const state: ReplState = { cfg, runtime, session, rl, director };
  runtime.spend.ledger.setSession(session.id);
  runtime.voice.warmUp(); // voice mode already on: load local models now, not on the first sentence
  // Know the balance from the start (free call, in the background; never delays startup).
  void runtime.http.refreshBalance().then((balance) => {
    if (balance && runtime.spend.budget.isLowBalance(balance.usd)) {
      console.log(theme.warning(`\n  Venice balance is low: ${formatUsd(balance.usd)}. Top up at venice.ai to avoid interruptions.`));
    }
  }).catch(() => {});

  // One activity at a time; the mascot (or spinner) reflects it.
  let activity: ActivityHandle | null = null;
  let activityState: { state: ActivityState; label: string } | null = null;
  const act = (state: ActivityState, label: string) => {
    activity?.stop();
    activity = startActivity(state, label);
    activityState = { state, label };
  };
  const quiet = () => {
    activity?.stop();
    activity = null;
    activityState = null;
  };
  // Permission prompts print text; step the mascot aside while asking, then bring it back.
  runtime.gate.setPromptHooks({
    beforePrompt: () => {
      const paused = activityState;
      quiet();
      activityState = paused;
    },
    afterPrompt: () => {
      if (activityState) act(activityState.state, activityState.label);
    },
  });

  let currentAbort: AbortController | null = null;
  rl.on("SIGINT", () => {
    quiet();
    const wasSpeaking = runtime.voice.isSpeaking;
    runtime.voice.stopSpeaking();
    if (currentAbort) {
      currentAbort.abort();
      cancelActiveForegroundCommand();
      console.log(theme.warning("\n  Cancelled."));
    } else if (!wasSpeaking) {
      console.log(theme.dim("\n  Nothing to cancel. Ctrl+D or /quit to exit."));
    }
  });

  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  let exitCode: number = ExitCode.SUCCESS;
  let approxTokens = estimateHistoryTokens(session.history);

  /** Push-to-talk capture; returns the transcript or "" when nothing should be sent. */
  const captureVoice = async (): Promise<string> => {
    currentAbort = new AbortController();
    try {
      const transcript = await runtime.voice.captureUtterance(rl, currentAbort.signal);
      if (!transcript) return "";
      console.log(theme.dim("  you said: ") + sanitizeForTerminal(transcript));
      return transcript;
    } catch (err) {
      console.log(theme.error(`  [voice] ${(err as Error).message}`));
      return "";
    } finally {
      currentAbort = null;
    }
  };

  runLoop: while (!closed) {
    let input: string;
    try {
      input = (await rl.question(prompt(runtime.voice.inputEnabled))).trim();
    } catch {
      break; // interface closed mid-question (e.g. Ctrl+D)
    }
    if (closed) break;

    // Enter on an empty line is the push-to-talk key: it first silences
    // Lattice if it's speaking, then (in a voice-input mode) starts recording.
    if (!input) {
      runtime.voice.stopSpeaking();
      if (!runtime.voice.inputEnabled) continue;
      input = await captureVoice();
      if (!input) continue;
    } else if (input === "/talk") {
      input = await captureVoice();
      if (!input) continue;
    }

    if (input.startsWith("/")) {
      // Slash commands that call the network (/imagine) are cancellable with Ctrl+C too.
      currentAbort = new AbortController();
      let result;
      try {
        result = await handleSlashCommand(input, state, currentAbort.signal);
      } finally {
        currentAbort = null;
      }
      if (result === "exit") break runLoop;
      // Every slash command is fully handled here except /retry, which
      // truncates history back to the last user turn and falls through so
      // the agent loop below re-runs it.
      if (input !== "/retry") continue;
    } else {
      state.session.history.push({ role: "user", content: input });
    }

    currentAbort = new AbortController();
    const spentBefore = runtime.spend.ledger.sessionTotal().usd;
    const speech = runtime.voice.beginResponse();
    act("thinking", "thinking…");
    try {
      await runtime.loop.run(state.session.history, runtime.ctx, {
        onTextDelta: (delta) => {
          if (activity) quiet();
          stdout.write(sanitizeForTerminal(delta));
          speech.onText(delta);
        },
        onToolCallStart: (name, args) => {
          speech.onPause();
          quiet();
          console.log();
          console.log(theme.tool(`  → ${sanitizeForTerminal(name)}`) + theme.dim(` ${truncateArgs(sanitizeForTerminal(args))}`));
          act(activityForTool(name), labelForTool(name, args));
        },
        onToolResult: (name, result, isError) => {
          quiet();
          const color = isError ? theme.error : theme.dim;
          console.log(color(`  ${isError ? "✗" : "✓"} ${firstLine(sanitizeForTerminal(result))}`));
          act("thinking", "thinking…");
        },
        onCompaction: (result) => {
          console.log(theme.dim(`  [context compacted: ${result.tokensBefore} → ${result.tokensAfter} approx tokens]`));
        },
        onUsage: (tokens) => {
          approxTokens = tokens;
        },
      }, currentAbort.signal);
      // After Ctrl+C, stay silent — don't release held-back text.
      if (!currentAbort.signal.aborted) speech.onEnd();
      console.log("\n");
    } catch (err) {
      quiet();
      if ((err as Error).name === "BudgetExceededError") {
        console.log(theme.warning(`\n  ${(err as Error).message}\n`));
      } else {
        console.log(theme.error(`\nError: ${(err as Error).message}\n`));
        exitCode = ExitCode.PROVIDER_FAILURE;
      }
    } finally {
      quiet();
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
        spend: spendLine(runtime, runtime.spend.ledger.sessionTotal().usd - spentBefore),
      }),
    );
    for (const warning of runtime.spend.budget.warnings()) console.log(theme.warning(`  ${warning}`));

    await sessions.saveSession(cfg.sessionsDir, state.session).catch(() => {
      // session persistence is best-effort; a failure here shouldn't interrupt the conversation
    });
  }

  runtime.voice.stopSpeaking();
  quiet();
  runtime.gate.setPromptHooks(null);
  setActivityStage(null);
  director?.dispose();
  restoreBackground?.();
  await sessions.saveSession(cfg.sessionsDir, state.session).catch(() => {});
  return exitCode;
}

/** "$0.0031 turn · $0.08 today · bal $4.20", with the balance flagged when low. */
function spendLine(runtime: Runtime, turnUsd: number): string {
  const parts = [theme.mascot(`${formatUsd(turnUsd)} turn`), theme.dim(`${formatUsd(runtime.spend.ledger.today().usd)} today`)];
  const balance = runtime.http.lastBalance();
  if (balance) {
    const low = runtime.spend.budget.isLowBalance(balance.usd);
    parts.push(low ? theme.warning(`bal ${formatUsd(balance.usd)} low`) : theme.dim(`bal ${formatUsd(balance.usd)}`));
  }
  return parts.join(theme.dim(" · "));
}

function truncateArgs(args: string): string {
  return args.length > 100 ? args.slice(0, 100) + "..." : args;
}

function firstLine(s: string): string {
  const line = s.split("\n")[0];
  return line.length > 120 ? line.slice(0, 120) + "..." : line;
}
