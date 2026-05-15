# WARD Marketplace Progress Tracker

Last updated: 2026-05-14

## Scope Baseline
Single-game marketplace for **WARD** with card-pack-aware catalog (`ward-gen1`, `ward-gen2`, `ward-gen3`), listings, wants, matches, trade offers, messaging, and disabled checkout/shipping in current release.

---

## ✅ Completed (Backend)

### Foundation / Guards
- [x] Added marketplace feature flags with disabled commerce defaults.
- [x] Added listing domain constants and validation guards.
- [x] Added single-game catalog guard (`WARD` only).
- [x] Added basic text sanitization helper and wired it into user-text input paths.

### API Scaffolding
- [x] Listings API (list/get/create/update/delete).
- [x] Wants API (list/create/update/delete).
- [x] Matches API (list/summary/update status).
- [x] Trade Offers API (list/create/get/update + accept/reject/counter/cancel/complete-manually actions).
- [x] Messaging API (threads list/create, thread get, send message).
- [x] Marketplace catalog endpoint (`GET /api/marketplace/catalog`) aligned to WARD card packs.

### Disabled Commerce (Current Release Constraint)
- [x] Checkout status endpoint returns disabled state by default.
- [x] Checkout session creation endpoint guarded/disabled.
- [x] Shipping status endpoint returns disabled state by default.
- [x] Shipping rates/labels endpoints guarded/disabled.

### Safety / Abuse Controls
- [x] Added route-level rate limits for trade-offer and messaging API roots.
- [x] Added participant-role restrictions for offer status transitions:
  - recipient: accept/reject/counter
  - creator: cancel

### Tests
- [x] Added marketplace guard tests (feature/status/sanitize/single-game guard coverage).

---

## 🟨 In Progress / Next Backend Priorities

### 1) Persistence Migration (critical)
- [~] Replace in-memory stores with DB repositories for:
  - listings
  - wants
  - match statuses
  - trade offers
  - message threads/messages
- [x] Add initial SQL migration for marketplace core tables (`0008_marketplace_core.sql`).
- [~] Add repository layer boundaries under `apps/server/src/marketplace/`.
  - [x] Added initial DB-backed wants repository scaffold (`repositories/wantsRepository.ts`).
  - [x] Wired wants API store callbacks from in-memory map to DB repository methods.
  - [~] Add listings/offers/messages/match-status repositories and complete DB wiring.
    - [x] Added listings repository scaffold and wired listings API to DB repository methods.
    - [~] Add offers/messages/match-status repositories and DB wiring.
      - [x] Added trade offers repository and wired trade offers API to DB repository methods.
      - [x] Added messages repository and wired messaging API to DB repository methods.
      - [x] Added match-status repository and wired match status persistence to DB repository methods.

### 2) Contract Hardening
- [~] Add schema validation (zod) for request/query/response DTOs across marketplace routes.
  - [x] Added initial zod body schemas for listings + wants create/update payloads.
  - [x] Extended zod body schemas to trade offers/messages/matches routes.
  - [x] Added initial query-param schemas for listings and matches routes.
  - [~] Add standard response DTO schemas/error envelope consistency across all marketplace routes.
    - [x] Introduced shared API envelope helpers (`ok` / `fail`) and applied to listings + wants routes.
    - [~] Apply shared response envelope across offers/messages/matches/commerce-disabled routes.
      - [x] Applied shared response envelope to offers/messages/matches routes.
      - [x] Apply shared response envelope to commerce-disabled routes.
    - [~] Add response DTO schemas and runtime response-shape checks.
      - [x] Added initial response schemas and runtime checks for listings/wants success envelopes.
      - [x] Extended response DTO checks to offers/messages/matches success payloads.
      - [x] Extend response DTO checks to commerce-disabled success payloads and normalize message-thread detail DTO shape.
- [~] Standardize error shape and error codes for all marketplace endpoints.
  - [x] Applied `ok`/`fail` envelope and code-based errors across marketplace route modules.
  - [x] Applied `ok`/`fail` envelope and query validation errors to marketplace catalog/cards endpoints.
  - [ ] Add optional machine-readable per-endpoint error subcodes and docs table.
- [x] Add pagination contracts to list endpoints (listings, wants, offers, threads, messages).

### 3) Matching Engine Improvements
- [~] Add score model + explanation payloads per match.
  - [x] Added initial score + explanation payload fields on match API responses.
  - [~] Calibrate scoring weights with reputation/condition/activity factors and add tests.
    - [x] Added deterministic match-id builder and scoring unit tests.
    - [x] Added activity-based scoring factor using post recency.
    - [ ] Add reputation/condition-aware modifiers once those fields are persisted on listing/trader records.
- [ ] Persist and enforce dismissed/viewed/saved semantics across sessions.
- [ ] Trigger recomputation on listing/want changes and expose deterministic match IDs.

### 4) Offer / Messaging Policy Tightening
- [x] Enforce listing availability/active checks for offer creation.
- [x] Prevent duplicate spam threads for same participants/context.
- [x] Add message length/content policy responses and optional moderation hooks.

### 5) Card Library Integration Depth
- [x] Expand catalog endpoint to include pack-level filters relevant to marketplace query APIs.
- [x] Add card lookup/search endpoint(s) for create-post and wants UX (name/id/pack scoped).

---

## ⏭️ Before UI/UX Build (Go/No-Go Checklist)

- [x] DB-backed persistence in place.
- [~] Route schemas + stable DTO contracts done.
- [ ] Match scoring + explanations done.
- [x] Offer/messaging policy rules finalized.
- [ ] Disabled-commerce tests verify fail-closed behavior.
- [~] Seed dataset prepared for WARD pack demos and empty/loading/error states.
  - [x] Added `GET /api/marketplace/demo-seed` to provide demo users/cards/empty-state copy for UI scaffolding.
  - [ ] Add DB-backed richer demo fixture coverage for offers/messages/matches scenarios.

---

## Suggested Execution Order
1. Persistence + repository extraction
2. Schema validation + DTO stabilization
3. Match scoring + explanation model
4. Offer/message policy completion
5. Card search endpoints
6. UI implementation against stable contracts

---

## Final Execution Checklist (Dependency-ordered)
1. [x] Add pagination contracts to list endpoints (listings, wants, offers, threads, messages).
   - [x] Implemented pagination for listings and wants (query schema + route + repository wiring).
   - [~] Extend pagination to offers/threads/messages list endpoints.
     - [x] Implemented pagination for offers and threads (including thread message pagination on detail endpoint).
     - [x] Added dedicated paginated thread-messages listing endpoint (`GET /messages/threads/:threadId/messages`) for UI timeline loading.
2. [ ] Standardize error shape and error codes across all remaining non-marketplace core routes that still return ad-hoc payloads.
3. [ ] Matching engine scoring + explanation payloads.
4. [ ] Offer/messaging policy tightening (availability checks, duplicate thread suppression, moderation hooks).
5. [x] Card lookup/search endpoints for post/want UX.
   - [x] Added `GET /api/marketplace/cards` with `q`, `packId`, and `limit` filters for create-post/wants picker UX.
   - [~] Add card-detail endpoint and pack-constrained recommendations for match composer UX.
     - [x] Added `GET /api/marketplace/cards/:cardId` card-detail endpoint.
     - [x] Added `GET /api/marketplace/cards/:cardId/recommendations` with pack-constrained recommendations.
6. [~] Disabled-commerce fail-closed test coverage + seed/demo dataset pass.
   - [x] Added disabled-commerce action throw coverage in marketplace guard tests.
   - [ ] Add seed/demo dataset pass for WARD marketplace UI states.
