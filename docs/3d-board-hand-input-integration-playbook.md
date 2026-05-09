# 3D Board + Hand + Phase Interaction Integration Playbook

This playbook describes how to connect your existing 3D board scene to the current engine/text interaction flow so that:

- hand cards are visible in 3D,
- cards can be dragged and dropped into valid slots,
- click/drag interactions satisfy the same phase/prompt requirements as the text interaction screen.

## Integration principle

Treat the engine as the single source of truth and the 3D board as a projection + input surface.

Pipeline:

1. Engine state/events (`MatchState`, `eventLog`) define what is legal and what happened.
2. A board adapter derives render data and actionable affordances.
3. 3D UI sends **intent commands** (not direct state mutations).
4. Engine resolves intents and emits authoritative updates/events.

## 1) Add a shared interaction contract

Create a contract that both text UI and 3D UI consume.

### `InteractionContext`

Derived from current phase + pending prompts:

- `phase`: draw/main/battle/end (or your real enum)
- `activePrompt`: optional structured prompt
- `legalActions`: list of action descriptors currently legal for the active player
- `selectionConstraints`: min/max target count, allowed zone/slot/card predicates

### `ActionDescriptor`

A normalized description of what the user can do now:

- `actionId`: stable id
- `kind`: `PLAY_FROM_HAND | ATTACH_MAGIC | SUMMON | DECLARE_BATTLE | CHOOSE_TARGET | END_PHASE | ...`
- `source`: card/zone anchor where action starts
- `targets`: allowed targets expressed structurally (zone, slot, card ids, predicates)
- `promptBinding`: optional link to the active prompt id

This lets 3D and text UIs execute the *same* legal moves.

## 2) Render the hand inside 3D as an anchored zone

Represent hand as a board anchor (camera-facing arc/fan near player edge).

For each hand card render item:

- `cardInstanceId`
- owner/controller
- display transform (position/rotation/scale)
- interaction state (`idle`, `hover`, `dragging`, `illegal`, `legalDropPreview`)

Do not compute legality in the scene layer. Scene asks adapter:

- `getActionsForCard(cardInstanceId)`
- `getDropTargetsForAction(actionId)`

## 3) Convert drag/drop into engine intents

Drag/drop should produce a command payload like:

```ts
{
  actionId: "...",
  actorPlayerId: "...",
  sourceCardId: "...",
  dropTarget: { zone: "MAGIC", slot: 1, targetCardId?: "..." },
  clientInteractionId: "uuid"
}
```

Submit that to the same action endpoint the text UI already uses.

### Why this matters

- Text UI and 3D UI stay behaviorally identical.
- All validation remains in engine guards.
- Illegal drops never mutate local game state.

## 4) Add affordance overlays driven by legality

When dragging:

1. Resolve candidate actions for dragged card.
2. Resolve legal targets for chosen action.
3. Highlight only legal anchors/slots in 3D.
4. Show deny feedback for invalid targets.

Recommended visuals:

- legal slot glow (green/blue)
- illegal slot muted/red pulse
- target lines for attach/battle declarations
- prompt badge for target-selection modes

## 5) Handle prompt-driven interactions as explicit modes

Your text side likely has prompts like “select a target creature.”

Map each prompt to a scene interaction mode:

- `IdleMode`
- `DraggingCardMode`
- `SelectingTargetMode`
- `ResolvingChainMode` (input locked)

Mode transition triggers:

- new `activePrompt`
- phase change
- in-flight resolution bundle start/end

In `SelectingTargetMode`, clicking a valid target submits `CHOOSE_TARGET` intent immediately.

## 6) Keep deterministic reconciliation

After every accepted intent:

- consume authoritative state/event update,
- reconcile transforms to new anchors,
- animate from previous to new positions,
- clear local drag ghost.

If server rejects an action:

- snap dragged card back to hand,
- surface rejection reason,
- keep context in same prompt/phase.

## 7) Suggested adapter seam in this repo

Given existing event/state architecture, add an adapter module responsible for:

- `buildBoardRenderModel(matchState)`
- `buildInteractionContext(matchState, activePlayerId)`
- `listLegalActions(interactionContext)`
- `mapPointerGestureToIntent(gesture, interactionContext)`

Both text and 3D clients should read from this seam.

## 8) Implementation order (practical)

1. **Mirror phase/prompt state into 3D HUD** (read-only).
2. **Render 3D hand zone** from current hand cards.
3. **Enable drag visuals only** (no submit).
4. **Wire drop -> intent submit** for one action family (e.g., play/summon).
5. **Add target-selection prompts** for click-to-choose.
6. **Add attach/battle drag lines** and action families.
7. **Harden rejection/reconnect/resync behavior**.

## 9) Definition of done

You are done when all of these are true:

- Every legal action available in text UI is performable in 3D.
- Every prompt type has a mapped interaction mode in 3D.
- Illegal gestures never desync local/authoritative state.
- Reconnect/replay rehydrates to the same visible positions and prompt state.

---

Short version: **use the 3D board as an input-capable renderer for the same legal-action/prompt contract your text UI already follows**. That gives you natural drag/drop while preserving rules correctness.
