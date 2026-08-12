from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def load(path: Path) -> dict[str, Any]:
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    qa = load(workspace / "reports" / "asset-qa-report.json")
    qa_by_file = {item["file"]: item for item in qa["assets"]}
    reviews = {path.stem: load(path) for path in (workspace / "reviews").glob("*.json")}
    assets: list[dict[str, Any]] = []
    pose_clips: list[dict[str, Any]] = []

    for character in ("farmer", "rabbit"):
        manifest = load(workspace / "manifests" / f"{character}.json")
        review = reviews[character]
        for pose in manifest["poses"]:
            frames = []
            for index, file in enumerate(pose["frames"]):
                qa_item = qa_by_file[file]
                anchor = load(anchor_path(workspace, file))
                asset_id = f"{pose['id']}.{index + 1:02d}"
                assets.append({
                    "id": asset_id,
                    "kind": "character-frame" if character == "farmer" else "animal-frame",
                    "file": file,
                    "contentHash": qa_item["contentHash"],
                    "qaStatus": qa_item["status"],
                    "reviewStatus": anchor.get("reviewStatus", "pending"),
                    "visualReview": review["clips"][pose["id"]],
                    "width": qa_item["dimensions"]["width"],
                    "height": qa_item["dimensions"]["height"],
                    "anchors": anchor["anchors"],
                    "normalization": anchor.get("normalization"),
                })
                frames.append({"assetId": asset_id, "anchors": anchor["anchors"]})
            pose_clips.append({
                "id": pose["id"],
                "entityType": manifest["entityType"],
                "fps": pose["fps"],
                "loop": pose["loop"],
                "normalizationPolicy": pose.get("normalizationPolicy", "none"),
                "frames": frames,
            })

    for manifest_name in ("environment", "effects"):
        manifest = load(workspace / "manifests" / f"{manifest_name}.json")
        if "layers" in manifest:
            records = [(f"environment.{item['id']}", item["file"], "environment-layer") for item in manifest["layers"]]
        else:
            records = [(f"effects.{item['id']}", item["file"], item["kind"]) for item in manifest["assets"]]
        for asset_id, file, kind in records:
            qa_item = qa_by_file[file]
            assets.append({
                "id": asset_id,
                "kind": kind,
                "file": file,
                "contentHash": qa_item["contentHash"],
                "qaStatus": qa_item["status"],
                "width": qa_item["dimensions"]["width"],
                "height": qa_item["dimensions"]["height"],
                "visualReview": reviews.get("environment") if manifest_name == "environment" else {"productionStatus": "passed"},
            })

    production_ready = all(item.get("reviewStatus", "approved") == "approved" for item in assets) and all(
        review.get("productionStatus") == "passed" for review in reviews.values()
    )
    result = {
        "schemaVersion": "1.0.0",
        "automatedStructuralQa": qa["gate"],
        "humanVisualReview": "WARNING" if not production_ready else "PASS",
        "productionReady": production_ready,
        "assets": assets,
        "poseClips": pose_clips,
    }
    canonical = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    result["packageHash"] = hashlib.sha256(canonical).hexdigest()
    output = workspace / "manifests" / "compiled-asset-package.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"assets": len(assets), "poseClips": len(pose_clips), "productionReady": production_ready, "output": str(output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
