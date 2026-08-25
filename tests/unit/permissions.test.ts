// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { PermissionGate, PermissionDeniedError } from "../../src/agent/permissions.js";

function fakeReadline(answer: string) {
  return { question: vi.fn().mockResolvedValue(answer) } as any;
}

describe("PermissionGate", () => {
  it("SAFE mode prompts even for safe-risk writes", async () => {
    const rl = fakeReadline("y");
    const gate = new PermissionGate("safe", rl, () => {});
    await gate.check("write", "src/a.ts");
    expect(rl.question).toHaveBeenCalledTimes(1);
  });

  it("NORMAL mode auto-allows safe-risk writes without prompting", async () => {
    const rl = fakeReadline("y");
    const gate = new PermissionGate("normal", rl, () => {});
    await gate.check("write", "src/a.ts");
    expect(rl.question).not.toHaveBeenCalled();
  });

  it("NORMAL mode prompts for caution-risk exec but AUTO mode does not", async () => {
    const rlNormal = fakeReadline("y");
    const gateNormal = new PermissionGate("normal", rlNormal, () => {});
    await gateNormal.check("exec", "npm install", "caution");
    expect(rlNormal.question).toHaveBeenCalledTimes(1);

    const rlAuto = fakeReadline("y");
    const gateAuto = new PermissionGate("auto", rlAuto, () => {});
    await gateAuto.check("exec", "npm install", "caution");
    expect(rlAuto.question).not.toHaveBeenCalled();
  });

  it("destructive and critical risk always prompt, even in AUTO mode", async () => {
    const rl = fakeReadline("y");
    const gate = new PermissionGate("auto", rl, () => {});
    await gate.check("delete", "important.txt"); // delete defaults to destructive risk
    await gate.check("exec", "sudo rm -rf /", "critical");
    expect(rl.question).toHaveBeenCalledTimes(2);
  });

  it("throws PermissionDeniedError when the user declines", async () => {
    const rl = fakeReadline("n");
    const gate = new PermissionGate("safe", rl, () => {});
    await expect(gate.check("write", "x.ts")).rejects.toThrow(PermissionDeniedError);
  });

  it("caches an 'always' decision for the rest of the session", async () => {
    const rl = fakeReadline("a");
    const gate = new PermissionGate("safe", rl, () => {});
    await gate.check("write", "x.ts");
    await gate.check("write", "y.ts");
    expect(rl.question).toHaveBeenCalledTimes(1);
  });

  it("fails closed (does not hang) when confirmation is required but no readline is available", async () => {
    const gate = new PermissionGate("safe", null, () => {});
    await expect(gate.check("write", "x.ts")).rejects.toThrow(PermissionDeniedError);
  });

  it("does not require a readline interface when nothing needs confirming", async () => {
    const gate = new PermissionGate("auto", null, () => {});
    await expect(gate.check("write", "x.ts")).resolves.toBeUndefined();
  });
});
