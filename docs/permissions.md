<!-- Copyright (c) 2026 Jevante Boxley / QCPUNKS -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Permissions

Every mutating tool call — file writes, deletes, shell commands, MCP server startup — goes through `PermissionGate`. It decides autoallow / ask / deny from two inputs: the active **mode** and the action's **risk tier**.

## Risk tiers (shell commands are classified automatically)

| Tier | Examples |
|---|---|
| `safe` | `ls`, `cat`, `git status`, `git diff`, `npm test`, `pytest`, `cargo build`, `make` |
| `caution` | `npm install`, `pip install`, `docker compose up`, `git checkout/merge/pull`, `npx ...` |
| `destructive` | `rm`, `git reset --hard`, `git clean -f`, `git push --force`, `docker system prune` |
| `critical` | `sudo`, `chmod -R`, `dd`, `shutdown`, `curl \| bash` |

File writes are treated as `safe` risk; file deletes are always treated as `destructive`. Unrecognized commands default to `caution` rather than either extreme.

## Modes

| Mode | safe | caution | destructive/critical |
|---|---|---|---|
| `safe` | ask | ask | ask |
| `normal` (default) | auto | ask | ask |
| `auto` | auto | auto | ask |

**destructive/critical risk always asks, in every mode** — no autonomy setting lets the model delete files or run system-level commands without you confirming.

Within a session, answering `[a]lways` at a prompt auto-allows that same (action, risk) pair for the rest of the session. `/permissions` shows what's currently standing.

## Secret files

`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`/`id_ed25519`/`id_ecdsa`/`id_dsa`, `credentials.*`, `secrets.*`, `.npmrc`, `.netrc` are never read or searched without an explicit confirmation prompt (tier: `destructive`, so it always asks) — this is independent of mode, so the model can't accidentally read and send your credentials to Venice.

## Workspace boundary

Every filesystem tool resolves paths against the workspace root and refuses anything that resolves outside it (`../` traversal, absolute paths elsewhere) — this is enforced in code, not by asking the model nicely.

## Non-interactive mode (`lattice exec` / `lattice ask`)

There's no one to prompt, so anything that would normally ask **fails closed** with a clear error instead of hanging. Use `--mode auto` to widen what runs without a human present — destructive/critical actions still refuse.
