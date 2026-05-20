# WARD Card Image Source Plan — WebGL/Canvas + Railway Buckets

## Purpose

Use high-resolution remote card images as the primary source where safe, while keeping Railway Bucket/server-owned images as backup or WebGL-safe primary fallback. The goal is to reduce app-server image egress without breaking the 3D board.

## Key Finding

The current WARD app **does use WebGL and canvas** for the 3D board.

Evidence from the latest project package inspected:

```text
apps/client/package.json
- Dependency: three
- Scripts include board 3D smoke/integration checks.

apps/client/src/components/boardPreview3d/BoardPreview3DWebGLCards.tsx
- Imports three.
- Creates THREE.WebGLRenderer using a canvas element.
- Uses THREE.TextureLoader to load card image URLs.
- Creates THREE.CanvasTexture for generated card backs.
- Draws card source images onto a 2D canvas for holographic/compact card textures.

apps/client/src/components/boardPreview3d/BoardPreview3DDiceLayer.tsx
- Imports three.
- Creates THREE.WebGLRenderer using a canvas element.
- Creates dice face textures from 2D canvas.

apps/client/src/components/boardPreview3d/BoardPreview3DTable.tsx
- Renders BoardPreview3DWebGLCards.
- Renders BoardPreview3DDiceLayer.
- Includes AttackStreamCanvas, a 2D canvas animation layer.

apps/client/src/components/MatchCardImage.tsx
- Current match/board image candidates are local-only /card-images/... paths.

apps/client/src/components/CardImagePreview.tsx
- Current library preview image candidates are local-only /card-images/... paths.

apps/client/src/cardImageManifest.ts
- Current manifest filtering expects local file names and does not support remote/bucket candidates yet.
```

## Important Consequence

A plain HTML image preview can usually display a cross-origin image without CORS, but the 3D board is different.

The WebGL/canvas card path needs remote image responses to be safe for:

```text
1. HTML image loading.
2. THREE.TextureLoader / WebGL texture upload.
3. Drawing the source image onto a canvas for holo/compact texture processing.
```

So the app should not blindly use a Wix high-resolution URL for the 3D board just because it works in an `<img>`. The board resolver must only use a remote candidate if it is validated as texture/canvas safe.

## Railway Bucket Reality

Railway Buckets are private S3-compatible object storage. Public buckets are not currently supported. Public/browser access should use either presigned URLs or a backend proxy.

For this project, **presigned GET URLs are the right default**:

```text
Browser -> presigned Railway Bucket URL -> image bytes come from bucket
```

Avoid this for normal card image traffic:

```text
Browser -> app server proxy -> Railway Bucket -> app server -> browser
```

The proxy path makes the app service resend image bytes and defeats the egress goal.

## Recommended Image Priority

Use separate priority rules for normal HTML preview versus WebGL/canvas board.

### HTML card preview priority

```text
1. Valid high-resolution Wix/Excel URL
2. Original Excel URL
3. Railway Bucket signed GET URL
4. Local /card-images fallback
5. Placeholder/card back
```

### WebGL/canvas 3D board priority

```text
1. Valid high-resolution Wix/Excel URL only if textureSafe && canvasSafe
2. Railway Bucket signed GET URL if textureSafe && canvasSafe
3. Local /card-images fallback
4. Placeholder/card back texture
```

Do not use a candidate in `BoardPreview3DWebGLCards` unless it is known texture/canvas safe or the loader can safely fall through to the next candidate.

## Data Model

Add image metadata to shared card definitions. Store original source URLs, generated high-res candidates, Railway object keys, and validation state.

Recommended shared type addition in:

```text
packages/shared/src/index.ts
```

```ts
export type CardImageSourceKind = "WIX" | "RAILWAY_BUCKET" | "LOCAL_PUBLIC" | "PLACEHOLDER";

export type CardImageCandidateKind = "remote" | "bucket" | "local" | "placeholder";

export type CardImageCandidate = {
  kind: CardImageCandidateKind;
  source: CardImageSourceKind;
  url?: string;
  objectKey?: string;
  fileName?: string;
  width?: number;
  height?: number;
  contentType?: string;
  corsRequired?: boolean;
  imageValidated?: boolean;
  textureValidated?: boolean;
  canvasValidated?: boolean;
  expiresAt?: string;
  cacheKey?: string;
};

export type CardImageSet = {
  provider?: "excel-wix" | "railway-bucket" | "local";
  originalUrl?: string;
  remotePrimaryUrl?: string;
  remoteCandidates?: CardImageCandidate[];
  bucketObjectKey?: string;
  bucketCandidates?: CardImageCandidate[];
  localBackupUrl?: string;
  localCandidates?: CardImageCandidate[];
  validation?: {
    remoteImageOk?: boolean;
    remoteTextureOk?: boolean;
    remoteCanvasOk?: boolean;
    bucketImageOk?: boolean;
    bucketTextureOk?: boolean;
    bucketCanvasOk?: boolean;
    checkedAt?: string;
    notes?: string[];
  };
};
```

Then add this optional field to both creature and magic card definitions:

```ts
image?: CardImageSet;
```

## Card Source Rule

Patch source card JSON files, not generated pack files.

```text
data/cards/src/gen1/*.json
data/cards/src/gen2/*.json
data/cards/src/gen3/*.json
```

Then rebuild:

```powershell
pnpm.cmd cards:build
pnpm.cmd cards:check
```

The current build tool spreads card source objects into generated packs, so optional `image` metadata should carry through once the shared type permits it.

## Excel/Wix Import Plan

Create:

```text
tools/card-images/import-excel-image-links.mjs
```

Responsibilities:

```text
1. Read ward gen3 pics + links.xlsx.
2. Iterate sheets:
   - legacy
   - g1e1
   - g1e2
   - gen1e3
   - g2e1
   - gen2e2
   - gen3e1
   - promo
3. Normalize card names.
4. Match each Excel row to a source card file.
5. Store original URL.
6. Generate ratio-preserving high-resolution candidates.
7. Write image metadata into the matching source card JSON.
8. Produce import report.
```

Recommended output report:

```text
docs/card-images/image-link-import-report.csv
```

Wix URL upgrade helper:

```ts
function upgradeWixImageUrl(url: string, targetWidth: number): string {
  const match = url.match(/w_(\d+),h_(\d+)/);
  if (!match) return url;

  const originalWidth = Number(match[1]);
  const originalHeight = Number(match[2]);
  if (!Number.isFinite(originalWidth) || !Number.isFinite(originalHeight) || originalWidth <= 0) {
    return url;
  }

  const targetHeight = Math.round(targetWidth * (originalHeight / originalWidth));
  return url.replace(/w_\d+,h_\d+/, `w_${targetWidth},h_${targetHeight}`);
}
```

Candidate widths:

```ts
const CARD_IMAGE_WIDTHS = [480, 720, 960, 1440];
```

## Railway Bucket Storage Plan

Use object keys, not permanent public URLs, in card data.

Example object keys:

```text
cards/gen1/001-blue-dragon.webp
cards/gen1/001-blue-dragon@960.webp
cards/gen2/001-card-name.webp
cards/gen3/001-card-name.webp
```

Recommended source JSON image block:

```json
{
  "image": {
    "provider": "excel-wix",
    "originalUrl": "https://static.wixstatic.com/media/.../v1/fit/w_480,h_855,q_90,...",
    "remotePrimaryUrl": "https://static.wixstatic.com/media/.../v1/fit/w_960,h_1710,q_90,...",
    "remoteCandidates": [
      {
        "kind": "remote",
        "source": "WIX",
        "url": "https://static.wixstatic.com/media/.../v1/fit/w_960,h_1710,q_90,...",
        "width": 960,
        "height": 1710,
        "corsRequired": true,
        "imageValidated": true,
        "textureValidated": false,
        "canvasValidated": false,
        "cacheKey": "gen3_001_remote_960"
      }
    ],
    "bucketObjectKey": "cards/gen3/001-adam-bomb.webp",
    "localBackupUrl": "/card-images/gen3_001_adam_bomb.webp",
    "validation": {
      "checkedAt": null,
      "notes": []
    }
  }
}
```

## Server Signing Plan

Add a server route/socket that signs Railway Bucket GET URLs without proxying image bytes.

Possible route:

```text
GET /api/card-images/signed?cardId=gen3_001_adam_bomb&width=960
```

Possible batch route:

```text
GET /api/card-images/manifest/signed?packIds=ward-gen1,ward-gen2,ward-gen3
```

Recommended server files:

```text
apps/server/src/cardImageSigning.ts
apps/server/src/index.ts
```

Signing behavior:

```text
1. Look up cardId in loaded card catalog.
2. Read image.bucketObjectKey.
3. Generate a presigned GET URL through S3-compatible client.
4. Return URL, expiresAt, width, height, contentType, cacheKey.
```

Use TTL long enough for a normal match:

```text
6 to 24 hours
```

Client should refresh signed URLs when expired or near expiry.

## Railway Bucket CORS

For browser-loaded textures, the bucket response must allow CORS.

Recommended CORS shape:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "http://localhost:5173",
        "https://YOUR_PRODUCTION_APP_DOMAIN"
      ],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Type"],
      "MaxAgeSeconds": 86400
    }
  ]
}
```

Only add upload methods such as PUT/POST for dedicated upload flows. Do not over-open the bucket for normal gameplay reads.

## Client Resolver Plan

Create shared resolver:

```text
apps/client/src/cardImages/cardImageResolver.ts
```

Export:

```ts
export type CardImageRenderContext = "html-preview" | "webgl-board";

export function getCardImageCandidatesForContext(
  card: CardDefinitionWithClientFields,
  context: CardImageRenderContext,
  options?: {
    signedBucketUrls?: Map<string, CardImageCandidate>;
    localManifest?: CardImageManifest;
  }
): CardImageCandidate[];
```

Rules:

```text
html-preview:
  keep remote candidates first if imageValidated !== false
  then bucket signed URLs
  then local fallback
  then placeholder

webgl-board:
  keep remote candidates only if textureValidated && canvasValidated
  then bucket candidates only if textureValidated && canvasValidated
  then local fallback
  then placeholder
```

## Update Local Manifest Filtering

Current file:

```text
apps/client/src/cardImageManifest.ts
```

Current logic is local-file-only. Update it so remote/bucket candidates are never removed by the local manifest.

Recommended behavior:

```ts
export function filterCardImageCandidates(
  candidates: CardImageCandidate[],
  manifest: CardImageManifest
): CardImageCandidate[] {
  const remoteOrBucket = candidates.filter(candidate => candidate.kind !== "local");
  const local = candidates.filter(candidate => candidate.kind === "local");

  if (manifest === undefined) {
    return [...remoteOrBucket, ...local.slice(0, 1)];
  }

  if (manifest === null) {
    return [...remoteOrBucket, ...local];
  }

  const knownLocal = local.filter(candidate =>
    candidate.fileName ? manifest.has(candidate.fileName) : false
  );

  return [...remoteOrBucket, ...(knownLocal.length > 0 ? knownLocal : local.slice(0, 1))];
}
```

## Update MatchCardImage and CardImagePreview

Current files:

```text
apps/client/src/components/MatchCardImage.tsx
apps/client/src/components/CardImagePreview.tsx
```

Replace local-only candidate generation with the shared resolver.

For HTML preview components, use:

```ts
getCardImageCandidatesForContext(card, "html-preview", ...)
```

For 3D board code, use:

```ts
getCardImageCandidatesForContext(card, "webgl-board", ...)
```

## WebGL Loader Hardening

Current file:

```text
apps/client/src/components/boardPreview3d/BoardPreview3DWebGLCards.tsx
```

Required changes:

```text
1. Use webgl-board image candidates, not HTML preview candidates.
2. Set TextureLoader cross-origin behavior explicitly.
3. Catch texture load failures and try the next candidate.
4. Do not run canvas post-processing on candidates not marked canvasValidated/canvasSafe.
5. Wrap canvas drawImage/post-processing in try/catch.
6. If holo/compact texture generation fails, use the base texture rather than crashing.
7. Use a stable cacheKey for signed URLs so expiring query strings do not create endless cache entries.
8. Prune expired signed URL texture cache entries.
```

Example hardening:

```ts
const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");
```

```ts
async function loadFirstSafeTexture(
  loader: THREE.TextureLoader,
  candidates: CardImageCandidate[]
): Promise<THREE.Texture> {
  for (const candidate of candidates) {
    if (!candidate.url) continue;

    try {
      const texture = await loader.loadAsync(candidate.url);
      configureTexture(texture, renderer);
      return texture;
    } catch (error) {
      console.warn("Failed to load card texture candidate", candidate.cacheKey ?? candidate.url, error);
    }
  }

  return createCardBackTexture();
}
```

Canvas processing guard:

```ts
function tryCreateHoloTexture(baseTexture: THREE.Texture, candidate: CardImageCandidate): THREE.Texture {
  if (!candidate.canvasValidated) return baseTexture;

  try {
    return createHolographicCardTexture(baseTexture);
  } catch (error) {
    console.warn("Holo canvas texture generation failed; using base texture", error);
    return baseTexture;
  }
}
```

## Validation Plan

Create:

```text
tools/card-images/validate-image-candidates.mjs
```

Two-stage validation:

### Stage 1 — Node validation

```text
1. Fetch candidate URL.
2. Check HTTP 200.
3. Check content-type starts with image/.
4. Record dimensions if possible.
5. Check visible CORS headers.
```

This is useful but not enough.

### Stage 2 — Browser/WebGL validation

Use Playwright or a small Vite validation page because only a browser can reliably test canvas taint and WebGL texture upload.

For each candidate:

```text
1. Create Image with crossOrigin = "anonymous".
2. Load candidate URL.
3. Draw to a canvas.
4. Try canvas.getImageData(0, 0, 1, 1) or canvas.toDataURL().
5. Try THREE.TextureLoader load.
6. Try uploading/rendering a minimal WebGL texture.
7. Save imageOk, canvasOk, textureOk.
```

Persist result to:

```text
data/card-images/image-validation.json
```

or patch each source card JSON `image.validation` block.

## No-Proxy Egress Rule

Do not make this the default:

```text
/api/card-image?url=https://...
```

That path makes the app server resend image bytes. Use it only as an emergency fallback for private/admin views or rare CORS failures.

## Implementation Phases

### Phase 1 — Data and resolver foundation

```text
1. Add image types to packages/shared/src/index.ts.
2. Add tools/card-images/import-excel-image-links.mjs.
3. Import Excel links into source card JSON.
4. Run pnpm.cmd cards:build and pnpm.cmd cards:check.
5. Add apps/client/src/cardImages/cardImageResolver.ts.
6. Update apps/client/src/cardImageManifest.ts.
7. Update MatchCardImage and CardImagePreview to support remote/bucket/local candidates.
```

### Phase 2 — Railway Bucket fallback

```text
1. Upload fallback images to Railway Bucket using S3-compatible credentials.
2. Add bucketObjectKey to card image metadata.
3. Add apps/server/src/cardImageSigning.ts.
4. Add signed GET route or socket.
5. Add client signed URL cache with expiry refresh.
```

### Phase 3 — WebGL safety

```text
1. Update BoardPreview3DWebGLCards to use webgl-board resolver.
2. Add explicit crossOrigin = anonymous to TextureLoader.
3. Add failover across candidates.
4. Add canvas post-processing guards.
5. Add stable cache keys for presigned URLs.
6. Add texture cache pruning.
```

### Phase 4 — Validation and reporting

```text
1. Add validate-image-candidates script.
2. Run browser/WebGL validation against Wix candidates.
3. Run browser/WebGL validation against Railway signed GET candidates.
4. Mark candidates with imageValidated / textureValidated / canvasValidated.
5. Confirm 3D board works from remote/bucket sources.
```

## Smoke Tests

Run after implementation:

```powershell
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd cards:build
pnpm.cmd cards:check
pnpm.cmd --filter @ward/client build:card-image-manifest
pnpm.cmd --filter @ward/client check:board-preview-integration
pnpm.cmd --filter @ward/client check:board-3d-gameplay-smoke
pnpm.cmd check
```

Manual smoke test:

```text
1. Start server and client.
2. Open the card library.
3. Confirm HTML previews use remote high-res URL when available.
4. Create or load a match.
5. Open 3D board.
6. Confirm card textures render.
7. Temporarily break a remote URL and confirm fallback to Railway/local.
8. Temporarily fail Railway signed URL and confirm fallback to local/card back.
9. Confirm no app-server image proxy traffic for normal image loads.
10. Confirm no WebGL/canvas security errors in browser console.
```

Restart commands:

```powershell
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd --filter @ward/server dev
```

Second PowerShell:

```powershell
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd --filter @ward/client dev
```

Hard refresh browser:

```text
Ctrl + F5
```

## LLM Handoff Prompt

Use this prompt in the next implementation chat:

```text
Use this WARD Card Image Source Plan as the source of truth. My current WARD app already uses WebGL/canvas for the 3D board through BoardPreview3DWebGLCards, BoardPreview3DDiceLayer, and AttackStreamCanvas. Implement remote-first card images while preserving WebGL/canvas safety.

Goals:
1. Use validated high-resolution Wix/Excel image URLs as primary for HTML previews.
2. Use Wix/Excel remote URLs for the WebGL board only if texture/canvas validation passes.
3. Use Railway Bucket images as server-owned fallback, preferably through presigned GET URLs so image bytes do not pass through the app server.
4. Keep local /card-images as dev/offline fallback.
5. Do not proxy normal image traffic through the app server.
6. Patch source card JSON files under data/cards/src/gen*/ and rebuild packs with pnpm.cmd cards:build.

Start by inspecting:
- packages/shared/src/index.ts
- tools/card-generation/build-card-packs.mjs
- apps/client/src/components/MatchCardImage.tsx
- apps/client/src/components/CardImagePreview.tsx
- apps/client/src/cardImageManifest.ts
- apps/client/src/components/boardPreview3d/BoardPreview3DWebGLCards.tsx
- apps/client/src/components/boardPreview3d/BoardPreview3DDiceLayer.tsx
- apps/client/src/components/boardPreview3d/BoardPreview3DTable.tsx
- apps/server/src/index.ts
- apps/server/src/dataStore.ts
- apps/client/package.json

Implementation order:
1. Add shared image metadata types and optional image field on card definitions.
2. Add tools/card-images/import-excel-image-links.mjs to import the Excel Wix links into source card JSON and generate high-res candidates.
3. Add apps/client/src/cardImages/cardImageResolver.ts with separate html-preview and webgl-board priority rules.
4. Update cardImageManifest filtering so remote/bucket candidates are preserved and only local files are manifest-filtered.
5. Update MatchCardImage and CardImagePreview to use the resolver.
6. Add Railway Bucket object keys and server-side presigned GET URL support.
7. Harden BoardPreview3DWebGLCards with crossOrigin anonymous, candidate failover, canvas processing guards, and stable cache keys.
8. Add browser/WebGL validation tooling to mark candidates imageValidated, textureValidated, and canvasValidated.

Run:
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd cards:build
pnpm.cmd cards:check
pnpm.cmd --filter @ward/client build:card-image-manifest
pnpm.cmd --filter @ward/client check:board-preview-integration
pnpm.cmd --filter @ward/client check:board-3d-gameplay-smoke
pnpm.cmd check
```
