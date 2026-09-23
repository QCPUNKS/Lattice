// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

/**
 * Terminal output hygiene for text Lattice doesn't control: model replies,
 * tool arguments, tool results (file contents, command output), MCP data.
 *
 * Terminals act on control sequences in what they print. Echoed unfiltered,
 * a file the agent reads could set the clipboard (OSC 52), rewrite the
 * screen, spoof a permission prompt with carriage returns, or — in a
 * terminal with remote control enabled — run commands. Everything untrusted
 * goes through here before it's printed.
 */

// C0 controls except tab and newline, DEL, and the C1 range (0x80–0x9f,
// which includes the single-byte CSI/OSC/DCS/APC introducers).
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
// Bidirectional overrides/isolates: make text display in a different order
// than it executes ("Trojan Source").
const BIDI = /[‪-‮⁦-⁩]/g;

export function sanitizeForTerminal(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(CONTROL, (ch) => (ch === "\x1b" ? "␛" : "")) // show that an escape was there, harmlessly
    .replace(BIDI, "");
}
