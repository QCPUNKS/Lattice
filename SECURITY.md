<!-- All Rights Reserved: Jevante Boxley -->
<!-- QCPUNKS SECTOR -->

# Lattice security model

No software is "fully secure." This document lists what Lattice protects,
what it doesn't, and why, so every gap is a known, deliberate decision
rather than a surprise.

## What Lattice protects

| Asset | Where it lives |
|---|---|
| Venice API key | env var / `.env` / `~/.config/lattice/config.toml` |
| Your code and files | the workspace, plus everything else your account can reach |
| Conversations and voice transcripts | `~/.local/share/lattice/sessions/` |
| Microphone | opened only by push-to-talk |
| Generated images and their prompts | your chosen image folder |
| Money | per-call charges for chat, images, speech |

## Threats and defenses

### 1. A malicious repository

You clone something and run Lattice in it. The repo can contain
`.lattice/config.toml`, `.lattice/mcp.json`, symlinks, and text crafted to
manipulate the model.

- **API key theft by redirection:** blocked. `venice.base_url` is read from
  the global config only; a project config can't point your bearer token at
  another server. Any base URL must be HTTPS (plain HTTP only for loopback).
- **Loosening your safety settings:** blocked. A project config may make the
  permission mode *stricter* but never looser (a repo can't switch you to
  `auto`), can't supply an API key, and can't raise `[budget]` limits.
- **Redirecting images or the microphone:** blocked. All `[image]` and
  `[voice]` settings are global-config only.
- **Symlink escape from the workspace:** blocked. File tools resolve real
  paths, so a symlink inside the workspace that points elsewhere (e.g.
  `notes -> ~`) is refused for reads, writes, and new files beneath it.
- **Project MCP servers:** never started without an explicit yes; never
  started at all non-interactively.
- **Prompt injection** (instructions hidden in files, web pages, or tool
  output): *mitigated, not prevented.* No agent can reliably tell injected
  instructions from real ones. The defense is the permission gate: in
  `normal` mode, anything with side effects beyond workspace edits asks you
  first, and destructive/critical actions always ask in every mode. Treat
  `auto` mode in an untrusted repo as trusting that repo.

- **Terminal escape injection:** blocked. Everything Lattice doesn't
  control (model replies, tool arguments and results, command output,
  labels, transcripts, names from the Venice catalog) has control codes
  stripped before it's printed, so a file the agent reads can't set your
  clipboard, spoof a prompt, or drive a terminal with remote control enabled.
  If you use Kitty, prefer `allow_remote_control socket-only` (or `no`) in
  `kitty.conf`: with `yes`, any program that prints to the terminal (not
  just Lattice) can send it commands.

### 2. Other accounts on the same machine

- Session files, the audit log, arena runs, and the global config are
  written owner-only (files 600, directories 700) regardless of umask, and
  data written by older versions is tightened on startup.
- Image folders: created 700; folders other users can write to are refused.
  Images are written 600 with `O_EXCL`, so an existing file or a planted
  symlink is never overwritten.
- Recorded audio and synthesized speech never touch disk.

### 3. Leaking privacy through logs and names

- The audit log records *that* things happened (tool calls, permission
  decisions, "image generated", "voice transcribed, 4.2 s"), never image
  prompts or transcripts.
- API keys never appear in logs in full (`redactKey`).
- Image file names contain date, model, and seed, never the prompt.

### 4. The model spending your money

- Every image the agent requests goes through the permission gate with the
  model and estimated cost; at most 2 per call.
- The agent can't choose the image model, disable safe mode, or use a
  third-party (anonymized) model; only you can, through `/image`.
- Paid tools are disabled in arena runs.

### 5. Data leaving your machine

Everything you send to Venice leaves your machine: prompts, code the agent
reads, voice audio, image prompts. Venice labels models:

- `private`: runs on Venice-controlled infrastructure; Venice states prompts
  aren't stored.
- `anonymized`: forwarded to a third party (OpenAI, Google, …) with your
  identity stripped; the content itself still reaches them.

Image and voice features refuse `anonymized` models by default
(`private_only = true`). **Chat models are not filtered this way yet** (see
open items). Venice's retention claims are theirs to keep; Lattice can't
verify them.

### 6. The accidental publish

- The v3 repository can push only to local paths (the encrypted vault
  backup). A pre-push hook refuses every network remote, whatever branch,
  tag, or commit is named.
- `package.json` is marked `"private": true`, so `npm publish` refuses.
- An image folder inside a git repository triggers a warning at setup.
- `.env` and `.lattice/` are gitignored.

## Known gaps and open items

Ordered by priority. These are real and not yet addressed.

1. **API key at rest is plaintext** in `.env` or `config.toml` (owner-only
   file). Next step: store it in the desktop keyring (KDE Wallet / GNOME
   Keyring via the Secret Service API) and read it at startup.
2. **Chat model privacy isn't enforced.** The `/model` picker doesn't show or
   filter `private` vs `anonymized` yet.
3. **Sessions are kept forever** until you `/forget` them. Next step: a
   `[sessions] retain_days` setting with automatic cleanup.
4. **Sessions aren't encrypted at rest.** File permissions stop other
   accounts; they don't stop anyone with your account or your unencrypted
   disk. Full-disk encryption (LUKS) is the right tool for that, and is
   stronger than anything Lattice could add on its own.
5. **Shell commands aren't sandboxed.** `run_command` runs with your full user
   privileges; the permission gate classifies risk, but an approved command
   can do anything you can. Container or namespace sandboxing is a candidate
   for a future version.
6. **Symlink check race (TOCTOU):** a path is checked, then used. Something
   that swaps a symlink in that window could still escape. It requires
   code already running as your user, which is outside this threat model.

## Reporting

This is a private project. Report issues directly to Jevante Boxley.
