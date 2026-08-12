from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


COLORS = {
    "foot": "#ff2d55",
    "leftFoot": "#ff9500",
    "rightFoot": "#ffcc00",
    "leftHand": "#34c759",
    "rightHand": "#00c7be",
    "center": "#007aff",
    "head": "#af52de",
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def anchor_path(workspace: Path, file: str) -> Path:
    relative = Path(file).relative_to("normalized")
    return workspace / "anchors" / relative.with_suffix(".json")


def collect(workspace: Path, character: str) -> list[tuple[str, Path, Path]]:
    manifest = load(workspace / "manifests" / f"{character}.json")
    result: list[tuple[str, Path, Path]] = []
    for pose in manifest["poses"]:
        for index, file in enumerate(pose["frames"], 1):
            suffix = f"-{index}" if len(pose["frames"]) > 1 else ""
            result.append((f"{pose['id']}{suffix}", workspace / file, anchor_path(workspace, file)))
    return result


def render(items: list[tuple[str, Path, Path]], output: Path, columns: int = 4) -> None:
    cell_w, cell_h, label_h = 360, 390, 34
    rows = (len(items) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_w, rows * (cell_h + label_h)), "#f2eee4")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=16)
    for index, (label, image_path, metadata_path) in enumerate(items):
        with Image.open(image_path) as source:
            image = source.convert("RGBA")
        scale = min((cell_w - 30) / image.width, (cell_h - 30) / image.height)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
        ox = (index % columns) * cell_w + (cell_w - image.width) // 2
        oy = (index // columns) * (cell_h + label_h) + (cell_h - image.height) // 2
        sheet.paste(image, (ox, oy), image)
        anchors = load(metadata_path)["anchors"]
        for name, point in anchors.items():
            x = ox + round(point["x"] * image.width)
            y = oy + round(point["y"] * image.height)
            color = COLORS.get(name, "#ffffff")
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color, outline="#241c15", width=2)
            draw.text((x + 7, y - 9), name, fill=color, stroke_width=2, stroke_fill="#241c15", font=font)
        label_y = (index // columns) * (cell_h + label_h) + cell_h + 6
        draw.text(((index % columns) * cell_w + 12, label_y), label, fill="#3a3026", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=94)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    for character in ("farmer", "rabbit"):
        render(collect(workspace, character), workspace / "qa" / f"{character}-anchor-review.jpg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
