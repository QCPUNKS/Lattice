<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Architecture

```
src/
├── index.ts              CLI entry point: parses argv, dispatches to a command or the interactive REPL
├── config/                env / TOML config loading and precedence
├── providers/
│   ├── types.ts           ModelProvider interface (provider-agnostic)
│   └── venice.ts           Venice implementation: chat, stream, getModels
├── agent/
│   ├── loop.ts             multi-turn agent loop (streaming, tool calls, compaction, failure detection)
│   ├── permissions.ts       PermissionGate: mode × risk → auto-allow / ask / deny
│   ├── command-classifier.ts  classifies shell commands into safe/caution/destructive/critical
│   ├── context.ts           token estimation + history compaction
│   ├── snapshots.ts         per-turn file snapshots for /diff and /undo
│   └── system-prompt.ts
├── tools/
│   ├── registry.ts         ToolRegistry, ToolContext, permission plumbing
│   ├── filesystem.ts        read/write/edit/create/delete/list/search/copy/move + stat/exists tools
│   ├── shell.ts              run_command, start/stop/status process, process-group kill
│   ├── git.ts                status/diff/log/branch/commit
│   ├── project.ts            detect_project_type, inspect_project
│   ├── secrets.ts            denylist for credential-shaped paths
│   └── ripgrep.ts            rg-backed search with a JS fallback
├── mcp/
│   ├── config.ts             global + project mcp.json resolution
│   └── manager.ts             MCP server lifecycle, tool discovery/execution
├── sessions/                persistent session storage (~/.local/share/lattice/sessions)
├── project/memory.ts        .lattice/ project memory scaffolding
├── audit/log.ts              structured audit trail
├── ui/                       theme, banner, box rendering, diff coloring
└── cli/
    ├── args.ts                argv parsing
    ├── runtime.ts              builds provider + tools + MCP + permissions for one run
    ├── repl.ts                 interactive loop
    ├── exec.ts                 non-interactive lattice exec/ask
    ├── slash-commands.ts        / commands inside the REPL
    ├── actions.ts               shared test/build/run/git/ps logic (CLI + slash commands)
    └── commands/                 doctor, models, mcp, sessions, config, setup, project
```

## Data flow

```
CLI args + env + config files
        │
        ▼
   LatticeConfig
        │
        ▼
   buildRuntime()  ──►  ToolRegistry (native + MCP tools)
        │                     │
        ▼                     ▼
   AgentLoop.run()  ◄──  PermissionGate, TurnSnapshotManager
        │
        ▼
   VeniceProvider.stream()  ──►  tool_calls  ──►  ToolRegistry.get(name).handler()
        │                                              │
        ▼                                              ▼
   text_delta → stdout                          tool result → history → next model turn
```

Adding a second OpenAI-compatible provider means implementing `ModelProvider` in `src/providers/` — the agent loop, tools, and UI never reference Venice directly outside that one file.
