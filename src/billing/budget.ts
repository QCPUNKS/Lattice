// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { SpendLedger } from "./ledger.js";
import { formatUsd } from "./pricing.js";

export interface BudgetConfig {
  /** Daily spend limit in USD; undefined = no daily limit. */
  dailyUsd: number | undefined;
  /** Monthly spend limit in USD; undefined = no monthly limit. */
  monthlyUsd: number | undefined;
  /** Fraction of a limit at which to warn once (e.g. 0.8). */
  warnAt: number;
  /** Warn when the Venice balance drops below this. */
  lowBalanceUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

type Period = "daily" | "monthly";

function periodKey(period: Period, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const month = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  return period === "monthly" ? month : `${month}-${p(d.getDate())}`;
}

/**
 * Keeps spending inside the user's limits. Checked before every paid
 * request (not once per turn), so a long agent run can't blow through a
 * limit between checks. Going over is the user's call: they're asked once,
 * and a "yes" holds for the rest of that day/month.
 */
export class BudgetGuard {
  private approvedOver = new Set<string>();
  private warned = new Set<string>();

  constructor(
    private readonly cfg: BudgetConfig,
    private readonly ledger: SpendLedger,
    /** Asks the user a yes/no question; null when non-interactive (then over-budget fails closed). */
    private readonly confirm: ((question: string) => Promise<boolean>) | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get config(): BudgetConfig {
    return this.cfg;
  }

  /** Throws BudgetExceededError if a limit is reached and the user doesn't approve going over. */
  async beforeSpend(): Promise<void> {
    for (const period of ["daily", "monthly"] as const) {
      const limit = period === "daily" ? this.cfg.dailyUsd : this.cfg.monthlyUsd;
      if (limit === undefined) continue;
      const spent = period === "daily" ? this.ledger.today().usd : this.ledger.month().usd;
      if (spent < limit) continue;

      const key = periodKey(period, this.now());
      if (this.approvedOver.has(key)) continue;

      const message = `${period === "daily" ? "Daily" : "Monthly"} budget of ${formatUsd(limit)} reached (${formatUsd(spent)} spent).`;
      if (!this.confirm) throw new BudgetExceededError(`${message} Raise [budget] in ~/.config/lattice/config.toml to continue.`);
      if (!(await this.confirm(`${message} Keep going for the rest of the ${period === "daily" ? "day" : "month"}?`))) {
        throw new BudgetExceededError(`${message} Stopped — nothing more will be spent.`);
      }
      this.approvedOver.add(key);
    }
  }

  /** Warnings newly crossed since the last call (each fires once per period). */
  warnings(): string[] {
    const out: string[] = [];
    for (const period of ["daily", "monthly"] as const) {
      const limit = period === "daily" ? this.cfg.dailyUsd : this.cfg.monthlyUsd;
      if (limit === undefined || limit <= 0) continue;
      const spent = period === "daily" ? this.ledger.today().usd : this.ledger.month().usd;
      const key = `${periodKey(period, this.now())}:warn`;
      if (spent >= limit * this.cfg.warnAt && spent < limit && !this.warned.has(key)) {
        this.warned.add(key);
        out.push(`${Math.round((spent / limit) * 100)}% of your ${period} budget used (${formatUsd(spent)} of ${formatUsd(limit)}).`);
      }
    }
    return out;
  }

  isLowBalance(balanceUsd: number | undefined): boolean {
    return balanceUsd !== undefined && balanceUsd < this.cfg.lowBalanceUsd;
  }
}
