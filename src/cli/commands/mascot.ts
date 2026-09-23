// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { LatticeConfig } from "../../config/index.js";
import { setGlobalConfigValue } from "../../config/writer.js";
import type { MascotDirector } from "../../ui/mascot/director.js";
import type { ActivityState } from "../../ui/activity.js";
import { theme } from "../../ui/theme.js";
import { MASCOT_NAME } from "../../ui/mascot/identity.js";

export const MASCOT_USAGE = `Usage (/kit10 works too):
  /mascot          tour ${MASCOT_NAME}'s poses
  /mascot on|off   turn ${MASCOT_NAME} on or off (takes effect next launch)`;

/** Frames of the token-bag sequence that show the bag at rising fullness (4 = first coins, 9 = heaviest). */
const TOKEN_BAG_FRAMES = [3, 4, 5, 6, 7, 8, 9];

/** Picks the token-bag frame for a context-usage fraction: emptier bag, lighter usage. */
export function tokenBagFrame(fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return TOKEN_BAG_FRAMES[Math.min(TOKEN_BAG_FRAMES.length - 1, Math.floor(clamped * TOKEN_BAG_FRAMES.length))];
}

const TOUR: [ActivityState, string][] = [
  ["idle", "idle — waiting for you"],
  ["thinking", "thinking — the model is working"],
  ["reading", "reading — files, search, git"],
  ["typing", "writing — edits and new files"],
  ["running", "running — commands and tests"],
  ["painting", "painting — /imagine"],
  ["listening", "listening — push-to-talk"],
  ["transcribing", "transcribing your voice"],
  ["speaking", "speaking — voice replies"],
  ["waiting", "waiting — needs your permission"],
  ["celebrate", "celebrate"],
  ["oops", "oops — something failed"],
];

const TOUR_STEP_MS = 1600;

export async function runMascotCommand(
  director: MascotDirector | null,
  cfg: LatticeConfig,
  arg: string,
  signal?: AbortSignal,
): Promise<void> {
  const sub = arg.trim();
  if (sub === "on" || sub === "off") {
    cfg.ui.mascot = sub === "on";
    await setGlobalConfigValue(cfg.globalConfigDir, "ui", "mascot", cfg.ui.mascot);
    console.log(theme.success(`${MASCOT_NAME} ${sub}.`) + theme.dim(" Takes effect the next time Lattice starts."));
    return;
  }
  if (sub) {
    console.log(MASCOT_USAGE);
    return;
  }
  if (!director) {
    console.log(
      theme.dim(
        cfg.ui.mascot
          ? `${MASCOT_NAME} needs a terminal with Kitty graphics (Kitty, WezTerm, Ghostty, Konsole ≥ 22.04).`
          : `${MASCOT_NAME} is off. /mascot on to bring her back.`,
      ),
    );
    return;
  }

  try {
    for (const [state, label] of TOUR) {
      if (signal?.aborted) break;
      director.stage.show(state, label);
      await new Promise((resolve) => setTimeout(resolve, TOUR_STEP_MS));
    }
  } finally {
    director.stage.hide();
  }
}
