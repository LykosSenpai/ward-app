# Zero Art Card Handoff

## Objective

Create WARD **Zero variant** cards from regular full-color target card PNGs. The final cards must preserve the original card layout, stats, attack structure, footer, icons, and framing while converting the main illustration/art mood into the monochrome Zero style.

This bundle intentionally contains only:

- mask/reference layers
- regular target card PNGs
- this handoff/manifest data

No extra IRL photos or broad reference sheets are required in the minimal bundle.

## Hard alignment rule

Use the **AL box outer stroke corners** as the root alignment feature.

Point order:

```txt
TL -> TR -> BR -> BL
```

Do not use the card border, art window, HP box, SPD box, attack strip, text baseline, or visual center as the alignment anchor. The AL box is the only stable stat box that does not change size across cards.

Recommended transform flow:

```txt
source target card AL quad
        ↓
perspective/affine transform
        ↓
canonical AL quad
        ↓
1462 x 2048 output canvas
        ↓
apply normalized mask layers
        ↓
rebuild Zero variant
```

The current primary target test card is:

```txt
targets_regular/target_regular__gen1_125_raptor.png
```

Approximate AL anchor for that card, based on visual inspection only:

```json
{
  "top_left": [759, 66],
  "top_right": [1064, 66],
  "bottom_right": [1064, 183],
  "bottom_left": [759, 183]
}
```

Before production, manually re-mark the exact outer stroke intersections of the AL box.

## Canvas and sizing

Final output target:

```txt
1462 x 2048 PNG
```

Important: the included mask files are visual/reference masks and were not all generated at this target size. Most masks are `1040 x 1512`; the Zero-logo mask is `1024 x 1536`; target regular cards are `1462 x 2048`.

Do not directly overlay masks by pixel location. Normalize by AL-box corners first.

## Included masks

| File | Purpose |
|---|---|
| `masks_original/00_footer_metadata_zones_mask.png` | Footer metadata strip zones, set-number box, illustrator/copyright areas. |
| `masks_original/01_full_frame_art_rules_structure_mask.png` | Full static frame, art-window/rules-panel boundary, distressed edge structure. |
| `masks_original/02_top_info_panels_mask.png` | Top name bar plus AL, HP, SPD panels. AL is the alignment source. |
| `masks_original/03_zero_logo_mask.png` | Zero logo placement zone. |
| `masks_original/04_rules_text_panel_mask.png` | Lower rules/effect text panel with rough/torn top edge. |
| `masks_original/05_main_art_window_frame_mask.png` | Main art window frame and static distressed inner geometry. |
| `masks_original/06_right_bonus_badge_mask.png` | Right-side bonus/modifier badge. |
| `masks_original/07_attack_strip_dice_zone_mask.png` | Attack strip, attack value, and die icon zone. |
| `masks_original/08_left_icon_cluster_zero_zone_mask.png` | Upper-left icon/faction/rarity/Zero-logo cluster. |

`template_reference/master_zero_template_reference_not_a_mask.png` is a visual template only. Do not treat it as a binary mask.

## Included regular target PNGs

| File | Role |
|---|---|
| `targets_regular/target_regular__gen1_125_raptor.png` | Primary test target. |
| `targets_regular/target_regular__gen1_001_blue_dragon.png` | Additional target. |
| `targets_regular/target_regular__gen1_002_dire_wolf.png` | Additional target. |

## Zero variant visual rules

Preserve unchanged:

- creature name text
- AL / HP / SPD values and box positions
- rarity/faction/generation icon placement
- attack name, attack number, die icon, and bonus badge structure
- footer/copyright/set-number/illustrator placement
- full frame geometry and card layout

Convert or restyle:

- Main illustration becomes grayscale/monochrome with strong contrast and atmospheric shading.
- The Zero logo appears under/near the title on the left side according to the mask/template position.
- The final result should feel like the IRL Zero cards: darker, monochrome art, same gameplay information, same layout.

Do not hallucinate new geometry. Do not move stats or resize boxes to fit newly generated art.

## Suggested production order

1. Load a regular target PNG.
2. Mark the four AL box outer stroke corners in `TL, TR, BR, BL` order.
3. Warp/normalize the target to the canonical `1462 x 2048` canvas using the AL quad.
4. Normalize each mask layer by the same AL anchor rule.
5. Use the main art window mask to isolate the illustration.
6. Convert only the illustration region to grayscale Zero art style.
7. Preserve/rebuild frame, stat boxes, attack strip, bonus badge, dice, icons, and footer over the monochrome art.
8. Add/place the Zero logo using the Zero/logo mask zone.
9. Export as `PNG`, same canvas size.
10. QA by checking the AL box corners, SPD box, HP box, attack strip, and footer all land exactly over the original target card.

## Mask handling notes

The mask images use white feature shapes on black, with gray dashed guide lines and crosshair marks. If converting masks to binary alpha:

```txt
feature alpha = bright white mask geometry
ignore        = gray dashed registration guides
```

If keeping registration guides inside final masks, store them as nearly invisible pixels, for example alpha `1`, and threshold final usable mask alpha at `>=128`.

## Failure modes to avoid

- Do not align by outer card border.
- Do not align by HP or SPD boxes.
- Do not directly resize all masks to target canvas and assume they match.
- Do not let AI regenerate text, stats, dice, or footer details.
- Do not crop the card by the photo/PNG edge; use AL-box alignment first.

## Immediate next-chat instruction

Use `NEXT_CHAT_PROMPT.txt` as the exact prompt when handing this bundle to another chat.
