<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# LATTICE

A terminal-native AI software engineering agent, built on Venice AI's OpenAI-compatible API. More on that later. Runs from any terminal, grants the model real access to your filesystem, shell, and git, and does the work rather than just describing it. This tool is designed for you and your projects. I chose Venice.ai as the API for many reasons. (No, I am not affiliated with them or sponsored.) Wouldn't mind being, though.

1. One API for the newest frontier models plus a huge range of efficient open models, across text, image, video, and voice.
2. Privacy you can see: Venice labels every model **private** (runs on Venice, prompts not stored) or **anonymized** (forwarded to the provider without your identity), and some models offer end-to-end encryption.
3. Access to a variety of uncensored open models.
4. Pay-per-use API pricing, published per model, so you only pay for what you use.

If that's not your thing, Lattice works with your own setup too: fill in your own environment variables and keys and it's ready to go. Voice, image generation right inside your terminal, and more are coming in [Lattice v3](#lattice-v3-coming-soon). K, let's get into the technical stuff.

## What Lattice is

- **Provider abstraction** with a full **Venice AI** implementation: SSE streaming, tool calling, retries with backoff on 429/5xx, timeouts, cancellation, model capability discovery via `/models`.
- **Interactive model picker**: `/model` lists the live Venice catalog — agent-capable models only, with context length and reasoning/vision tags — and switches on a number or an id. New Venice models appear automatically with no code changes.
- **Agent loop**: multi-turn model ↔ tool-call ↔ result cycle with configurable iteration/tool-call caps, automatic repeated-failure detection (stops instead of looping on the same failing command), and automatic context compaction as the conversation grows.
- **26 native tools**: filesystem (read/write/edit/create/delete/list/search/stat/exists/copy/move, ripgrep-backed search), shell (foreground commands + managed background processes with process-group kill), git (status/diff/log/branch/commit), and project inspection.
- **Real MCP client** (stdio + streamable-HTTP) — connects to configure servers, discovers and namespaces their tools, and exposes them to the model alongside the native ones. Project-scoped servers are surfaced and confirmed before Lattice spawns anything from a repo you don't own.
- **Arena mode**: run the same task across multiple models in parallel, each in its own isolated git worktree, with your test suite run against every result. A live scorecard shows files changed, tokens used, duration, and test outcome per model — then you review the actual diffs and merge only the winner. See [Arena](#arena) below.
- **Permission system**: `safe`/`normal`/`auto` autonomy modes crossed with a `safe`/`caution`/`destructive`/`critical` command risk classifier — destructive and critical actions always require confirmation, no matter the mode.
- **Safety boundaries**: filesystem tools can't escape the workspace directory; `.env`/`*.pem`/`*.key`/credential-shaped files are never read without an explicit prompt; tool output is bounded so a runaway command can't blow out the context window.
- **Sessions**: every conversation persists to `~/.local/share/lattice/sessions/`, resumable with `--session <id>`/`--session latest`, exportable to markdown or JSON.
- **Project memory**: `.lattice/` scaffolding (context notes, architecture/decisions/conventions files, agent state) that survives between runs and gets fed back into the system prompt; auto-gitignored.
- **Undo/diff**: every file touched in a turn is snapshotted before the first write, independent of git, so `/diff` and `/undo` work even in an uncommitted repo.
- **Audit log**: every permission decision and command execution is written as structured JSON to a local audit trail (`lattice audit`).
- **Full CLI surface**: interactive REPL, `lattice exec`/`lattice ask` for scripting (with real exit codes), `lattice doctor`, `lattice setup`, `lattice mcp`, `lattice sessions`, `lattice config`, `lattice inspect/status/diff/test/build/run/ps/stop`.
- **Tests**: unit tests for the provider, permission/risk classifier, filesystem safety, config precedence, and context compaction, plus a fixture-based integration test that proves the full read → edit → verify loop actually works end-to-end.

## Lattice v3 (coming soon)

v1 is the free, open-source engine. **Lattice v3** is the full experience, built on top of it:

- **Talk to it.** Push-to-talk voice with spoken replies. Speak and hear, speak and read, or type and hear, whatever fits the moment or your accessibility needs. Runs **locally on your GPU** (Whisper + Kokoro): free, offline, and your voice never leaves your machine.
- **Generate images in your terminal.** `/imagine` renders Venice image models inline in Kitty, WezTerm, Ghostty, and Konsole, with privacy-first defaults.
- **Know what you spend.** The cost of every answer, `/cost` breakdowns by model, your live Venice balance, a model picker sorted by price, and daily/monthly budgets checked before every model call.
- **Kit10.** An animated pixel-art companion who works alongside you: thinking, reading, typing, and building as the agent does. The terminal animates her, so she costs no CPU.
- **Hardened for privacy.** Owner-only storage for everything, a documented threat model, and private-by-default models throughout.

To hear when it launches, watch this repository (**Watch → Custom → Releases**).

## Requirements

- Node.js ≥ 20
- **Platform**: Linux and macOS are fully supported out of the box. Windows works via WSL2 or Git Bash — native `cmd.exe`/PowerShell isn't supported yet (the installer is a bash script, shell-tool process cleanup relies on POSIX process groups, and the agent's generated commands assume a POSIX shell).
Plug in your own API key from whatever model/subscription you've got going on.

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

or `lattice setup` for an interactive wizard that saves to `~/.config/lattice/config.toml`. Full precedence and every setting: `docs/configuration.md`.

## Usage

```bash
cd ~/Projects/my-app
lattice
```

```text
╭──────────────────────────────────────╮
│ LATTICE                              │
│ Personal AI Development Agent        │
│                                      │
│ Model       kimi-k2-7-code           │
│ Provider    Venice AI                │
│ Workspace   ~/Projects/my-app        │
│ Mode        NORMAL                   │
│ Tools       26 built-in              │
╰──────────────────────────────────────╯

lattice › Fix the authentication bug and run the tests, then update the config file.
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

## Arena

Arena mode pits multiple models against each other on the same task. Each participant gets its own git worktree on its own branch, so they work in full isolation — your working branch is never touched until you explicitly merge a winner.

```text
Lattice› /arena "Add input validation to the signup form" --models kimi-k2-7-code,qwen3-coder --tests "npm test"
```

What happens:

1. Lattice verifies your worktree is clean, then creates one worktree + branch per model off the current HEAD.
2. Every model runs the full agent loop on the task in parallel, with live per-participant progress (tool calls, test runs, errors).
3. If you passed `--tests`, the command runs inside each worktree after the agent finishes — its exit code feeds the scorecard.
4. You get a scorecard: files changed, insertions/deletions, tokens used, duration, and tests passed/failed per model.

Then you decide:

```text
/arena diff [label]      review a participant's actual diff before picking
/arena pick <label>      merge that participant's work into your branch
/arena list              show past and open arena runs
/arena clean             discard the current open run without merging
```

The same thing works non-interactively:

```bash
lattice arena "Add input validation to the signup form" --models kimi-k2-7-code,qwen3-coder --tests "npm test"
lattice arena diff qwen3-coder
lattice arena pick qwen3-coder
```

Nothing is merged automatically — the scorecard informs the decision, the diff review makes it, and losing branches are cleaned up on `/arena pick` or `/arena clean`.

## Security

- Filesystem tools cannot read or write outside the workspace directory. Every path is resolved (following symlinks) and checked before use, so a symlink committed to a repo can't be used to escape.
- A project's `.lattice/config.toml` can't redirect where your API key is sent, supply an API key, or loosen your permission mode. Those come only from your environment and global config, and the API base URL must be HTTPS.
- Everything Lattice prints that it doesn't control (model replies, tool output, command output) has terminal control codes stripped, so a file the agent reads can't hijack your terminal or clipboard.
- Your config (which can hold the API key), sessions, and the audit log are stored owner-only.
- MCP tools go through the same permission gate: tools that execute code ask every time, in every mode, and show you the code first. See `docs/mcp.md`.
- `.env`, `*.pem`, `*.key`, SSH private keys, `credentials.*`, `secrets.*` require an explicit confirmation before Lattice reads or sends their contents anywhere.
- Destructive/critical shell commands (`rm`, `git reset --hard`, `sudo`, `chmod -R`, `dd`, ...) always require confirmation, in every autonomy mode.
- API keys are never logged in full (`redactKey` shows only first/last 4 chars) and never appear in the audit trail.
- Command and file output is truncated before being sent to the model, bounding both context usage and the blast radius of a runaway command.

Full policy table: `docs/permissions.md`.

## Documentation

- `CHANGELOG.md`: what changed in each release
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
