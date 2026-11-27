<!-- Copyright (c) 2026 Jevante Boxley -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Terminal UI

Lattice is a `readline`-based REPL (not a full-screen TUI framework) — this was a deliberate choice: token-by-token streaming to a scrollback-friendly terminal is simpler and more reliable than reconciling a virtual-DOM-style TUI against a live stream, and it composes naturally with Kitty's scrollback, copy/paste, and hyperlink support.

## Layout

```
╭──────────────────────────────────────────────╮
│ LATTICE                                        │
│ Personal AI Development Agent                │
│                                              │
│ Model       deepseek-v4-flash-0731           │
│ Provider    Venice AI                        │
│ Workspace   ~/Projects/my-app                │
│ Mode        NORMAL                           │
│ Tools       19 built-in + 6 via 1 MCP server │
╰──────────────────────────────────────────────╯

lattice › <your request>

  → read_file src/App.tsx
  ✓ export function App() {...

<streamed model response>

tokens: 4.2k │ tools: 25 │ model: deepseek-v4-flash-0731 │ mode: normal │ workspace: ~/Projects/my-app
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

## Rendered replies

Model replies are rendered as markdown **while they stream** (`src/ui/markdown/`), without ever re-coloring text that's already on screen:

- **Prose streams token by token.** Formatting markers are swapped for styling as they arrive. The only text ever held back is a marker whose meaning depends on the next character or two (a lone `*`, a `#` at the start of a line, an unfinished `[link](`).
- **Code blocks** are framed with their language and syntax-highlighted a line at a time (`highlight.ts`, dependency-free).
- **Tables** are buffered until they end, then drawn aligned in a box. A table wider than the terminal is printed as its original rows instead of being truncated.
- **Links keep their address visible**, so a label can't disguise where a link goes.
- **Output that isn't a terminal** (piped `lattice exec`, logs) gets the raw markdown source, not escape codes.

The renderer adds styling only. Untrusted model text is sanitized before it reaches the renderer, exactly as before. A unit test checks that every way of chunking a reply displays the same result.

## Feature identity

Each major feature has one accent, one glyph and a framed section (`src/ui/features.ts`), so the screen always shows which part of Lattice you're in:

| Feature | Accent | Glyph | Where it shows |
|---|---|---|---|
| Imagine | violet | ✦ | `/imagine` section frame, twinkling spinner, saved/cost summary |
| Arena | amber | ◈ | race header, scorecard box |
| Voice | teal | ◉ | prompt mic marker, "you said" line, listening/speaking spinner |

Chat stays in the brand cyan. Feature identity only changes how a feature looks, never how it behaves.
