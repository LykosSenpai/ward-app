# Marketplace Rollout Status Audit

Audit date: 2026-05-14

This checklist validates implementation progress against `WARD_MARKETPLACE_ROLLOUT_PLAN.md` by checking the current codebase for corresponding files, symbols, and event handlers.

## Overall result

- **Implemented:** 1 / 9 rollout steps
- **Partially implemented:** 1 / 9 rollout steps
- **Not implemented:** 7 / 9 rollout steps

## Step-by-step status

1. **Shared marketplace domain types and contracts** — **Partially implemented**
   - ✅ Implemented shared marketplace domain types in `packages/shared/src/index.ts`.
   - ✅ Implemented `marketplaceCardKey(cardId, variant)` helper in `packages/shared/src/index.ts`.
   - ❌ Socket.IO payload contracts for marketplace request/response events are not present.
   - ❌ Quantity-safe helper utilities beyond `marketplaceCardKey` are not present.
   - ❌ `apps/client/src/clientTypes.ts` is not wired to consume additional shared marketplace contracts (no marketplace references found).

2. **Server persistence layer + validation** — **Not implemented**
   - ✅ Seed JSON files exist in `data/marketplace/`.
   - ❌ No marketplace datastore read/write accessors were found.
   - ❌ No marketplace-specific validation utilities were found.
   - ❌ No reservation/quantity aggregation helpers were found.

3. **Socket.IO handlers for Phase 1 (manual posts/settings)** — **Not implemented**
   - ❌ No `marketplace:*` Socket.IO handlers were found in server code.

4. **Client marketplace shell + manual post UX** — **Not implemented**
   - ❌ No marketplace page/components were found in `apps/client/src/components`.
   - ❌ No marketplace tab/route integration was found in `apps/client/src/App.tsx`.

5. **Matching engine (Phase 2)** — **Not implemented**
   - ❌ No marketplace matching computation or `marketplace:listMatches` handlers were found.

6. **Auto-listing generation (Phase 3/4)** — **Not implemented**
   - ❌ No derived auto-listing logic or override UI wiring was found.

7. **Completion-checker auto-needs (Phase 5)** — **Not implemented**
   - ❌ No completion-checker to marketplace need generation integration was found.

8. **Transaction lifecycle (Phase 6/7)** — **Not implemented**
   - ❌ No marketplace transaction handlers/state-machine implementation was found.

9. **Hardening and hosted-readiness prep (Phase 8 groundwork)** — **Not implemented**
   - ❌ No marketplace-specific input/rate-limit/ownership abstraction hardening paths were found.

## Commands used for verification

- `rg -n "marketplace" apps packages`
- `rg --files apps/client/src apps/server/src packages/shared/src data`
- `git log --oneline -n 8`

## Recommended next implementation slice

Implement step 2 (server datastore + validation) and step 3 (Phase 1 Socket.IO handlers) next, then expose a minimal client page for manual posts to make progress visible end-to-end.
