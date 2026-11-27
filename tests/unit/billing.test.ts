// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs, statSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpendLedger } from "../../src/billing/ledger.js";
import { BudgetGuard, BudgetExceededError, type BudgetConfig } from "../../src/billing/budget.js";
import { MeteredProvider } from "../../src/billing/metered-provider.js";
import { estimateChatCost, parseTextPricing, priceTier, formatUsd } from "../../src/billing/pricing.js";
import { VeniceHttp } from "../../src/providers/venice-http.js";
import type { ModelProvider, StreamEvent } from "../../src/providers/types.js";

let dir: string;
let clock: Date;
const now = () => clock;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-spend-"));
  clock = new Date(2026, 8, 23, 10, 0, 0);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("pricing", () => {
  const pricing = parseTextPricing({
    input: { usd: 0.5 },
    cache_input: { usd: 0.05 },
    output: { usd: 2 },
    extended: { context_token_threshold: 256000, input: { usd: 1.5 }, cache_input: { usd: 0.15 }, output: { usd: 6 } },
  })!;

  it("bills cached prompt tokens at the cache rate", () => {
    // 200k prompt tokens (under the 256k extended threshold), 180k cached, 20k output
    const usd = estimateChatCost(pricing, { promptTokens: 200_000, cachedTokens: 180_000, completionTokens: 20_000, totalTokens: 0 });
    expect(usd).toBeCloseTo(0.02 * 0.5 + 0.18 * 0.05 + 0.02 * 2, 10);
  });

  it("switches to the extended tier past the context threshold", () => {
    const usd = estimateChatCost(pricing, { promptTokens: 300_000, completionTokens: 1000, totalTokens: 0 });
    expect(usd).toBeCloseTo((300_000 * 1.5 + 1000 * 6) / 1e6, 10);
  });

  it("returns null for missing or malformed pricing, and tiers by output price", () => {
    expect(parseTextPricing(undefined)).toBeNull();
    expect(parseTextPricing({ input: { usd: "free" }, output: { usd: 1 } })).toBeNull();
    expect(priceTier(parseTextPricing({ input: { usd: 0.1 }, output: { usd: 0.35 } }))).toBe("budget");
    expect(priceTier(parseTextPricing({ input: { usd: 6 }, output: { usd: 30 } }))).toBe("luxury");
  });

  it("formats tiny charges with enough precision to be honest", () => {
    expect(formatUsd(0.0001754)).toBe("$0.0002");
    expect(formatUsd(0.42)).toBe("$0.420");
    expect(formatUsd(12.3)).toBe("$12.30");
  });
});

describe("SpendLedger", () => {
  it("persists owner-only JSONL per month, numbers only, and reloads it", () => {
    const ledger = new SpendLedger(dir, now);
    ledger.setSession("s1");
    ledger.record({ kind: "chat", model: "m", usd: 0.25, source: "venice", inputTokens: 100, outputTokens: 10 });
    const file = path.join(dir, "2026-09.jsonl");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const line = JSON.parse(readFileSync(file, "utf-8").trim());
    expect(Object.keys(line).sort()).toEqual(["inputTokens", "kind", "model", "outputTokens", "session", "source", "ts", "usd"]);

    const reloaded = new SpendLedger(dir, now);
    expect(reloaded.month()).toEqual({ usd: 0.25, requests: 1 });
  });

  it("separates session, today, and month totals, and ranks models", () => {
    const ledger = new SpendLedger(dir, now);
    ledger.setSession("a");
    ledger.record({ kind: "chat", model: "cheap", usd: 0.01, source: "venice" });
    clock = new Date(2026, 8, 24, 9, 0, 0); // next day
    ledger.setSession("b");
    ledger.record({ kind: "chat", model: "pricey", usd: 1, source: "venice" });
    ledger.record({ kind: "image", model: "z-image-turbo", usd: 0.01, source: "estimate", units: 1 });

    expect(ledger.sessionTotal()).toEqual({ usd: 1.01, requests: 2 });
    expect(ledger.today().usd).toBeCloseTo(1.01);
    expect(ledger.month().usd).toBeCloseTo(1.02);
    expect(ledger.byModel().map((m) => m.model)).toEqual(["pricey", "cheap", "z-image-turbo"]);
  });

  it("starts a fresh month at the boundary", () => {
    const ledger = new SpendLedger(dir, now);
    ledger.record({ kind: "chat", model: "m", usd: 5, source: "venice" });
    clock = new Date(2026, 9, 1, 0, 5, 0);
    expect(ledger.month()).toEqual({ usd: 0, requests: 0 });
    ledger.record({ kind: "chat", model: "m", usd: 1, source: "venice" });
    expect(readFileSync(path.join(dir, "2026-10.jsonl"), "utf-8").trim().split("\n")).toHaveLength(1);
  });

  it("skips a torn line instead of failing to load", async () => {
    await fs.writeFile(path.join(dir, "2026-09.jsonl"), '{"ts":"2026-09-23T10:00:00.000Z","usd":1,"kind":"chat","model":"m","source":"venice","session":"x"}\n{"ts":"2026-09-2');
    expect(new SpendLedger(dir, now).month().usd).toBe(1);
  });
});

describe("BudgetGuard", () => {
  const cfg = (over: Partial<BudgetConfig> = {}): BudgetConfig => ({ dailyUsd: 1, monthlyUsd: undefined, warnAt: 0.8, lowBalanceUsd: 1, ...over });

  it("allows spending under the limit without asking", async () => {
    const ledger = new SpendLedger(dir, now);
    const confirm = vi.fn();
    await new BudgetGuard(cfg(), ledger, confirm, now).beforeSpend();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks once at the limit; yes holds for the rest of the day, and a new day resets it", async () => {
    const ledger = new SpendLedger(dir, now);
    ledger.record({ kind: "chat", model: "m", usd: 1.2, source: "venice" });
    const confirm = vi.fn().mockResolvedValue(true);
    const guard = new BudgetGuard(cfg(), ledger, confirm, now);
    await guard.beforeSpend();
    await guard.beforeSpend();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/Daily budget of \$1\.00 reached \(\$1\.20 spent\)/);

    clock = new Date(2026, 8, 24, 8, 0, 0);
    ledger.record({ kind: "chat", model: "m", usd: 1.5, source: "venice" });
    await guard.beforeSpend();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("stops when the user declines, and fails closed non-interactively", async () => {
    const ledger = new SpendLedger(dir, now);
    ledger.record({ kind: "chat", model: "m", usd: 1, source: "venice" });
    await expect(new BudgetGuard(cfg(), ledger, async () => false, now).beforeSpend()).rejects.toThrow(BudgetExceededError);
    await expect(new BudgetGuard(cfg(), ledger, null, now).beforeSpend()).rejects.toThrow(/Raise \[budget\]/);
  });

  it("warns once when crossing the warning threshold", () => {
    const ledger = new SpendLedger(dir, now);
    const guard = new BudgetGuard(cfg(), ledger, null, now);
    ledger.record({ kind: "chat", model: "m", usd: 0.85, source: "venice" });
    expect(guard.warnings()).toEqual(["85% of your daily budget used ($0.850 of $1.00)."]);
    expect(guard.warnings()).toEqual([]);
  });

  it("flags a low balance", () => {
    const guard = new BudgetGuard(cfg(), new SpendLedger(dir, now), null, now);
    expect(guard.isLowBalance(0.55)).toBe(true);
    expect(guard.isLowBalance(5)).toBe(false);
    expect(guard.isLowBalance(undefined)).toBe(false);
  });
});

describe("MeteredProvider", () => {
  function fakeProvider(usage: StreamEvent): ModelProvider {
    return {
      name: "fake",
      async chat() {
        throw new Error("unused");
      },
      async *stream() {
        yield { type: "text_delta", delta: "hi" };
        yield usage;
      },
      async getModels() {
        return [];
      },
      async supportsTools() {
        return true;
      },
      async supportsReasoning() {
        return false;
      },
      async capabilities() {
        return {
          id: "m",
          contextLength: null,
          supportsTools: true,
          supportsReasoning: false,
          supportsVision: false,
          pricing: { input: 1, output: 10 },
        };
      },
    };
  }

  const drain = async (gen: AsyncGenerator<StreamEvent>) => {
    const out: StreamEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  };

  it("records Venice's reported cost when present", async () => {
    const ledger = new SpendLedger(dir, now);
    const guard = new BudgetGuard({ dailyUsd: undefined, monthlyUsd: undefined, warnAt: 0.8, lowBalanceUsd: 1 }, ledger, null, now);
    const p = new MeteredProvider(fakeProvider({ type: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.0042 } }), ledger, guard, () => "m");
    const events = await drain(p.stream({ messages: [] }));
    expect(events).toHaveLength(2); // passes everything through untouched
    expect(ledger.month()).toEqual({ usd: 0.0042, requests: 1 });
    expect(ledger.byModel()[0]).toMatchObject({ model: "m", kind: "chat" });
  });

  it("falls back to an estimate from published prices", async () => {
    const ledger = new SpendLedger(dir, now);
    const guard = new BudgetGuard({ dailyUsd: undefined, monthlyUsd: undefined, warnAt: 0.8, lowBalanceUsd: 1 }, ledger, null, now);
    const p = new MeteredProvider(fakeProvider({ type: "usage", usage: { promptTokens: 1_000_000, completionTokens: 100_000, totalTokens: 0 } }), ledger, guard, () => "m");
    await drain(p.stream({ messages: [] }));
    expect(ledger.month().usd).toBeCloseTo(1 + 1, 10); // $1/M in + $10/M × 0.1M out
  });

  it("refuses to start a request once the budget is spent", async () => {
    const ledger = new SpendLedger(dir, now);
    ledger.record({ kind: "chat", model: "m", usd: 3, source: "venice" });
    const guard = new BudgetGuard({ dailyUsd: 2, monthlyUsd: undefined, warnAt: 0.8, lowBalanceUsd: 1 }, ledger, null, now);
    const inner = fakeProvider({ type: "done", finishReason: "stop" });
    const streamSpy = vi.spyOn(inner, "stream");
    const p = new MeteredProvider(inner, ledger, guard, () => "m");
    await expect(drain(p.stream({ messages: [] }))).rejects.toThrow(BudgetExceededError);
    expect(streamSpy).not.toHaveBeenCalled(); // no request was sent, nothing was spent
  });
});

describe("balance tracking", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures x-venice-balance-usd from any response and notifies listeners", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "x-venice-balance-usd": "0.55328323" } })));
    const http = new VeniceHttp("k", "https://api.venice.example/api/v1");
    const seen: number[] = [];
    http.onBalance((b) => seen.push(b.usd));
    await http.request("/models", { method: "GET" });
    expect(http.lastBalance()?.usd).toBeCloseTo(0.55328323);
    expect(seen).toEqual([0.55328323]);
  });

  it("reads all balance types from Venice's free rate-limits endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { balances: { USD: 0.55, DIEM: 3, BUNDLED_CREDITS: 0 } } }), { status: 200 })));
    const http = new VeniceHttp("k", "https://api.venice.example/api/v1");
    const reading = await http.refreshBalance();
    expect(reading).toMatchObject({ usd: 0.55, diem: 3, bundledCredits: 0 });
  });
});
