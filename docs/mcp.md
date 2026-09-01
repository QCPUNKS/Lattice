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
