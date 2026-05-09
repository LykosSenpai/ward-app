# Optimal Integration Method: Engine + Card Effects -> 3D Board

## Why this method fits your current codebase

Your engine already emits structured `eventLog` entries (`type`, `sequenceNumber`, `payload`) via `addEvent`, which is the correct primitive to drive deterministic animation. The key is to formalize a **render event contract** derived from those events instead of trying to animate directly from raw text/effect labels.

Relevant runtime seams:
- Event emission: `packages/engine/src/engineRuntime.ts` (`addEvent`).
- Effect resolution hub: `packages/engine/src/effectResolver.ts`.
- Zone/card movement operations: `packages/engine/src/cardMovement.ts`.

## Recommended Architecture (Optimal Path)

### 1) Keep engine authoritative; add a renderer adapter layer

Do **not** let 3D code infer gameplay from card text. Keep this pipeline:

1. Engine mutates `MatchState`.
2. Engine emits game events (`eventLog`).
3. Adapter converts game events + snapshots into `BoardRenderEvent[]`.
4. 3D runtime plays `BoardRenderEvent[]` deterministically.

This protects effect complexity while keeping visuals stable.

### 2) Introduce two explicit contracts

#### A) `BoardRenderModel` (snapshot)
A normalized visual snapshot built from `MatchState`:
- cards by zone and slot index
- owner/controller ids
- attachments (magic -> creature)
- health/stat overlays
- pending prompts/chain markers

#### B) `BoardRenderEvent` (delta timeline)
A renderer-facing event schema independent of raw engine strings:
- `CARD_DRAWN`
- `CARD_MOVED_ZONE`
- `CREATURE_SUMMONED`
- `MAGIC_ATTACHED`
- `BATTLE_STARTED`
- `BATTLE_RESOLVED`
- `EFFECT_PROMPT_OPENED`
- `CHAIN_RESOLVED`

Each event must include:
- `eventId` (stable)
- `sequenceNumber` (authoritative ordering)
- `matchId`
- compact payload (card ids, source/destination anchors, timing hints)

### 3) Build a deterministic animation runtime

Implement queue semantics:

`enqueue -> validate preconditions -> animate -> settle -> ack`

Rules:
- Never start event `N+1` before `N` settles unless explicitly composable.
- On reconnect or divergence, clear queue, snap to latest `BoardRenderModel`, resume from latest `sequenceNumber`.
- Keep a fast-forward mode for spectator/slow clients.

### 4) Treat effect resolution as event bundles

`effectResolver` can emit multiple low-level actions for one card effect. Model this as grouped visual bundles:
- bundle id = source engine event id or synthetic transaction id
- include ordered child events
- allow a single “skip animation” action to skip whole bundle

This keeps chain/magic interactions understandable in 3D.

### 5) Upgrade embed mode to a full host API

Current embed shell is a good start. Next make it production-safe with versioned messaging:

Child -> Parent:
- `board.ready`
- `board.eventApplied`
- `board.error`
- `board.heightChanged`

Parent -> Child:
- `board.setView`
- `board.setAnimationSpeed`
- `board.requestSnapshot`
- `board.focusCard`

Security:
- strict origin allowlist for inbound commands
- API version field in every message

## Concrete implementation plan against your repo

### Step 0 — Add integration package boundary (1 day)
Create `packages/board-runtime` with:
- `buildBoardRenderModel(match: MatchState)`
- `translateGameEventsToRenderEvents(events: GameEvent[])`

Keep this pure and fully unit-testable.

### Step 1 — Standardize event taxonomy (2–3 days)
Audit emitted event `type` values and map them to a smaller renderer taxonomy.
- Start from `addEvent` callsites in engine modules.
- Prefer explicit payload fields over parsing event strings.

### Step 2 — Patch high-impact engine payload gaps (2–4 days)
Where movement/resolution is ambiguous, add structured payload fields at emission time (source zone, target anchor, initiating effect id).

### Step 3 — Connect 2D and 3D to same adapter (2–4 days)
- Existing board UI consumes `BoardRenderModel` for overlays.
- New 3D scene consumes `BoardRenderModel + BoardRenderEvent`.
- Use feature flag to switch renderer without touching gameplay logic.

### Step 4 — Hardening (ongoing)
- deterministic replay tests from saved matches
- reconnect/desync recovery tests
- mobile iframe touch + resize tests

## What "done" should mean

You are truly ready when:
- A saved match replay always produces identical event ordering and card end positions.
- Effects that currently run through `effectResolver` produce understandable grouped animations with no hidden state jumps.
- Reconnect during chain/battle does not leave visual desync.
- Embed host can reliably control view/speed and observe readiness/errors.

## Short answer to your question

You are **not** at “just wire text output to 3D and ship.”

The optimal method is: **authoritative engine state + explicit render contracts + deterministic event queue + versioned embed API**. Given your current engine/event structure, this is very achievable without rewriting card logic.
