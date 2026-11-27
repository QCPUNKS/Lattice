// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { formatOutcome } from "../../src/ui/arena-live.js";
import type { ArenaParticipantResult } from "../../src/arena/store.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function result(overrides: Partial<ArenaParticipantResult>): ArenaParticipantResult {
  return {
    label: "model-a",
    model: "model-a",
    branch: "arena/model-a",
    worktreePath: "/tmp/model-a",
    status: "ok",
    filesChanged: 1,
    insertions: 2,
    deletions: 1,
    tokensUsed: 1000,
    durationMs: 1000,
    testsPassed: null,
    testOutput: "",
    ...overrides,
  };
}

describe("formatOutcome", () => {
  it("calls a participant passed only when its tests passed", () => {
    expect(stripAnsi(formatOutcome(result({ testsPassed: true })))).toBe("✓ passed");
  });

  it("reports failing tests as a failure even though the run finished", () => {
    expect(stripAnsi(formatOutcome(result({ testsPassed: false })))).toBe("✗ tests failed");
  });

  it("stays neutral when there was no test command to judge by", () => {
    expect(stripAnsi(formatOutcome(result({ testsPassed: null })))).toBe("done");
  });

  it("shows the error for a participant that crashed", () => {
    expect(stripAnsi(formatOutcome(result({ status: "error", error: "timeout" })))).toBe("✗ error: timeout");
  });
});
