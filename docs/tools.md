<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tools

## Native (always available)

**Filesystem** — `read_file`, `read_many_files`, `write_file`, `edit_file`, `create_file`, `delete_file`, `create_directory`, `list_directory`, `file_exists`, `directory_exists`, `stat_file`, `search_files`, `search_content`, `copy_file`, `move_file`

`search_files`/`search_content` shell out to `ripgrep` when it's installed (respects `.gitignore` automatically, much faster on large trees) and fall back to a plain recursive walk otherwise.

**Shell / processes** — `run_command` (foreground, bounded output, timeout, process-group kill), `start_process`/`stop_process`/`get_process_status` (background dev servers; reuses an already-running instance of the exact same command instead of spawning a duplicate)

**Git** — `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit`

**Project** — `detect_project_type`, `inspect_project`

## MCP tools

Every tool discovered from a connected MCP server is registered as `mcp__<server>__<tool>` (shown in logs as `mcp.<server>.<tool>`). See `docs/mcp.md`.

## Tool output bounds

- Command output: truncated at 20,000 chars with a note of the true size.
- File reads: truncated at ~300KB with a note.
- `search_content`/`search_files`: capped at 200 results.
- MCP tool results: truncated at 20,000 chars.

This keeps a single runaway command or huge file from blowing out the model's context window.

## Adding a tool

1. Define a `ToolDefinition` (name, description, JSON Schema parameters) and a handler `(args, ctx) => Promise<string>` in `src/tools/`.
2. Call `ctx.requirePermission(action, detail, risk?)` before any mutation — `action` is `write`/`delete`/`exec`/`network`/`secret_read`.
3. Register it in `src/tools/register-all.ts`.

Keep descriptions short and specific — they're what the model uses to decide when (and when not) to reach for the tool.
