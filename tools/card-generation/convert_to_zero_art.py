#!/usr/bin/env python3
"""Convert regular Ward card art into a Zero-style variant.

Pipeline:
1) Grayscale
2) Contrast boost
3) Edge-preserving smooth
4) Unsharp mask
5) Optional threshold pass for inked look
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def convert_zero_art(
    image: Image.Image,
    contrast: float = 1.45,
    sharpness: float = 1.35,
    blur_radius: float = 0.4,
    posterize_bits: int = 4,
    threshold: int | None = None,
) -> Image.Image:
    gray = ImageOps.grayscale(image)
    contrasted = ImageEnhance.Contrast(gray).enhance(contrast)
    softened = contrasted.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    sharpened = ImageEnhance.Sharpness(softened).enhance(sharpness)
    inked = ImageOps.posterize(sharpened.convert("RGB"), bits=posterize_bits).convert("L")

    if threshold is not None:
        inked = inked.point(lambda px: 255 if px > threshold else 0, mode="1").convert("L")

    return inked


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create Zero-style black/white card art variants")
    parser.add_argument("input", type=Path, help="Input image path")
    parser.add_argument("output", type=Path, help="Output image path")
    parser.add_argument("--contrast", type=float, default=1.45)
    parser.add_argument("--sharpness", type=float, default=1.35)
    parser.add_argument("--blur-radius", type=float, default=0.4)
    parser.add_argument("--posterize-bits", type=int, default=4, choices=[2, 3, 4, 5, 6, 7, 8])
    parser.add_argument("--threshold", type=int, default=None, help="0-255 hard threshold for pure B/W")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    src = Image.open(args.input)
    out = convert_zero_art(
        src,
        contrast=args.contrast,
        sharpness=args.sharpness,
        blur_radius=args.blur_radius,
        posterize_bits=args.posterize_bits,
        threshold=args.threshold,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output)
    print(f"Saved Zero art variant: {args.output}")


if __name__ == "__main__":
    main()
