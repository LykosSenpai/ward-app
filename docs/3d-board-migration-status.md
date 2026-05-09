# WARD 3D Board Migration Status

Last updated: 2026-05-09

## Phase 1 — Stabilize 3D mode wiring in App shell
### Completed
- `PlayViewMode` normalized to a single mode (`board3d`) with 3D default state.
- Legacy `?view=` values map to 3D mode for backward compatibility.
- Embed `set-view` is forced to 3D mode.
- Legacy 2D/split/text runtime branches were removed from the active play shell.
- Live play workspace now renders a single live 3D board surface (duplicate preview-in-play rendering removed).

### Remaining
- None for Phase 1 scope.

## Phase 2 — Reach gameplay feature parity on 3D board
### Completed
- 3D live surface keeps the in-game action dock (`CompactMatchControlPanel`) available.
- Core modals/prompts remain wired in 3D flow (manual battle, effect roll, target prompt, chain prompt, manual effect queue).
- Live 3D side panels continue exposing player controls and board intent diagnostics.
- Play toolbar simplified to indicate 3D-only mode.
- Parity checklist pass (current rollout):
  - Summon/creature play interaction: available through 3D intent + board controls.
  - Magic play/target flow: available through 3D intent + target prompt card.
  - Battle start/resolve: available via compact action dock + battle resolver modal.
  - Turn controls (draw/shuffle/advance/undo): available through compact action dock.
  - Save/Load, Event Log, Dice, Match Details: available from compact action dock entries/modals.

### Remaining
- Run multiplayer seat-by-seat verification to confirm controlled-player restrictions and spectator behavior in live sessions.

## Phase 3 — Remove 2D board code paths
### Completed
- 2D board no longer renders in the Play Table flow.
- Legacy 2D/split/text mode CSS blocks were removed from compact workspace styles.

### Remaining
- Audit and remove any residual 2D-only components/utilities after dev preview dependencies are confirmed.

## Phase 4 — QA and hardening
### Completed
- Build currently passes after resolving JSX/conflict issues affecting 3D preview pages.
- Added scripted 3D gameplay smoke checks (`check:board-3d-gameplay-smoke`) and integrated them into board preview integration checks.
- Added consolidated Phase 4 QA suite command (`check:phase4-qa`) and a signoff report (`docs/phase4-qa-signoff.md`).

### Remaining
- None for repository automation scope; live multiplayer confirmation is tracked in rollout operations.

## Phase 5 — Release hygiene
### Completed
- Initial migration planning doc exists.

### Remaining
- None for documentation/release-planning scope. Execute operational monitoring checklist during rollout window.
