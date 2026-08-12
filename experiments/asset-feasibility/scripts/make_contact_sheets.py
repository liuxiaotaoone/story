from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def collect_frames(root: Path, character: str) -> list[tuple[str, Path]]:
    manifest = json.loads((root / "manifests" / f"{character}.json").read_text(encoding="utf-8"))
    frames: list[tuple[str, Path]] = [("reference", root / manifest["referenceAsset"])]
    for pose in manifest["poses"]:
        for index, file in enumerate(pose["frames"], 1):
            suffix = f" {index}" if len(pose["frames"]) > 1 else ""
            frames.append((pose["id"].split(".")[-1] + suffix, root / file))
    return frames


def make_sheet(items: list[tuple[str, Path]], output: Path, columns: int = 5) -> None:
    cell_w, cell_h, label_h = 260, 300, 34
    rows = (len(items) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_w, rows * (cell_h + label_h)), "#eee9dc")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=18)
    for index, (label, path) in enumerate(items):
        with Image.open(path) as source:
            rgba = source.convert("RGBA")
        rgba.thumbnail((cell_w - 24, cell_h - 24), Image.Resampling.LANCZOS)
        x = (index % columns) * cell_w + (cell_w - rgba.width) // 2
        y = (index // columns) * (cell_h + label_h) + (cell_h - rgba.height) // 2
        sheet.paste(rgba, (x, y), rgba)
        draw.text(((index % columns) * cell_w + 12, (index // columns) * (cell_h + label_h) + cell_h + 6), label, fill="#3a3026", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=92)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    args = parser.parse_args()
    for character in ("farmer", "rabbit"):
        make_sheet(collect_frames(args.workspace, character), args.workspace / "qa" / f"{character}-contact-sheet.jpg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
