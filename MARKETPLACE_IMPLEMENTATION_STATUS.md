# Newest Markdown Implementation Audit

Audit date: 2026-05-14

This audit checks the newest project Markdown files against the current repository:

- `WARD_MARKETPLACE_ROLLOUT_PLAN.md`
- `WARD_CARD_LIBRARY_COLLECTION_CHANGES_PLAN.md`
- `docs/plans/admin-controls-plan.md`
- `docs/ward-engine-board-effects-codex-plan.md`

## Overall Result

- The Markdown files were created and committed.
- The board-effects plan is mostly reflected by the merged board feature stack.
- The admin-controls plan is partially implemented.
- The card-library collection plan is partially implemented.
- The marketplace rollout plan is only partially followed: the repo has marketplace pieces, but several use older/local shapes that do not match the newer shared marketplace contract.

## Marketplace Rollout Plan Status

1. Shared marketplace domain types and contracts - Partially implemented
   - Implemented shared marketplace types in `packages/shared/src/index.ts`.
   - Implemented `marketplaceCardKey`, `clampNonNegative`, and `quantitySafeMin`.
   - Added request/response/event payload type aliases for marketplace operations.
   - Divergence: client marketplace components still use local string-list post shapes from `apps/client/src/components/MarketplacePostCard.tsx` instead of the shared `MarketplacePost` and `MarketplacePostItem` model.
   - Divergence: `apps/server/src/dataStore.ts` still has older marketplace variants/statuses (`STANDARD`, `FOIL`, `ALT_ART`, `OPEN`, `RESERVED`, `COMPLETED`, `CANCELLED`) that do not match the shared plan (`DEFAULT`, `HOLO`, `ZERO`, `ZERO_HOLO`, `ACTIVE`, `PAUSED`, `CLOSED`).

2. Server persistence layer and validation - Partially implemented
   - Added `data/marketplace/posts.json`, `settings.json`, and `transactions.json`.
   - Added marketplace load/save helpers and validation helpers in `apps/server/src/dataStore.ts`.
   - Divergence: live marketplace post/transaction flow in `apps/server/src/index.ts` uses in-memory Maps, so created posts and transactions are not persisted through those JSON helpers.
   - Divergence: newer auto-need/settings helpers exist under `apps/server/src/collection/`, but the manual marketplace post flow has not been unified with them.

3. Socket.IO handlers for manual posts/settings - Partially implemented
   - Implemented `marketplace:listPosts` and `marketplace:createPost`.
   - Implemented transaction handlers for create/confirm/deny/cancel/list/return expired.
   - Implemented auto-need handlers such as `marketplace:listNeeds`, `marketplace:createAutoNeedRule`, and `marketplace:disableAutoNeedRule`.
   - Missing: `marketplace:getSettings`, `marketplace:updateSettings`, `marketplace:updatePost`, `marketplace:deletePost`, `marketplace:listMatches`, and `marketplace:listMyMatches` are not implemented as planned.

4. Client marketplace shell and manual post UX - Partially implemented
   - Added Marketplace page/editor/card components.
   - Added Marketplace navigation gated by the `marketplace` feature flag.
   - Includes the required external-payments/trade disclaimer copy.
   - Divergence: manual posts are entered as free-text Have/Need lists, not structured card ID + variant + quantity items.

5. Matching engine - Partially implemented
   - Added matching helpers in `apps/server/src/index.ts`.
   - Added `MarketplaceMatchesPanel.tsx`.
   - Missing: server socket handlers that expose planned match lists to the client are not wired.

6. Auto-listing generation - Partially implemented
   - Added marketplace settings/override store helpers under `apps/server/src/collection/marketplaceSettingsStore.ts`.
   - Added an override affordance entry point in the card library UI.
   - Missing: user-facing global retain settings panel and generated auto-have pool are not complete.

7. Completion-checker auto-needs - Partially implemented
   - Added card-library completion UI, missing-focus filtering, and marketplace need/have buttons.
   - Added server-side auto-need rule and missing-needs helpers.
   - Divergence: client callbacks in `apps/client/src/App.tsx` currently map "Add Missing Once" and "Create Perpetual Need Rule" through differently named socket events than the plan text, and the "have" callback is wired to an auto-need rule event.

8. Transaction lifecycle - Partially implemented
   - Added in-memory transaction state and client transaction panel.
   - Added confirm, deny, cancel, list, expiration, and return-to-pool paths.
   - Divergence: status spelling uses `CANCELED` in server runtime types while shared contracts use `CANCELLED`.
   - Divergence: transaction persistence is not wired to `data/marketplace/transactions.json`.

9. Hardening and hosted-readiness prep - Partially implemented
   - Added some marketplace guards and ownership helpers.
   - Added feature flags to keep marketplace hidden from players by default.
   - Missing: full ownership enforcement, moderation, rate limits, and production auth hardening.

## Card Library + Collection Completion Plan Status

- Implemented generation completion controls, variant checkboxes, missing summaries, remaining-needed focus, and clear focus in `CardLibraryPanel.tsx`.
- Implemented ownership count support for the four planned variants.
- Implemented `collection:getOwnership`, `collection:updateOwnership`, and `collection:bulkUpdateOwnership` handlers.
- Added `apps/client/src/collectionCompletionHelpers.ts`.
- Divergence: client/server storage keys use existing art-key values such as `default`, `holo`, `zero-art`, and `zero-art-holo`, while the plan examples use uppercase `DEFAULT`, `HOLO`, `ZERO`, and `ZERO_HOLO`.
- Divergence: `data/collection/card-ownership.json` remains the local storage file, but there are also database-backed user ownership helpers; the docs should keep calling this local-first behavior out.

## Admin Controls Plan Status

- Implemented `apps/server/src/admin/adminFeatureFlags.ts`.
- Added `data/admin/feature-flags.json`.
- Implemented `features:list`, `admin:features:list`, `admin:features:update`, and `features:visibilityChanged`.
- Implemented `apps/client/src/components/AdminControlsPage.tsx`.
- Added feature flag state and marketplace/admin navigation gating in `App.tsx`.
- Divergence: the first UI pass keeps rollout rows inside `AdminControlsPage.tsx`; the planned separate `components/admin/AdminFeatureRolloutPanel.tsx` was not added.
- Divergence: server guards exist for feature flag management, but not every disabled feature action is guarded yet.
- Divergence: server admin helper treats only `ADMIN` as admin; the plan mentions `OWNER`, but `AuthUser.role` currently does not include `OWNER`.

## Board Effects Plan Status

- Implemented shared board contracts in `packages/shared/src/boardContracts.ts` and exported them from `packages/shared/src/index.ts`.
- Implemented board affordance, event taxonomy, animation planner, effect-family event plumbing, QA status fields, and a thin-board-preview extraction pass across the merged board branches.
- Verified by `corepack.cmd pnpm check`, including board render adapter and 3D board smoke checks.
- Updated `docs/ward-engine-board-effects-codex-plan.md` with a merged-status section so phases A-G are not mistaken for unstarted work.

## Recommended Cleanup Order

1. Align marketplace runtime/client shapes with the shared marketplace contracts.
2. Wire manual marketplace posts and transactions to persistent storage instead of in-memory Maps.
3. Add or rename missing socket events to match `WARD_MARKETPLACE_ROLLOUT_PLAN.md`.
4. Fix the `CANCELED`/`CANCELLED` spelling mismatch.
5. Correct the Card Library marketplace callbacks so "Have" and "Need" actions hit matching server events.
6. Add server feature guards for disabled marketplace/lobby/play actions.
7. Keep `docs/ward-engine-board-effects-codex-plan.md` current as future board QA and cleanup work lands.

## Verification Commands

These commands were used during the audit:

```powershell
git status --short --branch
Get-ChildItem -Path . -Recurse -Filter *.md | Sort-Object LastWriteTime -Descending | Select-Object -First 25 FullName,LastWriteTime
git log --name-status --oneline -n 12 -- *.md
rg -n "marketplace:|features:|admin:features|FeatureKey|ServerFeatureFlag|Marketplace|marketplace" apps/client/src apps/server/src packages/shared/src data/admin data/marketplace
rg -n "collection:getOwnership|collection:updateOwnership|CardOwnership|ownershipCounts|Add Missing|Remaining|completion|marketplace:add" apps/client/src apps/server/src packages/shared/src data/collection
corepack.cmd pnpm check
```
