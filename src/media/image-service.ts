// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type * as readline from "node:readline/promises";
import type { LatticeConfig } from "../config/index.js";
import { expandHome } from "../config/index.js";
import { setGlobalConfigValue } from "../config/writer.js";
import type { VeniceHttp } from "../providers/venice-http.js";
import { theme } from "../ui/theme.js";
import { encodeKittyPng, inlineImageColumns, supportsKittyGraphics } from "../ui/kitty-graphics.js";
import { ImageModelCatalog, type ImageModelInfo } from "./image-catalog.js";
import { VeniceImageClient, type GeneratedImages } from "./image-client.js";
import { inspectOutputDir, prepareOutputDir, saveGeneratedImages } from "./image-store.js";
import type { SpendLedger } from "../billing/ledger.js";

export interface ImagineOptions {
  prompt: string;
  model?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  steps?: number;
  variants?: number;
  /** Per-call override of the configured safe mode. */
  safeMode?: boolean;
  allowAnonymized?: boolean;
}

export interface ImagineResult {
  files: string[];
  model: ImageModelInfo;
  generated: GeneratedImages;
  estimatedCostUsd: number | null;
}

export class ImageSetupRequiredError extends Error {
  constructor() {
    super("Image generation isn't set up yet. Run /imagine setup in the interactive session to choose an output folder and safe-mode default.");
    this.name = "ImageSetupRequiredError";
  }
}

/**
 * Everything /imagine and the generate_image tool share: first-run setup,
 * privacy policy, cost estimate, generation, saving, and inline display.
 */
export class ImageService {
  readonly catalog: ImageModelCatalog;
  private readonly client: VeniceImageClient;

  constructor(
    http: VeniceHttp,
    private readonly cfg: LatticeConfig,
    private readonly ledger?: SpendLedger,
  ) {
    this.catalog = new ImageModelCatalog(http);
    this.client = new VeniceImageClient(http);
  }

  isConfigured(): boolean {
    return this.cfg.image.outputDir !== undefined && this.cfg.image.safeMode !== undefined;
  }

  /**
   * Interactive first-run: output folder (validated for privacy) and the
   * safe-mode default. Both persist to the global config only.
   */
  async runSetup(rl: readline.Interface, force = false): Promise<boolean> {
    if (force || this.cfg.image.outputDir === undefined) {
      console.log(theme.bold("Where should generated images be saved?"));
      console.log(theme.dim("  Lattice has no default on purpose — pick a private folder. It will be created owner-only (700)."));
      const answer = (await rl.question("  Folder: ")).trim();
      if (!answer) {
        console.log(theme.dim("  No folder chosen — setup cancelled."));
        return false;
      }
      const chosen = await this.chooseOutputDir(rl, expandHome(answer));
      if (!chosen) return false;
    }

    if (force || this.cfg.image.safeMode === undefined) {
      console.log(theme.bold("\nVenice safe mode blurs adult content."));
      const answer = (await rl.question("  Keep safe mode ON by default? [y]es / [n]o (you can override per image with --safe / --nsfw): "))
        .trim()
        .toLowerCase();
      const safeMode = !(answer === "n" || answer === "no");
      await this.setSafeModeDefault(safeMode);
    }
    return true;
  }

  /** Validates and stores the output folder. Returns false if the user backs out. */
  async chooseOutputDir(rl: readline.Interface, dir: string): Promise<boolean> {
    const report = inspectOutputDir(dir);
    if (!report.isDirectory) {
      console.log(theme.error(`  ${report.path} exists and isn't a folder.`));
      return false;
    }
    if (report.exists && report.writableByOthers) {
      console.log(theme.error(`  ${report.path} is writable by other users on this machine — refusing to use it.`));
      console.log(theme.dim(`  Fix with: chmod 700 "${report.path}"`));
      return false;
    }
    if (report.gitRepoRoot) {
      console.log(theme.warning(`  That folder is inside the git repo at ${report.gitRepoRoot}.`));
      console.log(theme.warning("  Images there can be committed and pushed by accident."));
      const go = (await rl.question("  Use it anyway? [y/N]: ")).trim().toLowerCase();
      if (go !== "y" && go !== "yes") return false;
    }
    let tighten = false;
    if (report.exists && report.accessibleToOthers) {
      const answer = (await rl.question(`  Other users can read ${report.path}. Restrict it to you only (chmod 700)? [Y/n]: `))
        .trim()
        .toLowerCase();
      tighten = answer !== "n" && answer !== "no";
      if (!tighten) console.log(theme.warning("  Leaving permissions as-is. Saved images themselves are still owner-only (600)."));
    }

    await prepareOutputDir(report.path, tighten);
    this.cfg.image.outputDir = report.path;
    const configPath = await setGlobalConfigValue(this.cfg.globalConfigDir, "image", "output_dir", report.path);
    console.log(theme.success(`  Images will be saved to ${report.path}`) + theme.dim(`  (saved in ${configPath})`));
    return true;
  }

  async setSafeModeDefault(on: boolean): Promise<void> {
    this.cfg.image.safeMode = on;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "image", "safe_mode", on);
    console.log(theme.success(`  Safe mode default: ${on ? "ON" : "OFF"}`));
  }

  async setDefaultModel(id: string): Promise<ImageModelInfo> {
    const model = await this.catalog.get(id);
    if (!model) throw new Error(`Unknown image model "${id}". /imagine models lists them.`);
    this.cfg.image.model = id;
    await setGlobalConfigValue(this.cfg.globalConfigDir, "image", "model", id);
    return model;
  }

  /** Resolves the model and enforces the privacy policy, without spending anything. */
  async resolveModel(options: Pick<ImagineOptions, "model" | "allowAnonymized">): Promise<ImageModelInfo> {
    const id = options.model ?? this.cfg.image.model;
    const model = await this.catalog.get(id);
    if (!model) throw new Error(`Unknown image model "${id}". /imagine models lists them.`);
    if (this.cfg.image.privateOnly && model.privacy !== "private" && !options.allowAnonymized) {
      throw new Error(
        `${model.id} is "${model.privacy}": Venice forwards the prompt to a third-party provider. ` +
          `Pass --allow-anonymized to use it anyway, or set [image] private_only = false.`,
      );
    }
    return model;
  }

  estimateCost(model: ImageModelInfo, variants: number, resolution?: string): number | null {
    const perImage = (resolution ? model.resolutionPricesUsd[resolution] : undefined) ?? model.priceUsd;
    return perImage === null ? null : perImage * variants;
  }

  async generate(options: ImagineOptions, signal?: AbortSignal): Promise<ImagineResult> {
    if (!this.isConfigured()) throw new ImageSetupRequiredError();
    const outputDir = this.cfg.image.outputDir!;
    const model = await this.resolveModel(options);
    const variants = options.variants ?? 1;
    const safeMode = options.safeMode ?? this.cfg.image.safeMode!;
    const aspectRatio = options.aspectRatio ?? defaultAspectFor(model, this.cfg.image.aspectRatio);

    // Re-check on every save: permissions can change after setup.
    const report = inspectOutputDir(outputDir);
    if (report.exists && report.writableByOthers) {
      throw new Error(`Output folder ${outputDir} is now writable by other users — refusing to save. chmod 700 it or run /imagine output.`);
    }
    await prepareOutputDir(outputDir, false);

    const generated = await this.client.generate(
      {
        model,
        prompt: options.prompt,
        negativePrompt: options.negativePrompt,
        aspectRatio,
        resolution: options.resolution,
        seed: options.seed,
        steps: options.steps,
        variants,
        safeMode,
      },
      signal,
    );

    const estimatedCostUsd = this.estimateCost(model, variants, options.resolution);
    this.ledger?.record({
      kind: "image",
      model: model.id,
      usd: estimatedCostUsd ?? 0,
      source: "estimate",
      units: generated.images.length,
    });

    const files = await saveGeneratedImages(
      outputDir,
      generated,
      {
        model: model.id,
        prompt: options.prompt,
        negativePrompt: options.negativePrompt,
        aspectRatio,
        resolution: options.resolution,
        steps: options.steps,
        safeMode,
      },
      this.cfg.image.saveMetadata,
    );

    return { files, model, generated, estimatedCostUsd };
  }

  /** Prints the images inline when the terminal supports it, plus paths and flags either way. */
  display(result: ImagineResult): void {
    const { generated, files } = result;
    if (supportsKittyGraphics()) {
      const columns = inlineImageColumns(process.stdout.columns, generated.images.length);
      for (const png of generated.images) {
        process.stdout.write(encodeKittyPng(png, columns) + "\n");
      }
    }
    for (const f of files) console.log(theme.success("  saved ") + f);
    const facts = [
      result.model.id,
      `seed ${generated.seed}`,
      generated.durationMs !== null ? `${(generated.durationMs / 1000).toFixed(1)}s` : null,
      result.estimatedCostUsd !== null ? `~$${result.estimatedCostUsd.toFixed(2)}` : null,
    ].filter(Boolean);
    console.log(theme.dim(`  ${facts.join("  ·  ")}`));
    if (generated.blurred) console.log(theme.warning("  Venice safe mode blurred this result. Use --nsfw to generate unblurred."));
    if (generated.contentViolation) console.log(theme.error("  Venice flagged this output as violating its terms of service."));
  }
}

/** Uses the configured ratio when the model supports it, otherwise the model's own default. */
function defaultAspectFor(model: ImageModelInfo, configured: string): string {
  if (model.sizing.kind === "pixels") return configured;
  return model.sizing.aspectRatios.includes(configured) ? configured : model.sizing.defaultAspectRatio;
}
