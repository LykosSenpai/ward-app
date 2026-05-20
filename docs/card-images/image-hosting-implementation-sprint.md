# Card Image Hosting & Management — Implementation Sprint

Last updated: 2026-05-20

## Phase 1 (now): data import + validation + reporting
1. Run `tools/card-images/import-excel-image-links.mjs` to inject `image` metadata into `data/cards/src/gen{1,2,3}` cards.
2. Resolve unmatched rows from `docs/card-images/image-link-unmatched-triage.md` with overrides/skip lists.
3. Run `tools/card-images/validate-image-candidates.mjs` to verify image/texture/canvas-safe status and generate report JSON.
4. Commit report artifact at `data/card-images/image-validation.json`.

## Phase 2: resolver behavior (preview vs board)
1. Keep HTML preview resolver remote-first.
2. Keep board/WebGL resolver strict: only `textureValidated && canvasValidated` for remote/bucket before local fallback.
3. Add explicit fallback to placeholder texture when all candidates fail.

## Phase 3: signed Railway delivery
1. Use server signing endpoint for bucket object keys.
2. Add short-lived URL caching client-side keyed by object key.
3. Avoid app-server image byte proxy for normal card traffic.

## Phase 4: rollout controls + QA
1. Gate remote-first behavior behind image source controls/feature flags.
2. Add smoke checks for:
   - library image preview loading
   - match card images loading
   - board WebGL texture load with safe-fallback behavior
3. Track unresolved cards and validation deltas each run.

## Working command order
1. `node tools/card-images/import-excel-image-links.mjs --dry-run`
2. `node tools/card-images/import-excel-image-links.mjs`
3. `node tools/card-images/validate-image-candidates.mjs`
4. `pnpm cards:build`
5. `pnpm cards:check`
