#!/usr/bin/env python3
# All Rights Reserved: Jevante Boxley
# QCPUNKS SECTOR
"""
Builds Lattice's mascot frame atlas from the design sheets.

    python3 scripts/mascot/build_atlas.py [--preview DIR]

Reads assets/mascot/regions.json, cuts each animation out of its sheet,
removes the baked-in background, aligns frames, and writes:

    assets/mascot/frames/<animation>/<n>.png   RGBA, uniform size per animation
    assets/mascot/mascot.json                   manifest the runtime reads

The runtime never touches the source sheets. Replacing them with clean,
hand-drawn frames later only means re-running this (or writing the frames
and manifest directly).

Build-time only dependencies: Pillow, numpy, scipy.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets" / "mascot"

# A pixel is "background" when its color is within this distance (sum of
# per-channel differences) of the sheet background sampled at the region edge.
BACKGROUND_TOLERANCE = 42
# Enclosed pockets (e.g. between an arm and the body) are only cleared when
# they're very close to the background color, so dark outfit details survive.
ENCLOSED_TOLERANCE = 16
MIN_ENCLOSED_AREA = 24
# Foreground blobs smaller than this are noise / label fragments.
MIN_SPECK_AREA = 12
PADDING = 2


def estimate_background(region: np.ndarray) -> np.ndarray:
    border = np.concatenate([region[0], region[-1], region[:, 0], region[:, -1]])
    return np.median(border, axis=0)


def distance_from(region: np.ndarray, color: np.ndarray) -> np.ndarray:
    return np.abs(region.astype(int) - color.astype(int)).sum(axis=-1)


def foreground_mask(region: np.ndarray, background: np.ndarray) -> np.ndarray:
    mask = distance_from(region, background) > BACKGROUND_TOLERANCE
    labels, count = ndimage.label(mask)
    if count:
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        keep = np.isin(labels, np.flatnonzero(sizes >= MIN_SPECK_AREA) + 1)
        mask &= keep
    return mask


def column_segments(mask: np.ndarray, expected: int) -> list[tuple[int, int]]:
    """Splits a row of figures on empty columns; falls back to an even split."""
    occupied = mask.any(axis=0)
    runs: list[list[int]] = []
    start = None
    for x, filled in enumerate(occupied):
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            runs.append([start, x])
            start = None
    if start is not None:
        runs.append([start, len(occupied)])

    # Fold small runs (sparkles, hearts, speech bubbles) into their nearest neighbour.
    widths = [b - a for a, b in runs]
    if widths:
        typical = sorted(widths)[len(widths) // 2]
        merged: list[list[int]] = []
        for run in runs:
            if merged and (run[1] - run[0] < typical * 0.35 or merged[-1][1] - merged[-1][0] < typical * 0.35):
                merged[-1][1] = run[1]
            else:
                merged.append(run)
        runs = merged

    if len(runs) == expected:
        return [(a, b) for a, b in runs]
    width = mask.shape[1]
    step = width / expected
    return [(round(i * step), round((i + 1) * step)) for i in range(expected)]


# Captions ("1. NOTICE") sit centered under each frame on a line this tall.
CAPTION_HEIGHT = 12
CAPTION_BRIGHTNESS = 135


def caption_segments(sheet: np.ndarray, spec: dict) -> list[tuple[int, int]] | None:
    """
    Frames that touch can't be split on empty columns, but their captions never
    touch: find the caption centers and split halfway between neighbours.
    Returns None when the captions found don't match the frame count.
    """
    left, top, right, bottom = spec["box"]
    expected = spec["frames"]
    caption_top = spec.get("caption_y", bottom)
    word_gap = spec.get("caption_gap", 9)
    band = sheet[caption_top : caption_top + CAPTION_HEIGHT, left:right].astype(int)
    text_columns = (band.mean(axis=-1) > CAPTION_BRIGHTNESS).any(axis=0)
    clusters: list[list[int]] = []
    for x in np.flatnonzero(text_columns):
        if clusters and x - clusters[-1][1] <= word_gap:
            clusters[-1][1] = x
        else:
            clusters.append([x, x])
    if len(clusters) != expected:
        return None
    centers = [(a + b) / 2 for a, b in clusters]
    edges = [0] + [round((centers[i] + centers[i + 1]) / 2) for i in range(expected - 1)] + [right - left]
    return list(zip(edges[:-1], edges[1:]))


def drop_edge_debris(frame: np.ndarray) -> np.ndarray:
    """
    Removes pieces of neighbouring frames and panel borders that a split left
    behind: blobs touching the left/right edge that are narrow relative to
    the frame, and thin straight lines touching any edge.
    """
    alpha = frame[..., 3] > 0
    labels, count = ndimage.label(alpha)
    if count <= 1:
        return frame
    h, w = alpha.shape
    total = alpha.sum()
    for index, sl in enumerate(ndimage.find_objects(labels), start=1):
        bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        area = (labels[sl] == index).sum()
        touches_side = sl[1].start == 0 or sl[1].stop == w
        touches_any = touches_side or sl[0].start == 0 or sl[0].stop == h
        sliver = touches_side and bw < w * 0.3 and area < total * 0.2
        line = touches_any and min(bh, bw) <= 4 and max(bh, bw) >= 12
        if sliver or line:
            frame[..., 3][labels == index] = 0
    return frame


# Chunky 7-row pixel font for sign patches ('#' = ink), drawn at `scale`.
PIXEL_FONT = {
    "K": ["##..##", "##.##.", "####..", "###...", "####..", "##.##.", "##..##"],
    "i": ["##", "..", "##", "##", "##", "##", "##"],
    "t": [".##..", ".##..", "#####", ".##..", ".##..", ".##..", "..###"],
    "1": [".##.", "###.", ".##.", ".##.", ".##.", ".##.", "####"],
    "0": [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
}


def hex_rgba(color: str) -> tuple[int, int, int, int]:
    color = color.lstrip("#")
    return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16), 255)


def apply_patch(frame: Image.Image, patch: dict) -> Image.Image:
    """
    Repaints part of a frame: clears `erase` (a transparent box), then
    draws `text` in the pixel font at `at` with a 1px outline — used to
    retitle signage baked into the art.
    """
    pixels = np.array(frame)
    x0, y0, x1, y1 = patch["erase"]
    pixels[y0:y1, x0:x1, 3] = 0

    scale = patch.get("scale", 2)
    ink = np.zeros(pixels.shape[:2], dtype=bool)
    x = patch["at"][0]
    for ch in patch["text"]:
        glyph = PIXEL_FONT[ch]
        for gy, row in enumerate(glyph):
            for gx, cell in enumerate(row):
                if cell == "#":
                    top = patch["at"][1] + gy * scale
                    left = x + gx * scale
                    ink[top : top + scale, left : left + scale] = True
        x += (len(glyph[0]) + 1) * scale

    outline = ndimage.binary_dilation(ink) & ~ink
    pixels[outline] = hex_rgba(patch["outline"])
    pixels[ink] = hex_rgba(patch["fill"])
    return Image.fromarray(pixels, "RGBA")


def grid_segments(shape: tuple[int, int], cols: int, rows: int) -> list[tuple[int, int, int, int]]:
    h, w = shape
    return [
        (round(c * w / cols), round(r * h / rows), round((c + 1) * w / cols), round((r + 1) * h / rows))
        for r in range(rows)
        for c in range(cols)
    ]


def cut_frame(region: np.ndarray, background: np.ndarray, keep_background: bool) -> Image.Image:
    """Returns an RGBA frame cropped to its content with the background removed."""
    if keep_background:
        return Image.fromarray(region.astype(np.uint8)).convert("RGBA")

    dist = distance_from(region, background)
    near_bg = dist <= BACKGROUND_TOLERANCE
    labels, count = ndimage.label(near_bg)
    edge_labels = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    transparent = np.isin(labels, list(edge_labels))

    pockets, pocket_count = ndimage.label((dist <= ENCLOSED_TOLERANCE) & ~transparent)
    if pocket_count:
        sizes = ndimage.sum(np.ones_like(dist), pockets, range(1, pocket_count + 1))
        transparent |= np.isin(pockets, np.flatnonzero(sizes >= MIN_ENCLOSED_AREA) + 1)

    opaque = ~transparent
    labels, count = ndimage.label(opaque)
    if count:
        sizes = ndimage.sum(opaque, labels, range(1, count + 1))
        opaque &= np.isin(labels, np.flatnonzero(sizes >= MIN_SPECK_AREA) + 1)

    rgba = drop_edge_debris(np.dstack([region.astype(np.uint8), (opaque * 255).astype(np.uint8)]))
    opaque = rgba[..., 3] > 0
    ys, xs = np.nonzero(opaque)
    if len(xs) == 0:
        return Image.fromarray(rgba, "RGBA")
    return Image.fromarray(rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], "RGBA")


def normalize(frames: list[Image.Image], anchor: str) -> list[Image.Image]:
    """Pads every frame to one canvas, anchored bottom-center (bodies) or center (faces)."""
    w = max(f.width for f in frames) + PADDING * 2
    h = max(f.height for f in frames) + PADDING * 2
    out = []
    for f in frames:
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        x = (w - f.width) // 2
        y = h - PADDING - f.height if anchor == "bottom" else (h - f.height) // 2
        canvas.paste(f, (x, y))
        out.append(canvas)
    return out


def build_entry(name: str, spec: dict, sheets: dict[str, np.ndarray]) -> list[Image.Image]:
    left, top, right, bottom = spec["box"]
    inset = spec.get("inset", 0)
    sheet = sheets[spec["sheet"]]
    region = sheet[top + inset : bottom - inset, left + inset : right - inset]
    background = estimate_background(region)
    keep_background = spec.get("keep_background", False)
    expected = spec.get("frames", 1)

    if "grid" in spec:
        cols, rows = spec["grid"]
        boxes = grid_segments(region.shape[:2], cols, rows)
        frames = [cut_frame(region[y0:y1, x0:x1], background, False) for x0, y0, x1, y1 in boxes]
    elif expected == 1:
        frames = [cut_frame(region, background, keep_background)]
    else:
        segments = caption_segments(sheet, spec) if spec.get("split") == "captions" else None
        if spec.get("split") == "captions" and segments is None:
            print(f"  warning: {name}: captions didn't match {expected} frames — splitting on columns")
        if segments is None:
            segments = column_segments(foreground_mask(region, background), expected)
        frames = [cut_frame(region[:, a:b], background, keep_background) for a, b in segments]

    if "keep_frames" in spec:
        frames = [frames[i] for i in spec["keep_frames"]]

    is_face = "labels" in spec and name.startswith(("faces", "expr"))
    return frames if keep_background else normalize(frames, "center" if is_face else "bottom")


def save_preview(name: str, frames: list[Image.Image], out_dir: Path) -> None:
    scale = 2
    w, h = frames[0].width * scale, frames[0].height * scale
    sheet = Image.new("RGB", ((w + 6) * len(frames) + 6, h + 12), (38, 30, 54))
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(frames):
        x = 6 + i * (w + 6)
        draw.rectangle([x - 1, 5, x + w, 6 + h], outline=(90, 80, 120))
        sheet.paste(f.resize((w, h), Image.NEAREST), (x, 6), f.resize((w, h), Image.NEAREST))
    sheet.save(out_dir / f"{name}.png")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--preview", type=Path, help="also write a contact sheet per animation here")
    parser.add_argument("--only", nargs="*", help="build just these entries (for tuning regions)")
    args = parser.parse_args()

    regions = json.loads((ASSETS / "regions.json").read_text())
    sheets = {key: np.asarray(Image.open(ASSETS / path).convert("RGB")) for key, path in regions["sheets"].items()}
    if args.preview:
        args.preview.mkdir(parents=True, exist_ok=True)

    frames_dir = ASSETS / "frames"
    if not args.only and frames_dir.exists():
        shutil.rmtree(frames_dir)

    manifest_path = ASSETS / "mascot.json"
    manifest = json.loads(manifest_path.read_text()) if args.only and manifest_path.exists() else {"version": 1}
    manifest.setdefault("animations", {})
    manifest.setdefault("props", {})

    for group in ("animations", "props"):
        for name, spec in regions[group].items():
            if args.only and name not in args.only:
                continue
            frames = build_entry(name, spec, sheets)
            target = frames_dir / name
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True)
            for i, frame in enumerate(frames):
                frame.save(target / f"{i}.png", optimize=True)
            entry = {
                "frames": len(frames),
                "width": frames[0].width,
                "height": frames[0].height,
            }
            for key in ("fps", "loop", "labels"):
                if key in spec:
                    entry[key] = spec[key]
            manifest[group][name] = entry
            if args.preview:
                save_preview(name, frames, args.preview)
            print(f"{group[:-1]:9} {name:14} {len(frames):2} frame(s)  {entry['width']}x{entry['height']}")

    # Patches repaint baked-in details (e.g. signage) before sequences reuse the frames.
    for patch in regions.get("patches", []):
        name = patch["target"]
        if args.only and name not in args.only:
            continue
        path = frames_dir / name / f"{patch['frame']}.png"
        apply_patch(Image.open(path).convert("RGBA"), patch).save(path, optimize=True)
        print(f"patch     {name}/{patch['frame']}  \"{patch['text']}\"")

    # Sequences chain animations into one (a terminal animation needs one frame size).
    for name, spec in regions.get("sequences", {}).items():
        if args.only and name not in args.only and not set(spec["parts"]) & set(args.only):
            continue
        parts = [Image.open(frames_dir / part / f"{i}.png") for part in spec["parts"]
                 for i in range(manifest["animations"][part]["frames"])]
        frames = normalize([p.crop(p.getbbox()) for p in parts], "bottom")
        target = frames_dir / name
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        for i, frame in enumerate(frames):
            frame.save(target / f"{i}.png", optimize=True)
        manifest["animations"][name] = {
            "frames": len(frames), "width": frames[0].width, "height": frames[0].height,
            "fps": spec.get("fps", 6), "loop": spec.get("loop", False),
        }
        if args.preview:
            save_preview(name, frames, args.preview)
        print(f"sequence  {name:14} {len(frames):2} frame(s)  {frames[0].width}x{frames[0].height}")

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {manifest_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
