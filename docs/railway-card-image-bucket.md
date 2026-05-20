# Railway Card Image Bucket

The production server can redirect `/card-images/*` requests to a Railway/S3-compatible bucket. This keeps the app deploy small while letting the browser download card art directly from the bucket's signed URL.

## Railway Variables

Add these variables to the app/server service that runs Ward. For your current `WARD_IMAGES` group, the bucket services shown in Railway are `GEN1_E3`, `GEN2_E2`, `GEN3_E1`, and `PROMO`.

```env
CARD_IMAGE_BUCKET_ENABLED=true

CARD_IMAGE_GEN1_BUCKET_NAME=${{GEN1_E3.BUCKET}}
CARD_IMAGE_GEN1_ACCESS_KEY_ID=${{GEN1_E3.ACCESS_KEY_ID}}
CARD_IMAGE_GEN1_SECRET_ACCESS_KEY=${{GEN1_E3.SECRET_ACCESS_KEY}}
CARD_IMAGE_GEN1_ENDPOINT=${{GEN1_E3.ENDPOINT}}
CARD_IMAGE_GEN1_REGION=${{GEN1_E3.REGION}}

CARD_IMAGE_GEN2_BUCKET_NAME=${{GEN2_E2.BUCKET}}
CARD_IMAGE_GEN2_ACCESS_KEY_ID=${{GEN2_E2.ACCESS_KEY_ID}}
CARD_IMAGE_GEN2_SECRET_ACCESS_KEY=${{GEN2_E2.SECRET_ACCESS_KEY}}
CARD_IMAGE_GEN2_ENDPOINT=${{GEN2_E2.ENDPOINT}}
CARD_IMAGE_GEN2_REGION=${{GEN2_E2.REGION}}

CARD_IMAGE_GEN3_BUCKET_NAME=${{GEN3_E1.BUCKET}}
CARD_IMAGE_GEN3_ACCESS_KEY_ID=${{GEN3_E1.ACCESS_KEY_ID}}
CARD_IMAGE_GEN3_SECRET_ACCESS_KEY=${{GEN3_E1.SECRET_ACCESS_KEY}}
CARD_IMAGE_GEN3_ENDPOINT=${{GEN3_E1.ENDPOINT}}
CARD_IMAGE_GEN3_REGION=${{GEN3_E1.REGION}}

CARD_IMAGE_PROMO_BUCKET_NAME=${{PROMO.BUCKET}}
CARD_IMAGE_PROMO_ACCESS_KEY_ID=${{PROMO.ACCESS_KEY_ID}}
CARD_IMAGE_PROMO_SECRET_ACCESS_KEY=${{PROMO.SECRET_ACCESS_KEY}}
CARD_IMAGE_PROMO_ENDPOINT=${{PROMO.ENDPOINT}}
CARD_IMAGE_PROMO_REGION=${{PROMO.REGION}}

CARD_IMAGE_BUCKET_URL_STYLE=virtual-hosted
```

Use `CARD_IMAGE_BUCKET_URL_STYLE=path` only if the bucket credentials screen says the bucket uses path-style URLs.

## Bucket Layout

Upload each card group to the root of its matching bucket:

```text
GEN1_E3 bucket:
gen1_001_ward_stone.webp

GEN2_E2 bucket:
gen2_001_some_card.webp

GEN3_E1 bucket:
gen3_001_some_card.webp

PROMO bucket:
promo_019_scarlett.webp
```

The browser still uses app-relative paths:

```text
/card-images/gen1/gen1_001_ward_stone.webp -> GEN1_E3/gen1_001_ward_stone.webp
/card-images/gen2/gen2_001_some_card.webp -> GEN2_E2/gen2_001_some_card.webp
/card-images/gen3/gen3_001_some_card.webp -> GEN3_E1/gen3_001_some_card.webp
/card-images/promos/promo_019_scarlett.webp -> PROMO/promo_019_scarlett.webp
```

## Manifest

The app can work without a bucket-hosted manifest because it can infer the bucket from filenames like `gen1_...webp` and `promo_...webp`. If you do keep using a manifest, its file paths are relative to `/card-images`:

```json
{
  "version": 1,
  "files": [
    "gen1/gen1_001_ward_stone.webp",
    "promos/promo_019_scarlett.webp"
  ]
}
```

The client tries flat filenames and generation folders. Once the manifest is loaded, it will prefer whichever path actually exists in the manifest.
