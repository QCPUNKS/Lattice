// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { readFileSync } from "node:fs";

export const CLI_HELP = `Usage: lattice [command] [options]

Start a chat:
  lattice                          chat in the current folder
  lattice <folder>                 chat in another folder
  lattice --session latest         continue your last chat in this folder

One-shot (for scripts and CI):
  lattice exec "<task>"            do a task, then exit with a status code
  lattice ask "<question>"         ask a question, then exit

Setup and diagnostics:
  lattice setup                    interactive first-run wizard
  lattice key                      show the active Venice key (masked) and balance
  lattice key set                  switch to a new Venice key (hidden input, checked first)
  lattice key backup               add a backup key, used when the main one runs out
  lattice doctor                   check config, API, and tools
  lattice models                   list available models
  lattice config [show]            print the active settings
  lattice config set <key> <value> change a setting (global config)
  lattice mcp [list|test]          list or test MCP servers

Sessions:
  lattice sessions [list]          list saved chats
  lattice sessions delete <id>     delete a chat
  lattice sessions export <id> [--format md|json]

Project:
  lattice inspect                  summarize the project
  lattice status                   git status summary
  lattice diff [file]              uncommitted git changes
  lattice test                     run the detected test command
  lattice build                    run the detected build command
  lattice run                      run the dev/start script (Ctrl+C stops it)
  lattice audit [n]                last n security-log entries (default 50)

Arena:
  lattice arena "<task>" --models a,b[,c] [--tests "<cmd>"]
  lattice arena diff [label] | pick <label> | list | clean

Options:
  --model <id>                     model for this run
  --mode <safe|normal|auto>        permission mode for this run
  --workspace <folder>             folder to work in
  --session <id|latest>            resume a saved chat
  --debug                          extra diagnostic output
  -h, --help                       show this help
  -v, --version                    show the version

Inside a chat, type /help for chat commands.
Full guide: docs/user-guide.md`;

/** Read from package.json at runtime; resolves the same from src/cli/ (tsx) and dist/cli/ (built). */
export function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
  return packageJson.version;
}
