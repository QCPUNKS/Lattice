// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "../providers/types.js";
import type { ToolRegistry, ToolContext } from "../tools/registry.js";
import type { ResolvedMcpServer } from "./config.js";
import { LATTICE_VERSION } from "../version.js";
import type { CommandRisk } from "../agent/command-classifier.js";
import { mcpToolRisk, applyRiskOverride, describeMcpCall, type ToolHints } from "./risk.js";

const MAX_MCP_OUTPUT_CHARS = 20_000;

interface ConnectedServer {
  name: string;
  scope: "global" | "project";
  client: Client;
  toolNames: string[]; // original (un-namespaced) tool names on this server
  error?: undefined;
}

interface FailedServer {
  name: string;
  scope: "global" | "project";
  error: string;
}

export type ServerStatus = ConnectedServer | FailedServer;

function isConnected(s: ServerStatus): s is ConnectedServer {
  return !("error" in s) || s.error === undefined;
}

/** Namespaced tool name exposed to the model/registry: mcp__<server>__<tool> (dots aren't valid in OpenAI-style function names). */
function namespacedName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** Human-readable form for logs/UI: `mcp.server.tool`. */
export function displayName(server: string, tool: string): string {
  return `mcp.${server}.${tool}`;
}

/**
 * Owns the lifecycle of every configured MCP server: connects, discovers
 * tools, registers them into the ToolRegistry under a collision-safe
 * namespace, executes calls, and disconnects everything on shutdown.
 */
export class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private failures: FailedServer[] = [];

  /**
   * Connects to every server. Project-scoped servers are gated through
   * `confirmProjectServer` before spawning, since they come from a
   * potentially untrusted repository.
   */
  async connectAll(
    resolved: ResolvedMcpServer[],
    registry: ToolRegistry,
    log: (event: Record<string, unknown>) => void,
    confirmProjectServer: (name: string, config: ResolvedMcpServer["config"]) => Promise<boolean>,
  ): Promise<void> {
    for (const entry of resolved) {
      if (entry.scope === "project") {
        const allowed = await confirmProjectServer(entry.name, entry.config);
        if (!allowed) {
          this.failures.push({ name: entry.name, scope: entry.scope, error: "declined by user (project-scoped server)" });
          continue;
        }
      }

      try {
        const client = await this.connectOne(entry);
        const { tools } = await client.listTools();

        const toolNames: string[] = [];
        for (const tool of tools) {
          const name = namespacedName(entry.name, tool.name);
          const definition: ToolDefinition = {
            type: "function",
            function: {
              name,
              description: `[MCP:${entry.name}] ${tool.description ?? tool.name}`.slice(0, 1024),
              parameters: tool.inputSchema as Record<string, unknown>,
            },
          };
          try {
            const risk = applyRiskOverride(
              mcpToolRisk(tool.name, tool.annotations as ToolHints | undefined),
              entry.config.toolRisk?.[tool.name],
              entry.scope,
            );
            registry.register(definition, this.makeHandler(entry.name, tool.name, client, risk));
            toolNames.push(tool.name);
          } catch (err) {
            // A single colliding/malformed tool shouldn't take the whole server down.
            log({ type: "mcp_tool_registration_failed", server: entry.name, tool: tool.name, error: (err as Error).message });
          }
        }

        this.servers.set(entry.name, { name: entry.name, scope: entry.scope, client, toolNames });
        log({ type: "mcp_connected", server: entry.name, scope: entry.scope, tools: toolNames.length });
      } catch (err) {
        const message = (err as Error).message;
        this.failures.push({ name: entry.name, scope: entry.scope, error: message });
        log({ type: "mcp_connect_failed", server: entry.name, scope: entry.scope, error: message });
      }
    }
  }

  private async connectOne(entry: ResolvedMcpServer): Promise<Client> {
    const client = new Client({ name: "lattice", version: LATTICE_VERSION }, { capabilities: {} });

    if (entry.config.command) {
      const transport = new StdioClientTransport({
        command: entry.config.command,
        args: entry.config.args ?? [],
        env: { ...getDefaultEnvironment(), ...(entry.config.env ?? {}) },
        stderr: "pipe",
      });
      await client.connect(transport);
    } else if (entry.config.url) {
      const transport = new StreamableHTTPClientTransport(new URL(entry.config.url));
      await client.connect(transport);
    } else {
      throw new Error(`server "${entry.name}" has neither "command" nor "url" configured`);
    }

    return client;
  }

  private makeHandler(server: string, tool: string, client: Client, risk: CommandRisk) {
    return async (args: any, ctx: ToolContext): Promise<string> => {
      // Every MCP call goes through the permission gate like native tools do;
      // code-execution tools are "destructive" and confirmed every time.
      await ctx.requirePermission("mcp", describeMcpCall(displayName(server, tool), args), risk);
      const result = await client.callTool({ name: tool, arguments: args ?? {} });
      const parts: string[] = [];
      for (const item of (result.content as any[]) ?? []) {
        if (item.type === "text") parts.push(item.text);
        else if (item.type === "resource_link") parts.push(`[resource: ${item.uri}]`);
        else parts.push(`[${item.type} content omitted]`);
      }
      let text = parts.join("\n") || JSON.stringify(result.structuredContent ?? result);
      if (text.length > MAX_MCP_OUTPUT_CHARS) {
        text = text.slice(0, MAX_MCP_OUTPUT_CHARS) + `\n[...truncated, ${text.length} chars total...]`;
      }
      if (result.isError) {
        throw new Error(text);
      }
      return text;
    };
  }

  status(): ServerStatus[] {
    return [...this.servers.values(), ...this.failures];
  }

  toolCount(): number {
    return [...this.servers.values()].reduce((sum, s) => sum + s.toolNames.length, 0);
  }

  async disconnectAll(): Promise<void> {
    for (const s of this.servers.values()) {
      try {
        await s.client.close();
      } catch {
        // best-effort shutdown
      }
    }
    this.servers.clear();
  }
}
