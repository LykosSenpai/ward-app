# Railway Cost + Performance Playbook (Network Egress + RAM)

This playbook focuses on reducing egress and memory pressure for the current WARD server/client split.

## Cost snapshot triage (from current Railway usage)

Given the sample numbers provided:

- `@ward/client`: egress `9.34 GB` (~`$0.4671`) and RAM `558.12 GB` (~`$0.1292`) are the top client costs.
- `@ward/server`: egress `3.29 GB` (~`$0.1643`) and RAM `553.29 GB` (~`$0.1281`) are the top server costs.
- `Postgres`: RAM hours are non-trivial, but egress is `0.00 GB`; DB is not the egress problem.

Priority should be:

1. Client + server payload/request-count reductions (biggest immediate $ impact).
2. Runtime RAM reductions on both Node services.
3. Postgres tuning only after app-layer wins.

## 1) Reduce ownership update egress first

`setUserCardOwnershipCount` currently returns the **entire ownership map** after every mutation. For large collections, this causes heavy response payloads and repeated download bytes.

- Current flow: `PATCH/POST ownership update -> write one row -> load all rows -> return full map`.
- Better flow: return only `{ ownershipKey, ownedCount }` (or a tiny `changed` patch) and let the client merge.

### API strategy

- Add an endpoint response mode:
  - default (new): `{"changed": {"<key>": n}}`
  - optional legacy: full map behind `?full=1` for migrations/debug.
- Add optimistic UI updates client-side and debounce writes (e.g., 250-500ms).
- Batch multiple edits in one request (`[{ ownershipKey, ownedCount }]`).

Expected effect: dramatically lower egress for users with many owned cards.

## 2) Cut client-originated request volume

Because client egress dominates, reduce repeated fetches first.

- Replace high-frequency polling with stale-while-revalidate cache-on-open.
- Keep manual refresh for low-priority views.
- Use small websocket invalidation events (`ownership_changed`) instead of repeated full refetches.
- Add request dedupe in the client data layer to prevent duplicate in-flight calls.

## 3) Add payload compression

Enable gzip/brotli on API responses in production. This is high impact for JSON maps/lists.

- Ensure compression is enabled at one layer only (Express or platform edge) to avoid duplicate work.
- Confirm `Content-Encoding` is present for large JSON responses.

## 4) Add HTTP caching primitives

For reads that are mostly static or user-stable in short windows:

- Use `ETag`/`If-None-Match` on ownership and marketplace list endpoints.
- Return `304 Not Modified` where possible.
- Add `Cache-Control: private, max-age=0, must-revalidate` for authenticated JSON where applicable.

This removes repeated response bodies from egress during refreshes.

## 5) Reduce DB round trips from write paths

For ownership writes:

- Keep upsert/delete, but avoid immediate full-map reload unless needed.
- If UI needs totals, return small aggregates (`ownedKinds`, `ownedTotal`) computed incrementally.

## 6) RAM optimization priorities

### A) Postgres pool sizing (server process memory)

`pg.Pool` is currently created with defaults. Set an explicit low-to-moderate pool size for Railway dynos.

- Start with `max: 5-10` per Node instance.
- Set `idleTimeoutMillis` and `connectionTimeoutMillis`.
- If using multiple replicas, total all pool sizes to stay below Postgres connection limits.

### B) Avoid in-memory unbounded structures

Review marketplace/chat/session-related in-memory stores; move durable/shared state to Postgres or add TTL+size caps.

### C) Session footprint

Sessions are stored in Postgres (good for restart durability), but keep session payload minimal (ids/flags only).

### D) Build/runtime split

- Ensure server runs compiled output only in production.
- Disable source maps if memory is tight.
- Avoid large in-memory card datasets in request handlers; load once and reuse read-only snapshots.

## 7) Add a one-day measurement loop

Track these metrics around each change:

- Egress bytes/day and bytes/request by route
- P95 response size for ownership endpoints
- Request count/day by route (to confirm polling reductions)
- Node RSS / heap used over time
- DB connections in use / waiting

Roll out changes one by one so wins are attributable.

## 8) Suggested rollout order

1. Return ownership deltas instead of full map.
2. Debounce + batch ownership writes.
3. Replace polling with cache + invalidation.
4. Enable compression + ETag.
5. Set explicit pg pool limits.
6. Add per-route payload/request/egress instrumentation.

## 9) Quick acceptance targets

Use practical short-term targets to know when to stop iterating:

- Cut client egress by `40%+` (9.34 GB -> <= 5.6 GB).
- Cut server egress by `30%+` (3.29 GB -> <= 2.3 GB).
- Reduce combined Node RAM-hours by `20%+`.

