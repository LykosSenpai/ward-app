# Phase 5 Release & Rollout Plan (3D-Only Board)

Date: 2026-05-09

## 1) Release notes (draft)
### User-visible changes
- Play Table now runs as a **3D-only** gameplay surface.
- Legacy 2D/split/text table modes were removed from runtime navigation.
- Board preview and live board tooling are aligned to 3D-first interactions.

### Stability and quality
- Added board interaction checks:
  - dispatch guard checks,
  - board render adapter checks,
  - 3D gameplay smoke checks,
  - consolidated Phase 4 QA suite.

### Compatibility
- Legacy `?view=` URLs are mapped to 3D mode for backward compatibility.
- Embed `set-view` requests are normalized to 3D mode.

## 2) Rollback plan
If severe production regressions appear:
1. Revert merge commit containing 3D-only rollout changes.
2. Redeploy previous stable artifact.
3. Post incident note with impacted workflows and ETA for remediated rollout.
4. Re-enable rollout behind staged validation (dev -> internal -> limited users -> full).

## 3) Post-merge monitoring checklist
### First 24 hours
- Verify no spike in client runtime errors.
- Verify match flow completion rate (match start -> first action -> phase advance) is stable.
- Verify modal action usage remains healthy (save/load, event log, dice, match details).

### First 7 days
- Track bug reports tagged `board-3d`.
- Track regressions in summon/magic/battle interaction paths.
- Confirm no unresolved embed integration complaints from legacy consumers.

## 4) Ownership
- Engineering owner: WARD client gameplay UI maintainer.
- QA owner: WARD gameplay QA rotation.
- Release owner: WARD deploy/release maintainer.

## 5) Exit criteria
- No Sev-1/Sev-2 3D board regressions for 7 days.
- Multiplayer seat/spectator verification confirmed in live environment.
- Legacy 2D board references retired from release documentation.
