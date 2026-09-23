// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { describe, it, expect } from "vitest";
import { MascotAtlas } from "../../src/ui/mascot/atlas.js";
import { MascotStage, IMAGE_ID_BASE } from "../../src/ui/mascot/stage.js";
import { MascotDirector, cropToAspect } from "../../src/ui/mascot/director.js";
import { POSES, activityForTool, labelForTool } from "../../src/ui/mascot/choreography.js";
import { uploadAnimation, controlAnimation, placeImage, removePlacement } from "../../src/ui/kitty-graphics.js";
import { renderTitle, TITLE_WIDTH } from "../../src/ui/title.js";
import { isPng } from "../../src/media/image-store.js";

/** Splits written output into graphics commands' control keys, ignoring payloads. */
function graphicsCommands(out: string): Record<string, string>[] {
  return [...out.matchAll(/\x1b_G([^;\x1b]*)(?:;[^\x1b]*)?\x1b\\/g)].map((m) =>
    Object.fromEntries(m[1].split(",").map((kv) => kv.split("=") as [string, string])),
  );
}

const atlas = MascotAtlas.load();

describe("mascot atlas (built assets)", () => {
  it("is built and has every animation the choreography uses, as real PNGs", () => {
    expect(atlas).not.toBeNull();
    for (const pose of Object.values(POSES)) {
      expect(atlas!.has(pose.animation), pose.animation).toBe(true);
      const frames = atlas!.frames(pose.animation);
      expect(frames.length).toBe(atlas!.entry(pose.animation)!.frames);
      expect(frames.every(isPng)).toBe(true);
    }
    for (const name of ["intro", "starfield", "wave"]) expect(atlas!.has(name), name).toBe(true);
  });

  it("resolves labelled frames used by poses", () => {
    for (const pose of Object.values(POSES)) {
      for (const f of pose.frames ?? []) {
        if (typeof f === "string") expect(atlas!.entry(pose.animation)!.labels, `${pose.animation}:${f}`).toContain(f);
      }
    }
  });
});

describe("kitty animation protocol", () => {
  const png = Buffer.from("fake");

  it("uploads root frame, extra frames with gaps, then the root gap", () => {
    const cmds = graphicsCommands(uploadAnimation({ id: 7, frames: [png, png, png], frameMs: 250 }));
    expect(cmds.map((c) => c.a)).toEqual(["t", "f", "f", "a"]);
    expect(cmds[1]).toMatchObject({ i: "7", z: "250" });
    expect(cmds[3]).toMatchObject({ i: "7", r: "1", z: "250" });
    expect(cmds.every((c) => c.q === "2")).toBe(true); // terminal never replies into stdin
  });

  it("repeats a=f on every chunk of a multi-chunk frame (else Kitty overwrites the root image)", () => {
    const big = Buffer.alloc(9000, 1);
    const out = uploadAnimation({ id: 7, frames: [big, big], frameMs: 100 });
    const chunks = [...out.matchAll(/\x1b_G([^;\x1b]*)/g)].map((m) => m[1]);
    const frameChunks = chunks.slice(chunks.findIndex((c) => c.includes("a=f")));
    const continuation = frameChunks.slice(1).filter((c) => !c.startsWith("a=a") && !c.includes("r=1"));
    expect(continuation.length).toBeGreaterThan(0);
    expect(continuation.every((c) => c.includes("a=f") && c.includes("q=2"))).toBe(true);
    // Root-image continuation chunks must NOT claim a=f.
    const rootContinuation = chunks.slice(1, chunks.findIndex((c) => c.includes("a=f")));
    expect(rootContinuation.every((c) => !c.includes("a="))).toBe(true);
  });

  it("maps playback modes to terminal-driven animation states", () => {
    expect(graphicsCommands(controlAnimation(7, "loop"))[0]).toMatchObject({ a: "a", s: "3", v: "1" });
    expect(graphicsCommands(controlAnimation(7, "once"))[0]).toMatchObject({ a: "a", s: "2" });
    expect(graphicsCommands(controlAnimation(7, "still"))[0]).toMatchObject({ a: "a", s: "1", c: "1" });
  });

  it("places without moving the cursor and removes a placement without freeing data", () => {
    expect(graphicsCommands(placeImage({ id: 7, placementId: 1, rows: 5 }))[0]).toMatchObject({ a: "p", C: "1", r: "5" });
    expect(graphicsCommands(removePlacement(7, 1))[0]).toMatchObject({ a: "d", d: "i", i: "7", p: "1" });
  });
});

describe("MascotStage", () => {
  function stage(reducedMotion = false) {
    let out = "";
    const s = new MascotStage(atlas!, {
      rows: 5,
      reducedMotion,
      write: (chunk) => (out += chunk),
      terminalColumns: () => 100,
    });
    return { s, take: () => { const o = out; out = ""; return o; } };
  }

  it("reserves rows once, uploads each pose once, and swaps placements on state change", () => {
    const { s, take } = stage();
    s.show("thinking", "thinking…");
    const first = take();
    expect(first).toContain("\r\n\n\n\n\n\x1b[5A\x1b7"); // reserve 5 rows, return, remember the spot
    expect(graphicsCommands(first).filter((c) => c.a === "t")).toHaveLength(1);
    expect(first).toContain("thinking…");

    s.show("typing", "writing src/a.ts…");
    const second = take();
    expect(second).not.toContain("\x1b[5A"); // no second reservation
    expect(graphicsCommands(second).some((c) => c.a === "d")).toBe(true);

    s.show("thinking", "thinking…");
    expect(graphicsCommands(take()).filter((c) => c.a === "t")).toHaveLength(0); // cached upload
  });

  it("hides by removing the placement and blanking its rows, cursor back at the top", () => {
    const { s, take } = stage();
    s.show("reading", "reading x…");
    take();
    s.hide();
    const out = take();
    expect(graphicsCommands(out)[0]).toMatchObject({ a: "d", d: "i" });
    expect(out.match(/\x1b\[2K/g)).toHaveLength(5);
    expect(out.endsWith("\x1b8")).toBe(true);
    expect(s.isShown).toBe(false);
  });

  it("holds still under reduced motion", () => {
    const { s, take } = stage(true);
    s.show("typing", "writing…");
    expect(graphicsCommands(take()).find((c) => c.a === "a" && c.s)).toMatchObject({ s: "1" });
  });

  it("truncates a long label to the terminal width", () => {
    const { s, take } = stage();
    s.show("reading", "x".repeat(300));
    const out = take();
    expect(out).toContain("…");
    expect(out).not.toContain("x".repeat(120));
  });

  it("frees its image range on dispose", () => {
    const { s, take } = stage();
    s.show("idle", "");
    take();
    s.dispose();
    const freed = graphicsCommands(take()).find((c) => c.d === "R");
    expect(freed).toMatchObject({ x: String(IMAGE_ID_BASE) });
  });
});

describe("MascotDirector", () => {
  const ui = { mascot: true, mascotRows: 5, intro: true, reducedMotion: false, background: undefined };
  const io = (env: NodeJS.ProcessEnv, isTTY = true) => ({ write: () => {}, terminalColumns: () => 100, env, isTTY });

  it("only exists when enabled, on a TTY that speaks Kitty graphics", () => {
    expect(MascotDirector.create(ui, io({ TERM: "xterm-kitty" }), atlas)).not.toBeNull();
    expect(MascotDirector.create(ui, io({ TERM: "xterm-256color" }), atlas)).toBeNull();
    expect(MascotDirector.create(ui, io({ TERM: "xterm-kitty" }, false), atlas)).toBeNull();
    expect(MascotDirector.create({ ...ui, mascot: false }, io({ TERM: "xterm-kitty" }), atlas)).toBeNull();
    expect(MascotDirector.create(ui, io({ TERM: "xterm-kitty" }), null)).toBeNull();
  });

  it("presents the banner: text first, then backdrop under it and the intro beside it", () => {
    let out = "";
    const d = MascotDirector.create(ui, { ...io({ TERM: "xterm-kitty" }), write: (s) => (out += s) }, atlas)!;
    const title = renderTitle({ color: false });
    d.presentBanner(title, TITLE_WIDTH + 3);
    expect(out.indexOf("██")).toBeLessThan(out.indexOf("\x1b_G"));
    const placements = graphicsCommands(out).filter((c) => c.a === "p");
    expect(placements.find((c) => c.z === "-1")).toBeDefined(); // starfield beneath text
    expect(graphicsCommands(out).find((c) => c.a === "a" && c.s)).toMatchObject({ s: "2" }); // intro plays once
    expect(out.endsWith(`\r\x1b[${title.length}B`)).toBe(true); // cursor returned below the banner
  });
});

describe("choreography", () => {
  it("maps tools to activities, with unknown/MCP tools as running", () => {
    expect(activityForTool("read_file")).toBe("reading");
    expect(activityForTool("edit_file")).toBe("typing");
    expect(activityForTool("run_command")).toBe("running");
    expect(activityForTool("generate_image")).toBe("painting");
    expect(activityForTool("mcp__github__create_issue")).toBe("running");
  });

  it("labels tool activity with its target", () => {
    expect(labelForTool("edit_file", '{"path":"src/a.ts"}')).toBe("writing src/a.ts…");
    expect(labelForTool("run_command", '{"command":"npm test"}')).toBe("running npm test…");
    expect(labelForTool("git_status", "{")).toBe("reading git_status…");
  });
});

describe("helpers", () => {
  it("crops a source rectangle to a target aspect ratio, centered", () => {
    expect(cropToAspect(400, 100, 2)).toEqual({ x: 100, y: 0, width: 200, height: 100 });
    expect(cropToAspect(100, 400, 0.5)).toEqual({ x: 0, y: 100, width: 100, height: 200 });
  });

  it("renders a title whose lines all have the same visible width", () => {
    const lines = renderTitle({ color: false });
    const widths = new Set(lines.slice(0, 8).map((l) => [...l].length));
    expect(widths).toEqual(new Set([TITLE_WIDTH + 3]));
    expect(lines.join("\n")).toContain("CONNECT • EXPLORE • BUILD • GROW");
  });
});

describe("token bag", () => {
  it("fills with context usage, clamped to the sequence's bag frames", async () => {
    const { tokenBagFrame } = await import("../../src/cli/commands/mascot.js");
    expect(tokenBagFrame(0)).toBe(3);
    expect(tokenBagFrame(0.5)).toBe(6);
    expect(tokenBagFrame(0.99)).toBe(9);
    expect(tokenBagFrame(5)).toBe(9);
    expect(tokenBagFrame(-1)).toBe(3);
  });

  it("prints an inline still that stays in scrollback, cursor left below it", () => {
    let out = "";
    const ui = { mascot: true, mascotRows: 5, intro: true, reducedMotion: false, background: undefined };
    const d = MascotDirector.create(ui, { write: (s) => (out += s), terminalColumns: () => 100, env: { TERM: "xterm-kitty" }, isTTY: true }, atlas)!;
    d.showInline("token_fill", 6, "~12k tokens", 4);
    const cmds = graphicsCommands(out);
    expect(cmds.filter((c) => c.a === "t")).toHaveLength(1); // a single frame, no animation
    expect(cmds.find((c) => c.a === "p")).toMatchObject({ r: "4", C: "1" });
    expect(out).toContain("~12k tokens");
    expect(out.endsWith("\r\x1b[3B")).toBe(true); // 4 rows, label on row 1 → 3 down to finish below
  });
});
