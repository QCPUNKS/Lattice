// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseModelSelection } from "../../src/cli/commands/arena.js";
import { parseShapeAnswer } from "../../src/cli/commands/imagine.js";
import { aspectForShape } from "../../src/media/image-service.js";
import { parseImageModel } from "../../src/media/image-catalog.js";
import { resolveParticipant } from "../../src/arena/orchestrator.js";
import type { ArenaParticipantResult, ArenaRun } from "../../src/arena/store.js";

const CATALOG = ["qwen3-coder", "deepseek-v4-flash", "glm-5", "kimi-k3"];

describe("parseModelSelection", () => {
  it("reads numbers separated by spaces or commas", () => {
    expect(parseModelSelection("1 3", CATALOG)).toEqual({ ok: true, models: ["qwen3-coder", "glm-5"] });
    expect(parseModelSelection("2,4", CATALOG)).toEqual({ ok: true, models: ["deepseek-v4-flash", "kimi-k3"] });
    expect(parseModelSelection(" 1, 2 ,3 ", CATALOG)).toEqual({ ok: true, models: CATALOG.slice(0, 3) });
  });

  it("accepts model ids mixed with numbers and drops duplicates", () => {
    expect(parseModelSelection("1 some-new-model 1", CATALOG)).toEqual({ ok: true, models: ["qwen3-coder", "some-new-model"] });
  });

  it("rejects numbers outside the list and fewer than two models", () => {
    expect(parseModelSelection("1 9", CATALOG)).toMatchObject({ ok: false, error: expect.stringContaining("no model number 9") });
    expect(parseModelSelection("2", CATALOG)).toMatchObject({ ok: false });
    expect(parseModelSelection("3 3", CATALOG)).toMatchObject({ ok: false });
  });

  it("works with ids alone when the catalog could not be loaded", () => {
    expect(parseModelSelection("a,b", [])).toEqual({ ok: true, models: ["a", "b"] });
    expect(parseModelSelection("1 2", [])).toMatchObject({ ok: false });
  });
});

describe("parseShapeAnswer", () => {
  it("maps numbers, words and initials", () => {
    expect(parseShapeAnswer("1")).toBe("square");
    expect(parseShapeAnswer("2")).toBe("wide");
    expect(parseShapeAnswer(" Tall ")).toBe("tall");
    expect(parseShapeAnswer("w")).toBe("wide");
  });

  it("treats Enter as 'the usual' and anything else as invalid", () => {
    expect(parseShapeAnswer("")).toBeNull();
    expect(parseShapeAnswer("7")).toBe("invalid");
  });
});

function imageModel(aspectRatios: string[], defaultAspectRatio: string) {
  return parseImageModel({ id: "m", model_spec: { constraints: { aspectRatios, defaultAspectRatio } } });
}

describe("aspectForShape", () => {
  it("uses the standard ratio when the model has it", () => {
    const model = imageModel(["1:1", "16:9", "9:16"], "1:1");
    expect(aspectForShape(model, "wide")).toBe("16:9");
    expect(aspectForShape(model, "tall")).toBe("9:16");
    expect(aspectForShape(model, "square")).toBe("1:1");
  });

  it("falls back to the widest or tallest ratio the model offers", () => {
    const model = imageModel(["1:1", "4:3", "3:2", "2:3", "3:4"], "1:1");
    expect(aspectForShape(model, "wide")).toBe("3:2");
    expect(aspectForShape(model, "tall")).toBe("2:3");
  });

  it("uses the model default when nothing fits the shape", () => {
    expect(aspectForShape(imageModel(["1:1"], "1:1"), "wide")).toBe("1:1");
  });

  it("passes the standard ratio through for pixel-sized models", () => {
    const pixel = parseImageModel({ id: "p", model_spec: { constraints: { widthHeightDivisor: 8 } } });
    expect(aspectForShape(pixel, "tall")).toBe("9:16");
  });
});

describe("resolveParticipant", () => {
  const participant = (label: string) => ({ label }) as ArenaParticipantResult;
  const run = { id: "r1", results: [participant("qwen3-coder"), participant("glm-5")] } as ArenaRun;

  it("finds a participant by scorecard number or by label", () => {
    expect(resolveParticipant(run, "2").label).toBe("glm-5");
    expect(resolveParticipant(run, "qwen3-coder").label).toBe("qwen3-coder");
  });

  it("names the valid choices when nothing matches", () => {
    expect(() => resolveParticipant(run, "3")).toThrow(/1 \(qwen3-coder\), 2 \(glm-5\)/);
  });
});
