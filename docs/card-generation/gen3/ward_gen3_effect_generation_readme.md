# WARD TCG Gen 3 — Engine-Ready Effect Package

Generated from user-provided Generation 3 card images and one user-provided table row for card 069.

## Edition / Generation

- Generation: 3
- Edition: 1st Edition
- Main numbered set: 001-150
- Bonus card included: 151/150 Eagle Family

## Generated summary

- Cards processed: 151
- Main set cards: 150
- Bonus cards: 1
- Cards with generated effect arrays: 127
- Atomic effects generated: 189
- Cards marked for manual review: 103
- Unique reusable functions: 25

## Output files

- `ward_gen3_1st_edition_card_library_combined.csv` — normalized card metadata and raw effect text.
- `ward_gen3_effects_engine_ready.csv` — one row per atomic generated effect.
- `ward_gen3_cards_engine_ready.csv` — one row per card with embedded cardDefinitionJson.
- `ward_gen3_effects_engine_ready.json` — engine-ready card definitions with effect arrays.
- `ward-gen3.json` — pack-level JSON similar to Gen 1 / Gen 2 app packs.
- `ward_engine_global_rules.json` and `ward_engine_global_rules_gen3.json` — global rule constants used while parsing.
- `ward_gen3_effect_coverage.csv` — per-card effect coverage and review flags.
- `ward_gen3_effect_function_catalog.csv` — unique reusable effect functions/action handlers needed.
- `ward_gen3_effect_breakdown_atomic.csv` — compact atomic effect review table.
- `generate_ward_gen3_effects_from_csv.py` — rerunnable generator script for the generated combined CSV.

## Modeling notes

- `Atk` and `Modifier` are separate. `Atk` maps to attack damage bonus only; `Modifier` applies to Hit Roll and Attack Damage Roll.
- Half values use `CEIL` rounding.
- Field card detection is separate from Standard/Infinite/Lightning magic timing.
- Limited Summon effects are flagged with `usesAnchoring` and source-linked cleanup when the card text ties the summon to a source card, effect negation, or field-leave condition.
- Complex cards are intentionally marked for manual review instead of forcing unsupported exact automation.
- Hybrid creature/magic cards are preserved as creature card definitions when they have creature stats, with notes explaining the hybrid behavior.

## High-priority manual review cards

Cards with custom engine work include: 006, 007, 009, 017, 021, 026, 028, 037, 049, 051, 062, 064, 074, 083, 095, 099, 103, 111, 115, 118, 120, 137, 146, 149, 150, 151.

## Integration note

For the current app, copy `ward-gen3.json` into:

```text
data/cards/packs/ward-gen3.json
```

Then make sure the server card pack loader includes the file or detects all pack JSON files dynamically.
