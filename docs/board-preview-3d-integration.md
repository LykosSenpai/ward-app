# BoardPreview3D Integration Handoff

## Purpose
This document defines the current `BoardPreview3D` integration contract for server-authoritative match flow.

## Current integration boundary
- `BoardPreview3D` remains projection-only.
- Match authority remains `AppMatchState` from server state updates.
- Dispatch path in live mode is:
  1. focus intent (slot/piece)
  2. adapter guard preflight
  3. socket emit with `clientRequestId`
  4. pending/ack/reject reconciliation in `BoardPreviewPage`

## Adapter contracts
Key adapter helpers in `apps/client/src/components/boardPreview3dAdapter.ts`:
- `buildBoardObjects(match)`
- `buildInteractionIntentFromSlotFocus(event)`
- `buildInteractionIntentFromPieceFocus(event, boardObjects)`
- `canDispatchSummon(...)`
- `canDispatchMagic(...)`
- `canDispatchBattle(...)`
- `ensureDispatchReady(...)`

### Guard parity notes
- Summon requires focused primary slot owned by acting player + summonable card.
- Magic requires a playable magic card for the acting player; the five visible magic slots are only used for Infinite Magic placement.
- Battle requires attacker id, defender id, valid attacker, defender primary, and valid battle phase.

## Request correlation + pending lifecycle
`BoardPreviewPage` now emits summon/magic/battle actions with `clientRequestId` and keeps a pending queue.

Expected behavior:
- On emit: add pending request and start timeout.
- On `match:state` with `clientRequestId`: ack matching request.
- On `match:error` with `clientRequestId`: reject matching request.
- On timeout: mark request timed out and clear from pending queue.
- On uncorrelated `match:state`: ack oldest pending request as fallback.

## Operator UX expectations (live mode)
- Disabled dispatch controls now display explicit reasons.
- Buttons include tooltip hints for blocked reasons.
- If `controlledPlayerId` is set, manual player selection is locked and explained.

## Integration smoke checks
Run these before merge:
1. `pnpm --filter @ward/client check`
2. `pnpm --filter @ward/client check:dispatch-guards`
3. `pnpm --filter @ward/client check:board-preview-integration`
4. `node tools/workspace-check.mjs client-types client-dispatch-guards client-board-preview-integration`

## QA checklist
- 2D/3D toggle works.
- Slot/piece focus updates bridge context.
- Summon/magic/battle buttons show actionable disable reasons, and non-Infinite field Magic is projected through the Field Magic tray.
- Pending ack line updates on dispatch, ack, reject, and timeout.
- No direct match-state mutation from preview UI handlers.
