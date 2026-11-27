// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { theme } from "./theme.js";
import { sanitizeForTerminal } from "./sanitize.js";
import { FEATURES } from "./features.js";

/**
 * What Lattice is doing right now. This is the single source of truth the
 * status line (and, later, the mascot) animates from — callers report state,
 * they never draw animation frames themselves.
 */
export type ActivityState =
  | "idle"
  | "thinking"
  | "reading"
  | "typing"
  | "running"
  | "waiting"
  | "listening"
  | "transcribing"
  | "speaking"
  | "painting"
  | "celebrate"
  | "oops";

/** The subset of the mascot stage startActivity needs; set once at startup when the mascot is enabled. */
export interface ActivityStage {
  show(state: ActivityState, label: string): void;
  setLabel(label: string): void;
  hide(): void;
}

let stage: ActivityStage | null = null;
/** Below this width the stage would crowd its label; the spinner is used instead. */
const MIN_STAGE_COLUMNS = 50;
/** Increments on every start, so a superseded handle's stop() can't hide its successor. */
let generation = 0;

export function setActivityStage(next: ActivityStage | null): void {
  stage?.hide();
  stage = next;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;

interface SpinnerStyle {
  frames: string[];
  color: (text: string) => string;
}

const DEFAULT_SPINNER: SpinnerStyle = { frames: SPINNER_FRAMES, color: theme.primary };

/** Feature states wear their feature's accent (and motion), so the spinner alone says where you are. */
const SPINNER_BY_STATE: Partial<Record<ActivityState, SpinnerStyle>> = {
  painting: { frames: ["✧", "✦", "✶", "✷", "✸", "✷", "✶", "✦"], color: FEATURES.imagine.accent },
  listening: { frames: ["◉", "◉", "◉", "◎", "○", "◎"], color: FEATURES.voice.accent },
  transcribing: { frames: SPINNER_FRAMES, color: FEATURES.voice.accent },
  speaking: { frames: ["▁", "▃", "▅", "▇", "▅", "▃"], color: FEATURES.voice.accent },
};

export interface ActivityHandle {
  update(label: string): void;
  stop(): void;
}

/**
 * Shows what Lattice is doing: the mascot stage when one is configured,
 * otherwise a single-line spinner on stdout. The spinner doesn't animate when
 * stdout isn't a TTY or LATTICE_REDUCED_MOTION=1 (screen readers re-announce
 * every redraw of an animated line), printing the label once instead.
 */
export function startActivity(state: ActivityState, label: string): ActivityHandle {
  const mine = ++generation;
  if (stage && process.stdout.isTTY && (process.stdout.columns || 80) >= MIN_STAGE_COLUMNS) {
    const active = stage;
    active.show(state, label);
    return {
      update: (next) => {
        if (mine === generation) active.setLabel(next);
      },
      stop: () => {
        if (mine === generation) active.hide();
      },
    };
  }

  const animate = Boolean(process.stdout.isTTY) && process.env.LATTICE_REDUCED_MOTION !== "1";
  if (!animate) {
    console.log(theme.dim(`  ${sanitizeForTerminal(label)}`));
    return { update: () => {}, stop: () => {} };
  }

  let frame = 0;
  let current = label;
  const { frames, color } = SPINNER_BY_STATE[state] ?? DEFAULT_SPINNER;
  const draw = () => {
    const glyph = frames[frame % frames.length];
    process.stdout.write(`\r\x1b[2K  ${color(glyph)} ${theme.dim(sanitizeForTerminal(current).replace(/\n/g, " "))}`);
    frame++;
  };
  draw();
  const timer = setInterval(draw, FRAME_MS);
  timer.unref();

  let stopped = false;
  return {
    update(next: string) {
      current = next;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write("\r\x1b[2K");
    },
  };
}
