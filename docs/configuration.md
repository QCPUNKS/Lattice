<!-- All Rights Reserved: Jevante Boxley -->
<!-- QCPUNKS SECTOR -->

# Configuration

Precedence, lowest to highest (each stage overrides only the fields it sets):

```
built-in defaults → environment variables → global config → project config → CLI flags
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `VENICE_API_KEY` | *(required)* | Your Venice API key. Never committed — `.env` is gitignored. |
| `LATTICE_MODEL` | `deepseek-v4-flash-0731` | Model ID. Run `lattice models` to see what's available. |
| `LATTICE_PROVIDER` | `venice` | Reserved for future providers. |
| `VENICE_BASE_URL` | `https://api.venice.ai/api/v1` | Override for testing/proxies. |
| `LATTICE_TEMPERATURE` | `0.3` | Sampling temperature. |
| `LATTICE_MAX_TOKENS` | `4096` | Max completion tokens per turn. |
| `LATTICE_MODE` | `normal` | `safe` \| `normal` \| `auto` — see `docs/permissions.md`. |

A `.env` file in the current directory is loaded automatically (never overrides a variable already set in the real environment).

### Selecting a model

Any model in Venice's catalog is selectable — the list is discovered live from `/models`, nothing is hardcoded. Verified working options include:

| Model | Context | Notes |
|---|---|---|
| `deepseek-v4-flash-0731` | 1M | Default. |
| `gemini-3-7-flash` | 1M | Tool calling + reasoning. Reasoning tokens count toward `max_tokens`, so consider raising `LATTICE_MAX_TOKENS` (e.g. `8192`). |

Switch at any scope:

- `/model` in the REPL — interactive picker: the full live catalog, numbered, with context size and `[reasoning]`/`[vision]` tags; type a number or an id. Models without tool-calling support are hidden (the agent loop requires tools).
- `/model <id>` in the REPL — switch directly (current session).
- `lattice --model <id>` — one run.
- `LATTICE_MODEL=<id>` in `.env`, or `model = "<id>"` in a config.toml — persistent.

## Config files

Global (applies everywhere): `~/.config/lattice/config.toml`
Project (applies only in this workspace, opt-in): `<workspace>/.lattice/config.toml`

```toml
model = "deepseek-v4-flash-0731"
mode = "normal"

[venice]
base_url = "https://api.venice.ai/api/v1"   # global config only; must be HTTPS
# api_key = "..."   # prefer VENICE_API_KEY / .env instead — see Security note below

[workspace]
root = "."           # global config only

[generation]
temperature = 0.3
max_tokens = 4096

[agent]
max_iterations = 100          # hard cap on model↔tool turns per request
max_tool_calls = 300           # hard cap on total tool calls per request
max_consecutive_failures = 5    # stop after this many identical failing tool calls in a row
command_timeout = 120           # seconds, default run_command timeout

[context]
token_budget = 100000           # approximate; triggers automatic compaction near this limit

[ui]
mascot = true                       # animated mascot (Kitty graphics terminals)
mascot_rows = 5
intro = true
reduced_motion = false
background = "#050b12"              # false = leave the terminal's background alone

# [budget], [image] and [voice] are read from the GLOBAL config only — see below.
[budget]
daily_usd = 2.00                    # optional; asks before going over
monthly_usd = 20.00                 # optional
warn_at = 0.8
low_balance_usd = 1.00

[image]
output_dir = "~/Pictures/lattice"   # no default: asked on first /imagine
safe_mode = true                    # Venice blurs adult content; asked on first /imagine
model = "z-image-turbo"
private_only = true                 # refuse models Venice forwards to third parties
save_metadata = false               # .json sidecar with prompt/seed next to each image
aspect_ratio = "1:1"

[voice]
mode = "off"                        # off | chat | dictate | listen
# input_device = "alsa_input..."    # default: auto (never a .monitor source)
stt_model = "openai/whisper-large-v3"
tts_model = "tts-kokoro"
voice = "af_sky"
speed = 1.0                         # 0.25–4
# language = "en"                   # ISO 639-1 hint; default auto-detect
private_only = true
```

### Settings a project config cannot change

A project's `.lattice/config.toml` arrives with whatever repository you cloned,
so it is not trusted with anything that decides where your data goes:
`venice.base_url` (your API key is sent there), every `[budget]` limit
(a repo must not be able to raise your spending), every `[image]` setting
(where images are written), and every `[voice]` setting (which microphone is
opened). Those are read from `~/.config/lattice/config.toml` only and are
silently ignored in project configs.

`/image` and `/voice` write their changes to the global config, owner-only (0600).

`lattice config show` prints the effective merged configuration (secrets redacted). `lattice config set <key> <value>` writes to the **global** config, e.g. `lattice config set agent.max_iterations 50`.

## Security note

Never commit `.lattice/config.toml` with a real `api_key` in it — even though `.lattice/` is gitignored automatically once a project has a `.git` directory, prefer `VENICE_API_KEY` in your environment or a local `.env` for secrets.
