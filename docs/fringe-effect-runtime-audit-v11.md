# Fringe Effect Runtime Audit Patch v11
This audit was generated from the current uploaded project zip and the card packs in `data/cards/packs`. It is not a claim that every individual card has been fully QA-tested; it identifies the repeated fringe-effect groups and adds generic runtime routes for the highest-reuse groups.
## Patch scope
- Added generic target/prompt support for `DESTROY_MAGIC`, `DESTROY_ALL_MAGIC`, D6 roll-table damage/heal effects, and roll-total healing.
- Added `APPLY_DAMAGE_IMMUNITY` prompt/status support and HP-damage immunity status flag support with battle and immediate effect damage prevention.
- Extended status parsing for damage immunity, control lock, and field-removal lock labels/flags. Control/field locks are tracked but still need dedicated enforcement where cards attempt control/removal.
- Updated Gen1 Minotaur from split `MANUAL_REVIEW` effects to a single `ROLL_FOR_EFFECT` on-hit effect, matching the Blue Dragon pattern with success on 5-6.
- Multi-effect Magic cards now resolve automatic effects and create the first available target prompt instead of pushing every parsed effect directly to manual fallback. Remaining effects still queue when the engine cannot safely sequence multiple prompts yet.
## Pack summary
### ward-gen1.json
- Cards: 151
- Parsed atomic effects: 170
- Effects still marked manual/review: 9
- Most common action types:
  - `APPLY_STAT_MODIFIER`: 17
  - `APPLY_ATTACK_DAMAGE_MULTIPLIER`: 9
  - `DESTROY_MAGIC_CARDS`: 9
  - `MOVE_CARD`: 9
  - `APPLY_DAMAGE_OVER_TIME`: 8
  - `VALIDATE_SUMMON_REQUIREMENT`: 3
  - `SUPPRESS_MODIFIER_LAYER`: 3
  - `NEGATE_MAGIC_AND_SEND_TO_CEMETERY`: 3
  - `RETURN_LINKED_SUMMON`: 3
  - `APPLY_PLAY_RESTRICTION`: 3
  - `APPLY_STATUS`: 3
  - `MOVE_CARDS`: 3
### ward-gen2.json
- Cards: 150
- Parsed atomic effects: 175
- Effects still marked manual/review: 4
- Most common action types:
  - `APPLY_STAT_MODIFIER`: 25
  - `APPLY_PLAY_RESTRICTION`: 11
  - `APPLY_DYNAMIC_STAT_MODIFIER`: 10
  - `APPLY_ATTACK_DAMAGE_MULTIPLIER`: 8
  - `APPLY_STATUS_WITH_ESCAPE_ROLL`: 7
  - `RETURN_LINKED_SUMMON`: 6
  - `SUMMON_LIMITED_CREATURE_FROM_HAND`: 6
  - `ROLL_DAMAGE_TABLE`: 6
  - `APPLY_DICE_MODIFIER`: 5
  - `DEAL_INSTANT_DAMAGE`: 5
  - `SET_CAN_BE_NEGATED`: 4
  - `VALIDATE_SUMMON_REQUIREMENT`: 4
### ward-gen3.json
- Cards: 151
- Parsed atomic effects: 189
- Effects still marked manual/review: 159
- Most common action types:
  - `APPLY_STAT_MODIFIER`: 38
  - `DAMAGE`: 34
  - `MANUAL_FALLBACK`: 21
  - `SEND_TO_CEMETERY`: 10
  - `LIMITED_SUMMON`: 10
  - `HEAL`: 8
  - `APPLY_ATTACK_DAMAGE_MULTIPLIER`: 7
  - `DESTROY_MAGIC`: 6
  - `MOVE_CARD`: 6
  - `ROLL_TABLE`: 6
  - `SUMMON_REQUIREMENT`: 5
  - `NEGATE_CARD_EFFECT`: 5

## New/expanded generic runtime groups
- `APPLY_DAMAGE_OVER_TIME`
- `APPLY_HEALING_OVER_TIME`
- `APPLY_HEAL_OVER_TIME`
- `APPLY_STATUS`
- `APPLY_STATUS_WITH_ESCAPE_ROLL`
- `APPLY_STAT_MODIFIER`
- `DAMAGE`
- `DAMAGE_CREATURE`
- `DEAL_INSTANT_DAMAGE`
- `DESTROY_ALL_MAGIC`
- `DESTROY_MAGIC`
- `DESTROY_MAGIC_CARDS`
- `HEAL`
- `HEAL_BY_ROLL`
- `HEAL_CREATURE`
- `ROLL_AND_DAMAGE`
- `ROLL_AND_HEAL`
- `ROLL_DAMAGE_TABLE`
- `ROLL_FOR_EFFECT`
- `ROLL_TABLE`

## Remaining high-risk unsupported groups
- `APPLY_ATTACK_DAMAGE_MULTIPLIER`: 24
- `MOVE_CARD`: 17
- `APPLY_PLAY_RESTRICTION`: 14
- `APPLY_DYNAMIC_STAT_MODIFIER`: 10
- `SEND_TO_CEMETERY`: 10
- `LIMITED_SUMMON`: 10
- `RETURN_LINKED_SUMMON`: 9
- `VALIDATE_SUMMON_REQUIREMENT`: 7
- `APPLY_DICE_MODIFIER`: 6
- `SUMMON_LIMITED_CREATURE_FROM_HAND`: 6
- `NEGATE_MAGIC_AND_SEND_TO_CEMETERY`: 5
- `NEGATE_ATTACK`: 5
- `SCHEDULE_RETURN_TO_HAND`: 5
- `SUMMON_REQUIREMENT`: 5
- `NEGATE_CARD_EFFECT`: 5
- `UNAFFECTED_BY_MAGIC`: 5
- `SUMMON_LIMITED_CREATURE`: 4
- `APPLY_DAMAGE_MULTIPLIER_AURA`: 4
- `MOVE_CARDS`: 4
- `SET_CAN_BE_NEGATED`: 4
- `SHUFFLE_DECK`: 4
- `ATTACH_CARDS_UNDER_SOURCE`: 3
- `SUPPRESS_MODIFIER_LAYER`: 3
- `DEAL_PERCENTAGE_DAMAGE`: 3
- `APPLY_BATTLE_REQUIREMENT`: 3
- `RETURN_LINKED_CARDS`: 3
- `NEGATE_CREATURE_EFFECTS`: 3
- `PREVENT_CARD_PLAY`: 3
- `REROLL_DICE`: 3
- `NEGATE_ATTACK_DAMAGE`: 2
- `HEAL_BY_DAMAGE_DEALT`: 2
- `APPLY_CONDITIONAL_DICE_MODIFIER`: 2
- `NEGATE_ATTACK_OR_MAGIC`: 2
- `DRAW_CARDS`: 2
- `APPLY_IMMUNITY`: 2
- `APPLY_MULTI_MODIFIER`: 2
- `APPLY_ZONE_RETURN_RESTRICTION`: 2
- `FORCE_SUMMON_FROM_HAND`: 2
- `DRAW_CARDS_VARIABLE`: 2
- `SUMMON_SELF_AS_LIMITED_CREATURE`: 2
- `TAKE_CONTROL_AS_LIMITED_SUMMON`: 2
- `APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT`: 2
- `DEAL_DAMAGE_ON_DRAW`: 2
- `ADD_ONCE_PER_FIELD_SHIELD`: 2
- `APPLY_ATTACK_PRIORITY_OVERRIDE`: 2
- `APPLY_DAMAGE_IMMUNITY`: 2
- `APPLY_SOURCE_LINKED_CLEANUP`: 2
- `APPLY_EFFECT_IMMUNITY`: 2
- `APPLY_HIT_OUTCOME_OVERRIDE`: 2
- `APPLY_SACRIFICE_VALUE`: 2
- `DESTROY_SELF`: 2
- `PAY_CARD_COST`: 2
- `TRADE_CARD_WITH_CEMETERY`: 2
- `REPLACE_ATTACK_PROFILE`: 2
- `CHANGE_CREATURE_TYPE`: 2
- `DISCARD_CARD`: 2
- `PREVENT_DAMAGE`: 2
- `APPLY_DICE_LIMIT`: 1
- `SEARCH_DECK_TO_HAND`: 1
- `ADD_NEXT_ATTACK_SHIELD`: 1

## Clarification backlog
These need rules/card-specific answers before I would hard-automate them:
1. Control-steal effects: when a stolen primary/limited creature leaves the field, does it go to owner cemetery, controller cemetery, or card text destination?
2. Field-removal locks: does “cannot be removed from the field unless killed” stop sacrifice, return-to-hand/deck, control switch, and destroy effects, or only opponent card effects?
3. Multi-effect card sequencing: should every parsed effect resolve strictly in text order even when one step needs a player choice, or may automatic effects resolve before prompts when independent?
4. Roll-table effects with branch outcomes that are not flat damage/heal: should every branch get its own modal session like Effect Roll, or should they go to manual queue after the roll?
