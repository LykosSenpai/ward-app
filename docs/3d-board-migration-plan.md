# WARD 3D Board Migration Plan (Remove 2D Board)

## Goal
Ship the 3D board as the only playable table experience for WARD and fully remove the legacy 2D board UI path.

## Current-state findings (historical context)
- ✅ Live Play Table is now 3D-only (`board3d`) in runtime.
- ✅ Legacy query `view` values (`board`, `split`, `text`, `board-3d`, `3d`) normalize to `board3d` for backward compatibility.
- ✅ Legacy 2D live board component/style paths were removed from active gameplay runtime.
- ℹ️ `board-preview` remains a dev/admin preview surface and is not the canonical live Play Table.

## Definition of done
- The Play Table only renders the 3D board experience in production gameplay.
- No user-facing controls or routes expose 2D board mode.
- Gameplay-critical interactions (select, play card, attack/targeting, phase progression, chain/effect prompts) are reachable from 3D flow.
- Build/tests pass and regression smoke checks cover 3D board flow.

## Phase 1 — Stabilize 3D mode wiring in App shell
1. Normalize `PlayViewMode` values to a single 3D mode naming convention.
2. Remove stale branches for 2D board/split/text in Play Table mode selector.
3. Fix all 3D conditional-render variables to one identifier.
4. Make URL/query parsing backward-compatible (map old params to new 3D-only mode).
5. Keep `board-preview` page as dev/admin preview only (optional).

## Phase 2 — Reach gameplay feature parity on 3D board
1. Inventory all actions currently available in 2D board control surfaces.
2. Ensure equivalent controls are available in 3D action dock/panels:
   - Draw/shuffle/undo/advance phase
   - Manual battle and battle resolution
   - Manual effects, target prompts, chain priority actions
   - Save/load, event log, match details, dice
3. Validate controlled-player perspective behavior and seat ownership affordances.
4. Verify drag/click intents produce server-valid commands for all common turns.

## Phase 3 — Remove 2D board code paths
1. Remove `CardBoardView` usage from `App.tsx` gameplay workspace.
2. Delete obsolete 2D-only components/styles (after confirming no remaining imports).
3. Remove old view labels/UI copy referencing 2D/split/text modes.
4. Clean dead utility code and types tied only to 2D presentation.

## Phase 4 — QA and hardening
1. Add/expand script checks for board render adapters and intent dispatch.
2. Add a scripted smoke scenario for 3D gameplay loop (start match, play card, advance phase, resolve pending UI prompts).
3. Perform manual multiplayer QA with both seats and spectator/admin roles.
4. Validate embed mode behavior for 3D-only presentation.

## Phase 5 — Release hygiene
1. Update docs/readme and internal notes to state 3D board is canonical.
2. Add migration notes for any old deep-links (`?view=board`, etc.).
3. Monitor post-merge bugs and keep a short rollback plan (feature flag or quick revert commit).

## Suggested PR breakdown
1. **PR A:** App view-mode normalization + 3D-only Play Table selector.
2. **PR B:** 3D action parity gaps + interaction fixes.
3. **PR C:** Remove 2D components/styles and dead code.
4. **PR D:** QA automation updates + docs cleanup.

## Immediate next implementation tasks
- [x] Lock `PlayViewMode` to 3D-first values and remove mixed-mode toolbar options.
- [x] Keep legacy `view` values mapped to `board3d` for compatibility.
- [x] Remove `CardBoardView` branch from live match workspace.
- [x] Add/adjust non-live script checks in `apps/client/scripts/*board*`.
- [ ] Complete live multiplayer seat/spectator operational signoff (live-only).
