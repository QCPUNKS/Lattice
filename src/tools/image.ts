// Copyright (c) 2026 Jevante Boxley
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../providers/types.js";
import type { ToolHandler } from "./registry.js";
import type { ImageService } from "../media/image-service.js";
import { resolveSafe } from "./filesystem.js";
import { startActivity } from "../ui/activity.js";

/** The agent may request fewer variants than a user can: every image costs money. */
const AGENT_MAX_VARIANTS = 2;

export const generateImageDef: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Generate an image with the user's Venice image model and save it to their configured image folder. " +
      "Costs money per image — use only when the user asks for an image or the task clearly needs one " +
      "(e.g. a hero image, icon, or illustration asset). Returns the saved file paths. " +
      "The image folder is outside the workspace; set copy_to to also place the first image in the project.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the image." },
        negative_prompt: { type: "string", description: "What the image should avoid." },
        aspect_ratio: { type: "string", description: "W:H, e.g. 1:1, 16:9, 9:16. Defaults to the user's setting." },
        variants: { type: "integer", minimum: 1, maximum: AGENT_MAX_VARIANTS, description: "Number of images (default 1)." },
        copy_to: { type: "string", description: "Optional workspace-relative .png path to copy the first image to, e.g. public/hero.png." },
      },
      required: ["prompt"],
    },
  },
};

/**
 * Deliberately NOT exposed to the model: model choice, safe mode, the
 * anonymized-provider override, and the output folder. Those are the user's
 * privacy/cost decisions, made through /image — not something a prompt
 * injected via a file the agent read should be able to flip.
 */
export function createGenerateImageHandler(service: ImageService): ToolHandler {
  return async (args, ctx) => {
    if (!service.isConfigured()) {
      return "Error: image generation isn't set up. Ask the user to run /image setup first.";
    }
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    // Validate the destination before spending money on the image.
    let copyTarget: string | null = null;
    if (typeof args.copy_to === "string" && args.copy_to.trim()) {
      copyTarget = resolveSafe(ctx.workspace, args.copy_to.trim());
      if (path.extname(copyTarget).toLowerCase() !== ".png") {
        return "Error: copy_to must be a .png file path inside the workspace.";
      }
    }
    const variants = Math.min(AGENT_MAX_VARIANTS, Math.max(1, Number(args.variants) || 1));

    const model = await service.resolveModel({});
    const cost = service.estimateCost(model, variants);
    // The prompt is intentionally not part of the permission detail: that
    // string is written to the audit log, and prompts stay private. The user
    // already sees the prompt in the tool-call line above the permission ask.
    await ctx.requirePermission(
      "network",
      `generate ${variants} image${variants > 1 ? "s" : ""} with ${model.id}${cost !== null ? ` (~$${cost.toFixed(2)})` : ""}`,
    );

    // Own the activity area while painting, and clear it before drawing the image there.
    const painting = startActivity("painting", `painting with ${model.id}…`);
    let result;
    try {
      result = await service.generate({
        prompt,
        negativePrompt: typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
        aspectRatio: typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined,
        variants,
      });
    } finally {
      painting.stop();
    }
    service.display(result);
    ctx.log({ type: "image_generated", model: model.id, count: result.files.length, seed: result.generated.seed });

    if (copyTarget) {
      await ctx.requirePermission("write", path.relative(ctx.workspace, copyTarget));
      await ctx.trackMutation?.(copyTarget);
      await fs.mkdir(path.dirname(copyTarget), { recursive: true });
      await fs.copyFile(result.files[0], copyTarget);
    }

    const notes = [
      copyTarget ? `Copied the first image to ${path.relative(ctx.workspace, copyTarget)}.` : null,
      result.generated.blurred ? "Venice safe mode blurred the result." : null,
      result.generated.contentViolation ? "Venice flagged the output as a terms-of-service violation." : null,
    ].filter(Boolean);
    return [`Saved ${result.files.length} image(s): ${result.files.join(", ")} (seed ${result.generated.seed})`, ...notes].join("\n");
  };
}
