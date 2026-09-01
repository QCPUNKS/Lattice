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
base_url = "https://api.venice.ai/api/v1"
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
```

`lattice config show` prints the effective merged configuration (secrets redacted). `lattice config set <key> <value>` writes to the **global** config, e.g. `lattice config set agent.max_iterations 50`.

## Security note

Never commit `.lattice/config.toml` with a real `api_key` in it — even though `.lattice/` is gitignored automatically once a project has a `.git` directory, prefer `VENICE_API_KEY` in your environment or a local `.env` for secrets.
