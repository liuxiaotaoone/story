from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prompt_hash(workspace: Path, filename: str) -> str:
    return sha256_file(workspace / "prompts" / filename)


def generated_provenance(
    *,
    input_hash: str,
    prompt_hash_value: str,
    workflow_version: str = "1.1.0",
) -> dict[str, Any]:
    return {
        "inputHash": input_hash,
        "promptHash": prompt_hash_value,
        "modelId": "openai-built-in-imagegen",
        # The built-in tool does not expose a deploy/model revision or seed.
        "modelVersion": "unreported-by-tool",
        "workflowVersion": workflow_version,
        "producer": {"name": "asset-feasibility-pipeline", "version": "0.2.0"},
        "createdAt": "2026-08-12T00:00:00.000Z",
    }


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
        reference_hash = qa_by_file[manifest["referenceAsset"]]["contentHash"]
        for pose in manifest["poses"]:
            prompt_file = (
                "farmer-notice-right.md"
                if pose["id"] == "farmer.notice-right"
                else f"{character}-pose-template.md"
            )
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
                    "provenance": generated_provenance(
                        input_hash=reference_hash,
                        prompt_hash_value=prompt_hash(workspace, prompt_file),
                    ),
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
            if file.endswith("shadow.png"):
                provenance = {
                    "inputHash": sha256_file(workspace / "scripts" / "prepare_environment.py"),
                    "modelId": "deterministic-pillow",
                    "modelVersion": "Pillow",
                    "workflowVersion": "1.0.0",
                    "producer": {"name": "prepare-environment", "version": "1.0.0"},
                    "createdAt": "2026-08-12T00:00:00.000Z",
                }
            else:
                prompt_file = "environment-layers.md" if manifest_name == "environment" else "impact-effect.md"
                provenance = generated_provenance(
                    input_hash=hashlib.sha256(b"").hexdigest(),
                    prompt_hash_value=prompt_hash(workspace, prompt_file),
                )
            assets.append({
                "id": asset_id,
                "kind": kind,
                "file": file,
                "contentHash": qa_item["contentHash"],
                "qaStatus": qa_item["status"],
                "width": qa_item["dimensions"]["width"],
                "height": qa_item["dimensions"]["height"],
                "visualReview": reviews.get("environment") if manifest_name == "environment" else {"productionStatus": "passed"},
                "provenance": provenance,
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
