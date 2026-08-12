import json
import tempfile
import unittest
from pathlib import Path
import sys

from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from run_asset_qa import find_anchor_file, inspect_image  # noqa: E402


class AssetQaTest(unittest.TestCase):
    def test_passes_valid_alpha_png_with_normalized_anchors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "processed" / "farmer").mkdir(parents=True)
            (root / "anchors" / "farmer").mkdir(parents=True)
            image = Image.new("RGBA", (100, 120), (0, 0, 0, 0))
            for x in range(20, 80):
                for y in range(10, 110):
                    image.putpixel((x, y), (80, 60, 40, 255))
            image.save(root / "processed" / "farmer" / "valid.png")
            (root / "anchors" / "farmer" / "valid.json").write_text(json.dumps({
                "anchors": {"foot": {"x": 0.5, "y": 0.9}, "center": {"x": 0.5, "y": 0.5}}
            }), encoding="utf-8")
            self.assertEqual(inspect_image(root, "valid", "processed/farmer/valid.png")["status"], "passed")

    def test_reports_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            report = inspect_image(Path(directory), "missing", "processed/missing.png")
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["findings"][0]["code"], "FILE_MISSING")

    def test_allows_an_opaque_full_bleed_environment_layer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "processed").mkdir()
            Image.new("RGB", (1280, 720), (100, 140, 180)).save(root / "processed" / "far.png")
            report = inspect_image(root, "far", "processed/far.png", require_anchors=False, require_transparency=False)
            self.assertEqual(report["status"], "passed")
            self.assertEqual(len(report["contentHash"]), 64)

    def test_anchor_namespace_mirrors_character_asset_path(self):
        root = Path("workspace")
        self.assertEqual(
            find_anchor_file(root, "normalized/farmer-002/idle.png"),
            root / "anchors" / "farmer-002" / "idle.json",
        )


if __name__ == "__main__":
    unittest.main()
