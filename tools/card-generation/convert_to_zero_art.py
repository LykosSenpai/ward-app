#!/usr/bin/env python3
"""Convert regular Ward card art into a Zero-style variant.

By default this script converts the full image. To preserve card frame colors,
provide one or more masks so only art regions are converted to monochrome.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps


def build_zero_monochrome(
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

    return inked.convert("RGB")


def load_and_merge_masks(
    mask_paths: list[Path],
    size: tuple[int, int],
    invert: bool,
    feather: float,
) -> Image.Image:
    merged = Image.new("L", size, 0)
    for path in mask_paths:
        layer = Image.open(path).convert("L")
        if layer.size != size:
            layer = layer.resize(size, Image.Resampling.LANCZOS)
        merged = ImageChops.lighter(merged, layer)

    if invert:
        merged = ImageOps.invert(merged)
    if feather > 0:
        merged = merged.filter(ImageFilter.GaussianBlur(radius=feather))

    return merged


def expand_path_globs(patterns: list[str]) -> list[Path]:
    paths: list[Path] = []
    for pattern in patterns:
        matches = sorted(Path().glob(pattern))
        if not matches:
            raise FileNotFoundError(f"No files matched glob: {pattern}")
        paths.extend([p for p in matches if p.is_file()])
    return paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create Zero-style card variants; optionally mask only the art panel"
    )
    parser.add_argument("input", type=Path, help="Input image path")
    parser.add_argument("output", type=Path, help="Output image path")
    parser.add_argument("--contrast", type=float, default=1.45)
    parser.add_argument("--sharpness", type=float, default=1.35)
    parser.add_argument("--blur-radius", type=float, default=0.4)
    parser.add_argument("--posterize-bits", type=int, default=4, choices=[2, 3, 4, 5, 6, 7, 8])
    parser.add_argument("--threshold", type=int, default=None, help="0-255 hard threshold for pure B/W")
    parser.add_argument(
        "--mask",
        type=Path,
        action="append",
        default=[],
        help="Mask image path; white=apply Zero conversion. Repeat to combine layers.",
    )
    parser.add_argument(
        "--retain-color-mask",
        type=Path,
        action="append",
        default=[],
        help="Mask image path; white=force keep original color (subtract from --mask). Repeat to combine layers.",
    )
    parser.add_argument(
        "--mask-glob",
        action="append",
        default=[],
        help="Glob for conversion masks (ex: 'masks/convert/*.png'). Repeat to combine globs.",
    )
    parser.add_argument(
        "--retain-color-mask-glob",
        action="append",
        default=[],
        help="Glob for retain-color masks (ex: 'masks/retain/*.png'). Repeat to combine globs.",
    )
    parser.add_argument(
        "--invert-mask",
        action="store_true",
        help="Invert final merged --mask if your source mask uses opposite polarity.",
    )
    parser.add_argument(
        "--invert-retain-color-mask",
        action="store_true",
        help="Invert final merged --retain-color-mask if your source mask uses opposite polarity.",
    )
    parser.add_argument(
        "--mask-feather",
        type=float,
        default=0.0,
        help="Optional blur radius to soften conversion mask edges before compositing.",
    )
    parser.add_argument(
        "--retain-color-feather",
        type=float,
        default=0.0,
        help="Optional blur radius to soften retain-color exclusion edges.",
    )
    parser.add_argument(
        "--save-mask-preview",
        type=Path,
        default=None,
        help="Optional path to save final conversion mask used during compositing.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    src = Image.open(args.input).convert("RGB")
    zero_layer = build_zero_monochrome(
        src,
        contrast=args.contrast,
        sharpness=args.sharpness,
        blur_radius=args.blur_radius,
        posterize_bits=args.posterize_bits,
        threshold=args.threshold,
    )

    conversion_masks = list(args.mask) + expand_path_globs(args.mask_glob)
    retain_masks = list(args.retain_color_mask) + expand_path_globs(args.retain_color_mask_glob)

    if conversion_masks:
        apply_mask = load_and_merge_masks(
            conversion_masks, src.size, invert=args.invert_mask, feather=args.mask_feather
        )

        if retain_masks:
            retain_mask = load_and_merge_masks(
                retain_masks,
                src.size,
                invert=args.invert_retain_color_mask,
                feather=args.retain_color_feather,
            )
            merged_mask = ImageChops.subtract(apply_mask, retain_mask)
        else:
            merged_mask = apply_mask

        out = Image.composite(zero_layer, src, merged_mask)
        if args.save_mask_preview is not None:
            args.save_mask_preview.parent.mkdir(parents=True, exist_ok=True)
            merged_mask.save(args.save_mask_preview)
    else:
        out = zero_layer

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output)
    if conversion_masks:
        note = f" (with {len(conversion_masks)} conversion mask layer(s)"
        if retain_masks:
            note += f", excluding {len(retain_masks)} retain-color mask layer(s)"
        note += ")"
    else:
        note = " (full-image conversion)"
    print(f"Saved Zero art variant: {args.output}{note}")


if __name__ == "__main__":
    main()
