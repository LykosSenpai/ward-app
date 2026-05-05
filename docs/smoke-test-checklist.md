# WARD App Smoke Test Checklist

Run this after refactors or effect-engine changes.

## Startup

- [ ] `pnpm.cmd check` passes.
- [ ] `pnpm.cmd --filter @ward/server dev` starts without errors.
- [ ] `pnpm.cmd --filter @ward/client dev` starts without errors.
- [ ] Browser opens `http://localhost:5173`.

## Basic Match Flow

- [ ] Create a 1v1 match.
- [ ] Shuffle both decks.
- [ ] Draw initial hand.
- [ ] Summon a primary creature.
- [ ] Advance phases without unexpected blocks.
- [ ] Save match.
- [ ] Load saved match.
- [ ] Delete saved match.

## Existing Automated Effects

- [ ] Council of the Cosmos prompts for Magic Slot target and destroys selected Magic.
- [ ] Dragon Tamer prompts only Dragon-name or Dragon-type cards from deck and moves selected card to hand.
- [ ] Ghost of the Past prompts for a cemetery creature and moves selected card to hand.
- [ ] Helping Hand prompts for a hand creature, Limited Summons it, and auto-attaches.
- [ ] Destroying Helping Hand destroys the linked Limited Summon.

## Manual Fallback

- [ ] Unsupported parsed effects create a Pending Magic Effect instead of crashing.
- [ ] Manual damage/heal/stat modifier controls still work.
- [ ] Completing a manual effect clears it from the pending list.

## Regression Watch List

- [ ] No blank screen after creating a match.
- [ ] No `uuidv4 is not defined` errors.
- [ ] No CSS `Unclosed block` or `Unexpected }` errors.
- [ ] No `@ward/engine does not provide export` errors.
