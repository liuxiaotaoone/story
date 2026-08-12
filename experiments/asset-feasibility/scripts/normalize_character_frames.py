from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, asdict
from pathlib import Path
from statistics import median
from typing import Any

from PIL import Image


@dataclass
class Target:
    height: float
    foot_x: float
    foot_y: float


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def anchor_path(workspace: Path, file: str) -> Path:
    relative = Path(file)
    for root in ("processed", "normalized"):
        try:
            relative = relative.relative_to(root)
            break
        except ValueError:
            continue
    return workspace / "anchors" / relative.with_suffix(".json")


def source_file(workspace: Path, normalized_file: str) -> Path:
    relative = Path(normalized_file)
    try:
        relative = relative.relative_to("normalized")
    except ValueError:
        pass
    return workspace / "processed" / relative


def source_anchors(metadata: dict[str, Any]) -> dict[str, dict[str, float]]:
    return metadata.get("sourceAnchors", metadata["anchors"])


def visual_height(anchors: dict[str, dict[str, float]]) -> float:
    head, foot = anchors["head"], anchors["foot"]
    return math.hypot(foot["x"] - head["x"], foot["y"] - head["y"])


def target_for(items: list[tuple[str, dict[str, dict[str, float]]]], reference: dict[str, dict[str, float]] | None = None) -> Target:
    values = [anchors for _, anchors in items]
    if reference is not None:
        return Target(visual_height(reference), reference["foot"]["x"], reference["foot"]["y"])
    return Target(
        median(visual_height(value) for value in values),
        median(value["foot"]["x"] for value in values),
        median(value["foot"]["y"] for value in values),
    )


def transform_image(image: Image.Image, scale: float, tx: float, ty: float) -> Image.Image:
    width, height = image.size
    resized = image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", image.size, (0, 0, 0, 0))
    output.alpha_composite(resized, (round(tx * width), round(ty * height)))
    return output


def normalize_manifest(workspace: Path, name: str) -> list[dict[str, Any]]:
    manifest = load_json(workspace / "manifests" / f"{name}.json")
    reference_file = manifest["referenceAsset"]
    reference_metadata = load_json(anchor_path(workspace, reference_file))
    reference_anchors = source_anchors(reference_metadata)
    grouped: dict[str, list[tuple[str, dict[str, dict[str, float]]]]] = {}
    policies: dict[str, str] = {}
    for pose in manifest["poses"]:
        policy = pose.get("normalizationPolicy", "none")
        for file in pose["frames"]:
            metadata = load_json(anchor_path(workspace, file))
            grouped.setdefault(policy, []).append((file, source_anchors(metadata)))
            policies[file] = policy
    targets: dict[str, Target] = {}
    if grouped.get("standing"):
        targets["standing"] = target_for(grouped["standing"], reference_anchors)
    for policy in ("locomotion",):
        if grouped.get(policy):
            targets[policy] = target_for(grouped[policy])

    files = [reference_file, *(file for pose in manifest["poses"] for file in pose["frames"])]
    results: list[dict[str, Any]] = []
    for file in files:
        source = source_file(workspace, file)
        output = workspace / file
        output.parent.mkdir(parents=True, exist_ok=True)
        metadata_file = anchor_path(workspace, file)
        metadata = load_json(metadata_file)
        original = source_anchors(metadata)
        policy = "reference" if file == reference_file else policies[file]
        target = targets.get(policy)
        if target is None:
            scale, tx, ty = 1.0, 0.0, 0.0
        else:
            raw_scale = target.height / max(visual_height(original), 1e-6)
            scale = max(0.85, min(1.15, raw_scale))
            tx = target.foot_x - original["foot"]["x"] * scale
            ty = target.foot_y - original["foot"]["y"] * scale
        with Image.open(source) as opened:
            image = opened.convert("RGBA")
        transform_image(image, scale, tx, ty).save(output)
        transformed = {
            key: {"x": round(point["x"] * scale + tx, 4), "y": round(point["y"] * scale + ty, 4)}
            for key, point in original.items()
        }
        metadata["file"] = file
        metadata["sourceAnchors"] = original
        metadata["anchors"] = transformed
        metadata["normalization"] = {
            "policy": policy,
            "scale": round(scale, 6),
            "translate": {"x": round(tx, 6), "y": round(ty, 6)},
            "operations": ["whole-sprite-scale", "whole-sprite-translate"],
        }
        metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        results.append({"file": file, "policy": policy, "scale": scale, "translate": {"x": tx, "y": ty}})
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    args = parser.parse_args()
    results = []
    for character in ("farmer", "rabbit"):
        results.extend(normalize_manifest(args.workspace.resolve(), character))
    report = args.workspace / "reports" / "normalization-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"schemaVersion": "1.0.0", "assets": results}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"normalized": len(results), "report": str(report)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
