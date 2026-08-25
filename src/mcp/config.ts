// Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface McpServerConfig {
  /** stdio server: executable to spawn. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** streamable-HTTP server: endpoint URL. */
  url?: string;
  /** Defaults to true. Set false to keep a configured server around without loading it. */
  enabled?: boolean;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface ResolvedMcpServer {
  name: string;
  config: McpServerConfig;
  scope: "global" | "project";
}

function readMcpConfigFile(filePath: string): McpConfigFile | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.mcpServers !== "object") {
      throw new Error("expected a top-level \"mcpServers\" object");
    }
    return parsed as McpConfigFile;
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
  }
}

/**
 * Loads and merges MCP server configuration:
 *   built-in defaults (none by design) → global → project (opt-in, surfaced).
 * Project-scoped servers are returned with scope="project" so the caller can
 * surface and gate them separately before spawning anything from an untrusted repo.
 */
export function resolveMcpServers(globalConfigDir: string, projectConfigDir: string): ResolvedMcpServer[] {
  const global = readMcpConfigFile(path.join(globalConfigDir, "mcp.json"));
  const project = readMcpConfigFile(path.join(projectConfigDir, "mcp.json"));

  const servers: ResolvedMcpServer[] = [];
  for (const [name, config] of Object.entries(global?.mcpServers ?? {})) {
    if (config.enabled === false) continue;
    servers.push({ name, config, scope: "global" });
  }
  for (const [name, config] of Object.entries(project?.mcpServers ?? {})) {
    if (config.enabled === false) continue;
    // A project can override a global server of the same name — last one wins, project takes priority.
    const existingIdx = servers.findIndex((s) => s.name === name);
    const entry: ResolvedMcpServer = { name, config, scope: "project" };
    if (existingIdx >= 0) servers[existingIdx] = entry;
    else servers.push(entry);
  }
  return servers;
}
