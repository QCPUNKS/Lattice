// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import chalk from "chalk";
import type { LatticeConfig } from "../../config/index.js";
import { setGlobalConfigValue } from "../../config/writer.js";
import { VeniceHttp } from "../../providers/venice-http.js";
import { theme } from "../../ui/theme.js";
import { ExitCode } from "../exit-codes.js";

/**
 * `lattice key` shows the Venice keys and their balances; `lattice key set`
 * replaces the main key; `lattice key backup` adds the key Lattice switches to
 * when the main one runs out of credit or hits its rate limit.
 *
 * The new key is typed with hidden input (or piped in, for password managers),
 * checked against Venice before anything is saved, and stored owner-only in
 * ~/.config/lattice/config.toml. A VENICE_API_KEY environment variable still
 * wins over that file, so `set` names every place one is defined instead of
 * leaving you wondering why the old key is still in use.
 */

const SHELL_PROFILES = [".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile"];

/** "…a1b2": enough to tell keys apart, never enough to use one. */
export function maskKey(key: string): string {
  return key.length <= 8 ? "…" : `…${key.slice(-4)}`;
}

/** Where a VENICE_API_KEY assignment lives in shell profiles and the project's .env, as "file:line". */
export function findKeyDefinitions(home: string, workspace: string): string[] {
  const candidates = [...SHELL_PROFILES.map((f) => path.join(home, f)), path.join(workspace, ".env")];
  const found: string[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (/^\s*(export\s+)?VENICE_API_KEY\s*=/.test(line)) found.push(`${file}:${i + 1}`);
    });
  }
  return found;
}

export async function runKeyCommand(cfg: LatticeConfig, sub: string | undefined): Promise<number> {
  if (sub === undefined || sub === "status") return showKeyStatus(cfg);
  if (sub === "set") return setKey(cfg, "main");
  if (sub === "backup") return setKey(cfg, "backup");
  console.error(chalk.red("Usage: lattice key [status|set|backup]"));
  return ExitCode.INVALID_USAGE;
}

async function showKeyStatus(cfg: LatticeConfig): Promise<number> {
  if (!cfg.veniceApiKey) {
    console.log(theme.warning("No Venice key is set. Run 'lattice key set'."));
    return ExitCode.AUTHENTICATION_FAILURE;
  }
  const mainSource = process.env.VENICE_API_KEY ? "VENICE_API_KEY (shell profile or .env)" : "~/.config/lattice/config.toml";
  const mainOk = await printKeyLine("Main  ", cfg.veniceApiKey, mainSource, cfg.veniceBaseUrl);

  if (cfg.veniceBackupApiKey) {
    const backupSource = process.env.VENICE_API_KEY_BACKUP ? "VENICE_API_KEY_BACKUP" : "~/.config/lattice/config.toml";
    await printKeyLine("Backup", cfg.veniceBackupApiKey, backupSource, cfg.veniceBaseUrl);
    console.log(theme.dim("\nLattice uses the main key and switches to the backup if the main one runs out of credit or is rate-limited."));
  } else {
    console.log(theme.dim("\nNo backup key. Add one with 'lattice key backup' to keep working when the main key runs out."));
  }
  return mainOk ? ExitCode.SUCCESS : ExitCode.AUTHENTICATION_FAILURE;
}

/** One status line: masked key, balance (or why Venice refused it), and where it came from. */
async function printKeyLine(label: string, key: string, source: string, baseUrl: string): Promise<boolean> {
  try {
    const balance = await new VeniceHttp(key, baseUrl).refreshBalance();
    const balanceText = balance ? formatBalance(balance.usd, balance.diem) : theme.dim("balance not reported");
    console.log(`${label}  ${theme.bold(maskKey(key))}  ${balanceText}  ${theme.dim(`from ${source}`)}`);
    return true;
  } catch (err) {
    console.log(`${label}  ${theme.bold(maskKey(key))}  ${theme.error(`rejected: ${(err as Error).message}`)}  ${theme.dim(`from ${source}`)}`);
    return false;
  }
}

async function setKey(cfg: LatticeConfig, which: "main" | "backup"): Promise<number> {
  const question = which === "main" ? "New main Venice API key (input hidden): " : "Backup Venice API key (input hidden): ";
  const key = (await readSecret(question)).trim();
  if (!key) {
    console.log(theme.dim("No key entered. Nothing changed."));
    return ExitCode.SUCCESS;
  }

  let balanceText: string;
  try {
    const balance = await new VeniceHttp(key, cfg.veniceBaseUrl).refreshBalance();
    balanceText = balance ? formatBalance(balance.usd, balance.diem) : "balance not reported";
  } catch (err) {
    console.log(theme.error(`Venice rejected that key, so nothing was saved: ${(err as Error).message}`));
    return ExitCode.AUTHENTICATION_FAILURE;
  }

  if (which === "backup" && key === cfg.veniceApiKey) {
    console.log(theme.warning("That is the same key as your main one, so it can't act as a backup. Nothing saved."));
    return ExitCode.INVALID_USAGE;
  }

  const configKey = which === "main" ? "api_key" : "backup_api_key";
  const configPath = await setGlobalConfigValue(cfg.globalConfigDir, "venice", configKey, key);
  console.log(theme.success(`Key ${maskKey(key)} works (${balanceText}). Saved as your ${which} key in ${configPath} (owner-only).`));

  if (which === "backup") {
    if (process.env.VENICE_API_KEY_BACKUP && process.env.VENICE_API_KEY_BACKUP !== key) {
      console.log(theme.warning("Note: a VENICE_API_KEY_BACKUP environment variable is set and takes priority over this saved key."));
    }
    console.log(theme.dim("Lattice switches to it automatically when the main key runs out. Check both with 'lattice key'."));
    return ExitCode.SUCCESS;
  }

  const envKey = process.env.VENICE_API_KEY;
  if (envKey && envKey !== key) {
    console.log(theme.warning(`\nNot active yet: a VENICE_API_KEY variable (${maskKey(envKey)}) overrides the saved key.`));
    const places = findKeyDefinitions(homedir(), cfg.workspace);
    if (places.length > 0) {
      console.log(theme.warning("Remove or comment out the line in:"));
      for (const place of places) console.log(theme.warning(`  ${place}`));
    }
    console.log(theme.dim("Then open a new terminal (or run 'unset VENICE_API_KEY') and check with 'lattice key'."));
  }
  console.log(theme.dim("\nIf the old key was ever shared or pasted anywhere, revoke it at venice.ai → Settings → API."));
  return ExitCode.SUCCESS;
}

function formatBalance(usd: number, diem?: number): string {
  const usdText = usd < 0 ? theme.error(`$${usd.toFixed(2)}`) : `$${usd.toFixed(2)}`;
  return diem !== undefined ? `${usdText} · ${diem} DIEM` : usdText;
}

/**
 * Reads one line without echoing it. A piped stdin (`pass venice | lattice key set`)
 * is read as-is; a terminal is put in raw mode so the key never appears on screen
 * or in scrollback.
 */
function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let input = "";
      stdin.setEncoding("utf-8");
      stdin.on("data", (chunk) => (input += chunk));
      stdin.on("end", () => resolve(input.split("\n")[0] ?? ""));
    });
  }

  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let secret = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const finish = (value: string) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(secret);
        if (ch === "\u0003" || ch === "\u001b") return finish(""); // Ctrl+C / Esc cancels
        if (ch === "\u007f" || ch === "\b") secret = secret.slice(0, -1);
        else if (ch >= " ") secret += ch;
      }
    };
    stdin.on("data", onData);
  });
}
