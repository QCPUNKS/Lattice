// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0
// I enjoy the terminal  if you havent noticed

import chalk from "chalk";
import type { LatticeConfig } from "../config/index.js";
import { theme } from "./theme.js";

function stripAnsiLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export interface BannerInfo {
  toolCount: number;
  mcpServerCount: number;
  mcpToolCount: number;
}

export function renderBanner(cfg: LatticeConfig, info: BannerInfo): string {
  const lines = [
    `${theme.primary(theme.bold("LATTICE"))}`,
    `Personal AI Development Agent`,
    ``,
    `${theme.dim("Model")}       ${cfg.model}`,
    `${theme.dim("Provider")}    Venice AI`,
    `${theme.dim("Workspace")}   ${cfg.workspace}`,
    `${theme.dim("Mode")}        ${cfg.mode.toUpperCase()}`,
    `${theme.dim("Tools")}       ${info.toolCount} built-in${info.mcpServerCount > 0 ? ` + ${info.mcpToolCount} via ${info.mcpServerCount} MCP server${info.mcpServerCount === 1 ? "" : "s"}` : ""}`,
  ];
  const width = Math.max(...lines.map((l) => stripAnsiLength(l))) + 4;
  const top = "╭" + "─".repeat(width) + "╮";
  const bottom = "╰" + "─".repeat(width) + "╯";
  const body = lines
    .map((l) => `│ ${l}${" ".repeat(width - stripAnsiLength(l) - 1)}│`)
    .join("\n");
  return [top, body, bottom].join("\n");
}

export function prompt(): string {
  return theme.success("lattice") + theme.dim(" › ");
}

/** Draws a titled box around `lines`, used for tool/edit/browser panels. */
export function renderBox(kind: string, title: string, lines: string[], color: (s: string) => string = theme.tool): string {
  const header = `─ ${kind.toUpperCase()} ─ ${title} `;
  const contentWidth = Math.max(header.length, ...lines.map((l) => stripAnsiLength(l) + 2), 40);
  const top = color(`┌${header}${"─".repeat(Math.max(0, contentWidth - header.length))}┐`);
  const body = lines
    .map((l) => color("│") + " " + l + " ".repeat(Math.max(0, contentWidth - stripAnsiLength(l) - 1)) + color("│"))
    .join("\n");
  const bottom = color(`└${"─".repeat(contentWidth)}┘`);
  return [top, body, bottom].join("\n");
}

export interface StatusBarInfo {
  approxTokens: number;
  toolCount: number;
  model: string;
  workspace: string;
  mode: string;
}

export function renderStatusBar(info: StatusBarInfo): string {
  const tokenStr = info.approxTokens >= 1000 ? `${(info.approxTokens / 1000).toFixed(1)}k` : String(info.approxTokens);
  return theme.dim(
    `tokens: ${tokenStr}  │  tools: ${info.toolCount}  │  model: ${info.model}  │  mode: ${info.mode}  │  workspace: ${shortenPath(info.workspace)}`,
  );
}

function shortenPath(p: string): string {
  const home = process.env.HOME;
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

export { chalk };
