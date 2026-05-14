# WARD Engine + 3D Board + Card Effects Codex Plan

Last updated: 2026-05-11  
Repo: `LykosSenpai/ward-app`  
Local path: `C:\Users\brjar\Documents\ward-app`

This document is a Codex/LLM handoff for making the WARD engine, card-effect runtime, and 3D board interaction/animation systems work together without turning the board into a second rules engine.

The current repo already contains a partial 3D-board integration path. Do not restart the 3D board work from scratch.

Existing relevant files:

```text
# Planning/status docs
docs/3d-board-migration-plan.md
docs/3d-board-migration-status.md
docs/3d-board-engine-effects-integration-method.md

# Engine/card-effect runtime
packages/engine/src/effectActionCatalog.ts
packages/engine/src/effectRuntimeSupport.ts
packages/engine/src/effectResolver.ts
packages/engine/src/effectPrompts.ts
packages/engine/src/cardMovement.ts
packages/engine/src/fieldRemoval.ts
packages/engine/src/battle.ts
packages/engine/src/battleEffectAdapter.ts
packages/engine/src/magicChainActions.ts
packages/engine/src/turns.ts
packages/engine/src/normalizeMatch.ts
packages/shared/src/index.ts

# Current 3D board/client adapter system
apps/client/src/components/BoardPreview3D.tsx
apps/client/src/components/boardRenderContracts.ts
apps/client/src/components/boardRenderAdapter.ts
apps/client/src/components/boardPreview3dAdapter.ts
apps/client/src/components/boardPreview3dLayout.ts
apps/client/src/components/boardAnimationQueue.ts
apps/client/src/components/boardAnimationProfiles.ts
apps/client/src/components/boardIntentCommands.ts
apps/client/scripts/boardRenderAdapterChecks.ts
apps/client/scripts/boardPreview3dDispatchChecks.ts
apps/client/scripts/board3dGameplaySmoke.ts
apps/client/scripts/board3dBattlePromptSmoke.ts
apps/client/scripts/board3dMultiplayerMatrixSmoke.ts
```

## 1. Main Architecture Rule

The WARD engine/server is the source of truth for:

- action legality
- summon legality
- target legality
- cost legality
- Magic Chain priority
- battle response windows
- card movement
- effect resolution
- turn-cycle duration handling
- source-linked cleanup
- hidden-information restrictions

The 3D board should:

1. Display legal choices.
2. Display disabled choices with reasons.
3. Send player intent to the server.
4. Animate engine-confirmed results.
5. Never decide gameplay rules locally.
6. Never parse card text to decide what is legal.
7. Avoid card-name-specific animation logic unless a card is truly unique and documented.

Correct flow:

```text
User click / drag / select on 3D board
  -> Board sends intent/action to server
  -> Engine validates
  -> Engine mutates MatchState
  -> Engine/server emits match update + board-facing events/affordances
  -> Board renders state and animates confirmed results
```

Bad flow to avoid:

```text
User drags card
  -> Board decides if the move is legal
  -> Board mutates local match state
  -> Engine catches up later
```

## 2. Target Layering

```text
Engine MatchState
  -> Shared Board Contracts
  -> Board View Model
  -> Board Affordances
  -> Board Events
  -> Board Animation Planner
  -> Renderer
       - current web 3D board
       - future Unreal client
```

The web 3D board should become one renderer for these contracts, not the place where WARD rules are implemented.

## 3. Existing Repo State

The repo is already partly aligned with this plan:

- `docs/3d-board-migration-status.md` says the 3D board is already the canonical live play surface.
- `apps/client/src/components/boardRenderContracts.ts` already defines early render contracts such as `BoardRenderModel`, `BoardRenderEvent`, and `BoardInteractionContext`.
- `apps/client/src/components/boardRenderAdapter.ts` already converts match/event-log data into render models/events.
- `apps/client/src/components/boardPreview3dLayout.ts` already centralizes board slot/zone layout.
- `apps/client/src/components/boardAnimationQueue.ts` and `boardAnimationProfiles.ts` already provide early animation queue/profile logic.

Main gap:

The current board contracts are still mostly client-local. The next step is to move the renderer-neutral contract concepts into shared code and add a true `BoardAffordance` layer.

## 4. Shared Board Contracts Plan

Create:

```text
packages/shared/src/boardContracts.ts
```

Export it from:

```text
packages/shared/src/index.ts
```

Rules for this file:

- No React imports.
- No Three.js imports.
- No DOM/browser types.
- No `AppMatchState` imports.
- No imports from `apps/client`.
- Only shared WARD types from `packages/shared`.

Initial shared type families:

```ts
export type BoardZoneKind =
  | "HAND"
  | "DECK"
  | "CEMETERY"
  | "PRIMARY_CREATURE"
  | "LIMITED_SUMMON"
  | "MAGIC_SLOT"
  | "CHAIN"
  | "BATTLE"
  | "PROMPT"
  | "REMOVED_FROM_GAME"
  | "ATTACHED_UNDER";

export type BoardZoneRef = {
  playerId?: string;
  zone: BoardZoneKind;
  slotIndex?: number;
};

export type BoardCardView = {
  instanceId: string;
  cardId: string;
  cardName: string;
  ownerPlayerId: string;
  controllerPlayerId: string;
  zoneRef: BoardZoneRef;
  faceUp: boolean;
  selectable: boolean;
  disabledReason?: string;
  attachedToInstanceId?: string;
  attachedCardInstanceIds?: string[];
  activeStatusLabels?: string[];
};

export type BoardAffordanceKind =
  | "PLAYABLE_CARD"
  | "VALID_TARGET_CARD"
  | "VALID_TARGET_ZONE"
  | "VALID_COST_CARD"
  | "VALID_CHAIN_RESPONSE"
  | "VALID_BATTLE_RESPONSE"
  | "VALID_DROP_ZONE"
  | "DISABLED_ACTION";

export type BoardAffordance = {
  id: string;
  kind: BoardAffordanceKind;
  playerId: string;
  sourceCardInstanceId?: string;
  targetCardInstanceId?: string;
  targetZoneRef?: BoardZoneRef;
  promptId?: string;
  actionId?: string;
  label: string;
  highlightStyle:
    | "VALID"
    | "TARGET"
    | "COST"
    | "CHAIN"
    | "BATTLE_RESPONSE"
    | "WARNING"
    | "LOCKED";
  disabledReason?: string;
};
```

Keep the existing client-local contracts working during migration. Do not break the current 3D board while adding shared contracts.

## 5. Board Affordance Layer Plan

This is the highest-priority missing layer.

Purpose:

`BoardAffordance[]` should be the only source for 3D board glow/highlight/disabled state.

Create one of these depending on the safest incremental path:

```text
# Preferred long-term
packages/engine/src/boardAffordances.ts

# Acceptable first step if engine import coupling is too high
apps/client/src/components/boardAffordances.ts
```

Inputs:

- `MatchState`
- controlled player id
- `pendingEffectTargetPrompt`
- `pendingPrompt`
- `pendingChain`
- `pendingBattle`
- `pendingEffectRoll`
- `manualEffectQueue`
- action guards
- target options
- summon rules
- magic play restrictions
- current phase
- Magic Chain priority
- battle strike/window state
- Silence/magic-lock states
- hand reveal/redraw state

Outputs:

- playable cards
- valid target cards
- valid target zones
- valid cost cards
- legal chain responses
- legal battle responses
- legal drop zones
- disabled actions/cards with reason text

Mapping examples:

```text
pendingEffectTargetPrompt.options
  -> VALID_TARGET_CARD / VALID_TARGET_ZONE

PAY_DISCARD_MAGIC_COST prompt
  -> VALID_COST_CARD

Magic Chain priority player
  -> VALID_CHAIN_RESPONSE for legal Lightning cards only

PendingBattle current strike
  -> VALID_BATTLE_RESPONSE for cards like Minotaur Bodyguard

Summon/Magic phase + summon rules
  -> PLAYABLE_CARD / VALID_DROP_ZONE

Primary replacement required
  -> PLAYABLE_CARD only for valid replacement creatures

Hand discard required
  -> VALID_COST_CARD / discard affordance

Magic play lock
  -> DISABLED_ACTION / disabled Magic cards with reason

No valid targets found
  -> clean no-target message/affordance, not manual fallback
```

Board rule:

```text
BoardPreview3D should render glows from BoardAffordance[] only.
BoardPreview3D should not duplicate target legality.
```

## 6. Board Event Upgrade Plan

Current `boardRenderAdapter.ts` maps raw event log types into broad visual events by string matching. This is good for early rendering but too coarse for full card-effect animation.

Add or upgrade:

```text
packages/engine/src/boardEventBuilder.ts
```

or, if safer first:

```text
apps/server/src/boardEventBuilder.ts
```

Target board event taxonomy:

```text
CARD_MOVED
CARD_DRAWN
CARD_DISCARDED
CARD_DESTROYED
CARD_RETURNED_TO_HAND
CARD_RETURNED_TO_DECK
CARD_SENT_TO_CEMETERY
CREATURE_SUMMONED_PRIMARY
CREATURE_SUMMONED_LIMITED
LIMITED_PROMOTED_TO_PRIMARY
MAGIC_PLAYED_TO_CHAIN
MAGIC_RESOLVED
MAGIC_NEGATED
MAGIC_ATTACHED
MAGIC_DETACHED
ANCHOR_LINK_CREATED
ANCHOR_LINK_REMOVED
SOURCE_LINK_CLEANUP_TRIGGERED
CARD_DAMAGED
CARD_HEALED
STATUS_APPLIED
STATUS_REMOVED
STAT_MODIFIER_APPLIED
STAT_MODIFIER_REMOVED
DICE_ROLLED
BATTLE_STARTED
BATTLE_STRIKE_STARTED
BATTLE_HIT_ROLLED
BATTLE_DAMAGE_ROLLED
BATTLE_DAMAGE_APPLIED
BATTLE_RESOLVED
PROMPT_OPENED
PROMPT_RESOLVED
CHAIN_LINK_ADDED
CHAIN_PRIORITY_PASSED
CHAIN_LINK_RESOLVED
PLAYER_LOCK_APPLIED
PLAYER_LOCK_REMOVED
TURN_PHASE_CHANGED
TURN_STARTED
TURN_ENDED
```

Minimum payload fields:

```ts
type BoardEventBase = {
  id: string;
  sequenceNumber: number;
  matchId: string;
  type: string;
  playerId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
};

type CardMoveBoardEvent = BoardEventBase & {
  type: "CARD_MOVED";
  cardInstanceId: string;
  fromZoneRef: BoardZoneRef;
  toZoneRef: BoardZoneRef;
};
```

Implementation rule:

```text
Do not rely on parsing card names or card text.
Use actionType, effectId, sourceCardInstanceId, fromZone, toZone, promptId, chain link id, battle session id, and strike id.
```

## 7. Animation Planner Plan

The repo already has an animation queue and duration profiles. Add a planner that converts semantic board events into generic animation steps.

Create:

```text
apps/client/src/components/boardAnimationPlanner.ts
```

Later this can move into a renderer-neutral package if needed.

Generic animation steps:

```ts
export type BoardAnimationStep =
  | {
      type: "MOVE_CARD";
      cardInstanceId: string;
      toZoneRef: BoardZoneRef;
      durationMs: number;
    }
  | {
      type: "FLIP_CARD";
      cardInstanceId: string;
      faceUp: boolean;
      durationMs: number;
    }
  | {
      type: "GLOW_CARD";
      cardInstanceId: string;
      glowKind: "VALID" | "TARGET" | "COST" | "CHAIN" | "DAMAGE" | "HEAL" | "LOCKED";
      durationMs: number;
    }
  | {
      type: "GLOW_ZONE";
      zoneRef: BoardZoneRef;
      glowKind: "VALID_DROP" | "TARGET" | "COST" | "LOCKED";
      durationMs: number;
    }
  | {
      type: "DAMAGE_NUMBER";
      cardInstanceId: string;
      amount: number;
    }
  | {
      type: "HEAL_NUMBER";
      cardInstanceId: string;
      amount: number;
    }
  | {
      type: "ATTACH_CARD";
      attachmentInstanceId: string;
      targetInstanceId: string;
      durationMs: number;
    }
  | {
      type: "DETACH_CARD";
      attachmentInstanceId: string;
      targetInstanceId: string;
      durationMs: number;
    }
  | {
      type: "DESTROY_CARD";
      cardInstanceId: string;
      durationMs: number;
    }
  | {
      type: "ROLL_DICE";
      values: number[];
      rollKind: string;
      durationMs: number;
    }
  | {
      type: "SHOW_STATUS_CHIP";
      cardInstanceId?: string;
      playerId?: string;
      label: string;
      durationMs: number;
    };
```

Mapping rule:

```text
AnimationPlanner maps by:
- BoardEvent.type
- BoardEvent.reason
- actionType
- source/target zone
- status type
- prompt type

Do not map by card name unless no generic mechanic exists.
```

## 8. Effect Family to Board Logic Mapping

Use `effectActionCatalog.ts` as the source index. It already groups effect action types by family/support/route.

Every family should eventually have:

1. Engine handler route.
2. Prompt/affordance behavior.
3. Board event behavior.
4. Animation behavior.
5. QA checklist.

### 8.1 Movement / Removal

Action examples:

```text
DESTROY_MAGIC
DESTROY_MAGIC_CARDS
DESTROY_ALL_MAGIC
DESTROY_CARD
DESTROY_SELF
SEND_TO_CEMETERY
RETURN_TO_HAND
RETURN_TO_DECK
MOVE_CARD
MOVE_CARDS
SEARCH_DECK_TO_HAND
DISCARD_CARD
DISCARD_CARDS
FORCE_DISCARD
```

Plan:

```text
Engine:
- Use cardMovement.ts / fieldRemoval.ts.
- Always emit structured fromZoneRef/toZoneRef.
- Include sourceEffectId and actionType.

Affordance:
- Highlight valid source cards/zones.
- Highlight valid targets.
- Highlight cost cards separately from effect targets.

Board events:
- CARD_MOVED
- CARD_DESTROYED
- CARD_DISCARDED
- CARD_RETURNED_TO_HAND
- CARD_RETURNED_TO_DECK

Animations:
- Move card to target zone.
- Destroy/fade/shatter for destroyed cards.
- Deck search fan/flash for SEARCH_DECK_TO_HAND.
- Cost discard uses distinct COST glow before movement.
```

### 8.2 Summon / Limited Summon / Anchor

Action examples:

```text
SUMMON_FROM_HAND
SUMMON_FROM_DECK
SUMMON_FROM_CEMETERY
LIMITED_SUMMON
SUMMON_LIMITED_CREATURE
SUMMON_LIMITED_CREATURE_FROM_HAND
SUMMON_LIMITED_CREATURE_FROM_DECK
SUMMON_LIMITED_CREATURE_FROM_CEMETERY
SUMMON_LIMITED_CREATURE_AND_EQUIP
SUMMON_FROM_CEMETERY_AND_EQUIP
DESTROY_LINKED_SUMMONED_CREATURE
RETURN_LINKED_SUMMON
APPLY_SOURCE_LINKED_CLEANUP
```

Plan:

```text
Engine:
- Reuse existing limited summon/cardMovement logic.
- Emit anchor/source-link events when source-linked cleanup is registered.
- Emit cleanup event when source leaves and linked summon leaves.

Affordance:
- Highlight valid creature source cards.
- Highlight valid Limited Summon slot.
- For replacement, highlight valid primary replacement options.

Board events:
- CREATURE_SUMMONED_PRIMARY
- CREATURE_SUMMONED_LIMITED
- MAGIC_ATTACHED
- ANCHOR_LINK_CREATED
- SOURCE_LINK_CLEANUP_TRIGGERED
- CARD_DESTROYED reason ANCHOR_CLEANUP

Animations:
- Creature moves from hand/deck/cemetery to Limited slot.
- Source Magic attaches/slides under linked creature.
- Anchor link visual appears.
- On source removal, linked creature fades/destroys and moves to cemetery.
```

### 8.3 Equip / Attachment

Action examples:

```text
ATTACH_CARD
EQUIP_FROM_DECK
STEAL_EQUIP
MAGIC_ATTACHED
CONVERT_CREATURE_TO_EQUIP_ON_DEATH
ATTACH_CARDS_UNDER_SOURCE
ATTACH_NAMED_CARD_UNDER_SOURCE
```

Plan:

```text
Engine:
- Standardize attachedToInstanceId, attachedUnder, and source links.
- Emit attach/detach events.

Affordance:
- Highlight valid equip target creatures.
- Highlight valid equip source card if choosing from hand/deck/cemetery.

Board events:
- MAGIC_ATTACHED
- CARD_ATTACHED
- CARD_DETACHED

Animations:
- Magic card moves beneath/near creature.
- Creature-to-equip conversion uses card transform/slide under attacker.
- Steal equip moves attachment from old target/controller to new target/controller.
```

### 8.4 Damage / Heal

Action examples:

```text
DAMAGE
DEAL_INSTANT_DAMAGE
DEAL_PERCENTAGE_DAMAGE
APPLY_DAMAGE_OVER_TIME
APPLY_ATTACK_DAMAGE_MULTIPLIER
APPLY_DAMAGE_MULTIPLIER_AURA
HEAL
HEAL_CREATURE
APPLY_HEALING_OVER_TIME
APPLY_REGENERATING_HEAL
HEAL_BY_DAMAGE_DEALT
ROLL_AND_DAMAGE
ROLL_AND_HEAL
```

Plan:

```text
Engine:
- All HP changes should emit amount, damage/heal type, sourceEffectId, sourceCardInstanceId.
- DOT/HOT should emit both STATUS_APPLIED/RECURRING_REGISTERED and tick events.

Affordance:
- Highlight valid damage/heal target.
- Show no valid target cleanly if none.

Board events:
- CARD_DAMAGED
- CARD_HEALED
- STATUS_APPLIED for DOT/HOT
- STATUS_REMOVED when duration expires

Animations:
- Damage flash + number.
- Heal glow + number.
- DOT/HOT status chip.
- Percentage damage should show calculated damage amount, not just percent text.
```

### 8.5 Stat / Dice Modifiers

Action examples:

```text
APPLY_STAT_MODIFIER
APPLY_DYNAMIC_STAT_MODIFIER
APPLY_MULTI_MODIFIER
APPLY_DICE_MODIFIER
APPLY_CONDITIONAL_DICE_MODIFIER
APPLY_DICE_LIMIT
APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT
APPLY_STAT_SET_AURA
APPLY_SOURCE_LINKED_STAT_SET_AURA
CHANGE_AL
SET_STAT
COPY_BASE_STATS
```

Plan:

```text
Engine:
- Keep modifierLayers/effectiveStats as source of truth.
- Emit modifier applied/removed events for active runtime effects.
- Include affected stats and display deltas.

Affordance:
- Highlight valid stat-mod target.
- For equip/aura modifiers, show persistent status/attachment.

Board events:
- STAT_MODIFIER_APPLIED
- STAT_MODIFIER_REMOVED
- STATUS_APPLIED if modifier is represented as status

Animations:
- Small stat chips on card.
- AL/SPD/ATK/MOD pulse when modified.
- Dice icon pulse for dice modifiers.
```

### 8.6 Status / Restriction / Immunity

Action examples:

```text
APPLY_STATUS
APPLY_STATUS_WITH_ESCAPE_ROLL
APPLY_PLAY_RESTRICTION
PREVENT_CARD_PLAY
APPLY_OPPONENT_MAGIC_PLAY_LOCK
APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION
APPLY_MAGIC_IMMUNITY
APPLY_EFFECT_IMMUNITY
APPLY_IMMUNITY
UNAFFECTED_BY_MAGIC
UNAFFECTED_BY_CREATURE_EFFECTS
NEGATE_CREATURE_EFFECTS
FIELD_STATIC_CREATURE_EFFECT_NEGATE
ACTIVATION_WINDOW_CREATURE_EFFECT_NEGATE
```

Plan:

```text
Engine:
- Use activeEffectInstances / creatureEffectSuppression / actionGuards.
- Statuses and restrictions need explicit active effect records.
- Turn-conditional effects must emit applied/paused/resumed/removed events.

Affordance:
- Disable illegal cards/actions with reason.
- Show creature effect suppression visually.
- Show immune/unaffected cards with shield visual, not as target-disabled unless the engine says target is illegal.

Board events:
- STATUS_APPLIED
- STATUS_REMOVED
- PLAYER_LOCK_APPLIED
- PLAYER_LOCK_REMOVED
- CREATURE_EFFECT_SUPPRESSED
- CREATURE_EFFECT_RESTORED

Animations:
- Lock icon on player side.
- Suppression overlay on affected creature.
- Immunity shield on unaffected creature.
```

### 8.7 Magic Chain / Lightning / Negate

Action examples:

```text
NEGATE_MAGIC_EFFECT
NEGATE_CARD_EFFECT
NEGATE_CREATURE_EFFECT
NEGATE_MAGIC_AND_SEND_TO_CEMETERY
WHEN_OPPONENT_PLAYS_MAGIC
WHEN_OPPONENT_PLAYS_LIGHTNING
CANNOT_BE_NEGATED
STEAL_MAGIC_CARD
FORCE_PLAY_STOLEN_CARD
```

Plan:

```text
Engine:
- magicChainActions.ts remains authoritative.
- Chain priority must expose who can respond.
- Legal Lightning responses must be filtered by trigger/condition.
- Cannot-be-negated and steal/play-stolen behavior should be explicit chain events.

Affordance:
- Highlight legal Lightning response cards only for priority player.
- Show disabled reason for own-link response, lockout, wrong timing, invalid condition.
- Chain pass/resolve actions visible as board affordances.

Board events:
- CHAIN_LINK_ADDED
- CHAIN_PRIORITY_PASSED
- CHAIN_LINK_NEGATED
- CHAIN_LINK_RESOLVED
- MAGIC_STOLEN
- STOLEN_MAGIC_PLAYED
- STOLEN_MAGIC_SENT_TO_CEMETERY

Animations:
- Card moves hand -> chain.
- Lightning response glow.
- Negated card breaks/fades.
- Resolved card pulses then moves to destination.
```

### 8.8 Battle / Battle Response

Action examples:

```text
APPLY_ATTACK_DAMAGE_MULTIPLIER
APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER
APPLY_ATTACK_PRIORITY_OVERRIDE
NEGATE_ATTACK_DAMAGE
PREVENT_ATTACK_DAMAGE
FORCE_BATTLE
FORCE_ATTACK
PREVENT_ATTACK
REROLL_DICE
APPLY_REROLL_PERMISSION
APPLY_PRE_BATTLE_ROLL_GATE
APPLY_HIT_OUTCOME_OVERRIDE
```

Plan:

```text
Engine:
- battle.ts and battleEffectAdapter.ts remain source of truth.
- Battle-only hand responses bypass normal Magic Chain.
- Current strike must expose valid response windows.
- Damage prevention must be tied to the strike/battle session.

Affordance:
- Highlight valid attackers.
- Highlight valid defenders.
- Highlight battle-only hand responses during the correct strike.
- Disabled reason if card is not playable in battle window.

Board events:
- BATTLE_STARTED
- BATTLE_STRIKE_STARTED
- BATTLE_HIT_ROLLED
- BATTLE_DAMAGE_ROLLED
- BATTLE_DAMAGE_PREVENTED
- BATTLE_DAMAGE_APPLIED
- BATTLE_RESOLVED
- CARD_MOVED reason BATTLE_RESPONSE

Animations:
- Attacker/defender focus.
- Dice roll.
- Hit/miss flash.
- Damage number.
- Shield/prevent animation.
- Battle response card moves hand -> cemetery without entering chain.
```

### 8.9 Turn Cycle / Recurring Timing

Action examples:

```text
DOT
HOT
turn-cycle durations
beginning-of-turn effects
end-of-turn effects
escape rolls
scheduled return
scheduled destroy
source-linked cleanup
```

Plan:

```text
Engine:
- turns.ts should process tick timing and duration cleanup.
- normalizeMatch.ts must initialize any added runtime fields.
- Turn events should include playerId, phase, turnNumber, turnCycleNumber.

Affordance:
- Show locked actions during timing resolution if needed.
- Show effects waiting for next turn/tick.

Board events:
- TURN_STARTED
- TURN_PHASE_CHANGED
- RECURRING_EFFECT_TICKED
- STATUS_REMOVED
- SCHEDULED_EFFECT_RESOLVED

Animations:
- Status countdown chip.
- DOT/HOT tick number.
- Cleanup fade when duration expires.
```

### 8.10 Deck / Hand / Reveal / Search

Action examples:

```text
SEARCH_DECK_TO_HAND
LOOK_AT_TOP_DECK_CARDS
REORDER_DECK_TOP
REVEAL_HAND
DISCARD_CARD
FORCE_DISCARD
TRADE_CARD_WITH_CEMETERY
DRAW_CARDS
DRAW_CARDS_VARIABLE
MILL_CARDS
```

Plan:

```text
Engine:
- Prompt system should handle hidden info correctly.
- Only reveal what the controlled player is allowed to see.
- Deck search prompt must expose valid card options.

Affordance:
- Highlight deck stack.
- Highlight valid selected cards.
- Highlight opponent hand only when reveal effect allows it.
- Disabled/no-target state should resolve cleanly.

Board events:
- PROMPT_OPENED
- CARD_REVEALED
- CARD_MOVED deck -> hand
- CARD_MOVED deck -> cemetery
- CARD_DISCARDED
- HAND_REVEALED
- PROMPT_RESOLVED

Animations:
- Deck glow/fan.
- Reveal overlay.
- Selected card moves to destination.
```

### 8.11 Player / Cemetery HP / Global Effects

Action examples:

```text
ADJUST_CEMETERY_HP
ADD_CEMETERY_HP_ADJUSTMENT
MODIFY_CEMETERY_HP
PLAYER_TARGET_EFFECT
APPLY_SKIP_TURN
RESET_CURRENT_TURN
```

Plan:

```text
Engine:
- Player-level effects should use activeEffectInstances or a dedicated playerEffects field.
- Cemetery HP adjustments should be separate from physical cemetery card movement.

Affordance:
- Highlight affected player side.
- Disable actions for skipped/locked player.

Board events:
- PLAYER_STAT_CHANGED
- CEMETERY_HP_CHANGED
- PLAYER_LOCK_APPLIED
- PLAYER_LOCK_REMOVED
- TURN_SKIPPED

Animations:
- Player side pulse.
- Cemetery HP number change.
- Lock/skipped turn banner.
```

## 9. Effect QA Status Upgrade

Current effect support/catalog data is not proof that every card is fully working. Runtime support means a route exists, not that the exact card has passed QA.

Add three independent QA statuses per effect/card:

```text
engineStatus
boardAffordanceStatus
boardAnimationStatus
```

Values:

```text
UNTESTED
WORKING
PARTIAL
BROKEN
BLOCKED
MANUAL
```

Migration/default rule:

```text
Existing single status values migrate into engineStatus.
boardAffordanceStatus and boardAnimationStatus default to UNTESTED.
Legacy BLOCKED_RUNTIME and BLOCKED_DATA collapse to BLOCKED.
Legacy NEEDS_RULES_REVIEW collapses to MANUAL.
```

Meaning:

```text
engineStatus:
Does the WARD rule/effect resolve correctly?

boardAffordanceStatus:
Does the 3D board show the correct legal cards/zones/targets/costs/responses?

boardAnimationStatus:
Does the 3D board animate the resolved effect clearly and correctly?
```

Examples:

```text
Dragon Tamer:
engineStatus = WORKING
boardAffordanceStatus = WORKING if only valid Dragons highlight from deck prompt
boardAnimationStatus = WORKING if deck search -> selected Dragon -> hand animation works

Silence From The Grave:
engineStatus = WORKING
boardAffordanceStatus = WORKING if discard-cost Magic cards highlight before chain
boardAnimationStatus = WORKING if discard cost, chain entry, destroy all Magic, and lockout all visualize

Minotaur Bodyguard:
engineStatus = WORKING only if it bypasses normal Magic Chain during battle
boardAffordanceStatus = WORKING if it only highlights during the correct battle damage window
boardAnimationStatus = WORKING if it moves hand -> cemetery and shows shield/prevent damage
```

## 10. Implementation Order

### Phase A — Shared contracts

1. Add `packages/shared/src/boardContracts.ts`.
2. Export from `packages/shared/src/index.ts`.
3. Keep old client contracts working.
4. Add no runtime behavior yet.

### Phase B — Board Affordance foundation

1. Add `BoardAffordance` builder.
2. Convert one simple path: `pendingEffectTargetPrompt` target highlights.
3. Convert second path: playable hand card / valid zone highlight.
4. Add tests.

### Phase C — Board Event upgrade

1. Extend `BoardRenderEvent` taxonomy.
2. Keep old string mapping as fallback.
3. Add structured payload mapping for common movement.
4. Add tests for draw, summon, play magic, destroy magic.

### Phase D — Animation Planner

1. Add `BoardAnimationStep`.
2. Add planner for common movement/damage/prompt/chain events.
3. Wire current animation queue to planner output.
4. Keep existing visual behavior.

### Phase E — Effect family integration

1. Movement/removal.
2. Summon/limited/anchor.
3. Equip/attachment.
4. Damage/heal.
5. Stat/dice modifiers.
6. Status/restrictions/immunity.
7. Magic Chain/Lightning.
8. Battle responses.
9. Turn-cycle recurring effects.
10. Deck/hand/reveal/search.
11. Player/cemetery HP effects.

### Phase F — QA model upgrade

1. Add engine/affordance/animation status fields.
2. Update Effect Coverage UI.
3. Update saved status JSON normalization.
4. Add filters for broken affordances and broken animations.

### Phase G — Thin `BoardPreview3D`

1. Move state-to-view code out.
2. Move affordance code out.
3. Move animation planning out.
4. Keep `BoardPreview3D.tsx` as renderer shell.

## 11. First Safe Codex Task

Implement this first:

```text
1. Add packages/shared/src/boardContracts.ts.
2. Add BoardAffordance types.
3. Add a BoardAffordance builder using existing pendingEffectTargetPrompt and action guard data.
4. Convert only one existing board highlight path to use BoardAffordance[].
5. Add/update tests.
6. Do not rewrite BoardPreview3D.
7. Do not change engine legality.
8. Do not remove existing 3D board behavior.
```

## 12. Required Commands

Run after changes:

```powershell
cd C:\Users\brjar\Documents\ward-app

pnpm.cmd cards:check
pnpm.cmd effects:audit
pnpm.cmd check

pnpm.cmd --filter @ward/client check:board-render-adapter
pnpm.cmd --filter @ward/client check:dispatch-guards
pnpm.cmd --filter @ward/client check:board-preview-integration
pnpm.cmd --filter @ward/client check:phase4-qa
```

Restart server:

```powershell
pnpm.cmd --filter @ward/server dev
```

Restart client:

```powershell
pnpm.cmd --filter @ward/client dev
```

## 13. Critical Rules

- Preserve engine ESM `.js` suffixes in relative imports/exports.
- Do not re-monolith `actions.ts`.
- Do not re-monolith `App.tsx`.
- Do not rewrite `BoardPreview3D.tsx` in one large pass.
- Do not move legality into the board renderer.
- Do not add card-name-specific animation branches unless the card is truly unique and documented.
- Update `normalizeMatch.ts` when adding persisted match/player/card fields.
- Keep generated card packs in sync with source card files when changing card data.

## 14. Future Unreal Readiness

Do not add Unreal code now.

But design these concepts so a future Unreal client can consume the same ideas:

- `BoardZoneRef`
- `BoardCardView`
- `BoardAffordance`
- `BoardEvent`
- `BoardAnimationStep`
- board layout data
- card asset ids
- prompt/target model
- effect/actionType mapping

Future Unreal client should be able to:

1. Connect to the same WARD server/API.
2. Receive `MatchState` or a board-facing snapshot.
3. Receive `BoardAffordance[]`.
4. Receive `BoardEventBatch`.
5. Build Unreal card actors/zones from board view data.
6. Implement the same animation primitives using Unreal Actors, Components, Materials, Timelines, UMG, and input actions.

The goal is not direct Three.js-to-Unreal code portability. The goal is rules/effect/animation behavior portability through renderer-neutral contracts.
