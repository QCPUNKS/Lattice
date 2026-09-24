<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog

## v1.0.1

**Security release: everyone on v1.0.0 or earlier should upgrade.**

- **MCP tools ran without permission.** Tools from connected MCP servers
  were executed without going through the permission gate, in every mode. A
  server exposing a code-execution tool could run whatever code the model
  wrote without asking you. Every MCP call now goes through the gate:
  - tools that execute code (by name or because the server marks them
    destructive) ask **every time, in every mode**, and the prompt shows the
    code or arguments;
  - tools the server marks read-only run without asking;
  - everything else asks in `safe`/`normal` and runs in `auto`.

  "Always allow this session" for MCP calls is kept separate from shell
  commands.
- **New: per-tool `toolRisk` overrides** in `mcp.json` (for example, to
  stop being asked about tools that only read). Your global config can set
  any tier; a project's `.lattice/mcp.json` can only raise a tool's risk.

Upgrading changes one behavior: MCP tools that used to run silently now ask
in `safe` and `normal` mode (or are denied in non-interactive `lattice exec`
unless you use `--mode auto`). See `docs/mcp.md` to mark read-only tools
`safe`.

## v1.0.0

The first stable release. **This is a security release: everyone on v0.1.0
should upgrade.**

### Security fixes

- **A cloned repository could redirect your API key.** A project's
  `.lattice/config.toml` could set `venice.base_url`, sending your API key to
  a server of its choosing. The base URL and API key now come only from the
  environment or your global config, and the base URL must use HTTPS (plain
  HTTP is allowed only for localhost).
- **A cloned repository could loosen your permission mode.** A project config
  could set `mode = "auto"`. Project configs can now only make the mode
  stricter. Your own `--mode`, `LATTICE_MODE`, and global config work as
  before.
- **Symlinks could escape the workspace sandbox.** v0.1.0 checked paths as
  text, so a symlink inside the workspace (for example, one committed to a
  repo) could be used to read or write files outside it. File tools now
  resolve real paths.
- **Terminal escape injection.** Model output, tool arguments and results,
  and command output were printed unfiltered. Control sequences in that text
  (for example, from a file the agent read) could set your clipboard, spoof a
  permission prompt, or, in a terminal with remote control enabled, run
  commands. Untrusted output is now sanitized before it's printed.
- **Session ids weren't validated.** `lattice sessions delete ../x` could
  delete a `.json` file outside the sessions folder. Session ids from
  `/load`, `--session`, and `lattice sessions` are now validated.
- **Private data had default file permissions.** `lattice setup` wrote the
  API key into a `config.toml` that other local users could read, and
  sessions and the audit log were readable too. They're now owner-only, and
  existing files are repaired at startup.

### Cost fixes

- **No more paying for Venice's hidden system prompt.** Venice adds its own
  ~1,700-token system prompt to every request unless told not to. Lattice
  now turns it off, which saves those tokens on every call and keeps
  Venice's persona out of the agent's instructions.
- **Real token counts.** Lattice now asks Venice for usage data and reads it
  correctly. It arrives in a final message that v0.1.0 skipped, so counts
  were estimated before.

### Upgrading

```bash
cd Lattice
git pull
./install.sh
```

Behavior changes:

- `venice.base_url` and `venice.api_key` in a project's
  `.lattice/config.toml` are now ignored. Set them in
  `~/.config/lattice/config.toml` or in your environment.
- A project config's `mode` only applies if it's stricter than your own.

## v0.1.0

Initial public release: 26 native tools, arena mode, MCP client, the
permission and risk system, the interactive model picker, sessions, project
memory, undo/diff, and an audit log.
