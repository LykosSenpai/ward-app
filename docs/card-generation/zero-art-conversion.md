# Zero Art Conversion Workflow

Use this to convert standard card art into the monochrome "Zero" style like the Raptor sample.

## 1) Run converter

```bash
python3 tools/card-generation/convert_to_zero_art.py \
  <input-image> \
  <output-image>
```

Example (Gen1 Raptor):

```bash
python3 tools/card-generation/convert_to_zero_art.py \
  apps/client/public/card-images/gen1_125_raptor.png \
  apps/client/public/card-images/zero/gen1_125_raptor_zero.png
```

## 2) Tune style controls

- `--contrast` (default `1.45`): higher = more dramatic lights/darks.
- `--sharpness` (default `1.35`): higher = more ink-like edges.
- `--blur-radius` (default `0.4`): small smoothing to reduce noise.
- `--posterize-bits` (default `4`): lower values create chunkier comic shading.
- `--threshold` (optional): hard black/white look, no gray tones.

Example high-ink pass:

```bash
python3 tools/card-generation/convert_to_zero_art.py \
  apps/client/public/card-images/gen1_125_raptor.png \
  apps/client/public/card-images/zero/gen1_125_raptor_zero_inked.png \
  --contrast 1.6 \
  --sharpness 1.6 \
  --posterize-bits 3 \
  --threshold 132
```

## 3) Optional card framing step

This converter targets the art panel itself. If you want full-card framed output, run the generated art through your existing card frame compositor/template workflow afterward.
