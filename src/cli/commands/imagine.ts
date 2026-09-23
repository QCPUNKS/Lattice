// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type * as readline from "node:readline/promises";
import { sanitizeForTerminal } from "../../ui/sanitize.js";
import { spawn } from "node:child_process";
import { theme } from "../../ui/theme.js";
import { expandHome } from "../../config/index.js";
import { startActivity } from "../../ui/activity.js";
import type { ImageService, ImagineOptions } from "../../media/image-service.js";
import type { ImageModelInfo } from "../../media/image-catalog.js";

export const IMAGINE_USAGE = `Usage: /imagine <prompt> [options]
  --model, -m <id>        image model (default from /image model)
  --aspect, -a <W:H>      aspect ratio, e.g. 16:9, 9:16, 1:1
  --res <1K|2K|4K>        resolution tier (models that support it)
  --neg "<text>"          negative prompt — what to avoid
  --seed <n>              reproduce a previous image
  --steps <n>             inference steps
  --n <1-4>               number of variants
  --safe / --nsfw         override the safe-mode default for this image
  --allow-anonymized      permit a model that forwards prompts to a third party`;

export const IMAGE_USAGE = `Usage: /image <setup|models|model <id>|output [path]|safe <on|off>|open>`;

export type ParsedImagine = { ok: true; options: ImagineOptions } | { ok: false; error: string };

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

/** Parses `/imagine` arguments. Anything that isn't a recognized flag is prompt text. */
export function parseImagineArgs(input: string): ParsedImagine {
  const tokens = tokenize(input);
  const options: ImagineOptions = { prompt: "" };
  const words: string[] = [];

  const needValue = (i: number): string | null => {
    const v = tokens[i + 1];
    return v === undefined || v.startsWith("--") ? null : v;
  };
  const needInt = (flag: string, raw: string | null): number | string => {
    if (raw === null || !/^-?\d+$/.test(raw)) return `${flag} needs a whole number.`;
    return Number(raw);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case "--model":
      case "-m":
      case "--aspect":
      case "-a":
      case "--res":
      case "--neg": {
        const v = needValue(i);
        if (v === null) return { ok: false, error: `${t} needs a value.` };
        i++;
        if (t === "--model" || t === "-m") options.model = v;
        else if (t === "--aspect" || t === "-a") options.aspectRatio = v;
        else if (t === "--res") options.resolution = v.toUpperCase();
        else options.negativePrompt = v;
        break;
      }
      case "--seed":
      case "--steps":
      case "--n": {
        const n = needInt(t, needValue(i));
        if (typeof n === "string") return { ok: false, error: n };
        i++;
        if (t === "--seed") options.seed = n;
        else if (t === "--steps") options.steps = n;
        else options.variants = n;
        break;
      }
      case "--safe":
        options.safeMode = true;
        break;
      case "--nsfw":
        options.safeMode = false;
        break;
      case "--allow-anonymized":
        options.allowAnonymized = true;
        break;
      default:
        if (t.startsWith("--")) return { ok: false, error: `Unknown option ${t}.` };
        words.push(t);
    }
  }

  options.prompt = words.join(" ").trim();
  if (!options.prompt) return { ok: false, error: "Missing prompt." };
  return { ok: true, options };
}

export async function runImagine(
  service: ImageService,
  rl: readline.Interface,
  arg: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!arg.trim()) {
    console.log(IMAGINE_USAGE);
    return;
  }
  const parsed = parseImagineArgs(arg);
  if (!parsed.ok) {
    console.log(theme.error(parsed.error));
    console.log(theme.dim(IMAGINE_USAGE));
    return;
  }

  if (!service.isConfigured()) {
    console.log(theme.dim("First-time image setup:\n"));
    if (!(await service.runSetup(rl))) return;
    console.log();
  }

  const activity = startActivity("painting", "painting…");
  try {
    const result = await service.generate(parsed.options, signal);
    activity.stop();
    service.display(result);
  } catch (err) {
    activity.stop();
    console.log(theme.error(`  ${(err as Error).message}`));
  }
}

export async function runImageSettings(service: ImageService, rl: readline.Interface, arg: string, current: {
  outputDir: string | undefined;
  safeMode: boolean | undefined;
  model: string;
}): Promise<void> {
  const [sub, ...rest] = arg.trim().split(/\s+/);
  const value = rest.join(" ");

  try {
    switch (sub) {
      case "":
      case undefined:
        console.log(`model:       ${current.model}`);
        console.log(`output:      ${current.outputDir ?? theme.dim("(not set — /image setup)")}`);
        console.log(`safe mode:   ${current.safeMode === undefined ? theme.dim("(not set)") : current.safeMode ? "ON" : "OFF"}`);
        console.log(theme.dim(IMAGE_USAGE));
        return;
      case "setup":
        await service.runSetup(rl, true);
        return;
      case "models":
        printModels(await service.catalog.list(), current.model);
        return;
      case "model": {
        if (!value) {
          console.log(theme.error("Usage: /image model <id>"));
          return;
        }
        const model = await service.setDefaultModel(value);
        console.log(theme.success(`Default image model: ${model.id}`) + theme.dim(`  (${model.privacy})`));
        if (model.privacy !== "private") {
          console.log(theme.warning(`  Note: ${model.id} forwards prompts to a third party; it needs --allow-anonymized while private_only is on.`));
        }
        return;
      }
      case "output":
        if (!value) {
          console.log(current.outputDir ?? theme.dim("(not set)"));
          return;
        }
        await service.chooseOutputDir(rl, expandHome(value));
        return;
      case "safe":
        if (value !== "on" && value !== "off") {
          console.log(theme.error("Usage: /image safe <on|off>"));
          return;
        }
        await service.setSafeModeDefault(value === "on");
        return;
      case "open":
        if (!current.outputDir) {
          console.log(theme.dim("No output folder set yet — /image setup."));
          return;
        }
        spawn("xdg-open", [current.outputDir], { detached: true, stdio: "ignore" }).on("error", () => {
          console.log(theme.error("Couldn't launch a file manager (xdg-open)."));
        }).unref();
        return;
      default:
        console.log(theme.error(`Unknown /image subcommand "${sub}".`));
        console.log(theme.dim(IMAGE_USAGE));
    }
  } catch (err) {
    console.log(theme.error((err as Error).message));
  }
}

function formatSizing(m: ImageModelInfo): string {
  switch (m.sizing.kind) {
    case "pixels":
      return "any W:H";
    case "aspect":
      return m.sizing.aspectRatios.join(" ");
    case "resolution":
      return `${m.sizing.aspectRatios.join(" ")} @ ${m.sizing.resolutions.join("/")}`;
  }
}

function printModels(models: ImageModelInfo[], currentId: string): void {
  const sorted = [...models].sort((a, b) =>
    a.privacy === b.privacy ? (a.priceUsd ?? 99) - (b.priceUsd ?? 99) : a.privacy === "private" ? -1 : 1,
  );
  for (const m of sorted) {
    const marker = m.id === currentId ? theme.success("●") : " ";
    const privacy = m.privacy === "private" ? theme.success("private   ") : theme.warning(`${m.privacy.padEnd(10)}`);
    const price = m.priceUsd !== null ? `$${m.priceUsd.toFixed(2)}` : "  ?  ";
    const tags = m.uncensored ? theme.dim(" [uncensored]") : "";
    console.log(`${marker} ${theme.bold(sanitizeForTerminal(m.id).padEnd(28))} ${privacy} ${price.padStart(6)}  ${theme.dim(sanitizeForTerminal(formatSizing(m)))}${tags}`);
  }
  console.log(theme.dim("\nprivate = runs on Venice, prompts not stored · anonymized = forwarded to a third-party provider"));
}
