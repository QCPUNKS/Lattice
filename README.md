<!-- Copyright (c) 2026 Jevante Boxley -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# LATTICE

A terminal-native AI software engineering agent, built on Venice AI's OpenAI-compatible API. Runs from Kitty (or any terminal), gets real access to your filesystem, shell, and git, and does the work rather than just describing it.

## What Lattice is

- **Provider abstraction** with a full **Venice AI** implementation: SSE streaming, tool calling, retries with backoff on 429/5xx, timeouts, cancellation, model capability discovery via `/models`.
- **Agent loop**: multi-turn model ↔ tool-call ↔ result cycle with configurable iteration/tool-call caps, automatic repeated-failure detection (stops instead of looping on the same failing command), and automatic context compaction as the conversation grows.
- **26 native tools**: filesystem (read/write/edit/create/delete/list/search/stat/exists/copy/move, multi-file read, ripgrep-backed search), shell (foreground commands + managed background processes with process-group kill), git (status/diff/log/branch/commit), and project inspection.
- **Arena mode**: run the same task across multiple models in parallel, each in its own isolated git worktree, with your test suite run against every result. A live scorecard shows files changed, tokens used, duration, and test outcome per model — then you review the actual diffs and merge only the winner. See [Arena](#arena) below.
- **Real MCP client** (stdio + streamable-HTTP) — connects to configured servers, discovers and namespaces their tools, and exposes them to the model alongside the native ones. Project-scoped servers are surfaced and confirmed before Lattice spawns anything from a repo you don't own.
- **Permission system**: `safe`/`normal`/`auto` autonomy modes crossed with a `safe`/`caution`/`destructive`/`critical` command risk classifier — destructive and critical actions always require confirmation, no matter the mode.
- **Safety boundaries**: filesystem tools can't escape the workspace directory; `.env`/`*.pem`/`*.key`/credential-shaped files are never read without an explicit prompt; tool output is bounded so a runaway command can't blow out the context window.
- **Sessions**: every conversation persists to `~/.local/share/lattice/sessions/`, resumable with `--session <id>`/`--session latest`, exportable to markdown or JSON.
- **Project memory**: `.lattice/` scaffolding (context notes, architecture/decisions/conventions files, agent state) that survives between runs and gets fed back into the system prompt; auto-gitignored.
- **Undo/diff**: every file touched in a turn is snapshotted before the first write, independent of git, so `/diff` and `/undo` work even in an uncommitted repo.
- **Audit log**: every permission decision and command execution is written as structured JSON to a local audit trail (`lattice audit`).
- **Full CLI surface**: interactive REPL, `lattice exec`/`lattice ask` for scripting (with real exit codes), `lattice doctor`, `lattice setup`, `lattice mcp`, `lattice sessions`, `lattice config`, `lattice inspect/status/diff/test/build/run`, `lattice --help`.
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

or `lattice setup` for an interactive wizard that saves to `~/.config/lattice/config.toml`. Full precedence and every setting: `docs/configuration.md`.

## Usage

```bash
cd ~/Projects/my-app
lattice
```

```text
╭────────────────────────────────────\
│ Lattice                                                     / \/\/\/\/\/\/\    \   
│ Personal AI Development Agent      \ _______  / \    |
│                                                                   |  \/    \/     |\     |
│ Model       deepseek-v4-flash-0731     |                |       |
│ Provider    YOUR_API_KEY                |      U       |        |                     
│ Workspace   ~/Projects/my-app         |    \___/    |        /
│ Mode        NORMAL                             |  ______   |      /              
│ Tools       26 built-in                             \/  |       |  \/     /
╰──────────────────────────────────── /

Lattice› Fix the authentication bug and run the tests.
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
Lattice› /arena
What should the models do? Add input validation to the signup form
  1. deepseek-v4-flash-0731   ...
  2. qwen3-coder              ...
Pick 2 or more models by number, e.g. 1 3 5  (Enter = same as last time): 1 2
Check every result with npm test? [Y/n]
```

Lattice asks only for what you left out, so the one-line form still works for scripts and muscle memory:

```text
Lattice› /arena "Add input validation to the signup form" --models deepseek-v4-flash-0731,qwen3-coder --tests "npm test"
```

What happens:

1. Lattice verifies your worktree is clean (auto-committing if you allow it), then creates one worktree + branch per model.
2. Every model runs the full agent loop on the task in parallel, with live per-participant progress (tool calls, test runs, errors).
3. If you passed `--tests`, the command runs inside each worktree after the agent finishes — its exit code feeds the scorecard.
4. You get a scorecard: files changed, insertions/deletions, tokens used, duration, and tests passed/failed per model.

Then you decide:

```text
/arena diff [number]     review a participant's actual diff before picking
/arena pick <number>     merge that participant's work into your branch (a model id works too)
/arena list              show past and open arena runs
/arena clean             discard the current open run without merging
```

Nothing is merged automatically — the scorecard informs the decision, the diff review makes it, and losing branches are cleaned up on `/arena pick` or `/arena clean`.

## Costs

Venice output prices differ ~1,700× between models, so Lattice tracks every cent. After each answer it shows the turn's cost, today's total, and your Venice balance. `/cost` breaks spending down by session, day, month, and model. `/model` lists models cheapest first and warns when a switch multiplies your cost. Optional daily and monthly budgets are checked before every model call. Full guide: `docs/costs.md`.

## Kit10

In Kitty (and WezTerm, Ghostty, Konsole) Lattice v3 has **Kit10**, an animated mascot. She climbs in beside the gradient LATTICE wordmark at startup, then shows what the agent is doing: thinking, reading, typing, building, painting, listening, speaking. `/context` shows her token bag filling with the context window, and `/kit10` tours every pose. Animation runs inside the terminal, so it costs no CPU. `reduced_motion` holds still poses. Full guide: `docs/mascot.md`.

## Voice

Talk to Lattice and hear it answer, with input and output independently switchable:

| `/voice chat` | `/voice dictate` | `/voice listen` | `/voice off` |
|---|---|---|---|
| speak → hear | speak → read | type → hear | type → read |

Push-to-talk: **Enter on an empty line** starts recording, **Enter** sends, **Ctrl+C** cancels. Spoken replies skip code blocks and always print as captions. Voice runs **locally by default**, free and offline: Whisper on your GPU and Kokoro on your machine (`scripts/voice/install-local-voice.sh`), with Venice's hosted voice available as an alternative. Audio never touches disk. Full guide: `docs/voice.md`.

## Images

```text
lattice › /imagine a glass cube floating over a neon grid --aspect 16:9
```

Generates with your Venice image models, shows the result inline (Kitty, WezTerm, Ghostty, Konsole), and saves it owner-only to a folder you choose on first use. Private models only by default, and file names never contain your prompt. Settings live under `/image`. Full guide: `docs/images.md`.

## Security

- Filesystem tools cannot read or write outside the workspace directory — every path is resolved and checked before use.
- `.env`, `*.pem`, `*.key`, SSH private keys, `credentials.*`, `secrets.*` require an explicit confirmation before Lattice reads or sends their contents anywhere.
- Destructive/critical shell commands (`rm`, `git reset --hard`, `sudo`, `chmod -R`, `dd`, ...) always require confirmation, in every autonomy mode.
- API keys are never logged in full (`redactKey` shows only first/last 4 chars) and never appear in the audit trail.
- Command and file output is truncated before being sent to the model, bounding both context usage and the blast radius of a runaway command.
- Symlinks can't be used to escape the workspace: file tools check real paths, not just path text.
- A project's `.lattice/config.toml` can't redirect your API key, image folder, or microphone. Those settings are global-config only.
- Sessions, audit log, and config are owner-only (600/700) regardless of umask.

Full policy table: `docs/permissions.md`. Threat model and known gaps: `SECURITY.md`.

## Documentation

- **`docs/user-guide.md` — start here: every command explained in plain language, with examples**
- `docs/architecture.md` — module map and data flow
- `docs/configuration.md` — every setting and its precedence
- `docs/tools.md` — native tool reference
- `docs/mcp.md` — MCP setup and trust model
- `docs/permissions.md` — the mode × risk policy table in full
- `docs/providers.md` — the provider abstraction, adding a second backend
- `docs/terminal-ui.md` — layout, keybindings, theming
- `docs/voice.md` — voice modes, push-to-talk, microphones, privacy
- `docs/mascot.md` — the mascot, visuals, `[ui]` settings, rebuilding the art
- `docs/costs.md` — spend tracking, balance, budgets
- `docs/images.md` — `/imagine`, `/image`, the agent's image tool, privacy
- `SECURITY.md` — threat model, defenses, and known gaps
- `docs/troubleshooting.md`

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run dev          # run directly with tsx, no build step
npm test              # vitest — unit + fixture-based integration tests
```

Adding a second OpenAI-compatible provider (OpenRouter, LM Studio, Ollama) means implementing `ModelProvider` in `src/providers/` — the agent loop, tools, and UI are provider-agnostic.

## Creator & License

Lattice was created by **Jevante Boxley**.

Licensed under the [Apache License 2.0](LICENSE). You're free to use, modify, and share it, as long as you keep the copyright notices and the [NOTICE](NOTICE) file that credits the creator, and mark any files you change. The Lattice name and the Kit10 mascot aren't covered by the license, so forks need their own name.
