# WARD Effect Support Map

This document tracks which parsed card effect types are currently automated.

## Automated / Prompted

| Action Type | Current Support |
|---|---|
| `DESTROY_MAGIC_CARDS` | Target prompt for Magic Slot cards. |
| `SEARCH_DECK_TO_HAND` | Card-selection prompt. Includes Dragon/Undead and basic type filters. |
| `MOVE_CARD` | Supports cemetery-to-hand style movement when mapped by prompt resolver. |
| `SUMMON_LIMITED_CREATURE` | Card-selection prompt from supported source zones. |
| `SUMMON_LIMITED_CREATURE_FROM_HAND` | Card-selection prompt for hand creatures, including Gen2/Gen3 parser output aliases. |
| `LIMITED_SUMMON` | Supported when the parsed text clearly says to summon a creature from hand/deck/cemetery. Non-summon limited-summon rule text still falls back/manual. |
| `SUMMON_LIMITED_CREATURE_AND_EQUIP` | Selects creature, Limited Summons it, then attaches source Magic. |
| `SUMMON_FROM_CEMETERY_AND_EQUIP` | Selects cemetery creature, Limited Summons it, then attaches source Magic. |
| `FORCE_SUMMON_FROM_HAND` | Selects creature from hand and Limited Summons it. |
| `PAY_DISCARD_MAGIC_COST` | Prompts for Magic card in hand and discards it. |
| `PAY_DISCARD_COST` | Prompts for a hand card and discards it. |
| `DISCARD_CARD` / `DISCARD_CARDS` / `FORCE_DISCARD` | Basic hand discard prompt support. |
| `DRAW_CARDS` | Auto-resolves when amount can be parsed. |
| `APPLY_STAT_MODIFIER` | Supports some equipped/stat modifier flows; unsupported variants fall back to manual. |

## Trigger Support

| Trigger | Current Support |
|---|---|
| `ON_PLAY` / immediate effects | Resolved during chain resolution. |
| `ON_CARD_REMOVED_FROM_FIELD` | Used for cleanup such as Helping Hand linked Limited Summon destruction. |

## Manual Fallback

Anything not listed above should safely create a Pending Magic Effect or log an unsupported effect path instead of crashing.

## Next Targets

- Player-target prompts.
- Opponent hand privacy for discard effects.
- Battle roll modifiers.
- Negation / Lightning response automation.
- More specific deck-search filters.
- Trigger support for `ON_SUMMON`, `ON_DESTROYED`, `TURN_START`, and `TURN_END`.
