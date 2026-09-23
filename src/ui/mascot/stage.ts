// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { ActivityState } from "../activity.js";
import { controlAnimation, freeImageRange, placeImage, removePlacement, uploadAnimation } from "../kitty-graphics.js";
import type { MascotAtlas } from "./atlas.js";
import { POSES, type Pose } from "./choreography.js";

/**
 * Image ids Lattice owns in the terminal. A fixed, unusual range so they
 * never collide with images other programs in the same window upload.
 */
export const IMAGE_ID_BASE = 0x4c4100; // "LA"
const IMAGE_ID_SPAN = 0xff;
const STAGE_PLACEMENT = 1;

/** Cell height ÷ width. Kitty's default fonts sit around 2.0–2.2; overestimating only widens the label gap. */
const CELL_ASPECT = 2.2;
const LEFT_MARGIN = 2;
const LABEL_GAP = 2;

export interface StageOptions {
  rows: number;
  reducedMotion: boolean;
  write: (s: string) => void;
  /** Current terminal width, for fitting the label. */
  terminalColumns: () => number;
  /** Decorates the label text (colors); identity by default. */
  styleLabel?: (s: string) => string;
}

interface UploadedPose {
  id: number;
  /** Width in cells at the stage height. */
  columns: number;
}

/**
 * The mascot's on-screen stage: a block of rows reserved at the cursor, the
 * animated sprite at its left, a status label beside it. Animation runs
 * inside the terminal (no timers here); switching poses swaps a placement of
 * an already-uploaded image, so it's instant.
 *
 * While shown, the cursor is parked at the stage's top-left; hide() erases
 * the stage and leaves the cursor there, so following output reuses the space.
 */
export class MascotStage {
  private uploaded = new Map<string, UploadedPose>();
  private nextId = IMAGE_ID_BASE;
  private shownId: number | null = null;
  private labelColumn = 0;

  constructor(
    private readonly atlas: MascotAtlas,
    private readonly opts: StageOptions,
  ) {}

  get isShown(): boolean {
    return this.shownId !== null;
  }

  show(state: ActivityState, label: string): void {
    this.showPose(state, POSES[state], label);
  }

  /** Shows any pose (used by previews and one-off moments beyond the activity table). */
  showPose(key: string, pose: Pose, label: string): void {
    const uploaded = this.upload(key, pose);
    const { write, rows } = this.opts;
    let out = "";
    if (this.shownId === null) {
      // Reserve rows (scrolling if at the bottom), return to their top-left, remember it.
      out += `\r${"\n".repeat(rows)}\x1b[${rows}A\x1b7`;
    } else {
      out += removePlacement(this.shownId, STAGE_PLACEMENT);
    }
    out += `\x1b8\x1b[${LEFT_MARGIN}C`;
    out += placeImage({ id: uploaded.id, placementId: STAGE_PLACEMENT, rows });
    out += controlAnimation(uploaded.id, this.opts.reducedMotion ? "still" : pose.playback);
    out += "\x1b8";
    this.shownId = uploaded.id;
    this.labelColumn = LEFT_MARGIN + uploaded.columns + LABEL_GAP;
    write(out);
    this.setLabel(label);
  }

  setLabel(label: string): void {
    if (this.shownId === null) return;
    const row = Math.floor((this.opts.rows - 1) / 2);
    const room = Math.max(8, this.opts.terminalColumns() - this.labelColumn - 1);
    const fitted = label.length > room ? `${label.slice(0, room - 1)}…` : label;
    const styled = this.opts.styleLabel ? this.opts.styleLabel(fitted) : fitted;
    this.opts.write(`\x1b8${row > 0 ? `\x1b[${row}B` : ""}\x1b[${this.labelColumn}C\x1b[K${styled}\x1b8`);
  }

  hide(): void {
    if (this.shownId === null) return;
    let out = removePlacement(this.shownId, STAGE_PLACEMENT) + "\x1b8";
    for (let r = 0; r < this.opts.rows; r++) out += `\x1b[2K${r < this.opts.rows - 1 ? "\x1b[1B" : ""}`;
    out += "\x1b8";
    this.opts.write(out);
    this.shownId = null;
  }

  /** Frees every image Lattice uploaded (call on exit). */
  dispose(): void {
    this.hide();
    if (this.uploaded.size > 0) this.opts.write(freeImageRange(IMAGE_ID_BASE, IMAGE_ID_BASE + IMAGE_ID_SPAN));
    this.uploaded.clear();
  }

  /** Uploads a pose's frames once; later shows reuse the terminal-side copy. */
  private upload(key: string, pose: Pose): UploadedPose {
    const existing = this.uploaded.get(key);
    if (existing) return existing;
    const entry = this.atlas.entry(pose.animation);
    if (!entry) throw new Error(`Mascot animation "${pose.animation}" isn't in the atlas.`);

    const all = this.atlas.frames(pose.animation);
    const frames = pose.frames
      ? pose.frames.map((f) => all[typeof f === "number" ? f : this.atlas.frameIndex(pose.animation, f)]).filter(Boolean)
      : all;
    const fps = pose.fps ?? entry.fps ?? 4;
    const id = this.nextId++;
    if (id > IMAGE_ID_BASE + IMAGE_ID_SPAN) throw new Error("Mascot image id range exhausted.");

    this.opts.write(uploadAnimation({ id, frames, frameMs: Math.round(1000 / fps) }));
    const uploaded = {
      id,
      columns: Math.ceil(this.opts.rows * CELL_ASPECT * (entry.width / entry.height)),
    };
    this.uploaded.set(key, uploaded);
    return uploaded;
  }
}
