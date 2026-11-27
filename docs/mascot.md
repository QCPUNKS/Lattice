<!-- Copyright (c) 2026 Jevante Boxley -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Kit10: mascot and visuals

Lattice has **Kit10**, an animated mascot who shows what the agent is doing, a
gradient LATTICE wordmark, and a starfield banner. The artwork comes from the
design sheets in `assets/mascot/source/`.

The animation runs inside the terminal itself (Kitty graphics protocol), so
it costs Lattice no CPU. It works in Kitty, WezTerm, Ghostty, and Konsole ≥ 22.04.
Every other terminal gets the text wordmark and the plain spinner.

## What she does

| When Lattice is… | Pose |
|---|---|
| waiting for the model | thinking expressions (hmm, look up, side look…) |
| reading files, searching, inspecting git | at the screens (`program`) |
| editing or creating files | typing at the laptop |
| running commands and tests | building |
| generating an image | building with sparks and hearts |
| recording your voice | listening |
| transcribing | thought bubble |
| speaking a reply | talking faces |
| asking permission | steps aside while the prompt is shown |

At startup she climbs the terminal wall, pulls herself over, and waves beside
the title. `/context` shows her token bag, which gets fuller as the context
window fills. `/mascot` (or `/kit10`) tours every pose.

The pose table is data: `src/ui/mascot/choreography.ts` (`POSES`, plus
`TOOL_ACTIVITY` for which tool counts as which activity). Changing her
behavior never means touching the renderer.

## Settings

```toml
[ui]
mascot = true            # false → plain spinner and text title
mascot_rows = 5          # stage height in rows (3–12)
intro = true             # climb-in at startup
reduced_motion = false   # true → still poses, no spinner redraws
background = "#050b12"   # session background (restored on exit); false = leave the terminal alone
```

Environment overrides: `LATTICE_MASCOT=0`, `LATTICE_REDUCED_MOTION=1`.

**Reduced motion** is for screen-reader users (animated lines get re-announced)
and anyone who finds motion distracting. The mascot still appears, but holds
a single frame.

**Background:** Lattice sets the design's deep navy for the session and
restores your own color on exit, including after Ctrl+C or a crash. With a
translucent terminal (`background_opacity` below 1 in `kitty.conf`) the
navy blends with your desktop, so it'll look close to your usual background.

## How the art gets into Lattice

```
assets/mascot/source/*.png   the design sheets (untouched)
assets/mascot/regions.json   where each animation sits on the sheets
scripts/mascot/build_atlas.py  cuts, cleans, and aligns frames
assets/mascot/frames/…       the result: one folder of PNG frames per animation
assets/mascot/mascot.json    manifest the runtime reads
```

Rebuild after changing a sheet or `regions.json` (needs Pillow, numpy, scipy):

```bash
python3 scripts/mascot/build_atlas.py --preview /tmp/mascot-preview
```

`--preview` writes a contact sheet per animation so you can check the cuts.
`--only name …` rebuilds just those entries.

The builder removes each sheet's baked-in background, splits frames using
the captions under them (or empty columns), drops slivers of neighbouring
frames, and anchors every frame bottom-center so the character doesn't
jitter between frames. `sequences` chain animations onto one canvas; the
intro is `climb` + `climb_top`.

### Swapping in hand-drawn frames

The current frames are cut from AI-generated concept sheets, and the
character shifts slightly between frames (face details, hair strands),
which reads as a subtle shimmer when looped. For crisp animation, redraw
the key loops (`idle`, `type`, `build`, `program`, `expr_thinking`) in
Aseprite or LibreSprite on a fixed grid with a transparent background.
Then either point `regions.json` at the new sheets, or write
`frames/<name>/<n>.png` and the manifest entry directly. No code changes are
needed either way.
