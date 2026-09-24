<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# MCP

Lattice ships a real MCP client (`@modelcontextprotocol/sdk`) for stdio and streamable-HTTP servers. Core functionality (filesystem, shell, git, project inspection) is native and does **not** depend on MCP — MCP is for extending Lattice, not required to use it.

## Configuration

Global (trusted — you configured these yourself): `~/.config/lattice/mcp.json`
Project (opt-in, surfaced before anything is spawned): `<workspace>/.lattice/mcp.json`

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
    },
    "remote-example": {
      "url": "https://example.com/mcp"
    }
  }
}
```

`command`+`args` starts a stdio server; `url` connects to a streamable-HTTP server. Set `"enabled": false` on an entry to keep it configured but not loaded.

## Trust model

- **Global servers** connect automatically — you put them there.
- **Project servers** are listed on startup and require an explicit `y`/`n` before Lattice spawns them, since a project's `.lattice/mcp.json` could come from a repo you don't fully trust (spec §8, §50). Non-interactive runs (`lattice exec`) never auto-spawn a project-scoped server.

## Recommended servers

- **Playwright** (`@playwright/mcp`) — browser automation for verifying frontend work (spec §20). Not bundled by default; add it yourself.
- **GitHub** — issues/PRs from the terminal.
- **Fetch** — if you want a dedicated fetch tool beyond native `run_command curl`.

Keep the list short. Every extra tool definition competes for the model's attention and costs context — spec §96's philosophy is "few powerful tools," not "install every integration."

## Commands

```bash
lattice mcp          # or: lattice mcp list — show configured servers
lattice mcp test     # connect to every configured server and report status
```

Inside the REPL: `/mcp` shows live connection status for the current session.

## Permissions for MCP tools

Every MCP tool call goes through the same permission gate as Lattice's own
tools:

| Tool | Risk | Behavior |
|---|---|---|
| Name looks like code execution (`execute`, `eval`, `run`, `shell`, `code`, `script`, `python`, `bash`, `command`) or the server marks it destructive | destructive | **Asks every time, in every mode**, and the prompt shows the code or arguments |
| Server marks it read-only | safe | Runs without asking |
| Everything else | caution | Asks in `safe`/`normal`, runs in `auto` |

A code-execution name wins over any hint: a server claiming its eval tool is
read-only isn't believed. "Always allow this session" for MCP calls is kept
separate from shell commands.

Override the tier per tool with `toolRisk`, for example to stop being asked
about tools that only read:

```json
{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["mcp-for-blender@2.0.3"],
      "env": { "DISABLE_TELEMETRY": "true" },
      "toolRisk": { "get_scene_info": "safe", "get_object_info": "safe" }
    }
  }
}
```

Overrides in your global `~/.config/lattice/mcp.json` can set any tier. In a
project's `.lattice/mcp.json` they can only **raise** a tool's risk, so a
cloned repo can't mark a code-execution tool safe.
