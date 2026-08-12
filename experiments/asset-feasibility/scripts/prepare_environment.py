from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter


TARGET = (1280, 720)


def resize_cover(image: Image.Image) -> Image.Image:
    source_ratio = image.width / image.height
    target_ratio = TARGET[0] / TARGET[1]
    if source_ratio > target_ratio:
        crop_width = round(image.height * target_ratio)
        left = (image.width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, image.height))
    elif source_ratio < target_ratio:
        crop_height = round(image.width / target_ratio)
        top = (image.height - crop_height) // 2
        image = image.crop((0, top, image.width, top + crop_height))
    return image.resize(TARGET, Image.Resampling.LANCZOS)


def make_shadow(path: Path) -> None:
    image = Image.new("RGBA", (512, 192), (0, 0, 0, 0))
    alpha = Image.new("L", image.size, 0)
    from PIL import ImageDraw

    ImageDraw.Draw(alpha).ellipse((54, 62, 458, 146), fill=105)
    alpha = alpha.filter(ImageFilter.GaussianBlur(18))
    image.putalpha(alpha)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shadow", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name in ("far", "mid", "ground", "foreground"):
        source = args.input / f"{name}.png"
        with Image.open(source) as image:
            result = resize_cover(image.convert("RGBA"))
            result.save(args.output / f"{name}.png")
    if args.shadow:
        make_shadow(args.shadow)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
