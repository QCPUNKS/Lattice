<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Terminal UI

Lattice is a `readline`-based REPL (not a full-screen TUI framework) — this was a deliberate choice: token-by-token streaming to a scrollback-friendly terminal is simpler and more reliable than reconciling a virtual-DOM-style TUI against a live stream, and it composes naturally with Kitty's scrollback, copy/paste, and hyperlink support.

## Layout

```
╭──────────────────────────────────────────────╮
│ LATTICE                                        │
│ Personal AI Development Agent                │
│                                              │
│ Model       kimi-k2-7-code                   │
│ Provider    Venice AI                        │
│ Workspace   ~/Projects/my-app                │
│ Mode        NORMAL                           │
│ Tools       19 built-in + 6 via 1 MCP server │
╰──────────────────────────────────────────────╯

lattice › <your request>

  → read_file src/App.tsx
  ✓ export function App() {...

<streamed model response>

tokens: 4.2k │ tools: 25 │ model: kimi-k2-7-code │ mode: normal │ workspace: ~/Projects/my-app
```

## Theme

`src/ui/theme.ts` is the single place color is defined — primary/success/warning/error/tool/system/user/reasoning. Nothing else in the UI layer reaches for raw `chalk` colors directly, so retheming is a one-file change.

## Keyboard

| Key | Action |
|---|---|
| Enter | send |
| Ctrl+C | cancel the current generation or running command (idle: no-op, shows a hint) |
| Ctrl+D | exit |

## Rendering helpers

- `renderBox(kind, title, lines)` — titled box for tool/edit/browser panels (`src/ui/terminal.ts`)
- `colorizeDiff(unifiedDiff)` — green/red unified diff coloring (`src/ui/diff.ts`), used by `/diff` and `git diff` passthrough

Streamed model text is printed raw (no markdown post-processing) to keep streaming simple and reliable — the priority order in the spec puts reliability and functionality ahead of visual polish, and re-coloring already-printed terminal output mid-stream is exactly the kind of complexity that trades reliability for looks.
