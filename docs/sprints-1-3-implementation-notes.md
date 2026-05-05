# WARD App Sprints 1-3 Implementation Notes

## Sprint 1 - Battle resolver stabilization

Implemented a battle effect suggestion bridge that scans active field state and pre-fills manual battle resolver modifiers where possible.

Key files:

- `packages/engine/src/battleEffectAdapter.ts`
- `packages/engine/src/battle.ts`
- `packages/shared/src/index.ts`
- `apps/client/src/components/BattleResolverModal.tsx`

The resolver now surfaces detected battle-relevant effects from:

- primary creatures
- limited summons
- magic slots
- attached equip cards
- active stat modifiers

Suggested modifiers include speed deltas, hit dice, hit flat bonus, damage dice, damage flat bonus, damage multipliers, forced hit/miss, and damage prevention. Suggestions are prefilled as defaults but remain manually editable before rolling.

Limited Summon promotion was also stabilized. If a primary creature dies and that player has exactly one Limited Summon, that Limited Summon is automatically promoted to primary, its creature effects are restored, and combat still ends because a primary creature was killed. If multiple Limited Summons are available, the existing promotion UI remains available while the player is in primary replacement state.

## Sprint 2 - Battle timing trigger foundation

Added battle timing trigger detection to the engine.

Key files:

- `packages/engine/src/triggers.ts`
- `packages/engine/src/battle.ts`

Supported timing checkpoints:

- `WHEN_BATTLE_DECLARED`
- `BEFORE_SPEED_CHECK`
- `BEFORE_HIT_ROLL`
- `AFTER_HIT_ROLL`
- `ON_HIT`
- `ON_HIT_FIRST`
- `ON_MISS`
- `BEFORE_DAMAGE_ROLL`
- `DURING_DAMAGE_CALC`
- `AFTER_DAMAGE_APPLIED`
- `WHEN_CREATURE_KILLED_IN_BATTLE`
- `END_OF_COMBAT_PHASE`

Current behavior logs detected battle timing effects as `BATTLE_TIMING_TRIGGER_DETECTED` events. This gives the app a safe trigger foundation without prematurely hardcoding every WARD card effect. Effects that are not yet safely automated still remain visible in the battle UI or event log for manual handling.

## Sprint 3 - Magic chain priority refactor

Refactored the Magic Chain state to use explicit response priority.

Key files:

- `packages/shared/src/index.ts`
- `packages/engine/src/magicChainActions.ts`
- `packages/engine/src/normalizeMatch.ts`
- `apps/client/src/components/MagicChainCard.tsx`
- `apps/client/src/components/PlayerPanel.tsx`

Rules now enforced:

- the player who played the latest chain link cannot respond to their own link
- the opponent of the latest chain link receives response priority
- when a Lightning response is added, priority flips back to the other player
- old saved chains are normalized with priority fields when loaded

The current resolve button still resolves the chain when priority is passed/no response is taken. Reverse-order resolution and prototype Lightning negation behavior remain intact.

## Validation performed in this environment

The following checks were run successfully:

```powershell
node tools/check-project-files.mjs
node tools/check-css-braces.mjs
node tools/check-engine-exports.mjs
```

Full `pnpm.cmd check` and TypeScript package checks should still be run on the user's Windows machine because this container does not have the project dependencies installed.

Recommended local validation:

```powershell
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd install
pnpm.cmd check
pnpm.cmd --filter @ward/server dev
pnpm.cmd --filter @ward/client dev
```

Focused smoke test:

1. Create a match.
2. Shuffle both decks.
3. Complete first-turn setup for both players.
4. Reach Combat Phase.
5. Start a manual battle.
6. Confirm detected effects show in the battle resolver.
7. Run speed check, hit roll, damage roll, and apply damage.
8. Kill a primary while exactly one Limited Summon is available and confirm auto-promotion occurs while combat still ends.
9. Start a Magic Chain and confirm only the priority player can play a Lightning response.
10. Resolve the chain and verify reverse-order resolution still works.
