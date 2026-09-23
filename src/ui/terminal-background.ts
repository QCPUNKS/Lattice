// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

/**
 * Session background color via OSC 11 (set) / OSC 111 (reset to the user's
 * own configured color). Supported by Kitty, WezTerm, Ghostty, Konsole,
 * GNOME Terminal and xterm; terminals that don't understand it ignore it.
 */

export function setBackgroundSequence(hex: string): string {
  return `\x1b]11;${hex}\x1b\\`;
}

export const RESET_BACKGROUND = "\x1b]111\x1b\\";

/**
 * Applies `hex` and guarantees the reset runs however the process ends
 * (normal exit, Ctrl+C, SIGTERM, uncaught error), so the user's terminal is
 * never left recolored. Returns the restore function (idempotent).
 */
export function applySessionBackground(hex: string, write: (s: string) => void = (s) => process.stdout.write(s)): () => void {
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      write(RESET_BACKGROUND);
    } catch {
      // stdout already gone
    }
  };
  write(setBackgroundSequence(hex));
  process.once("exit", restore);
  return restore;
}
