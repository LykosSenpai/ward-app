# New Card Intake & Release Pipeline Outline (Deferred)

## Status

Deferred for later. This document captures the future direction so current work can continue on the original image-source plan without context loss.

## Goal

Create a production-ready pipeline for introducing **completely new cards** into WARD with minimal manual steps:

1. Intake new card data/art.
2. Build effect chains from card descriptions.
3. Validate effect compatibility against engine capabilities.
4. Apply cards into source data.
5. Verify library, deck builder, and gameplay integration.
6. Perform QA gate and release.

## Proposed Workflow

### Phase 1 — Intake

- Import new card rows from structured input (CSV/XLSX/API).
- Capture required fields:
  - name
  - generation / edition / card number
  - type/subtype
  - stats
  - rules text
  - art URLs / asset references
- Write draft records to a staging directory (draft schema).

### Phase 2 — Effect Chain Generation

- Parse card rules text.
- Produce candidate effect chains in engine-compatible structure.
- Mark confidence and unresolved clauses.
- Flag unsupported mechanics for manual review.

### Phase 3 — Validation

- Validate generated effect chains against supported engine action/effect types.
- Validate required parameters and target contracts.
- Emit machine-readable validation report.

### Phase 4 — Apply to Source

- Convert approved drafts into `data/cards/src/gen*/` source JSON files.
- Add image metadata blocks.
- Preserve deterministic ordering and formatting.
- Generate apply summary report (created/updated/skipped cards).

### Phase 5 — Integration Verification

Automated checks to confirm each new card:

- appears in Card Library
- can be added in Deck Builder
- is available in gameplay flow
- executes core effects without runtime contract failures

### Phase 6 — QA Gate

- Manual QA checklist signoff for:
  - rules correctness
  - rendering/images
  - gameplay behavior
  - balance sanity pass
- Release readiness flag once all checks pass.

## Suggested Tooling (Future)

- `tools/card-intake/new-card-intake.mjs`
- `tools/card-intake/build-effect-chains.mjs`
- `tools/card-intake/validate-effect-chains.mjs`
- `tools/card-intake/apply-intake-to-source.mjs`
- `docs/card-intake/release-qa-checklist.md`

## Non-Goals for Current Sprint

To avoid side-tracking, this sprint should **not** implement the full intake pipeline above.

Current sprint focus remains:

- image source priority controls
- remote source integration (Excel/Wix, GitHub CDN, Railway fallback)
- import/migration workflow for existing card sets

## Resume Checklist (When Revisited)

1. Finalize intake JSON schema.
2. Decide single source-of-truth for new release batches.
3. Define effect-chain generation prompt/rules and fallback review flow.
4. Implement validator against engine-supported effect taxonomy.
5. Add release QA checklist and acceptance criteria.
