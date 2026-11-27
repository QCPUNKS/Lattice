<!-- Copyright (c) 2026 Jevante Boxley -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Lattice

**An AI coding partner that lives in your terminal.**

Tell Lattice what you want in plain English: *"fix the login bug and run the tests."* It reads your code, makes the changes, runs your commands, and shows you every step. It asks before doing anything risky, and one command undoes its last change.

Lattice runs on [Venice AI](https://venice.ai), so you bring your own Venice API key and pay Venice only for what you use. Lattice itself is free.

```text
lattice › The checkout total is wrong when a coupon is applied. Fix it and run the tests.

  → search_content {"pattern":"applyCoupon"}
  → read_file {"path":"src/cart/totals.ts"}
  → edit_file {"path":"src/cart/totals.ts", …}
  → run_command {"command":"npm test"}

The coupon discount was subtracted twice: once in applyCoupon() and again in
calculateTotal(). It now happens only in calculateTotal(). All 48 tests pass.

$0.0042 turn · $0.21 today · bal $12.40
```

---

## What you can do with it

| | |
|---|---|
| **Fix, build, and explain code** | Describe the job. Lattice finds the right files, edits them, and checks its own work by running your tests. |
| **Race AI models (Arena)** | Give the same task to 2 or more models at once. Each works on its own copy of your project. Compare the results and keep only the best one. |
| **Undo anything it just did** | `/undo` puts back every file from its last reply, even in a folder that isn't a git repo. |
| **Watch your spending** | Every reply shows what it cost. Set daily or monthly limits and Lattice stops before going over. |
| **Make images** | `/imagine a glass cube over a neon grid` creates an image and shows it right in your terminal. |
| **Talk to it** | Speak your request and hear the answer. Voice runs on your own computer by default: free and offline. |
| **Meet Kit10** | An animated mascot who shows what Lattice is doing: thinking, reading, typing, building. |
| **Add more tools** | Connect MCP servers (plug-ins that add tools, like a database browser or Blender) and Lattice can use them too. |

---

## What you need

- **A Venice AI account with an API key and some balance.** Create the key at [venice.ai/settings/api](https://venice.ai/settings/api). Venice charges per use from your balance: add USD credits there, stake DIEM, or use the API allowance that comes with a paid Venice plan.
- **Node.js 20 or newer.** Check with `node --version`. Get it at [nodejs.org](https://nodejs.org).
- **git.** Check with `git --version`.
- **Linux or macOS.** On Windows, use WSL2.
- **Optional:** a terminal that can show images (Kitty, WezTerm, Ghostty, or Konsole 22.04+) for Kit10 and inline pictures. Lattice works in any terminal without them.

---

## Install in 4 steps

**1. Download Lattice**

```bash
git clone https://github.com/QCPUNKS/Lattice.git
cd Lattice
```

**2. Install it**

```bash
./install.sh
```

This installs what Lattice needs, builds it, and adds the `lattice` command to your terminal.

**3. Add your Venice key**

```bash
lattice setup
```

It asks four quick questions. Press **Enter** to accept the suggestion in `[brackets]`:

1. Your Venice API key (paste it in)
2. Which AI model to use by default
3. Which folder to work in by default
4. How much Lattice may do without asking. Choose **normal** if you're not sure.

**4. Check that it works**

```bash
lattice doctor
```

Green ✓ marks mean you're ready. A red ✗ tells you exactly what to fix.

---

## Your first chat

Go to any project folder and start Lattice:

```bash
cd ~/Projects/my-app
lattice
```

Type what you want and press **Enter**. Some good first requests:

```text
Explain what this project does and how it's organized.
Find why the signup page crashes and fix it.
Add a test for the password reset function, then run all the tests.
```

### When Lattice asks permission

Before it changes something, Lattice may stop and ask:

```text
  Allow? [y]es / [n]o / [a]lways this session:
```

- **y**: yes, this time.
- **n**: no. Lattice is told it was refused and finds another way.
- **a**: yes, and don't ask again for this kind of action until you quit.

How often it asks depends on the **mode** you picked:

| Mode | What it does on its own | What it asks about |
|---|---|---|
| **safe** | nothing | everything |
| **normal** (recommended) | reading files, running tests, safe commands like `git status` | installing packages, unfamiliar commands, and anything risky |
| **auto** | almost everything | only risky actions |

**Risky actions always ask, in every mode:** deleting files, `rm`, `sudo`, `git reset --hard`, force-pushing, and similar. Lattice also always asks before opening secret files like `.env` or SSH keys, and it can never touch files outside your project folder.

### Keys to know

| Key | What it does |
|---|---|
| **Enter** | Send your message |
| **Ctrl+C** | Stop what Lattice is doing right now. Your chat stays open. |
| **Ctrl+D** or `/quit` | Leave Lattice |

---

## The commands you'll use most

Inside a chat, commands start with `/`. Type `/help` any time to see them all.

| Command | What it does |
|---|---|
| `/diff` | Show exactly what Lattice changed in its last reply |
| `/undo` | Put those files back the way they were |
| `/model` | Pick a different AI model from a list, cheapest first |
| `/cost` | See your Venice balance and what you've spent |
| `/test` | Run your project's tests |
| `/arena` | Race several models on one task (it asks you what to do) |
| `/imagine` | Make an image (it asks you what to paint) |
| `/voice chat` | Talk to Lattice and hear it answer |
| `/compact` | Shrink a long conversation so it runs faster and cheaper |
| `/reset` | Start a fresh conversation (the old one stays saved) |

From your normal terminal:

| Command | What it does |
|---|---|
| `lattice` | Start a chat in the current folder |
| `lattice --session latest` | Continue your last chat in this folder |
| `lattice ask "…"` | Ask one question and get the answer, no chat |
| `lattice exec "…"` | Do one job and exit (for scripts and automation) |
| `lattice doctor` | Check that everything is set up correctly |
| `lattice key` | See which Venice key is in use and its balance |
| `lattice --help` | List every command |

Every command, with examples: **[the User Guide](docs/user-guide.md)**.

---

## Arena: let the models compete

Not sure which AI model is best for a job? Make them race.

```text
lattice › /arena
What should the models do? Add input validation to the signup form
  1. deepseek-v4-flash-0731   ...
  2. qwen3-coder              ...
Pick 2 or more models by number, e.g. 1 3 5: 1 2
Check every result with npm test? [Y/n] y
```

Each model gets its own private copy of your project, so they can't interfere with each other or with your code. When they finish, you get a scorecard showing whose tests passed, how many files and lines each changed, how many tokens it used, and how long it took.

Then you choose:

```text
/arena diff 1     look at model 1's changes
/arena pick 1     keep model 1's work and throw away the rest
/arena clean      throw away all of them
```

**Nothing touches your code until you pick a winner.** Your project needs to be a git repository for Arena to work.

---

## Costs

Venice charges per use, and some models cost over 1,000× more than others. Lattice keeps you informed:

- After every reply: what that reply cost, today's total, and your balance.
- `/model` lists models cheapest first and warns you when a switch will cost more.
- `/cost` breaks down spending by day, month, and model.
- Optional spending limits. Add to `~/.config/lattice/config.toml`:

  ```toml
  [budget]
  daily_usd = 2.00
  monthly_usd = 20.00
  ```

  Before a request would cross a limit, Lattice asks first.

Running low on credit? `lattice key backup` adds a second Venice key, and Lattice switches to it automatically when the first one runs out. More: [docs/costs.md](docs/costs.md).

---

## Images

```text
lattice › /imagine a glass cube floating over a neon grid
```

Or type `/imagine` by itself and it asks what to paint and what shape (square, wide, or tall). The picture appears right in your terminal if it supports images, and is saved to a folder you pick the first time.

By default Lattice only uses Venice's **private** image models, which don't store your prompt, and file names never contain your prompt. More: [docs/images.md](docs/images.md).

---

## Voice

| Command | You | Lattice |
|---|---|---|
| `/voice chat` | speak | talks back |
| `/voice dictate` | speak | answers in text |
| `/voice listen` | type | talks back |
| `/voice off` | type | answers in text |

**To talk:** press **Enter** on an empty line, speak, then press **Enter** again. Lattice shows what it heard before acting on it.

Voice runs **on your own computer** by default, free and offline. Install it once with `scripts/voice/install-local-voice.sh`. Your audio is never saved. More: [docs/voice.md](docs/voice.md).

---

## Kit10

In terminals that can show images, **Kit10** appears beside the Lattice logo and acts out what's happening: thinking, reading, typing, building, painting, listening, speaking. Type `/kit10` to see every pose and what it means, or `/kit10 off` to turn her off. More: [docs/mascot.md](docs/mascot.md).

---

## Is it safe?

Lattice has real access to your files and terminal, so safety comes first:

- **It stays in your project.** It can't read or change files outside the folder you're working in, including through shortcuts (symlinks).
- **It asks before risky actions** in every mode, and you can see every decision later with `lattice audit`.
- **It protects your secrets.** It asks before opening `.env` files, keys, or credentials, and never writes your API key to a log.
- **A downloaded project can't take over.** A repo's own settings can make Lattice *stricter*, never looser. It can't change where your key is sent, your spending limits, or your microphone.
- **You can undo its last change** with `/undo`, even without git.

The full threat model, including the known gaps: [SECURITY.md](SECURITY.md).

---

## Something not working?

| Problem | Fix |
|---|---|
| `VENICE_API_KEY is not set` | Run `lattice setup` |
| It chats but never edits files | Your model can't use tools. Run `/model` and pick one from the list. |
| A reply stops mid-sentence | `lattice config set generation.max_tokens 8192` |
| No Kit10 or no images | Your terminal can't show images. Try Kitty, WezTerm, Ghostty, or Konsole. |
| Anything else | Run `lattice doctor`, then see [docs/troubleshooting.md](docs/troubleshooting.md) |

---

## Learn more

| Guide | What's in it |
|---|---|
| **[User Guide](docs/user-guide.md)** | **Start here.** Every command explained, with examples and recipes. |
| [Configuration](docs/configuration.md) | Every setting and where it lives |
| [Costs](docs/costs.md) | Spending, balances, budgets, backup keys |
| [Images](docs/images.md) | `/imagine` options and privacy |
| [Voice](docs/voice.md) | Voice modes, microphones, the local engine |
| [Kit10](docs/mascot.md) | The mascot and display settings |
| [Permissions](docs/permissions.md) | Exactly when Lattice asks and why |
| [MCP](docs/mcp.md) | Adding tool servers |
| [Troubleshooting](docs/troubleshooting.md) | Fixes for common problems |
| [Security](SECURITY.md) | What Lattice protects against, and what it doesn't |

**For developers:** [architecture](docs/architecture.md), [tools](docs/tools.md), [providers](docs/providers.md), [terminal UI](docs/terminal-ui.md).

```bash
npm run dev         # run from source, no build step
npm test            # run the test suite
npm run typecheck   # check types
```

---

## Creator & License

Lattice was created by **Jevante Boxley**.

Licensed under the [Apache License 2.0](LICENSE). You're free to use, modify, and share it, as long as you keep the copyright notices and the [NOTICE](NOTICE) file that credits the creator, and mark any files you change. The Lattice name and the Kit10 mascot aren't covered by the license, so forks need their own name.
