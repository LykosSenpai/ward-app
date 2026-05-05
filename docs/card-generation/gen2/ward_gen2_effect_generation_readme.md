# WARD Gen 2 Effect Generation Outputs

This package turns the current Gen 2 card library CSV into engine-ready effect data using the same output shape as the Gen 1 files.

## Files

- `ward_gen2_effects_engine_ready.csv`: one row per atomic effect/action. Best for review and filtering in Excel.
- `ward_gen2_cards_engine_ready.csv`: one row per card with normalized magic type/subtype and a full card definition JSON column.
- `ward_gen2_effects_engine_ready.json`: app-ready card definitions with global rules and effect arrays.
- `ward-gen2.json`: package-style Gen 2 card library matching the Gen 1 package format.
- `ward_engine_global_rules_gen2.json`: shared rules constants used for Gen 2 generation.
- `ward_gen2_effect_breakdown_atomic.csv`: compact human-review list of atomic effects.
- `ward_gen2_effect_coverage.csv`: per-card coverage and review flags.
- `ward_gen2_effect_function_catalog.csv`: unique reusable function/action handler list.
- `ward_gen2_effect_system_breakdown.md`: summary of effect families and implementation notes.
- `generate_ward_gen2_effects_from_csv.py`: rerunnable generator.

## Generation summary

- Cards processed: 150
- Cards with effect text: 122
- Cards with generated effect arrays: 122
- Atomic effects generated: 174
- Atomic effects marked for manual review: 4

## Important modeling decisions

- `maxArmorLevel`: 12
- `baseHitDice`: 2
- `halfRoundingMode`: CEIL
- `turnCycleDefinition`: One full round back to the same player; starts at the beginning of a player's turn.
- `durationExpirationDefault`: Beginning of the start player's turn after the specified turn cycles complete.
- `limitedSummonMaxPerSide`: 4
- `limitedSummonsCannotReceiveHpDamage`: True
- `limitedSummonsLoseCreatureEffects`: True
- `limitedSummonsCannotBeSacrificed`: True

## Manual review notes

Review rows where `needs_manual_review = TRUE` before wiring final handlers. These are mostly cards where the physical text implies a nonstandard card-state behavior, has a timing ambiguity, or turns a magic card into a Limited Summon without normal creature stat boxes.
