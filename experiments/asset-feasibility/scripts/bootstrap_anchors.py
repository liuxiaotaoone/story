from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def bootstrap(workspace: Path, character: str) -> None:
    processed = workspace / "processed" / character
    anchors_dir = workspace / "anchors" / character
    anchors_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(processed.glob("*.png")):
        target = anchors_dir / f"{path.stem}.json"
        if target.exists():
            continue
        with Image.open(path) as source:
            image = source.convert("RGBA")
        bbox = image.getchannel("A").getbbox()
        if bbox is None:
            continue
        width, height = image.size
        left, top, right, bottom = bbox
        center_x = (left + right) / 2 / width
        visible_bottom = min(1.0, bottom / height)
        payload = {
            "schemaVersion": "1.0.0",
            "assetId": path.stem,
            "file": f"processed/{character}/{path.name}",
            "anchors": {
                "foot": {"x": round(center_x, 4), "y": round(visible_bottom, 4)},
                "leftFoot": {"x": round(left / width + (right - left) / width * 0.4, 4), "y": round(visible_bottom, 4)},
                "rightFoot": {"x": round(left / width + (right - left) / width * 0.6, 4), "y": round(visible_bottom, 4)},
                "leftHand": {"x": round(left / width + (right - left) / width * 0.25, 4), "y": round(top / height + (bottom - top) / height * 0.5, 4)},
                "rightHand": {"x": round(left / width + (right - left) / width * 0.75, 4), "y": round(top / height + (bottom - top) / height * 0.5, 4)},
                "center": {"x": round(center_x, 4), "y": round((top + bottom) / 2 / height, 4)},
                "head": {"x": round(center_x, 4), "y": round(top / height + (bottom - top) / height * 0.15, 4)},
            },
            "reviewStatus": "auto-estimate"
        }
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--character", required=True)
    args = parser.parse_args()
    bootstrap(args.workspace.resolve(), args.character)


if __name__ == "__main__":
    main()
