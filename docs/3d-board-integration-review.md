# 3D Game Board Integration Review (Browser + Embedding)

## Scope Reviewed

- `apps/client/src/components/CardBoardView.tsx`
- `apps/client/src/components/BoardPreviewPage.tsx`
- `apps/client/src/App.tsx`
- `apps/client/src/styles/app-06-interactive-board.css`

## Executive Summary

The current client is in a **good position** for a 3D board integration because the board is already separated into a dedicated composition layer (`CardBoardView`) and a preview harness (`BoardPreviewPage`). The architecture is componentized enough to progressively swap visual layers (2D CSS board → 3D renderer) without rewriting match logic.

Embedding into a website is also feasible, but you should formalize an **embed mode contract** (URL params + auth + reduced chrome + postMessage API) before shipping.

## What Is Already Strong

1. **Board view is a distinct component boundary.**
   - `CardBoardView` receives a match snapshot and actions as props, which makes it a strong integration seam for a 3D presentation layer.
2. **Preview harness exists.**
   - `BoardPreviewPage` can build synthetic match state from catalog data for visual iteration without needing full multiplayer setup.
3. **State and control flow are explicit.**
   - Turn status, pending prompts, battle state, and manual queue are surfaced in UI-specific helpers (`getTableAlert`, `getBoardPanelTitle`) that can be mirrored into 3D overlays.
4. **Near/far board semantics are already defined.**
   - Distinction between near and far player is already first-class; this maps directly to camera framing and board anchoring in 3D.

## Integration Risks / Gaps to Resolve

1. **No formal view-model adapter for rendering layer.**
   - `CardBoardView` currently computes display details inline. A 3D renderer will be easier if you create a single mapping function (match → board render model).
2. **Embed-specific shell controls are not yet isolated.**
   - Global app nav/header/session indicators are useful in-app, but embedded contexts typically require a minimal shell.
3. **No parent/child messaging contract for embeds.**
   - If hosted in iframe, parent site needs a stable API (`postMessage`) for events (turn changes, card selected, ready state).
4. **Auth/session assumptions may block third-party embedding.**
   - Current auth flow is cookie-based in app shell. Embedded use often needs token bootstrap or trusted host checks.
5. **Performance budgets are not yet codified.**
   - 3D board in browser needs explicit budgets (frame time, texture memory, draw calls) and fallback policy.

## Recommended Integration Plan

### Phase 1: Stabilize Render Contract

- Add `buildBoardRenderModel(match, controlledPlayerId)` in client domain layer.
- Make both current 2D board and future 3D board consume the same render model.
- Keep gameplay actions as pure callbacks injected from App state.

### Phase 2: Introduce 3D Renderer Behind Feature Flag

- Add `playViewMode: "board-2d" | "board-3d" | "split" | "text"`.
- Implement a `BoardScene3D` component that only consumes render model + callbacks.
- Maintain `CardBoardView` as fallback for low-power devices or unsupported browsers.

### Phase 3: Embed Mode

- Add URL contract (example):
  - `?embed=1&page=board-preview&view=3d`
- In embed mode:
  - Hide app header/nav and nonessential panels.
  - Lock focus to board surface.
  - Disable controls not appropriate for host context.
- Implement `window.postMessage` protocol:
  - Child → parent: `ready`, `turnChanged`, `selectionChanged`, `error`.
  - Parent → child: `setMatch`, `setView`, `highlightCard`, `requestSnapshot`.

### Phase 4: Browser Hardening

- Provide graceful fallback when WebGL/WebGPU unavailable.
- Add reduced effects mode for mobile.
- Add `ResizeObserver`-driven responsive canvas sizing for iframe containers.
- Verify accessibility alternatives for key interactions.

## Embedding Readiness Checklist

- [ ] Dedicated embed shell (no app nav/header)
- [ ] URL-driven boot config (`embed`, `page`, `view`, optional seed)
- [ ] Auth/token bootstrap strategy documented
- [ ] `postMessage` API versioned (`type`, `version`, `payload`)
- [ ] Origin allowlist validation for inbound messages
- [ ] Dynamic sizing strategy (fixed, responsive, or auto-height messaging)
- [ ] Snapshot/loading states exposed to host
- [ ] Mobile touch input pass tested inside iframe
- [ ] Browser fallback path tested (2D board fallback)

## Conclusion

Your codebase is **well-positioned** for 3D board integration. The biggest blockers are not core gameplay logic; they are integration contracts (render model, embed shell, auth, and parent-window messaging). If you implement those contracts first, the 3D board should embed cleanly in browser-hosted websites with predictable behavior.

## Is It "Just Hook Text Engine Output to 3D"?

Short answer: **not quite**.

You are close, but there are several production-critical layers between engine text/events and smooth 3D gameplay:

1. **Deterministic event stream contract**
   - 3D motion needs structured events (summon, attach, destroy, move zone, resolve chain), not only human-readable text.
2. **Temporal orchestration layer**
   - Multiple engine events often happen in one logical action; animations need queueing, grouping, interruption, and rollback handling.
3. **Authoritative state reconciliation**
   - Renderer should animate toward authoritative snapshots while handling out-of-order socket events and reconnects.
4. **Input arbitration**
   - Prevent conflicting actions during pending chain/prompt states; lock or gate interactions while animations resolve.
5. **Embed-host integration contract**
   - Parent page needs readiness/state hooks and control hooks (`postMessage`) before production embed is reliable.

## Concrete Build Plan (Suggested)

### Milestone 0 — Contracts First (1–2 days)
- Define `BoardRenderModel` and `BoardEvent` TypeScript contracts.
- Add a pure mapper from `AppMatchState` to `BoardRenderModel`.
- Add a serializer for deterministic event payloads from match updates.

### Milestone 1 — 2D/3D Parallel Adapter (2–4 days)
- Keep existing `CardBoardView` as baseline.
- Create `BoardScene3D` behind feature flag.
- Feed both from the same render model.

### Milestone 2 — Animation Runtime (3–6 days)
- Build event queue with phases: enqueue → precondition → animate → settle → ack.
- Add cancellation and fast-forward path for reconnect/desync.
- Add basic motion library: draw, summon, attack, destroy, attach, chain resolve.

### Milestone 3 — Sync + Recovery (2–4 days)
- Add snapshot checkpoints every N events.
- On mismatch/reconnect: snap to latest authoritative model, then continue queued events.
- Add logging for event IDs and animation timings.

### Milestone 4 — Embed Productionization (2–4 days)
- Expand embed mode beyond hidden chrome:
  - `postMessage` API (versioned) for parent/child communication.
  - Origin checks for inbound messages.
  - Resize protocol (`ResizeObserver` + optional child->parent height events).

### Milestone 5 — Performance + QA (ongoing)
- FPS and frame-time budgets for desktop/mobile.
- Texture atlas strategy and draw-call budget.
- Fallback to 2D board when GPU/browser capability insufficient.

## Definition of "Good to Go"

You are ready when all of the following are true:

- [ ] Same gameplay action yields deterministic visual sequence across clients.
- [ ] Reconnect during animation recovers to correct board state without stuck UI.
- [ ] Embed host can control and observe board via stable message API.
- [ ] Mobile touch interactions are reliable in iframe context.
- [ ] 2D fallback path works when 3D is unavailable.
