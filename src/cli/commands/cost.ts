// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { BudgetGuard } from "../../billing/budget.js";
import type { SpendLedger, SpendKind } from "../../billing/ledger.js";
import { formatUsd } from "../../billing/pricing.js";
import type { BalanceReading } from "../../providers/venice-http.js";
import { theme } from "../../ui/theme.js";

const BAR_WIDTH = 20;

/** "▓▓▓▓░░░░" filled to `fraction`, colored by how close to the limit. */
export function budgetBar(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * BAR_WIDTH);
  const color = clamped >= 1 ? theme.error : clamped >= 0.8 ? theme.warning : theme.success;
  return color("▓".repeat(filled)) + theme.dim("░".repeat(BAR_WIDTH - filled));
}

const KIND_LABEL: Record<SpendKind, string> = {
  chat: "chat",
  image: "images",
  speech: "voice out",
  transcription: "voice in",
};

function timeAgo(at: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function renderCostReport(ledger: SpendLedger, budget: BudgetGuard, balance: BalanceReading | null): string {
  const lines: string[] = [];
  const { dailyUsd, monthlyUsd } = budget.config;

  if (balance) {
    const low = budget.isLowBalance(balance.usd);
    const amount = low ? theme.warning(formatUsd(balance.usd)) : theme.bold(formatUsd(balance.usd));
    lines.push(`${theme.dim("Venice balance ")}  ${amount}  ${theme.dim(`(${timeAgo(balance.at)})`)}${low ? theme.warning("  low — top up at venice.ai") : ""}`);
    const extras = [
      balance.diem ? `${balance.diem} DIEM` : null,
      balance.bundledCredits ? `${formatUsd(balance.bundledCredits)} bundled credits` : null,
    ].filter(Boolean);
    if (extras.length > 0) lines.push(`${theme.dim("               ")}  ${theme.dim(`+ ${extras.join(" · ")}`)}`);
  } else {
    lines.push(`${theme.dim("Venice balance ")}  ${theme.dim("known after the first request")}`);
  }
  lines.push("");

  const session = ledger.sessionTotal();
  lines.push(`${theme.dim("This session   ")}  ${formatUsd(session.usd).padEnd(9)} ${theme.dim(`${session.requests} requests`)}`);

  const today = ledger.today();
  const todayBudget = dailyUsd ? `  ${budgetBar(today.usd / dailyUsd)} ${theme.dim(`of ${formatUsd(dailyUsd)}/day`)}` : "";
  lines.push(`${theme.dim("Today          ")}  ${formatUsd(today.usd).padEnd(9)}${todayBudget}`);

  const month = ledger.month();
  const monthBudget = monthlyUsd ? `  ${budgetBar(month.usd / monthlyUsd)} ${theme.dim(`of ${formatUsd(monthlyUsd)}/month`)}` : "";
  lines.push(`${theme.dim("This month     ")}  ${formatUsd(month.usd).padEnd(9)}${monthBudget}`);

  const models = ledger.byModel();
  if (models.length > 0) {
    lines.push("", theme.dim("This month by model"));
    const top = models.slice(0, 8);
    const widest = Math.max(...top.map((m) => m.model.length));
    for (const m of top) {
      const share = month.usd > 0 ? Math.round((m.usd / month.usd) * 100) : 0;
      lines.push(`  ${m.model.padEnd(widest)}  ${formatUsd(m.usd).padStart(8)}  ${theme.dim(`${String(share).padStart(3)}%  ${KIND_LABEL[m.kind]}, ${m.requests}×`)}`);
    }
    if (models.length > top.length) lines.push(theme.dim(`  …and ${models.length - top.length} more`));
  }

  if (!dailyUsd && !monthlyUsd) {
    lines.push("", theme.dim("No budget set. Add to ~/.config/lattice/config.toml:  [budget]  daily_usd = 2.00  monthly_usd = 20.00"));
  }
  return lines.join("\n");
}
