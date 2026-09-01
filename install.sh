#!/usr/bin/env bash
# Copyright (c) 2026 Jevante Boxley / QCPUNKS
# SPDX-License-Identifier: Apache-2.0

# Installs Lattice: checks prerequisites, installs dependencies, builds, and
# links the `lattice` command onto PATH. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; }

bold "Lattice installer"
echo

# 1. Check dependencies
echo "Checking dependencies..."
if ! command -v node >/dev/null 2>&1; then
  fail "node not found — install Node.js >= 20 first (https://nodejs.org)"
  exit 1
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "node $NODE_MAJOR found, but Lattice requires Node.js >= 20"
  exit 1
fi
ok "node $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  fail "npm not found"
  exit 1
fi
ok "npm $(npm --version)"

if command -v git >/dev/null 2>&1; then ok "git $(git --version | awk '{print $3}')"; else fail "git not found (recommended)"; fi
if command -v rg >/dev/null 2>&1; then ok "ripgrep found"; else fail "ripgrep not found — search will fall back to a slower built-in walk"; fi
echo

# 2. Create required directories
echo "Creating directories..."
mkdir -p "$HOME/.config/lattice"
mkdir -p "$HOME/.local/share/lattice/sessions"
ok "$HOME/.config/lattice"
ok "$HOME/.local/share/lattice/sessions"
echo

# 3. Install dependencies and build
echo "Installing dependencies..."
npm install
echo
echo "Building..."
npm run build
echo

# 4. Link the lattice command
echo "Linking the lattice command..."
npm link
ok "lattice is now on PATH ($(command -v lattice || echo 'unknown'))"
echo

# 5. Default configuration
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "Created .env from .env.example — add your VENICE_API_KEY before running lattice"
fi

# 6. Verify
echo
bold "Verifying installation..."
if lattice doctor; then
  echo
  bold "Lattice is installed."
else
  echo
  echo "Installation finished, but 'lattice doctor' reported issues above (likely a missing API key)."
fi

echo
echo "Next steps:"
echo "  1. export VENICE_API_KEY=\"...\"   (or edit .env / run 'lattice setup')"
echo "  2. cd into any project and run: lattice"
