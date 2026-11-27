<!-- Copyright (c) 2026 Jevante Boxley -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Lattice User Guide

This guide covers every Lattice command in plain language: what it does, when you'd use it, and an example. If you've never used Lattice, read **Part 1** first. After that, use it as a reference.

**Contents**

1. [Getting started (5 minutes)](#part-1--getting-started)
2. [Talking to Lattice, and how approvals work](#part-2--talking-to-lattice)
3. [Terminal commands (`lattice …`)](#part-3--terminal-commands)
4. [In-chat commands (`/…`)](#part-4--in-chat-commands)
5. [Recipes for common jobs](#part-5--recipes)
6. [Exit codes, for scripts](#part-6--exit-codes)
7. [When something goes wrong](#part-7--when-something-goes-wrong)

> **Two kinds of commands.** Lattice has two places you type commands, and it helps to keep them apart:
>
> - **Terminal commands** start with `lattice` and run from your normal shell prompt, e.g. `lattice doctor`.
> - **In-chat commands** start with `/` and run *inside* a Lattice chat, after you've launched it, e.g. `/model`.
>
> Some names exist in both places (`test`, `build`, `diff`, `arena`…). Where they behave differently, this guide says so.

---

## Part 1 — Getting started

### Step 1: Install

```bash
cd Lattice
./install.sh
```

This installs the dependencies, builds Lattice, and puts the `lattice` command on your PATH. You need Node.js 20 or newer.

### Step 2: Give it your API key

Lattice talks to AI models through Venice AI, so it needs your Venice API key. The easiest way:

```bash
lattice setup
```

It asks four questions, and you can press **Enter** to keep the value shown in `[brackets]`:

1. **Venice API key**: paste your key from venice.ai.
2. **Default model**: which AI model to use. It lists models that can use tools (the only kind that can edit files).
3. **Default workspace**: the folder Lattice works in when you don't say otherwise.
4. **Permission mode**: how much Lattice may do without asking. Pick `normal` if unsure (explained in Part 2).

Everything is saved to `~/.config/lattice/config.toml`.

### Step 3: Check that everything works

```bash
lattice doctor
```

You want green ✓ marks next to **VENICE_API_KEY set**, **API reachable**, and **Model supports tool calling**. A red ✗ tells you what to fix.

### Step 4: Start working

Go to a project folder and launch Lattice:

```bash
cd ~/Projects/my-app
lattice
```

Then type what you want in plain English and press Enter:

```text
Lattice› Find why the login page crashes and fix it, then run the tests.
```

Lattice reads files, runs commands, and edits code. You'll see each step as it happens (`→ read_file …`, `✓ …`). To leave, type `/quit` or press **Ctrl+D**.

---

## Part 2 — Talking to Lattice

### Keys you'll use

| Key | What it does |
|---|---|
| **Enter** | Send your message. |
| **Ctrl+C** | Stop whatever Lattice is doing right now (a reply, a command, an image). Your chat stays open. |
| **Ctrl+D** | Quit Lattice. |
| **Enter on an empty line** | Stops Lattice talking out loud. In a voice-input mode, it also starts recording (see `/voice`). |

### When Lattice asks permission

Before Lattice does anything that changes your machine, it may stop and ask:

```text
  Allow? [y]es / [n]o / [a]lways this session:
```

- **y**: allow this one action.
- **n**: refuse it. Lattice is told it was refused and works around it.
- **a**: allow this kind of action for the rest of this chat, so it won't ask again. It resets when you quit.

**When does it ask?** That depends on the **mode** and on how risky the action is. Lattice sorts every shell command into one of four risk levels:

| Risk | Examples |
|---|---|
| safe | `ls`, `cat`, `git status`, `npm test`, `pytest`, `make` |
| caution | `npm install`, `pip install`, `git checkout`, `git pull`, `npx …`, anything it doesn't recognize |
| destructive | `rm`, `git reset --hard`, `git push --force`, deleting a file |
| critical | `sudo`, `chmod -R`, `dd`, `shutdown`, `curl … \| bash` |

And the three modes decide what happens at each level:

| Mode | safe | caution | destructive / critical |
|---|---|---|---|
| **safe**: asks about everything | asks | asks | asks |
| **normal** (default) | just does it | asks | asks |
| **auto**: for when you trust the task | just does it | just does it | asks |

**Destructive and critical actions always ask, in every mode.** Lattice also always asks before reading secret files (`.env`, `*.pem`, `*.key`, SSH keys, `credentials.*`, `secrets.*`), and it can never touch files outside your workspace folder.

---

## Part 3 — Terminal commands

Run these from your normal shell. Every one of them accepts the **options** below.

### Options that work with any command

| Option | What it does | Example |
|---|---|---|
| `--model <id>` | Use a different AI model just for this run. | `lattice --model gemini-3-7-flash` |
| `--mode <safe\|normal\|auto>` | Use a different permission mode just for this run. | `lattice --mode safe` |
| `--workspace <folder>` | Work in a different folder without `cd`-ing there. | `lattice --workspace ~/Projects/api` |
| `--session <id\|latest>` | Continue a past conversation instead of starting fresh. | `lattice --session latest` |
| `--debug` | Print extra diagnostic detail. | `lattice exec "…" --debug` |
| `-h`, `--help` | Print a summary of every terminal command. `lattice help` works too. | `lattice --help` |
| `-v`, `--version` | Print the installed version. | `lattice -v` |

You can also launch Lattice on a folder by just naming it: `lattice ~/Projects/my-app` is the same as `cd ~/Projects/my-app && lattice`.

---

### `lattice`: start a chat

```bash
lattice
lattice ~/Projects/my-app        # start in a specific folder
lattice --session latest         # pick up where you left off in this folder
```

Opens the interactive chat. This is where you'll spend most of your time. Everything in [Part 4](#part-4--in-chat-commands) runs in here.

---

### `lattice exec "<task>"`: do one job and exit

```bash
lattice exec "Run the test suite and fix every failure."
```

Runs a single task without opening a chat, then exits. Useful in scripts, Makefiles, and CI.

**Important:** no one is there to answer permission questions, so anything that would normally ask is **refused automatically** rather than left waiting. If the task needs to install packages or run unfamiliar commands, add `--mode auto`:

```bash
lattice exec --mode auto "Install the missing dependencies and get the build passing."
```

Even in `auto`, destructive and critical actions are still refused. The exit code tells your script whether it worked (see [Part 6](#part-6--exit-codes)).

### `lattice ask "<question>"`: ask one question and exit

```bash
lattice ask "What does this project do, and where is the entry point?"
```

Works exactly like `exec`. Use `ask` for questions and `exec` for changes, so your scripts read clearly.

---

### `lattice setup`: the setup wizard

```bash
lattice setup
```

Walks you through API key, default model, default workspace, and permission mode (see Part 1). Run it again any time to change those defaults. If your key already comes from an environment variable or `.env`, setup leaves it alone.

### `lattice doctor`: health check

```bash
lattice doctor
```

Checks that:

- **your tools are installed**: Node.js, git, ripgrep, fd, docker, bun, kitty. Only Node and git are essential. ripgrep makes searching faster.
- **your settings are valid**: API key, model, mode, workspace folder.
- **Venice is reachable**, your model exists, and it supports tool calling.
- **your MCP config file is valid** (if you have one).

Run this first whenever something isn't working.

### `lattice models`: list available AI models

```bash
lattice models
```

Lists every model Venice offers, with:

- `ctx`: how much text the model can hold in mind at once (bigger = can work with larger projects).
- `tools`: **must be `true`** for Lattice to edit files or run commands with it.
- `reasoning`: the model "thinks" before answering. Better at hard problems, slower and pricier.
- `vision`: it can look at images.

For prices, use `/model` or `/models` inside a chat. They also show cost per million tokens.

---

### `lattice config`: view and change settings

```bash
lattice config                          # same as: lattice config show
lattice config show                     # print every active setting (API key is hidden)
lattice config set <key> <value>        # change a setting permanently
lattice config edit                     # prints where the config file lives
```

Examples of `set`:

```bash
lattice config set model gemini-3-7-flash
lattice config set mode auto
lattice config set agent.max_iterations 50
lattice config set generation.max_tokens 8192
lattice config set context.token_budget 200000
```

`set` always writes to your **global** config (`~/.config/lattice/config.toml`), so the change applies in every project. `true`/`false` and numbers are understood automatically. `edit` doesn't open an editor; it tells you the file path so you can open it yourself. Every available setting is listed in `docs/configuration.md`.

**Where settings come from.** When the same setting is set in more than one place, the one higher in this list wins:

1. Flags on the command (`--model`, `--mode`, `--workspace`)
2. The project's own `.lattice/config.toml`
3. Your global `~/.config/lattice/config.toml`
4. Environment variables / `.env` (`LATTICE_MODEL`, `LATTICE_MODE`, …)
5. Built-in defaults

So if `lattice config set model …` seems to be ignored, look for a `model =` line in the project's `.lattice/config.toml`. The one exception is the **API key**: `VENICE_API_KEY` from the environment or `.env` wins over an `api_key` in the config file.

A project's config is limited, because it arrives with whatever repo you downloaded. It can make the permission mode **stricter** but never looser, so a repo can't switch you to `auto`. It also can't change where your API key is sent, your spending limits, or your image and voice settings. Only your global config controls those.

---

### `lattice sessions`: manage saved conversations

Every chat is saved automatically, so you can come back to it later.

```bash
lattice sessions                          # list all saved chats (same as: lattice sessions list)
lattice sessions delete <id>              # delete one permanently
lattice sessions export <id>              # save it as a readable Markdown file
lattice sessions export <id> --format json  # …or as JSON
```

The list shows each chat's **id**, when it was last used, which folder it was in, how many messages it has, and a preview. Exports are written to the folder you're currently in, named `lattice-session-<id>.md` (or `.json`).

To **continue** a chat, start Lattice with `--session`:

```bash
lattice --session latest       # the most recent chat in this folder
lattice --session <id>         # a specific chat
```

`lattice session` (singular) works too.

---

### `lattice mcp`: external tool servers

MCP servers are add-ons that give Lattice extra tools (for example, a Blender controller or a database browser). You list them in `~/.config/lattice/mcp.json` (trusted, all projects) or `<project>/.lattice/mcp.json` (that project only; Lattice asks before starting these). Setup details: `docs/mcp.md`.

```bash
lattice mcp            # list configured servers (same as: lattice mcp list)
lattice mcp test       # actually connect to each one and report how many tools it offers
```

Use `test` after adding a server, to see whether it starts.

---

### `lattice arena`: race several models on the same task

Runs the same task with 2 or more models at once. Each works in its own copy of your repo, so they can't interfere with each other or with your code. Then you compare the results and keep only the best one.

```bash
lattice arena "Add input validation to the signup form" --models deepseek-v4-flash-0731,qwen3-coder --tests "npm test"
```

- `--models`: **required**, at least two model ids separated by commas, no spaces.
- `--tests`: optional. A command run in each copy after its model finishes. Pass/fail goes on the scorecard.

Your project must be a git repository. When the race finishes you get a **scorecard**: tests passed, files changed, lines added/removed, tokens used, and time taken for each model.

Then decide:

```bash
lattice arena diff               # quick per-file summary for every model
lattice arena diff <label>       # the full code changes from one model
lattice arena pick <label>       # merge that model's work into your branch, discard the rest
lattice arena clean              # discard all of them, merge nothing
lattice arena list               # every past and open race
```

The `<label>` is the name shown on the scorecard. **Nothing is merged until you `pick`.**

---

### Project shortcuts

These run common jobs in your workspace without involving the AI, so they're free and instant.

| Command | What it does |
|---|---|
| `lattice inspect` | Summarizes the project: what kind it is, key files, and detected languages and tools. |
| `lattice status` | Shows the git branch and counts of staged, modified, and untracked files. |
| `lattice diff` | Shows all uncommitted changes (`git diff`). |
| `lattice diff <file>` | Uncommitted changes in one file. |
| `lattice test` | Finds and runs the project's tests. |
| `lattice build` | Finds and runs the project's build. |
| `lattice run` | Runs your `dev` (or `start`) script in this terminal, like `npm run dev`. Output appears live. **Ctrl+C** stops it, and Lattice waits for it to shut down cleanly. |
| `lattice audit` | Shows the last 50 entries of the security log. |
| `lattice audit <n>` | Shows the last *n* entries, e.g. `lattice audit 200`. |

**How `test` and `build` find the right command:**

| If your project has… | test runs | build runs |
|---|---|---|
| `package.json` with a `test` / `build` script | `npm test` (or pnpm/yarn/bun, whichever you use) | `npm run build` |
| `Cargo.toml` | `cargo test` | `cargo build` |
| `go.mod` | `go test ./...` | `go build ./...` |
| `pytest.ini` or `pyproject.toml` | `pytest` | — |

If nothing matches, it says "No test command detected".

**What's in the audit log?** Every permission question and your answer, every command Lattice ran, and every session you deleted, with timestamps. Use it to check exactly what Lattice did while you weren't watching. API keys never appear in it.

**`lattice run` vs `/run`:** `lattice run` keeps the server in the foreground of your terminal. To run it in the **background** while you keep chatting, use `/run` inside a chat, then `/ps` and `/stop` to manage it. Background servers stop when you quit that chat.

---

## Part 4 — In-chat commands

Type these inside a Lattice chat. `/help` prints the full list at any time.

### Help and exiting

| Command | What it does |
|---|---|
| `/help` | Lists every in-chat command. |
| `/quit` or `/exit` | Leaves Lattice (Ctrl+D also works). |

### Choosing the AI model

| Command | What it does |
|---|---|
| `/model` | Opens the **model picker**: a numbered list, cheapest first, showing price and capacity. Type a number (or a model id) and press Enter, or just press Enter to keep the current one. |
| `/model <id>` | Switches straight to a model, e.g. `/model gemini-3-7-flash`. |
| `/models` | Lists every model with price, context size, and abilities (including ones that can't use tools). |

The picker only shows models that can use tools, because the others can't edit files. When you switch, Lattice warns you if the new model costs much more ("~12× the cost of …") or tells you if it's cheaper. Prices are dollars per million tokens, shown as *input / output*. Coding work is mostly output.

### Seeing what's going on

| Command | What it does |
|---|---|
| `/status` | Git branch and file counts, plus the current session id and message count. |
| `/tools` | Every tool the AI can use: the 26 built-in ones plus any from MCP servers. |
| `/mcp` | Which MCP servers connected (✓) or failed (✗, with the reason). |
| `/context` | How full the AI's memory of this chat is, e.g. `~42000 tokens / 100000 budget`. |
| `/cost` or `/spend` | Your money: Venice balance, spend this session / today / this month, top models by spend, and progress bars against your budget. |

### Managing the conversation

The AI can only hold so much of a conversation at once. These commands help when a chat gets long or goes off track.

| Command | What it does |
|---|---|
| `/compact` | Shrinks the conversation by summarizing older parts, freeing up room. Lattice also does this automatically as it nears the limit. |
| `/clear` | Wipes the conversation so the AI starts with a blank memory. The session id stays the same. |
| `/reset` | Like `/clear`, but also starts a new session id. The old chat stays saved. |
| `/forget` | **Permanently deletes** this chat from disk (asks first), then starts a fresh one. Use it when you discussed something you don't want kept. |
| `/retry` | Re-sends your last message, for when a reply went wrong or you switched models and want a second opinion. |

### Sessions (saved chats)

| Command | What it does |
|---|---|
| `/session` | Shows this chat's id, folder, model, and message count. |
| `/sessions` | Lists all saved chats. |
| `/save` | Saves the chat now. |
| `/save <label>` | Saves it with a name so it's easy to find, e.g. `/save auth-refactor`. |
| `/load <id>` | Switches to a saved chat. |

### Workspace and permissions

| Command | What it does |
|---|---|
| `/workspace` | Shows which folder Lattice is working in. |
| `/cd <path>` | Moves Lattice to a different folder, e.g. `/cd ../api`. |
| `/permissions` | Shows the current mode and which actions you've "[a]lways" allowed this session. |
| `/mode safe` / `/mode normal` / `/mode auto` | Changes the permission mode for this chat (see Part 2). |

### Undoing the AI's changes

Lattice saves a copy of every file **before** it changes it, so you can undo even without git.

| Command | What it does |
|---|---|
| `/diff` | Shows exactly what the AI changed **in its last reply**. |
| `/diff <file>` | The same, for one file. |
| `/undo` | Puts every file changed in the last reply back the way it was. Files the AI *created* are removed. |

> `/diff` (in chat) shows **the AI's last reply's changes**. `lattice diff` (terminal) shows **all uncommitted git changes**, including yours.
>
> `/undo` only reaches back **one reply**. To undo older work, use git.

### Running your project

| Command | What it does |
|---|---|
| `/test` | Runs your tests (same detection as `lattice test`). |
| `/build` | Runs your build. |
| `/run` | Starts your `dev` (or `start`) script in the background, e.g. a local web server. If it's already running, it reuses it. Each process gets an id like `proc_1`. |
| `/ps` | Lists background processes: id, running or stopped, how long it's been up, and the command. |
| `/stop <id>` | Stops one, e.g. `/stop proc_1`. Background processes are also stopped when you quit. |
| `/git <anything>` | Runs a git command directly, e.g. `/git log --oneline -5`, `/git stash`. |

### Arena (race models)

The same as `lattice arena` (Part 3), but from inside a chat, with a live progress view while the models work:

```text
/arena "Add input validation to the signup form" --models modelA,modelB --tests "npm test"
/arena diff [label]
/arena pick <label>
/arena list
/arena clean
```

Put the task in **double quotes**.

### Images

| Command | What it does |
|---|---|
| `/imagine <description>` | Generates an image and shows it right in the terminal (Kitty, WezTerm, Ghostty, Konsole). |
| `/imagine` | With nothing after it, shows all the options. |
| `/image` | Shows your image settings. |
| `/image setup` | Re-runs first-time image setup (save folder and safe mode). |
| `/image models` | Lists image models: private or third-party, price, and supported sizes. |
| `/image model <id>` | Sets your default image model. |
| `/image output` | Shows where images are saved. |
| `/image output <folder>` | Changes the save folder, e.g. `/image output ~/Pictures/lattice`. |
| `/image safe on` / `off` | Turns safe mode on or off. On blurs adult content. |
| `/image open` | Opens your image folder in your file manager. |

The first time you use `/imagine`, it asks where to save images. Nothing is saved until you choose.

**`/imagine` options**, added after your description:

| Option | Meaning | Example |
|---|---|---|
| `--aspect` / `-a` | Shape | `--aspect 16:9` (wide), `9:16` (phone), `1:1` (square) |
| `--res` | Resolution, on models that support it | `--res 2K` |
| `--neg "…"` | Things to leave out | `--neg "text, watermark"` |
| `--n` | How many versions, 1–4 | `--n 3` |
| `--seed` | Repeat an earlier image exactly | `--seed 12345` |
| `--steps` | Detail passes (more is slower and often better) | `--steps 30` |
| `--model` / `-m` | Use a different model just this once | `-m z-image-turbo` |
| `--safe` / `--nsfw` | Override safe mode for this image | `--nsfw` |
| `--allow-anonymized` | Allow a model that sends your prompt to an outside company | |

Example:

```text
/imagine a glass cube floating over a neon grid --aspect 16:9 --n 2 --neg "blurry"
```

By default Lattice only uses **private** models, which run on Venice itself without storing your prompt. File names never include your prompt.

### Voice

Talk to Lattice and/or have it talk back. Choose one of four modes:

| Command | You… | Lattice… |
|---|---|---|
| `/voice chat` | speak | speaks back (and prints captions) |
| `/voice dictate` | speak | replies in text |
| `/voice listen` | type | speaks back |
| `/voice off` | type | replies in text |

**How to talk:** press **Enter on an empty line** to start recording, speak, then press **Enter** again to send. **Ctrl+C** cancels. Lattice prints what it heard (`you said: …`) before acting on it. When Lattice is speaking, press **Enter on an empty line** to stop it. Code blocks are never read aloud.

| Command | What it does |
|---|---|
| `/voice` | Shows your voice settings. |
| `/talk` | Speak a single message now, in any mode, even `off`. |
| `/voice engine local` | Use the free voice that runs on your own computer, offline (default). |
| `/voice engine venice` | Use Venice's hosted voice (paid per use). |
| `/voice voices` | Lists available voices. In Kokoro names, the first letter is the accent (**a** American, **b** British) and the second is **f**emale / **m**ale, e.g. `af_sky`. |
| `/voice voice <name>` | Picks a voice. |
| `/voice speed <0.25–4>` | Speaking speed. `1` is normal, `1.3` is a bit faster. |
| `/voice mic` | Lists your microphones. ● marks the one in use. |
| `/voice mic <number>` | Picks a microphone from that list. |
| `/voice test` | Says a test sentence so you can hear the current voice. |
| `/voice models` | Lists Venice's hosted voice models (only used with the `venice` engine). |
| `/voice model <id>` | Picks a hosted voice model. |
| `/voice help` | Lists all of the above. |

The local engine needs a one-time install: `scripts/voice/install-local-voice.sh`. Audio is never saved to disk. More detail: `docs/voice.md`.

### Kit10 (the mascot)

| Command | What it does |
|---|---|
| `/kit10` or `/mascot` | Kit10 shows all her poses (thinking, reading, typing, painting…) so you know what each one means. Ctrl+C ends the tour early. |
| `/kit10 off` / `/kit10 on` | Turns her off or on. Takes effect the next time you start Lattice. |

She appears only in terminals that support images (Kitty, WezTerm, Ghostty, Konsole 22.04+). To keep her still, set `reduced_motion = true` under `[ui]` in your config.

---

## Part 5 — Recipes

**Fix a bug, and make sure nothing broke**
```text
Lattice› The checkout total is wrong when a coupon is applied. Find the cause, fix it, and run the tests.
/diff          ← review what it changed
/undo          ← if you don't like it
```

**Understand a project you just cloned**
```bash
lattice inspect
lattice ask "Explain how this project is structured and where I'd add a new API endpoint."
```

**Work safely in someone else's repo**
```bash
lattice --mode safe ~/Downloads/some-repo
```
Lattice asks before every action. If the repo has its own `.lattice/mcp.json`, you're asked before any of those servers start.

**Keep costs down**
```text
/model          ← pick something cheap from the top of the list
/cost           ← check spending
```
Set a spending limit in `~/.config/lattice/config.toml`:
```toml
[budget]
daily_usd = 2.00
monthly_usd = 20.00
```
Before a request would push you over a limit, Lattice asks whether to continue. In `exec`/`ask`, where no one can answer, it stops instead.

**Pick up yesterday's work**
```bash
lattice --session latest
```

**Get a second opinion on a hard change**
```text
/arena "Refactor the payment module to remove duplication" --models modelA,modelB --tests "npm test"
/arena diff modelA
/arena pick modelA
```

**Long chat getting slow or confused?**
```text
/context        ← see how full it is
/compact        ← squeeze it
/reset          ← or start fresh (the old chat stays saved)
```

**Run Lattice from a script or CI job**
```bash
lattice exec --mode auto "Fix lint errors" || echo "Lattice failed with code $?"
```

---

## Part 6 — Exit codes

`exec`, `ask`, and the terminal commands exit with a number your scripts can check:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General failure |
| 2 | You typed the command wrong (missing argument, unknown command) |
| 3 | Configuration problem, e.g. the model doesn't exist or can't use tools |
| 4 | API key missing |
| 5 | Couldn't reach Venice, or the AI run failed |
| 6 | A tool failed |
| 7 | An action needed permission and was refused (common with `exec` in normal mode) |
| 8 | Tests or build failed (`lattice test` / `lattice build`) |

---

## Part 7 — When something goes wrong

| Problem | Fix |
|---|---|
| `VENICE_API_KEY is not set` | Run `lattice setup`, or put `VENICE_API_KEY=…` in `.env`. Check with `lattice doctor`. |
| `Unknown command or path: …` | Typo in the command name, or the folder doesn't exist. |
| `Unknown flag: …` | That option doesn't exist. `lattice --help` lists the real ones. |
| The AI chats but never edits files | Your model can't use tools. Run `/model` and pick one from the list (all of them can). |
| `exec` exits with code 7 | It needed permission to do something. Add `--mode auto`, or run it in a chat instead. |
| A reply cut off mid-sentence | Raise the length limit: `lattice config set generation.max_tokens 8192` (reasoning models especially need this). |
| It keeps going in circles | Ctrl+C, then `/retry`, or try `/model` with a stronger model. Lattice also stops by itself after 5 identical failures in a row. |
| `/undo` says "Nothing to undo" | It only covers the AI's last reply. Use `/git` or git directly for older changes. |
| An MCP server shows ✗ | Run `lattice mcp test` for the error, and see `docs/mcp.md`. |
| No mascot or no images shown | Your terminal doesn't support Kitty graphics. Use Kitty, WezTerm, Ghostty, or Konsole 22.04+. |
| Voice doesn't hear you | `/voice mic` to check the right microphone is selected, then `/voice mic <number>`. |

More: `docs/troubleshooting.md`. Security details: `SECURITY.md`.
