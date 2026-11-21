// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { describe, it, expect, vi, afterEach } from "vitest";
import { VeniceHttp, isKeyExhausted } from "../../src/providers/venice-http.js";

/** Fake Venice: answers per key, and records which key signed each request. */
function fakeVenice(responses: Record<string, () => Response>) {
  const seenKeys: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const key = new Headers(init.headers).get("Authorization")!.replace("Bearer ", "");
    seenKeys.push(key);
    return responses[key]();
  }));
  return seenKeys;
}

const ok = () => new Response("{}", { status: 200 });
const outOfCredit = () => new Response('{"error":"Insufficient USD or Diem balance"}', { status: 402 });

afterEach(() => vi.unstubAllGlobals());

describe("isKeyExhausted", () => {
  it("treats out-of-credit and rate limits as exhausted", () => {
    expect(isKeyExhausted(402, "")).toBe(true);
    expect(isKeyExhausted(429, "")).toBe(true);
    expect(isKeyExhausted(403, "API key spending limit reached")).toBe(true);
  });

  it("leaves bad requests and bad keys alone", () => {
    expect(isKeyExhausted(400, "invalid model")).toBe(false);
    expect(isKeyExhausted(401, "Authentication failed")).toBe(false);
    expect(isKeyExhausted(403, "forbidden")).toBe(false);
  });
});

describe("VeniceHttp backup key", () => {
  it("retries the same request on the backup key when the main key is out of credit", async () => {
    const seen = fakeVenice({ main: outOfCredit, backup: ok });
    const http = new VeniceHttp("main", "https://venice.test", "backup");
    const switched = vi.fn();
    http.onKeySwitch(switched);

    const res = await http.request("/chat", { method: "POST", headers: http.jsonHeaders(), body: "{}" });

    expect(res.status).toBe(200);
    expect(seen).toEqual(["main", "backup"]);
    expect(switched).toHaveBeenCalledOnce();
    expect(http.usingBackupKey()).toBe(true);
  });

  it("stays on the backup key for later requests", async () => {
    const seen = fakeVenice({ main: outOfCredit, backup: ok });
    const http = new VeniceHttp("main", "https://venice.test", "backup");
    await http.request("/a", { headers: http.authHeaders() });
    await http.request("/b", { headers: http.authHeaders() });
    expect(seen).toEqual(["main", "backup", "backup"]);
  });

  it("surfaces the error when both keys are exhausted", async () => {
    fakeVenice({ main: outOfCredit, backup: outOfCredit });
    const http = new VeniceHttp("main", "https://venice.test", "backup");
    await expect(http.request("/a", { headers: http.authHeaders() })).rejects.toThrow(/402/);
  });

  it("does not switch keys on a rejected key or a bad request", async () => {
    const seen = fakeVenice({ main: () => new Response("Authentication failed", { status: 401 }), backup: ok });
    const http = new VeniceHttp("main", "https://venice.test", "backup");
    await expect(http.request("/a", { headers: http.authHeaders() })).rejects.toThrow(/401/);
    expect(seen).toEqual(["main"]);
  });

  it("behaves exactly as before without a backup key", async () => {
    const seen = fakeVenice({ main: outOfCredit });
    const http = new VeniceHttp("main", "https://venice.test");
    await expect(http.request("/a", { headers: http.authHeaders() })).rejects.toThrow(/402/);
    expect(seen).toEqual(["main"]);
  });
});
