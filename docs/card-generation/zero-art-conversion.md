# Zero Art Conversion Workflow

Use this to convert standard card art into the monochrome "Zero" style while preserving the original frame colors.

## 1) Masked conversion (recommended)

When you have the original mask layer(s), pass them with `--mask` so only the illustration area gets converted to monochrome.

```bash
python3 tools/card-generation/convert_to_zero_art.py \
  <input-card-image> \
  <output-card-image> \
  --mask <convert-mask-1.png> \
  --mask <convert-mask-2.png>
```

- White in `--mask` = apply Zero monochrome conversion.
- Multiple `--mask` layers are merged together.

## 2) New: explicitly retain color with white masks

If your source masks are white even where color must stay, provide those as retain-color exclusions:

```bash
python3 tools/card-generation/convert_to_zero_art.py \
  <input-card-image> \
  <output-card-image> \
  --mask <global-convert-mask.png> \
  --retain-color-mask <hud-and-frame-mask.png> \
  --retain-color-mask <icon-mask.png>
```

- White in `--retain-color-mask` = force original color (subtract from conversion region).
- This means you can keep all-white source masks and just call out the regions that must remain colored.

If either mask family is reversed, use `--invert-mask` or `--invert-retain-color-mask`.

## 3) Useful mask options

- `--mask-feather 1.25`: soften conversion edge transitions.
- `--retain-color-feather 1.0`: soften retained-color exclusions.
- `--save-mask-preview /tmp/final-mask.png`: save final conversion mask for debugging.

## 4) Tuning style controls

- `--contrast` (default `1.45`): higher = stronger dramatic lights/darks.
- `--sharpness` (default `1.35`): higher = more ink-like edge emphasis.
- `--blur-radius` (default `0.4`): light denoise/smoothing before sharpening.
- `--posterize-bits` (default `4`): lower values create chunkier comic-style shading.
- `--threshold` (optional): pure black/white style (no gray gradients).

## 5) Full-image conversion (legacy behavior)

If no `--mask` is provided, the script converts the entire image to monochrome. This is mainly for art-only source images.


## 6) Convenience glob usage

You can pass mask groups without repeating flags per file:

```bash
python3 tools/card-generation/convert_to_zero_art.py \
  <input-card-image> \
  <output-card-image> \
  --mask-glob "masks/convert/*.png" \
  --retain-color-mask-glob "masks/retain/*.png"
```

Globs are expanded by the script and merged the same as repeated `--mask` / `--retain-color-mask` flags.
