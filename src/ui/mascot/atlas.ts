// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Entry in assets/mascot/mascot.json, written by scripts/mascot/build_atlas.py. */
export interface AtlasEntry {
  frames: number;
  width: number;
  height: number;
  fps?: number;
  loop?: boolean;
  /** Names for individual frames (expression sets): pick one with `frame`. */
  labels?: string[];
}

interface Manifest {
  version: number;
  animations: Record<string, AtlasEntry>;
  props: Record<string, AtlasEntry>;
}

/** src/ui/mascot and dist/ui/mascot are both three levels below the package root. */
export const DEFAULT_ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../assets/mascot");

export class MascotAtlas {
  private readonly manifest: Manifest;
  private readonly frameCache = new Map<string, Buffer[]>();

  private constructor(
    private readonly dir: string,
    manifest: Manifest,
  ) {
    this.manifest = manifest;
  }

  /** Returns null when the atlas hasn't been built — the mascot then simply stays off. */
  static load(dir = DEFAULT_ASSETS_DIR): MascotAtlas | null {
    const file = path.join(dir, "mascot.json");
    if (!existsSync(file)) return null;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf-8")) as Manifest;
      if (manifest.version !== 1 || typeof manifest.animations !== "object") return null;
      return new MascotAtlas(dir, { ...manifest, props: manifest.props ?? {} });
    } catch {
      return null;
    }
  }

  entry(name: string): AtlasEntry | undefined {
    return this.manifest.animations[name] ?? this.manifest.props[name];
  }

  has(name: string): boolean {
    return this.entry(name) !== undefined;
  }

  names(): string[] {
    return [...Object.keys(this.manifest.animations), ...Object.keys(this.manifest.props)];
  }

  /** PNG bytes for every frame of `name` (read once, then cached). */
  frames(name: string): Buffer[] {
    const cached = this.frameCache.get(name);
    if (cached) return cached;
    const entry = this.entry(name);
    if (!entry) throw new Error(`Unknown mascot animation "${name}".`);
    const frames = Array.from({ length: entry.frames }, (_, i) =>
      readFileSync(path.join(this.dir, "frames", name, `${i}.png`)),
    );
    this.frameCache.set(name, frames);
    return frames;
  }

  /** Index of a labelled frame (e.g. expressions → "listening"), or 0. */
  frameIndex(name: string, label: string): number {
    const index = this.entry(name)?.labels?.indexOf(label) ?? -1;
    return Math.max(0, index);
  }
}
