// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { UiConfig } from "../../config/index.js";
import { controlAnimation, freeImageRange, placeImage, supportsKittyGraphics, uploadAnimation } from "../kitty-graphics.js";
import { theme } from "../theme.js";
import { MascotAtlas } from "./atlas.js";
import { MascotStage, IMAGE_ID_BASE } from "./stage.js";

/** Banner images use ids just above the stage's range. */
const BANNER_ID = IMAGE_ID_BASE + 0xf0;
const BACKDROP_ID = BANNER_ID + 1;
const BANNER_PLACEMENT = 1;
/** Inline stills (token bag, previews) live in scrollback; they get their own id range. */
const INLINE_ID_BASE = IMAGE_ID_BASE + 0x100;
const INLINE_ID_SPAN = 0x100;
const CELL_ASPECT = 2.2;

export interface DirectorIO {
  write: (s: string) => void;
  terminalColumns: () => number;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

/**
 * Owns everything the mascot does: the activity stage and the startup
 * banner (intro climb + starfield backdrop behind the title). Exists only
 * when the mascot is enabled, the atlas is built, and the terminal speaks
 * the Kitty graphics protocol; otherwise Lattice runs with the plain
 * spinner and text title.
 */
export class MascotDirector {
  readonly stage: MascotStage;
  private inlineCount = 0;

  private constructor(
    private readonly atlas: MascotAtlas,
    private readonly ui: UiConfig,
    private readonly io: DirectorIO,
  ) {
    this.stage = new MascotStage(atlas, {
      rows: ui.mascotRows,
      reducedMotion: ui.reducedMotion,
      write: io.write,
      terminalColumns: io.terminalColumns,
      styleLabel: (s) => `${theme.mascot("♥")} ${theme.dim(s)}`,
    });
  }

  static create(ui: UiConfig, io: DirectorIO, atlas = MascotAtlas.load()): MascotDirector | null {
    if (!ui.mascot || !atlas) return null;
    if (!supportsKittyGraphics(io.env ?? process.env, io.isTTY ?? Boolean(process.stdout.isTTY))) return null;
    return new MascotDirector(atlas, ui, io);
  }

  /** Columns the banner mascot occupies beside a block of `rows` rows. */
  bannerGutter(rows: number): number {
    const entry = this.atlas.entry(this.bannerAnimation());
    if (!entry) return 0;
    return Math.ceil(rows * CELL_ASPECT * (entry.width / entry.height)) + 3;
  }

  /**
   * Prints `lines` (the title block) indented by the mascot gutter, then
   * goes back up to lay the starfield beneath the text (z < 0) and the
   * mascot in the gutter. Cursor movement is relative, so this stays correct
   * even when printing scrolls the screen.
   */
  presentBanner(lines: string[], visibleWidth: number): void {
    const rows = lines.length;
    const gutter = this.bannerGutter(rows);
    const { write } = this.io;
    write(lines.map((l) => " ".repeat(gutter) + l).join("\n") + "\n");

    let out = `\x1b[${rows}A\r`;
    const backdrop = this.atlas.entry("starfield");
    if (backdrop) {
      const columns = Math.min(this.io.terminalColumns() - 1, gutter + visibleWidth + 2);
      out += uploadAnimation({ id: BACKDROP_ID, frames: this.atlas.frames("starfield"), frameMs: 1000 });
      out += placeImage({
        id: BACKDROP_ID,
        placementId: BANNER_PLACEMENT,
        rows,
        columns,
        z: -1,
        crop: cropToAspect(backdrop.width, backdrop.height, columns / (rows * CELL_ASPECT)),
      });
    }

    const name = this.bannerAnimation();
    const entry = this.atlas.entry(name)!;
    out += uploadAnimation({
      id: BANNER_ID,
      frames: this.atlas.frames(name),
      frameMs: Math.round(1000 / (entry.fps ?? 6)),
    });
    out += `\x1b[1C${placeImage({ id: BANNER_ID, placementId: BANNER_PLACEMENT, rows })}`;
    // Play the climb once and hold the final wave; reduced motion shows the wave only.
    out += controlAnimation(BANNER_ID, this.animatesIntro() ? "once" : "still");
    out += `\r\x1b[${rows}B`;
    write(out);
  }

  /**
   * Prints one frame inline, `rows` tall, with a label beside it, and leaves
   * the cursor below — a permanent part of the scrollback, unlike the stage.
   */
  showInline(name: string, frame: number | string, label: string, rows = 4): void {
    const entry = this.atlas.entry(name);
    if (!entry) return;
    const index = typeof frame === "number" ? Math.min(entry.frames - 1, Math.max(0, frame)) : this.atlas.frameIndex(name, frame);
    // Ids cycle; after 256 inline stills the oldest scrollback copy is the one reused.
    const id = INLINE_ID_BASE + (this.inlineCount++ % INLINE_ID_SPAN);
    const columns = Math.ceil(rows * CELL_ASPECT * (entry.width / entry.height));
    const labelRow = Math.floor((rows - 1) / 2);
    let out = uploadAnimation({ id, frames: [this.atlas.frames(name)[index]], frameMs: 1000 });
    out += `\r${"\n".repeat(rows)}\x1b[${rows}A\x1b[2C`;
    out += placeImage({ id, placementId: 1, rows });
    out += `\r${labelRow > 0 ? `\x1b[${labelRow}B` : ""}\x1b[${columns + 4}C${label}\r\x1b[${rows - labelRow}B`;
    this.io.write(out);
  }

  dispose(): void {
    this.stage.dispose();
    if (this.inlineCount > 0) this.io.write(freeImageRange(INLINE_ID_BASE, INLINE_ID_BASE + INLINE_ID_SPAN - 1));
  }

  private animatesIntro(): boolean {
    return this.ui.intro && !this.ui.reducedMotion && this.atlas.has("intro");
  }

  private bannerAnimation(): string {
    return this.animatesIntro() ? "intro" : "wave";
  }
}

/** Largest centered source rectangle with the given width/height ratio. */
export function cropToAspect(width: number, height: number, ratio: number): { x: number; y: number; width: number; height: number } {
  if (width / height > ratio) {
    const w = Math.round(height * ratio);
    return { x: Math.round((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - h) / 2), width, height: h };
}
