from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError


@dataclass
class Finding:
    severity: str
    code: str
    message: str


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def find_anchor_file(workspace: Path, asset_path: str) -> Path:
    relative = Path(asset_path)
    asset_relative = relative
    for root in ("processed", "normalized"):
        try:
            asset_relative = relative.relative_to(root)
            break
        except ValueError:
            continue
    return workspace / "anchors" / asset_relative.with_suffix(".json")


def inspect_image(
    workspace: Path,
    asset_id: str,
    relative_path: str,
    require_anchors: bool = True,
    require_transparency: bool = True,
) -> dict[str, Any]:
    path = workspace / relative_path
    findings: list[Finding] = []
    result: dict[str, Any] = {"assetId": asset_id, "file": relative_path}
    if not path.is_file():
        result.update(status="failed", findings=[asdict(Finding("error", "FILE_MISSING", "Asset file does not exist"))])
        return result
    try:
        result["contentHash"] = hashlib.sha256(path.read_bytes()).hexdigest()
        with Image.open(path) as source:
            source.load()
            image = source.convert("RGBA")
    except (UnidentifiedImageError, OSError) as error:
        result.update(status="failed", findings=[asdict(Finding("error", "PNG_UNREADABLE", str(error)))])
        return result

    width, height = image.size
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    pixels = width * height
    alpha_values = list(alpha.get_flattened_data())
    transparent = sum(value == 0 for value in alpha_values)
    partial = sum(0 < value < 255 for value in alpha_values)
    result.update(
        dimensions={"width": width, "height": height},
        mode=image.mode,
        alpha={
            "hasAlpha": "A" in image.getbands(),
            "transparentRatio": transparent / pixels,
            "partialRatio": partial / pixels,
        },
        boundingBox=None if bbox is None else {
            "x": bbox[0], "y": bbox[1], "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]
        },
    )
    if bbox is None:
        findings.append(Finding("error", "EMPTY_ALPHA", "No visible subject pixels"))
    else:
        left, top, right, bottom = bbox
        margin = {"left": left, "top": top, "right": width - right, "bottom": height - bottom}
        result["margins"] = margin
        minimum_x = max(4, round(width * 0.01))
        minimum_y = max(4, round(height * 0.01))
        if require_anchors and top < minimum_y:
            findings.append(Finding("warning", "HEAD_CROP_RISK", "Visible subject is too close to the top edge"))
        if require_anchors and bottom > height - minimum_y:
            findings.append(Finding("warning", "FOOT_CROP_RISK", "Visible subject is too close to the bottom edge"))
        if require_anchors and (left < minimum_x or right > width - minimum_x):
            findings.append(Finding("warning", "SIDE_CROP_RISK", "Visible subject is too close to a side edge"))
    if require_transparency and transparent == 0:
        findings.append(Finding("error", "NO_TRANSPARENCY", "Visual asset has no fully transparent pixels"))
    elif require_transparency and transparent / pixels < 0.1:
        findings.append(Finding("warning", "LOW_TRANSPARENT_AREA", "Transparent area is below 10%"))

    anchor_file = find_anchor_file(workspace, relative_path)
    if require_anchors:
        result["anchorFile"] = str(anchor_file.relative_to(workspace)).replace("\\", "/")
    if require_anchors and not anchor_file.is_file():
        findings.append(Finding("warning", "ANCHOR_FILE_MISSING", "Anchor metadata requires manual review"))
    elif require_anchors:
        anchors = load_json(anchor_file).get("anchors", {})
        for required in ("foot", "center"):
            if required not in anchors:
                findings.append(Finding("error", "ANCHOR_REQUIRED", f"Missing required {required} anchor"))
        for name, point in anchors.items():
            x, y = point.get("x"), point.get("y")
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not 0 <= x <= 1 or not 0 <= y <= 1:
                findings.append(Finding("error", "ANCHOR_RANGE", f"{name} must be normalized to 0..1"))
                continue
            if name in {"foot", "leftFoot", "rightFoot"} and y < 0.65:
                findings.append(Finding("warning", "FOOT_ANCHOR_HIGH", f"{name} is outside the expected lower subject region"))
            if bbox is not None:
                px, py = x * width, y * height
                tolerance_x, tolerance_y = width * 0.08, height * 0.08
                if not bbox[0] - tolerance_x <= px <= bbox[2] + tolerance_x or not bbox[1] - tolerance_y <= py <= bbox[3] + tolerance_y:
                    findings.append(Finding("warning", "ANCHOR_OUTSIDE_SUBJECT", f"{name} is outside the visible subject bounds"))

    result["findings"] = [asdict(finding) for finding in findings]
    result["status"] = "failed" if any(item.severity == "error" for item in findings) else "warning" if findings else "passed"
    return result


def manifest_assets(manifest: dict[str, Any]) -> list[tuple[str, str, bool, bool]]:
    assets: list[tuple[str, str, bool, bool]] = []
    if "poses" in manifest:
        assets.append((f"{manifest['characterId']}.reference", manifest["referenceAsset"], True, True))
        for pose in manifest["poses"]:
            frames = pose.get("frames", [])
            if pose.get("kind") == "clip" and len(frames) < 2:
                raise ValueError(f"Clip {pose['id']} must contain at least two frames")
            assets.extend((f"{pose['id']}.{index + 1:02d}", frame, True, True) for index, frame in enumerate(frames))
    if "layers" in manifest:
        assets.extend(
            (
                f"{manifest['environmentId']}.{layer['id']}",
                layer["file"],
                False,
                bool(layer.get("alphaRequired", True)),
            )
            for layer in manifest["layers"]
        )
    if "assets" in manifest:
        assets.extend(
            (
                f"{manifest['assetPackageId']}.{asset['id']}",
                asset["file"],
                False,
                bool(asset.get("alphaRequired", True)),
            )
            for asset in manifest["assets"]
        )
    return assets


def run(workspace: Path) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    package_findings: list[Finding] = []
    manifests = sorted((workspace / "manifests").glob("*.json"))
    for manifest_path in manifests:
        if manifest_path.name == "compiled-asset-package.json":
            continue
        try:
            manifest = load_json(manifest_path)
            if manifest.get("schemaVersion") != "1.0.0":
                package_findings.append(Finding("error", "MANIFEST_VERSION", f"{manifest_path.name} must use schemaVersion 1.0.0"))
            manifest_results: list[dict[str, Any]] = []
            for asset_id, relative_path, require_anchors, require_transparency in manifest_assets(manifest):
                result = inspect_image(workspace, asset_id, relative_path, require_anchors, require_transparency)
                results.append(result)
                manifest_results.append(result)
            readable_dimensions = [
                item["dimensions"] for item in manifest_results if "dimensions" in item
            ]
            if "poses" in manifest and readable_dimensions:
                distinct = {(item["width"], item["height"]) for item in readable_dimensions}
                if len(distinct) != 1:
                    package_findings.append(Finding(
                        "error", "CHARACTER_DIMENSIONS_MISMATCH",
                        f"{manifest_path.name} character frames must share one canvas size: {sorted(distinct)}"
                    ))
            if "layers" in manifest:
                expected = manifest.get("referenceResolution", {})
                expected_size = (expected.get("width"), expected.get("height"))
                for item in manifest_results:
                    if "dimensions" in item and (item["dimensions"]["width"], item["dimensions"]["height"]) != expected_size:
                        package_findings.append(Finding(
                            "error", "ENVIRONMENT_DIMENSIONS_MISMATCH",
                            f"{item['assetId']} must be {expected_size[0]}x{expected_size[1]}"
                        ))
        except (json.JSONDecodeError, KeyError, ValueError) as error:
            package_findings.append(Finding("error", "MANIFEST_INVALID", f"{manifest_path.name}: {error}"))

    counts = {status: sum(result["status"] == status for result in results) for status in ("passed", "warning", "failed")}
    gate_passed = counts["failed"] == 0 and not any(item.severity == "error" for item in package_findings)
    return {
        "schemaVersion": "1.0.0",
        "gate": "PASS" if gate_passed else "FAIL",
        "summary": {"assets": len(results), **counts},
        "packageFindings": [asdict(finding) for finding in package_findings],
        "assets": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    arguments = parser.parse_args()
    workspace = arguments.workspace.resolve()
    report = run(workspace)
    report_path = workspace / "reports" / "asset-qa-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"gate": report["gate"], **report["summary"], "report": str(report_path)}, ensure_ascii=False))
    return 0 if report["gate"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
