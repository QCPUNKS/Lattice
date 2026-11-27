// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { ProviderError } from "./types.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

/**
 * Responses that mean "this key can't go on" rather than "this request is bad":
 * out of credit (402), rate-limited (429), or a 403 that names a spending limit.
 * Any of them moves Lattice to the backup key, when one is configured.
 */
export function isKeyExhausted(status: number, body: string): boolean {
  if (status === 402 || status === 429) return true;
  return status === 403 && /limit|quota|balance|credit|insufficient/i.test(body);
}

/** Same request, signed with a different key. Only an existing Authorization header is replaced. */
function withApiKey(init: RequestInit, apiKey: string): RequestInit {
  const bearer = `Bearer ${apiKey}`;
  const { headers } = init;
  if (!headers) return init;

  if (headers instanceof Headers || Array.isArray(headers)) {
    const copy = new Headers(headers);
    if (!copy.has("Authorization")) return init;
    copy.set("Authorization", bearer);
    return { ...init, headers: copy };
  }

  // Plain object (what authHeaders()/jsonHeaders() build): keep its shape and key casing.
  const name = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
  if (!name || headers[name] === bearer) return init;
  return { ...init, headers: { ...headers, [name]: bearer } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BalanceReading {
  usd: number;
  /** Venice's other credit types, when a full balance query reported them. */
  diem?: number;
  bundledCredits?: number;
  at: Date;
}

/**
 * Venice API credentials + endpoint shared by chat, image, and audio clients.
 * Constructing one validates the key and base URL once, up front.
 *
 * Every Venice response carries the account balance (x-venice-balance-usd);
 * it's captured here so any request keeps the balance current for free.
 */
export class VeniceHttp {
  private balance: BalanceReading | null = null;
  private balanceListeners: ((reading: BalanceReading) => void)[] = [];
  private keySwitchListeners: ((reason: string) => void)[] = [];
  private readonly keys: string[];
  private activeKey = 0;

  /**
   * `backupApiKey` takes over for the rest of the process once the main key is
   * exhausted (see isKeyExhausted). The next launch starts on the main key again,
   * so a key whose credit resets daily is used first whenever it can be.
   */
  constructor(
    apiKey: string,
    readonly baseUrl: string,
    backupApiKey?: string,
  ) {
    if (!apiKey) {
      throw new ProviderError(
        "VENICE_API_KEY is not set. Export it or add it to .env before running lattice.",
      );
    }
    this.keys = backupApiKey && backupApiKey !== apiKey ? [apiKey, backupApiKey] : [apiKey];
  }

  private get apiKey(): string {
    return this.keys[this.activeKey];
  }

  /** True once requests are being signed with the backup key. */
  usingBackupKey(): boolean {
    return this.activeKey > 0;
  }

  /** Called once, with Venice's reason, when Lattice moves to the backup key. */
  onKeySwitch(listener: (reason: string) => void): void {
    this.keySwitchListeners.push(listener);
  }

  /** Moves to the next key if there is one. Returns false when none is left. */
  private switchToNextKey(reason: string): boolean {
    if (this.activeKey + 1 >= this.keys.length) return false;
    this.activeKey++;
    this.balance = null; // the old key's balance says nothing about the new one
    for (const listener of this.keySwitchListeners) listener(reason);
    return true;
  }

  authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  jsonHeaders(): Record<string, string> {
    return this.authHeaders({ "Content-Type": "application/json" });
  }

  /** Most recent balance Venice reported, or null before the first response. */
  lastBalance(): BalanceReading | null {
    return this.balance;
  }

  onBalance(listener: (reading: BalanceReading) => void): void {
    this.balanceListeners.push(listener);
  }

  /** Asks Venice for all balances directly (free; no usage charged). */
  async refreshBalance(signal?: AbortSignal): Promise<BalanceReading | null> {
    const res = await this.request("/api_keys/rate_limits", { method: "GET", headers: this.authHeaders() }, signal);
    const body: any = await res.json();
    const balances = body?.data?.balances;
    if (typeof balances?.USD !== "number") return this.balance;
    this.setBalance({
      usd: balances.USD,
      ...(typeof balances.DIEM === "number" ? { diem: balances.DIEM } : {}),
      ...(typeof balances.BUNDLED_CREDITS === "number" ? { bundledCredits: balances.BUNDLED_CREDITS } : {}),
      at: new Date(),
    });
    return this.balance;
  }

  private setBalance(reading: BalanceReading): void {
    this.balance = reading;
    for (const listener of this.balanceListeners) listener(reading);
  }

  private observe(res: Response): void {
    const raw = res.headers.get("x-venice-balance-usd");
    const usd = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(usd)) return;
    // Response headers only carry USD; keep the other credit types from the last full query.
    this.setBalance({ ...this.balance, usd, at: new Date() });
  }

  /**
   * fetch() with exponential backoff on 429/5xx and network failures. Honors
   * Retry-After. Non-retryable HTTP errors surface immediately as ProviderError
   * with the response body, so callers see Venice's actual complaint.
   */
  async request(pathOrUrl: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { ...withApiKey(init, this.apiKey), signal });
        this.observe(res);
        if (res.ok) return res;

        const bodyText = await res.text().catch(() => "");
        const retryable = RETRYABLE_STATUS.has(res.status);

        // Main key out of credit or rate-limited: retry right away on the backup
        // key. This doesn't use up a retry, since it's a different key.
        if (isKeyExhausted(res.status, bodyText) && this.switchToNextKey(`${res.status} ${bodyText || res.statusText}`.trim())) {
          attempt--;
          continue;
        }

        if (retryable && attempt < MAX_RETRIES) {
          const retryAfter = res.headers.get("retry-after");
          const waitMs = retryAfter ? Number(retryAfter) * 1000 : BASE_BACKOFF_MS * 2 ** attempt;
          await sleep(waitMs);
          continue;
        }

        throw new ProviderError(
          `Venice API error ${res.status}: ${bodyText || res.statusText}`,
          res.status,
          retryable,
        );
      } catch (err) {
        if (err instanceof ProviderError) {
          lastErr = err;
          if (!err.retryable || attempt >= MAX_RETRIES) throw err;
          continue;
        }
        // Network-level failure (DNS, connection reset, abort, etc.)
        if ((err as Error)?.name === "AbortError") {
          throw new ProviderError("Request cancelled", undefined, false, err);
        }
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        throw new ProviderError(
          `Network error contacting Venice API: ${(err as Error).message}`,
          undefined,
          false,
          err,
        );
      }
    }
    throw new ProviderError("Exhausted retries contacting Venice API", undefined, false, lastErr);
  }
}
