// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

/**
 * Inline images via the Kitty graphics protocol
 * (https://sw.kovidgoyal.net/kitty/graphics-protocol/). Supported by Kitty,
 * WezTerm, Ghostty, and Konsole ≥ 22.04; everything else gets a text fallback
 * from the caller, never raw escape codes.
 */

const CHUNK_SIZE = 4096; // protocol maximum payload per escape sequence

export function supportsKittyGraphics(env: NodeJS.ProcessEnv = process.env, isTTY = Boolean(process.stdout.isTTY)): boolean {
  if (!isTTY) return false;
  if (env.LATTICE_INLINE_IMAGES === "0") return false;
  if (env.LATTICE_INLINE_IMAGES === "1") return true;
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return true;
  if (env.TERM_PROGRAM === "WezTerm" || env.TERM_PROGRAM === "ghostty") return true;
  if (env.KONSOLE_VERSION && Number(env.KONSOLE_VERSION) >= 220400) return true;
  return false;
}

type Controls = Record<string, string | number>;

function serialize(controls: Controls): string {
  return Object.entries(controls)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

/**
 * One graphics command. A payload is base64-encoded and split into
 * ≤4096-byte chunks (m=1 on all but the last); the control keys go on the
 * first chunk. q=2 is on every chunk so the terminal never writes OK/error
 * replies into stdin, where they'd corrupt the prompt.
 *
 * Animation frames (a=f) must repeat a=f on every chunk — the protocol says
 * so, and without it Kitty reads the continuation chunks as a plain upload
 * that overwrites the root image (every frame collapses into the last one).
 */
export function kittyCommand(controls: Controls, payload?: Buffer): string {
  const base = { ...controls, q: 2 };
  if (!payload) return `\x1b_G${serialize(base)}\x1b\\`;
  const continuation: Controls = controls.a === "f" ? { a: "f", q: 2 } : { q: 2 };
  const b64 = payload.toString("base64");
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
    const more = i + CHUNK_SIZE < b64.length ? 1 : 0;
    const control = serialize({ ...(i === 0 ? base : continuation), m: more });
    parts.push(`\x1b_G${control};${b64.slice(i, i + CHUNK_SIZE)}\x1b\\`);
  }
  return parts.join("");
}

/** Transmits and displays a PNG at the cursor, `columns` cells wide (height follows the aspect ratio). */
export function encodeKittyPng(png: Buffer, columns: number): string {
  return kittyCommand({ a: "T", f: 100, c: columns }, png);
}

/** Picks a display width that fits the terminal without dominating it. */
export function inlineImageColumns(terminalColumns: number | undefined, count: number): number {
  const available = Math.max(20, (terminalColumns || 80) - 4); // 0 = unknown width (e.g. a bare pty)
  const perImage = count > 1 ? Math.floor(available / Math.min(count, 2)) : available;
  return Math.min(perImage, 64);
}

export interface AnimationUpload {
  /** Stable image id (1…4294967295) the animation is referenced by afterwards. */
  id: number;
  /** PNG frames, all the same pixel size. */
  frames: Buffer[];
  /** Milliseconds each frame is shown. */
  frameMs: number;
}

/**
 * Uploads an animation without displaying it: the root frame, the remaining
 * frames with their gap, then the root frame's gap (the protocol can't set
 * it at creation). Placing it later is cheap and instant.
 */
export function uploadAnimation({ id, frames, frameMs }: AnimationUpload): string {
  if (frames.length === 0) throw new Error("An animation needs at least one frame.");
  const out = [kittyCommand({ a: "t", f: 100, i: id }, frames[0])];
  for (const frame of frames.slice(1)) out.push(kittyCommand({ a: "f", f: 100, i: id, z: frameMs }, frame));
  if (frames.length > 1) out.push(kittyCommand({ a: "a", i: id, r: 1, z: frameMs }));
  return out.join("");
}

export type Playback = "loop" | "once" | "still";

/**
 * Terminal-driven playback, so animating costs Lattice no CPU:
 * "loop" repeats forever; "once" plays through and holds the last frame
 * (loading mode, waiting for frames that never come); "still" stops on the
 * first frame (reduced motion).
 */
export function controlAnimation(id: number, playback: Playback): string {
  if (playback === "still") return kittyCommand({ a: "a", i: id, s: 1, c: 1 });
  if (playback === "once") return kittyCommand({ a: "a", i: id, s: 2 });
  return kittyCommand({ a: "a", i: id, s: 3, v: 1 });
}

export interface Placement {
  id: number;
  placementId: number;
  /** Height in cells; width follows the image's aspect ratio. */
  rows: number;
  /** Stacking order; negative draws beneath text. */
  z?: number;
  /** Optional source crop in image pixels. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Explicit width in cells (with rows, the image is scaled to fill the box). */
  columns?: number;
}

/** Shows an uploaded image at the cursor without moving the cursor (C=1). */
export function placeImage(p: Placement): string {
  const controls: Controls = { a: "p", i: p.id, p: p.placementId, r: p.rows, C: 1 };
  if (p.columns) controls.c = p.columns;
  if (p.z !== undefined) controls.z = p.z;
  if (p.crop) Object.assign(controls, { x: p.crop.x, y: p.crop.y, w: p.crop.width, h: p.crop.height });
  return kittyCommand(controls);
}

/** Removes one placement but keeps the image data, so it can be shown again instantly. */
export function removePlacement(id: number, placementId: number): string {
  return kittyCommand({ a: "d", d: "i", i: id, p: placementId });
}

/** Frees images in an id range (inclusive), e.g. everything Lattice uploaded, on exit. */
export function freeImageRange(fromId: number, toId: number): string {
  return kittyCommand({ a: "d", d: "R", x: fromId, y: toId });
}
