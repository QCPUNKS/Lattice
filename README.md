<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# LATTICE

A terminal-native AI software engineering agent, built on Venice AI's OpenAI-compatible API.  More on that later. Runs from any terminal,  grants the model real access to your filesystem, shell, and git, and does the work rather than just describing it. This tool is designed for you and your projects. I I choose Venice.AI as the API for many reasons. (No I Am Not Affiliated with them and or Sponsored) Wouldn't mind to be though. 

1. 18$ Subscription grants you front row early access to all the newest frontier models along with every other known efficient models across Text | Image | Video |
2. Its 100% Private No account needed, E2EE, all chats with all providers are anonimized, and Private. 
3. Access to a variety of Uncensored Models with E2EE chats
4. API access to all these models.  

If that sounds like something you don't wanna do I have designed this tool for any type of setup of your choice. Just remove the placeholders for your own environment varibles and Keys and its ready to go. The use of Open source models will be available in the next update soon. along with the ability to train your models through a few simple commands. Image Gen and image training will also be inside the next update. If you use a terminal that supports image viewing like kitty for example you will be able to run the model locally or via API and see the generated image right inside your terminal. K lets get into the techincal Shit.

## What Lattice is

- **Provider abstraction** with a full **Venice AI** implementation: SSE streaming, tool calling, retries with backoff on 429/5xx, timeouts, cancellation, model capability discovery via `/models`.
- **Agent loop**: multi-turn model ↔ tool-call ↔ result cycle with configurable iteration/tool-call caps, automatic repeated-failure detection (stops instead of looping on the same failing command), and automatic context compaction as the conversation grows.
- **19 native tools**: filesystem (read/write/edit/create/delete/list/search/stat/exists/copy/move, ripgrep-backed search), shell (foreground commands + managed background processes with process-group kill), git (status/diff/log/branch/commit), and project inspection.
- **Real MCP client** (stdio + streamable-HTTP) — connects to configure servers, discovers and namespaces their tools, and exposes them to the model alongside the native ones. Project-scoped servers are surfaced and confirmed before Lattice spawns anything from a repo you don't own.
- **Permission system**: `safe`/`normal`/`auto` autonomy modes crossed with a `safe`/`caution`/`destructive`/`critical` command risk classifier — destructive and critical actions always require confirmation, no matter the mode.
- **Safety boundaries**: filesystem tools can't escape the workspace directory; `.env`/`*.pem`/`*.key`/credential-shaped files are never read without an explicit prompt; tool output is bounded so a runaway command can't blow out the context window.
- **Sessions**: every conversation persists to `~/.local/share/lattice/sessions/`, resumable with `--session <id>`/`--session latest`, exportable to markdown or JSON.
- **Project memory**: `.lattice/` scaffolding (context notes, architecture/decisions/conventions files, agent state) that survives between runs and gets fed back into the system prompt; auto-gitignored.
- **Undo/diff**: every file touched in a turn is snapshotted before the first write, independent of git, so `/diff` and `/undo` work even in an uncommitted repo.
- **Audit log**: every permission decision and command execution is written as structured JSON to a local audit trail (`lattice audit`).
- **Full CLI surface**: interactive REPL, `lattice exec`/`lattice ask` for scripting (with real exit codes), `lattice doctor`, `lattice setup`, `lattice mcp`, `lattice sessions`, `lattice config`, `lattice inspect/status/diff/test/build/run/ps/stop`.
- **Tests**: unit tests for the provider, permission/risk classifier, filesystem safety, config precedence, and context compaction, plus a fixture-based integration test that proves the full read → edit → verify loop actually works end-to-end.

## Requirements

- Node.js ≥ 20
- **Platform**: Linux and macOS are fully supported out of the box. Windows works via WSL2 or Git Bash — native `cmd.exe`/PowerShell isn't supported yet (the installer is a bash script, shell-tool process cleanup relies on POSIX process groups, and the agent's generated commands assume a POSIX shell).
Plug in your own API key from what ever model/subscription you got going on 

## Installation

```bash
cd Lattice
./install.sh
```

or manually:

```bash
npm install
npm run build
npm link   # makes `lattice` available on your PATH
```

Run without linking: `npm run dev` (runs `src/index.ts` directly via `tsx`, no build step).

## Configuration

```bash
cp .env.example .env   # then fill in VENICE_API_KEY
```

or `latticee setup` for an interactive wizard that saves to `~/.config/lattice/config.toml`. Full precedence and every setting: `docs/configuration.md`.

## Usage

```bash
cd ~/Projects/my-app
lattice
```

```text
Example of how things will look
╭────────────────────────────────────╮_
│ Lattice                                                                         │_
│ Personal AI Development Agent                            
│                                                                                       
│ Model       kimi-k2-7-code                                  
│ Provider    Digiworld                                
│ Workspace   ~/Projects/my-app                              _
│ Mode        NORMAL                                                  │      
│ Tools       19 built-in                                                  │ 
╰────────────────────────────────────

Lattice› Fix the authentication bug and run the tests. then after can you add make these changes to this config file for me?
```

Scripting / CI:

```bash
lattice exec "Run the test suite and fix all failures."   # real exit code, no interactive prompts
lattice ask "Explain what this project does."
```

Diagnostics:

```bash
lattice doctor      # config/connectivity/MCP check
lattice models      # Venice models + capabilities (context length, tools, reasoning, vision)
lattice mcp test     # connect to every configured MCP server and report status
```

Full slash-command reference: type `/help` inside the REPL, or see `docs/terminal-ui.md`.

## Security

- Filesystem tools cannot read or write outside the workspace directory — every path is resolved and checked before use.
- `.env`, `*.pem`, `*.key`, SSH private keys, `credentials.*`, `secrets.*` require an explicit confirmation before Lattice reads or sends their contents anywhere.
- Destructive/critical shell commands (`rm`, `git reset --hard`, `sudo`, `chmod -R`, `dd`, ...) always require confirmation, in every autonomy mode.
- API keys are never logged in full (`redactKey` shows only first/last 4 chars) and never appear in the audit trail.
- Command and file output is truncated before being sent to the model, bounding both context usage and the blast radius of a runaway command.

Full policy table: `docs/permissions.md`.

## Documentation

- `docs/architecture.md` — module map and data flow
- `docs/configuration.md` — every setting and its precedence
- `docs/tools.md` — native tool reference
- `docs/mcp.md` — MCP setup and trust model
- `docs/permissions.md` — the mode × risk policy table in full
- `docs/providers.md` — the provider abstraction, adding a second backend
- `docs/terminal-ui.md` — layout, keybindings, theming
- `docs/troubleshooting.md`

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run dev          # run directly with tsx, no build step
npm test              # vitest — unit + fixture-based integration tests
```

Adding a second OpenAI-compatible provider (OpenRouter, LM Studio, Ollama) means implementing `ModelProvider` in `src/providers/` — the agent loop, tools, and UI are provider-agnostic.

## License

Copyright (c) 2026 Jevante Boxley / QCPUNKS

Licensed under the [Apache License 2.0](LICENSE). You're free to use, modify, distribute, and build on this software — commercially or otherwise — as long as you keep the copyright notice and license text with it. See the [LICENSE](LICENSE) file for the full terms.

Looking forward to feedback and suggestions. 
