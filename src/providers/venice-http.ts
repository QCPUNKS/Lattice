// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { ProviderError } from "./types.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

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

  constructor(
    private readonly apiKey: string,
    readonly baseUrl: string,
  ) {
    if (!apiKey) {
      throw new ProviderError(
        "VENICE_API_KEY is not set. Export it or add it to .env before running lattice.",
      );
    }
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
        const res = await fetch(url, { ...init, signal });
        this.observe(res);
        if (res.ok) return res;

        const bodyText = await res.text().catch(() => "");
        const retryable = RETRYABLE_STATUS.has(res.status);

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
