#!/usr/bin/env python3
"""Generate WARD Zero-zone masks in the correct coordinate system.

Supports two separate targets:
- production: masks sized to the master template (1040x1512)
- reference_sheet: debug overlays sized to the alignment poster (1024x1536)
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from PIL import Image, ImageDraw

MASK_TARGET = Literal["production", "reference_sheet"]

REFERENCE_SHEET_SIZE = (1024, 1536)
REFERENCE_SHEET_ANCHORS = {
    "OTL": (98, 124),
    "PC": (439, 124),
    "OTR": (790, 124),
    "LC": (81, 589),
    "RC": (814, 589),
    "OBL": (97, 1203),
    "BC": (440, 1203),
    "OBR": (791, 1203),
    "FIC_C": (147, 337),
    "FIC_D": 97,
    "ZERO_B": 303,
}


def validate_mask_geometry(target_path: str, mask_path: str) -> None:
    target = Image.open(target_path)
    mask = Image.open(mask_path)

    if target.size != mask.size:
        raise ValueError(
            f"{Path(mask_path).name} has size {mask.size}, "
            f"but target {Path(target_path).name} has size {target.size}."
        )

    if mask.mode != "L":
        raise ValueError(
            f"{Path(mask_path).name} is mode {mask.mode}. "
            "Production masks should be grayscale mode 'L'."
        )


def get_target_path(bundle_dir: Path, target: MASK_TARGET) -> Path:
    if target == "production":
        return bundle_dir / "template_reference" / "master_zero_template_reference_not_a_mask.png"
    return bundle_dir / "template_reference" / "Alignment reference 2.png"


def draw_left_icon_cluster(mask: Image.Image, target: MASK_TARGET) -> None:
    draw = ImageDraw.Draw(mask)

    if target == "reference_sheet":
        anchors = REFERENCE_SHEET_ANCHORS
        fic_x, fic_y = anchors["FIC_C"]
        fic_r = anchors["FIC_D"] // 2
        pc_x = anchors["PC"][0]
        zero_baseline = anchors["ZERO_B"]

        # faction medallion circle
        draw.ellipse((fic_x - fic_r, fic_y - fic_r, fic_x + fic_r, fic_y + fic_r), fill=255)
        # rarity pip
        draw.ellipse((108, 222, 142, 256), fill=255)
        # generation/rank tag zone
        draw.rounded_rectangle((78, 264, 240, 315), radius=10, fill=255)
        # zero logo area near header left
        draw.rounded_rectangle((92, zero_baseline - 46, pc_x - 40, zero_baseline + 20), radius=12, fill=255)
    else:
        # production target: preserve geometry proportions from the existing 1040x1512 mask family
        draw.ellipse((99, 283, 196, 380), fill=255)
        draw.ellipse((111, 205, 146, 240), fill=255)
        draw.rounded_rectangle((82, 250, 246, 301), radius=10, fill=255)
        draw.rounded_rectangle((97, 286, 392, 352), radius=12, fill=255)


def generate_mask(bundle_dir: Path, target: MASK_TARGET, output_name: str) -> Path:
    target_path = get_target_path(bundle_dir, target)
    target_im = Image.open(target_path)
    w, h = target_im.size

    if target == "reference_sheet" and (w, h) != REFERENCE_SHEET_SIZE:
        raise ValueError(f"Expected reference sheet size {REFERENCE_SHEET_SIZE}, got {(w, h)}")

    mask = Image.new("L", (w, h), 0)
    draw_left_icon_cluster(mask, target)

    output_dir = bundle_dir / ("masks_regenerated_reference" if target == "reference_sheet" else "masks_regenerated_production")
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / output_name
    mask.save(out_path)

    validate_mask_geometry(str(target_path), str(out_path))
    return out_path


def main() -> None:
    bundle_dir = Path("zero_art_card_handoff_bundle")

    generated = [
        generate_mask(bundle_dir, "production", "08_left_icon_cluster_zero_zone_mask.png"),
        generate_mask(bundle_dir, "production", "09_left_icon_cluster_zero_zone_mask.png"),
        generate_mask(bundle_dir, "production", "10_left_icon_cluster_zero_zone_mask.png"),
        generate_mask(bundle_dir, "production", "12_left_icon_cluster_zero_zone_mask.png"),
        generate_mask(bundle_dir, "production", "13_left_icon_cluster_zero_zone_mask.png"),
        generate_mask(bundle_dir, "reference_sheet", "08_left_icon_cluster_zero_zone_mask_overlay.png"),
    ]

    for path in generated:
        print(f"Generated {path}")


if __name__ == "__main__":
    main()
