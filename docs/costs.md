<!-- All Rights Reserved: Jevante Boxley -->
<!-- QCPUNKS SECTOR -->

# Costs, balance, and budgets

Venice prices vary enormously: across models with tool calling, output
tokens run from about $0.15 to $225 per million. The same task can cost a
fraction of a cent or several dollars depending on the model. Lattice shows
you what you're spending as you go, and can stop you before you overspend.

## What you see

**After every answer**, the status line starts with what that turn cost,
today's total, and your Venice balance:

```text
$0.0031 turn · $0.08 today · bal $4.20  │  tokens: 12.4k  │  model: …
```

**`/cost`** (or `/spend`) shows the full picture:

```text
Venice balance     $4.20  (just now)

This session       $0.042    18 requests
Today              $0.080    ▓▓▓▓▓░░░░░░░░░░░░░░░ of $2.00/day
This month         $1.42     ▓▓░░░░░░░░░░░░░░░░░░ of $20.00/month

This month by model
  deepseek-v4-flash-0731   $1.10   77%  chat, 412×
  z-image-turbo            $0.21   15%  images, 21×
  tts-kokoro               $0.02    1%  voice out, 96×
```

**`/model`** lists models **cheapest first**, with input / output prices per
million tokens, color-coded: green (budget, under $1), plain (standard),
yellow (premium, $5–20), red (luxury, $20+). Switching to a model that costs
more tells you by how much, e.g. *"Heads up: ~86× the cost of
deepseek-v4-flash-0731 for the same work."*

## Where the numbers come from

- **Chat:** Venice reports the exact charge for every request, and that's
  what gets recorded. If a response ever lacks it, Lattice estimates from
  the published prices (including cached-token discounts and long-context
  tiers).
- **Images, speech, transcription:** estimated from Venice's published
  prices (per image at the chosen resolution, per character, per second).
- **Balance:** read at startup and on `/cost` from Venice's free balance
  endpoint, then kept current from every response.

## Budgets

Add to `~/.config/lattice/config.toml`:

```toml
[budget]
daily_usd = 2.00        # optional
monthly_usd = 20.00     # optional
warn_at = 0.8           # warn once at 80% of a limit
low_balance_usd = 1.00  # warn when your Venice balance drops below this
```

Limits are checked **before every model call**, not just once per message,
so a long agent run can't blow through them. At a limit, Lattice asks
before spending more. A "yes" holds for the rest of that day or month. In
non-interactive runs (`lattice exec`), it stops instead.

`[budget]` is read from the global config only. A project's
`.lattice/config.toml` can't raise your limits.

## Privacy

The spend log (`~/.local/share/lattice/spend/YYYY-MM.jsonl`, owner-only)
holds numbers only: time, model, tokens, dollars. It never stores prompts,
replies, or transcripts.

## One saving you get for free

Venice adds its own ~1,700-token system prompt to every request unless
asked not to. Lattice turns that off, which saves those tokens on every call
and keeps Venice's persona out of the agent's instructions.
