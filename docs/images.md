<!-- All Rights Reserved: Jevante Boxley -->
<!-- QCPUNKS SECTOR -->

# Image generation

Generate images with your Venice image models without leaving the terminal.
They're shown inline in terminals that support the Kitty graphics protocol
(Kitty, WezTerm, Ghostty, Konsole ≥ 22.04) and saved to a folder you choose.

```text
lattice › /imagine a glass cube floating over a neon grid --aspect 16:9
  saved ~/Pictures/lattice/2026-09-22_161604_z-image-turbo_454463673.png
  z-image-turbo  ·  seed 454463673  ·  5.1s  ·  ~$0.01
```

## First run

The first `/imagine` asks two things, then remembers them in
`~/.config/lattice/config.toml`:

1. **Where to save images.** There is no default on purpose. The folder is
   created owner-only (700). If it already exists and other users can read it,
   Lattice offers to lock it down. It refuses folders other users can
   *write*, and warns if the folder is inside a git repository, since images
   there are one `git add .` from being published.
2. **Safe mode default.** Venice's safe mode blurs adult content. Choose the
   default; override any single image with `--safe` or `--nsfw`.

Re-run any time with `/image setup`.

## `/imagine` on its own

Nothing to remember: it asks what to paint, then the shape.

```text
lattice › /imagine
What should I paint? (Enter to cancel) a glass cube floating over a neon grid
Shape: 1 square  2 wide  3 tall  (Enter = usual) 2
```

"Wide" and "tall" use 16:9 and 9:16 when the model supports them, and
otherwise the widest or tallest ratio the model offers. `/imagine help` lists
every option below.

## `/imagine <prompt> [options]`

| Option | Meaning |
|---|---|
| `--model`, `-m <id>` | Image model for this image (default: `/image model`) |
| `--aspect`, `-a <W:H>` | Aspect ratio: `1:1`, `16:9`, `9:16`, … |
| `--res <1K\|2K\|4K>` | Resolution tier, for models that have tiers |
| `--neg "<text>"` | Negative prompt: what to avoid |
| `--seed <n>` | Reproduce an earlier image (the seed is in its file name) |
| `--steps <n>` | Inference steps (capped at the model's maximum) |
| `--n <1-4>` | Number of variants |
| `--safe` / `--nsfw` | Override the safe-mode default for this image |
| `--allow-anonymized` | Permit a model that forwards prompts to a third party |

Venice models don't share one sizing scheme: some take pixel sizes, some an
aspect ratio, some a resolution tier. `--aspect` is translated into whatever
the chosen model accepts. If the model can't do that ratio, the error lists
the ones it can.

## `/image` settings

| Command | Does |
|---|---|
| `/image` | Show model, folder, safe mode |
| `/image models` | Every image model, private ones first, with price and supported sizes |
| `/image model <id>` | Set the default model |
| `/image output <path>` | Change the output folder (same privacy checks as setup) |
| `/image safe on\|off` | Change the safe-mode default |
| `/image open` | Open the folder in your file manager |
| `/image setup` | Re-run first-time setup |

## Privacy

- **Private-only by default.** Venice labels each model `private` (runs on
  Venice, prompts not stored) or `anonymized` (forwarded to a provider like
  OpenAI or Google with your identity stripped, but the prompt still leaves
  Venice). With `private_only = true`, anonymized models need
  `--allow-anonymized` per image. `/image models` shows which is which.
- **File names never contain the prompt.** They're
  `<date>_<time>_<model>_<seed>.png`, so a folder listing doesn't reveal what
  you asked for. Set `save_metadata = true` if you *want* a `.json` sidecar with
  the prompt and settings for each image.
- **Images are saved owner-only (600)** and never overwrite an existing file,
  including a planted symlink.
- **The audit log records that an image was made** (model, count, seed), never
  the prompt.

## The agent's `generate_image` tool

The agent can create images while it works, for example a hero image for a
landing page. It's deliberately limited:

- It can't choose the model, flip safe mode, use anonymized models, or change
  the output folder. Those are your decisions, made through `/image`, not
  something a prompt injected into a file the agent read can change.
- It works only after you've run setup yourself.
- Each call goes through the permission gate as a network action, showing the
  model and estimated cost. At most 2 images per call.
- `copy_to: "public/hero.png"` also copies the first image into the
  workspace, subject to the normal write permission and `/undo`.
- It's disabled in arena runs, so racing three models never buys three sets of
  images.

## Costs

Prices come live from Venice's catalog and are shown in `/image models` and
after each image. At the time of writing, the default `z-image-turbo` is
$0.01 per image.
