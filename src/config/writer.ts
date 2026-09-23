// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * Read-modify-write of the global config.toml. The file can hold the Venice
 * API key, so it is always written owner-only (0600) inside an owner-only
 * directory (0700), and replaced atomically so a crash mid-write can't leave
 * a truncated config behind.
 *
 * Note: TOML comments in the file are not preserved (smol-toml round-trip).
 */
export async function updateGlobalConfig(
  globalConfigDir: string,
  mutate: (toml: Record<string, any>) => void,
): Promise<string> {
  await fs.mkdir(globalConfigDir, { recursive: true, mode: 0o700 });
  await fs.chmod(globalConfigDir, 0o700);

  const configPath = path.join(globalConfigDir, "config.toml");
  const existing: Record<string, any> = existsSync(configPath)
    ? (parseToml(readFileSync(configPath, "utf-8")) as Record<string, any>)
    : {};
  mutate(existing);

  const tmpPath = `${configPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, stringifyToml(existing), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmpPath, configPath);
  await fs.chmod(configPath, 0o600); // rename keeps tmp's mode, but be explicit for pre-existing files
  return configPath;
}

/** Sets `[section].key = value` in the global config, creating the section if needed. */
export function setGlobalConfigValue(
  globalConfigDir: string,
  section: string,
  key: string,
  value: string | number | boolean,
): Promise<string> {
  return updateGlobalConfig(globalConfigDir, (toml) => {
    toml[section] = toml[section] ?? {};
    toml[section][key] = value;
  });
}
