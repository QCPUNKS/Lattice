<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS SECTOR -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Troubleshooting

Start with `lattice doctor` — it checks runtime dependencies, config, live Venice connectivity, model capability, and MCP config validity in one pass.

## "VENICE_API_KEY is not set"

Export it, put it in `.env` in your project (or wherever you run `lattice` from), or run `lattice setup` to save it to `~/.config/lattice/config.toml`.

## "Model X was not found in the model list" / tool calls silently don't happen

Run `lattice models` and pick a model with `tools=true`. Not every Venice model supports function calling — some `e2ee-*` privacy-tier models in particular don't (check before setting one as your default; Lattice is useless as an *agent* on a model that can't call tools, though it'll still chat).

## A command hangs waiting for confirmation in a script

Non-interactive runs (`lattice exec`/`lattice ask`) never prompt — anything needing confirmation fails closed instead. Pass `--mode auto` to widen what's auto-allowed, or restructure so destructive steps aren't required.

## "Permission denied for exec: ..."

The command was classified `caution`/`destructive`/`critical` and the active mode didn't auto-allow it. See `docs/permissions.md` for the exact policy table. In the REPL, answering `a` (always) at the prompt avoids repeat prompts for the rest of the session.

## Orphaned background processes

`start_process`/`/run` track PIDs and kill the whole process group (not just the shell) on `stop_process`, `/stop`, session exit, or `SIGTERM`. If you still find a stray process after a hard crash (`kill -9` on Lattice itself), check `lattice ps` first, then your OS process list.

## Context growing very large / responses feel slow

Run `/context` to see approximate token usage, `/compact` to force compaction. Compaction also happens automatically near the configured `context.token_budget`.

## Search isn't respecting .gitignore

Install `ripgrep` (`rg`) — `search_files`/`search_content` use it automatically when present and only fall back to a plain recursive walk (which does *not* respect `.gitignore`) when it's missing.

## MCP server won't connect

`lattice mcp test` connects to every configured server and reports the specific error. Most failures are: wrong `command`, missing env var the server needs, or a server that expects `url` but was given `command` (or vice versa).
