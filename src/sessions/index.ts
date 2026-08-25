// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../providers/types.js";
import type { PermissionMode } from "../config/index.js";

export interface StoredSession {
  id: string;
  label?: string;
  workspace: string;
  model: string;
  mode: PermissionMode;
  createdAt: string;
  updatedAt: string;
  history: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  label?: string;
  workspace: string;
  model: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

function timestampId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function createSession(workspace: string, model: string, mode: PermissionMode): StoredSession {
  const now = new Date().toISOString();
  return {
    id: timestampId(),
    workspace,
    model,
    mode,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

function sessionPath(sessionsDir: string, id: string): string {
  // Session ids are generated internally, never from user input, so no traversal risk.
  return path.join(sessionsDir, `${id}.json`);
}

export async function saveSession(sessionsDir: string, session: StoredSession): Promise<void> {
  await fs.mkdir(sessionsDir, { recursive: true });
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(sessionsDir, session.id), JSON.stringify(session, null, 2), "utf-8");
}

export async function loadSession(sessionsDir: string, id: string): Promise<StoredSession> {
  const raw = await fs.readFile(sessionPath(sessionsDir, id), "utf-8");
  return JSON.parse(raw) as StoredSession;
}

export async function deleteSession(sessionsDir: string, id: string): Promise<void> {
  await fs.unlink(sessionPath(sessionsDir, id));
}

export async function listSessions(sessionsDir: string): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = (await fs.readdir(sessionsDir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(sessionsDir, file), "utf-8");
      const s = JSON.parse(raw) as StoredSession;
      const firstUser = s.history.find((m) => m.role === "user");
      summaries.push({
        id: s.id,
        label: s.label,
        workspace: s.workspace,
        model: s.model,
        updatedAt: s.updatedAt,
        messageCount: s.history.length,
        preview: firstUser?.content ? String(firstUser.content).slice(0, 80) : "(empty session)",
      });
    } catch {
      // skip unreadable/corrupt session files rather than failing the whole listing
      continue;
    }
  }
  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Finds the most recently updated session for a given workspace, if any. */
export async function findLatestSessionForWorkspace(
  sessionsDir: string,
  workspace: string,
): Promise<SessionSummary | null> {
  const all = await listSessions(sessionsDir);
  return all.find((s) => s.workspace === workspace) ?? null;
}

export function exportSessionMarkdown(session: StoredSession): string {
  const lines: string[] = [
    `# Lattice session ${session.id}`,
    "",
    `- Workspace: ${session.workspace}`,
    `- Model: ${session.model}`,
    `- Mode: ${session.mode}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    "",
    "---",
    "",
  ];

  for (const msg of session.history) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      lines.push(`## User`, "", String(msg.content ?? ""), "");
    } else if (msg.role === "assistant") {
      if (msg.content) lines.push(`## Lattice`, "", String(msg.content), "");
      for (const tc of msg.tool_calls ?? []) {
        lines.push(`**Tool call:** \`${tc.function.name}\`(${tc.function.arguments})`, "");
      }
    } else if (msg.role === "tool") {
      lines.push(`**Tool result (${msg.name}):**`, "", "```", String(msg.content ?? "").slice(0, 2000), "```", "");
    }
  }

  return lines.join("\n");
}

export function exportSessionJson(session: StoredSession): string {
  return JSON.stringify(session, null, 2);
}
