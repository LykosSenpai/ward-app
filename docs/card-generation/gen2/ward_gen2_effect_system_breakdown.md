# WARD Gen 2 Effect System Breakdown

Processed **150 cards** and generated **174 atomic effects**.

## Largest effect groups

- Stat Modifier: 23
- Zone Movement: 13
- Limited Summon: 9
- Damage Multiplier: 8
- Healing: 6
- Scaling Modifier: 6
- Negation Rule: 4
- Triggered Damage: 4
- Play Restriction: 4
- Direct Damage: 4
- Status: 4
- Dynamic Stat Modifier: 3
- Status Escape Roll: 3
- Summon Requirement: 3
- Destroy: 3
- Negation: 3
- Equip Requirement: 2
- Once Per Field Negation: 2
- Attack Priority: 2
- Attachment/Linked Cards: 2

## Most common engine action types

- `APPLY_STAT_MODIFIER`: 26
- `APPLY_PLAY_RESTRICTION`: 11
- `APPLY_DYNAMIC_STAT_MODIFIER`: 10
- `APPLY_ATTACK_DAMAGE_MULTIPLIER`: 8
- `APPLY_STATUS_WITH_ESCAPE_ROLL`: 7
- `RETURN_LINKED_SUMMON`: 6
- `SUMMON_LIMITED_CREATURE_FROM_HAND`: 6
- `ROLL_DAMAGE_TABLE`: 6
- `DEAL_INSTANT_DAMAGE`: 5
- `SET_CAN_BE_NEGATED`: 4
- `VALIDATE_SUMMON_REQUIREMENT`: 4
- `HEAL_CREATURE`: 3
- `APPLY_BATTLE_REQUIREMENT`: 3
- `RETURN_LINKED_CARDS`: 3
- `SCHEDULE_RETURN_TO_HAND`: 3
- `DESTROY_MAGIC_CARDS`: 3
- `APPLY_DICE_MODIFIER`: 3
- `SUMMON_LIMITED_CREATURE`: 2
- `DEAL_DAMAGE_ON_DRAW`: 2
- `ADD_ONCE_PER_FIELD_SHIELD`: 2
- `APPLY_ATTACK_PRIORITY_OVERRIDE`: 2
- `ATTACH_CARDS_UNDER_SOURCE`: 2
- `APPLY_DAMAGE_MULTIPLIER_AURA`: 2
- `NEGATE_MAGIC_AND_SEND_TO_CEMETERY`: 2
- `APPLY_DAMAGE_IMMUNITY`: 2
- `APPLY_SOURCE_LINKED_CLEANUP`: 2
- `APPLY_EFFECT_IMMUNITY`: 2
- `APPLY_HIT_OUTCOME_OVERRIDE`: 2
- `APPLY_SACRIFICE_VALUE`: 2
- `DESTROY_SELF`: 2

## Cards flagged for manual review

- 055 The Iron Range
- 061 Abominable Deer Man
- 071 Sonic Screech
- 081 Phoenix Armor

## Next coding step

Start by implementing the reusable functions with the highest counts in `ward_gen2_effect_function_catalog.csv`, then wire response-window cards by `trigger`.
