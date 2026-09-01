// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";

/**
 * Records pre-mutation file state for the current agent turn so changes can
 * be diffed or undone independent of git — important because
 * the user may be working in an uncommitted repo, or no repo at all.
 */
export class TurnSnapshotManager {
  private snapshots = new Map<string, string | null>(); // relPath -> original content, or null if the file didn't exist

  constructor(private workspace: string) {}

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  /** Call once per user turn, before any tool calls run. */
  reset(): void {
    this.snapshots.clear();
  }

  /** Records the pre-mutation content of a path the first time it's touched this turn. */
  async track(relPath: string): Promise<void> {
    if (this.snapshots.has(relPath)) return;
    const abs = path.resolve(this.workspace, relPath);
    try {
      this.snapshots.set(relPath, await fs.readFile(abs, "utf-8"));
    } catch {
      this.snapshots.set(relPath, null); // file did not exist before this turn
    }
  }

  touchedPaths(): string[] {
    return [...this.snapshots.keys()];
  }

  /** Produces a unified diff of every tracked file against its current on-disk content. */
  async diff(specificPath?: string): Promise<string> {
    const paths = specificPath ? [specificPath] : this.touchedPaths();
    const patches: string[] = [];

    for (const relPath of paths) {
      if (!this.snapshots.has(relPath)) {
        if (specificPath) patches.push(`(no tracked changes for ${relPath} in this turn)`);
        continue;
      }
      const before = this.snapshots.get(relPath) ?? "";
      let after = "";
      try {
        after = await fs.readFile(path.resolve(this.workspace, relPath), "utf-8");
      } catch {
        after = ""; // file was deleted
      }
      if (before === after) continue;
      patches.push(createTwoFilesPatch(relPath, relPath, before, after, "before", "after"));
    }

    return patches.join("\n") || "(no changes)";
  }

  /** Restores every tracked file to its pre-turn content (deleting files that didn't exist before). Clears tracking afterward. */
  async undo(): Promise<{ restored: string[]; deleted: string[] }> {
    const restored: string[] = [];
    const deleted: string[] = [];

    for (const [relPath, before] of this.snapshots) {
      const abs = path.resolve(this.workspace, relPath);
      if (before === null) {
        try {
          await fs.unlink(abs);
          deleted.push(relPath);
        } catch {
          // already gone
        }
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, before, "utf-8");
        restored.push(relPath);
      }
    }

    this.reset();
    return { restored, deleted };
  }
}
