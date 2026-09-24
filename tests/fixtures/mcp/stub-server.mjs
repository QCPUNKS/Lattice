// Copyright (c) 2026 Jevante Boxley / QCPUNKS
// SPDX-License-Identifier: Apache-2.0

// A minimal MCP server for tests: a code-execution tool that leaves a marker
// file when it actually runs, and a read-only tool.
import { writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const marker = process.env.STUB_MARKER;
const server = new McpServer({ name: "stub", version: "1.0.0" });

server.registerTool(
  "execute_code",
  { description: "Runs code", inputSchema: { code: z.string() } },
  async ({ code }) => {
    writeFileSync(marker, code);
    return { content: [{ type: "text", text: "ran" }] };
  },
);

server.registerTool(
  "get_info",
  { description: "Reads info", inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => ({ content: [{ type: "text", text: "info" }] }),
);

await server.connect(new StdioServerTransport());
