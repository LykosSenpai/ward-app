# WARD Effect Action Type Audit - 2026-05-05

Generated from `data/cards/src/gen*/`. This is an action-type work queue, not a card-by-card Working confirmation.

## Summary

- Total unique action types: 152
- Supported/cataloged as runtime-supported: 54
- Partial / needs QA or deeper handler: 82
- Manual / needs dedicated resolver: 16

## Action Types

| Support | Count | Action Type | Examples |
|---|---:|---|---|
| MANUAL | 21 | `MANUAL_FALLBACK` | Dark Angel 001-E01<br>Enlightened Soul 003-E01<br>Fazard 010-E01 |
| MANUAL | 4 | `MOVE_CARDS` | Foolish Tricks 086-E01<br>Wrath of the Old Ones 108-E01<br>Judgement 113-E01 |
| MANUAL | 2 | `DRAW_CARDS_VARIABLE` | Wrath of the Old Ones 108-E02<br>The Old One 074-E02 |
| MANUAL | 2 | `HEAL_BY_DAMAGE_DEALT` | Blood of the Bat 029-E01<br>Vampire 097-E01 |
| MANUAL | 2 | `TAKE_CONTROL_AS_LIMITED_SUMMON` | Psychic Toad 132-E01<br>Skeleton Lord 088-E01 |
| MANUAL | 2 | `TRADE_CARD_WITH_CEMETERY` | Frog of Fortune 128-E01<br>Peddling Partridge 129-E01 |
| MANUAL | 1 | `FORCE_PLAY_STOLEN_CARD` | Magic Steal 116-E02 |
| MANUAL | 1 | `HEAL_BY_CEMETERY_EVENT` | The Guide 109-E01 |
| MANUAL | 1 | `HEAL_BY_SENT_CREATURE_HP` | Vampire Lord 084-E02 |
| MANUAL | 1 | `LOOK_AND_REORDER_DECK_TOP` | Hands of Fate 132-E01 |
| MANUAL | 1 | `RESET_CURRENT_TURN` | Hourglass of Time 064-E01 |
| MANUAL | 1 | `RETURN_LINKED_CONTROLLED_CREATURE` | Psychic Toad 132-E02 |
| MANUAL | 1 | `REVEAL_HAND_AND_CHOOSE_CARD` | Watcher in the Wall 099-E01 |
| MANUAL | 1 | `STEAL_EQUIP_CARD` | Thief 086-E01 |
| MANUAL | 1 | `STEAL_MAGIC_CARD` | Magic Steal 116-E01 |
| MANUAL | 1 | `SWAP_PRIMARY_CREATURES` | Turncoat 110-E01 |
| PARTIAL | 13 | `APPLY_PLAY_RESTRICTION` | Eternal Titan 050-E01<br>Cosmic Negation 112-E02<br>Irresistible Love 039-E01 |
| PARTIAL | 10 | `SEND_TO_CEMETERY` | Cybernetic Upgrade 008-E01<br>Hoggan 009-E03<br>Possessed Dummy 021-E04 |
| PARTIAL | 9 | `RETURN_LINKED_SUMMON` | Dark Knight 034-E02<br>Necromancer 076-E02<br>Revival Priest 115-E03 |
| PARTIAL | 7 | `VALIDATE_SUMMON_REQUIREMENT` | Eternal Dragon 020-E01<br>The Creator 092-E01<br>The Old God 141-E01 |
| PARTIAL | 5 | `APPLY_DAMAGE_MULTIPLIER_AURA` | Dragon's Bane 044-E01<br>Holy Water 117-E01<br>Exorcism 037-E01 |
| PARTIAL | 5 | `SCHEDULE_RETURN_TO_HAND` | Junk Scarecrow 066-E02<br>Mysterious Door 119-E03<br>Summoner 044-E02 |
| PARTIAL | 5 | `SUMMON_REQUIREMENT` | Crow 012-E01<br>Owl God 048-E01<br>Deercrow 051-E01 |
| PARTIAL | 4 | `SET_CAN_BE_NEGATED` | Celestial Power 002-E01<br>Creator's Gift 005-E01<br>Hell Hath No Fury 054-E01 |
| PARTIAL | 4 | `UNAFFECTED_BY_MAGIC` | Steam Armor 058-E01<br>Gluttony 083-E02<br>Fog 095-E01 |
| PARTIAL | 3 | `APPLY_BATTLE_REQUIREMENT` | Double Hit 014-E01<br>Double Hit 014-E02<br>Frenzy 117-E01 |
| PARTIAL | 3 | `ATTACH_CARDS_UNDER_SOURCE` | Eternal Dragon 020-E02<br>Great White 020-E02<br>Perfect Shark 021-E02 |
| PARTIAL | 3 | `NEGATE_CREATURE_EFFECTS` | The Iron Range 055-E01<br>Steam Knight Blaster 007-E01<br>Final Form 111-E01 |
| PARTIAL | 3 | `PREVENT_CARD_PLAY` | Hell Authority 019-E01<br>Street Lights 099-E02<br>Sasquatch 113-E02 |
| PARTIAL | 3 | `REROLL_DICE` | Bad Luck Bear 052-E01<br>Winter Griffin 072-E01<br>Advantage 100-E01 |
| PARTIAL | 3 | `RETURN_LINKED_CARDS` | Great White 020-E03<br>Perfect Shark 021-E03<br>Thief 086-E02 |
| PARTIAL | 2 | `ADD_ONCE_PER_FIELD_SHIELD` | Bunnysaurus 013-E01<br>Bunnysaurus 013-E02 |
| PARTIAL | 2 | `APPLY_ATTACK_PRIORITY_OVERRIDE` | Bear Wolf 015-E01<br>Reverse Polarity 107-E01 |
| PARTIAL | 2 | `APPLY_EFFECT_IMMUNITY` | Steam Rex 064-E01<br>Steam Golem 065-E01 |
| PARTIAL | 2 | `APPLY_HIT_OUTCOME_OVERRIDE` | Maniac 068-E01<br>Ring of Extremes 116-E01 |
| PARTIAL | 2 | `APPLY_IMMUNITY` | Ent Tree 047-E01<br>Maniac 068-E02 |
| PARTIAL | 2 | `APPLY_SACRIFICE_VALUE` | Sacrificial Goat 070-E01<br>Subject #4212 093-E01 |
| PARTIAL | 2 | `APPLY_SOURCE_LINKED_CLEANUP` | Abominable Deer Man 061-E02<br>Sleepy Scent 123-E02 |
| PARTIAL | 2 | `APPLY_ZONE_RETURN_RESTRICTION` | Holy Light 063-E02<br>Angel 135-E02 |
| PARTIAL | 2 | `CHANGE_CREATURE_TYPE` | Frost Wyrms 086-E01<br>Demon Blood 096-E01 |
| PARTIAL | 2 | `DEAL_DAMAGE_ON_DRAW` | Absolute Terror 007-E01<br>Life Sap 018-E01 |
| PARTIAL | 2 | `DESTROY_SELF` | Metallic Bone 073-E02<br>Frenzy 117-E02 |
| PARTIAL | 2 | `NEGATE_ATTACK_OR_MAGIC` | Dragon Rage 042-E01<br>Melody of the Deep 053-E01 |
| PARTIAL | 2 | `PREVENT_DAMAGE` | Ooze Weaver 120-E01<br>Eagle Knight 145-E01 |
| PARTIAL | 2 | `REPLACE_ATTACK_PROFILE` | Steam Knight Blaster 007-E02<br>Final Form 111-E02 |
| PARTIAL | 2 | `SUMMON_SELF_AS_LIMITED_CREATURE` | The Squire 121-E01<br>Abominable Deer Man 061-E01 |
| PARTIAL | 1 | `ADD_NEXT_ATTACK_SHIELD` | Wizard 018-E01 |
| PARTIAL | 1 | `ADD_NEXT_MAGIC_SHIELD` | Magic Shield 118-E01 |
| PARTIAL | 1 | `APPLY_BATTLE_LOCK` | A Loving God 021-E01 |
| PARTIAL | 1 | `APPLY_CEMETERY_SEND_COUNTER_MODIFIER` | The Hero 139-E01 |
| PARTIAL | 1 | `APPLY_CONDITIONAL_DAMAGE_IMMUNITY` | Wings of the Beast 101-E02 |
| PARTIAL | 1 | `APPLY_CONDITIONAL_DAMAGE_REDUCTION` | Giant Turtle 130-E01 |
| PARTIAL | 1 | `APPLY_CREATURE_EFFECT_NEGATION` | Mind Sap 084-E01 |
| PARTIAL | 1 | `APPLY_DAMAGE_REDUCTION` | Demonic Turtle 083-E01 |
| PARTIAL | 1 | `APPLY_DAMAGE_TYPE_IMMUNITY` | Swamp Dragon 089-E01 |
| PARTIAL | 1 | `APPLY_FIELD_AURA_MODIFIERS` | Flame of the Infinite 085-E01 |
| PARTIAL | 1 | `APPLY_MAGIC_IMMUNITY` | Heroism 093-E02 |
| PARTIAL | 1 | `APPLY_NEGATION_WINDOW_RESTRICTION` | Heroism 093-E03 |
| PARTIAL | 1 | `APPLY_PERMANENT_CREATURE_FLAG` | Stone Golem 088-E02 |
| PARTIAL | 1 | `APPLY_PRE_BATTLE_ROLL_DEFENSE` | Ranger 080-E01 |
| PARTIAL | 1 | `APPLY_PRE_BATTLE_ROLL_GATE` | Fear 051-E01 |
| PARTIAL | 1 | `APPLY_RECURRING_STAT_MODIFIER` | Zombified 120-E01 |
| PARTIAL | 1 | `APPLY_REROLL_PERMISSION` | Magic Watch 078-E01 |
| PARTIAL | 1 | `APPLY_SKIP_TURN` | Black Dragon 027-E01 |
| PARTIAL | 1 | `APPLY_SOURCE_LINKED_STAT_SET_AURA` | Witch 103-E01 |
| PARTIAL | 1 | `APPLY_START_TURN_HP_LOSS` | Stone Golem 088-E04 |
| PARTIAL | 1 | `APPLY_STAT_AND_DICE_MULTIPLIER` | Forest Demon 137-E02 |
| PARTIAL | 1 | `APPLY_STAT_SET_AURA` | Curse 049-E01 |
| PARTIAL | 1 | `APPLY_STATUS_AURA` | Electroloon 006-E01 |
| PARTIAL | 1 | `APPLY_SUMMON_REQUIREMENT_OVERRIDE` | Raccoon Knight 011-E01 |
| PARTIAL | 1 | `APPLY_TEMPORARY_HIT_OVERRIDE` | Death From Above 036-E01 |
| PARTIAL | 1 | `APPLY_TEMPORARY_STAT_SET` | Unlucky Circumstance 096-E01 |
| PARTIAL | 1 | `APPLY_ZONE_LOCK` | Hourglass of Time 064-E02 |
| PARTIAL | 1 | `APPLY_ZONE_RESTRICTION` | Bound With Chains 077-E01 |
| PARTIAL | 1 | `ATTACH_NAMED_CARD_UNDER_SOURCE` | Terry 151-E01 |
| PARTIAL | 1 | `CLEAR_SOURCE_LINKED_MODIFIERS` | Zombified 120-E02 |
| PARTIAL | 1 | `CONVERT_CREATURE_TO_EQUIP_ON_DEATH` | Forest Demon 137-E01 |
| PARTIAL | 1 | `DESTROY_EQUIPPED_CARDS` | Turncoat 110-E02 |
| PARTIAL | 1 | `DESTROY_IF_NO_DAMAGE_THIS_TURN` | Dragon Power 118-E02 |
| PARTIAL | 1 | `DETACH_ATTACHED_CARDS_TO_FIELD` | Terry 151-E03 |
| PARTIAL | 1 | `FORCE_LIMITED_SUMMONS_TO_BATTLE_PRIMARY` | Ancient One 145-E01 |
| PARTIAL | 1 | `NEGATE_ATTACK_AND_HEAL` | Sentinel of Life 083-E01 |
| PARTIAL | 1 | `NEGATE_ATTACK_AND_REFLECT_DAMAGE` | Forest Sentinel 109-E01 |
| PARTIAL | 1 | `NEGATE_HEALING_AND_CONVERT_TO_DAMAGE` | Poisoned Potion 082-E01 |
| PARTIAL | 1 | `OVERRIDE_SUMMON_SACRIFICE_REQUIREMENT` | Frog Man 087-E01 |
| PARTIAL | 1 | `REFLECT_PREVENTED_DAMAGE` | Demonic Turtle 083-E02 |
| PARTIAL | 1 | `RESOLVE_FIELD_ROLL_OUTCOME` | Forest Fire 122-E01 |
| PARTIAL | 1 | `RESOLVE_STATUS_ESCAPE_ROLL` | Winter Chill 102-E02 |
| PARTIAL | 1 | `RESOLVE_STATUS_TICK` | Kraken 068-E02 |
| PARTIAL | 1 | `RETURN_SELF_TO_DECK_AND_SHUFFLE` | Giant Rat 055-E01 |
| PARTIAL | 1 | `RETURN_SELF_TO_HAND` | Phoenix 144-E01 |
| PARTIAL | 1 | `ROLL_DAMAGE_DICE` | Dragon Fox 041-E01 |
| PARTIAL | 1 | `SEARCH_DECK_TO_EQUIP` | Equip Knight 085-E01 |
| PARTIAL | 1 | `SEND_NAMED_CARD_TO_CEMETERY` | Jester 065-E02 |
| PARTIAL | 1 | `SEND_TO_ORIGINAL_OWNER_CEMETERY` | Magic Steal 116-E03 |
| PARTIAL | 1 | `SET_CARD_TYPE` | The Squire 121-E02 |
| PARTIAL | 1 | `SET_TEMPORARY_CARD_BEHAVIOR` | Mind Sap 084-E02 |
| PARTIAL | 1 | `SUMMON_TO_OPPONENT_SIDE` | Stone Golem 088-E01 |
| SUPPORTED | 80 | `APPLY_STAT_MODIFIER` | Surprise From The Deep 017-E01<br>Ball and Chain 024-E01<br>Demonic Magic 039-E01 |
| SUPPORTED | 33 | `DAMAGE` | Ball Demon 006-E01<br>Hoggan 009-E02<br>Shield of Light 017-E03 |
| SUPPORTED | 23 | `APPLY_ATTACK_DAMAGE_MULTIPLIER` | Hafling 006-E01<br>Orc 012-E01<br>Assassin 022-E01 |
| SUPPORTED | 17 | `MOVE_CARD` | Ghost of the Past 053-E01<br>Holy Light 063-E01<br>Stone Golem 088-E03 |
| SUPPORTED | 11 | `APPLY_DAMAGE_OVER_TIME` | Dire Wolf 002-E01<br>Giant Spider 019-E01<br>Basilisk 025-E01 |
| SUPPORTED | 11 | `APPLY_DYNAMIC_STAT_MODIFIER` | All In One 001-E01<br>Demon Dragon 045-E01<br>Alkonost 046-E02 |
| SUPPORTED | 11 | `DESTROY_MAGIC_CARDS` | Council of the Cosmos 032-E01<br>Demon King 037-E01<br>Dragon Fire 040-E01 |
| SUPPORTED | 10 | `LIMITED_SUMMON` | Hoggan 009-E01<br>Crow 012-E02<br>Possessed Dummy 021-E01 |
| SUPPORTED | 8 | `HEAL` | Repair Bear 004-E01<br>Shield of Light 017-E02<br>Mosquito Man 024-E01 |
| SUPPORTED | 7 | `APPLY_STATUS_WITH_ESCAPE_ROLL` | Electroloon 006-E02<br>Irresistible Love 039-E03<br>Sonic Screech 071-E01 |
| SUPPORTED | 7 | `DEAL_INSTANT_DAMAGE` | Demon Knight 038-E01<br>Jester 065-E01<br>Martial Arts Man 062-E01 |
| SUPPORTED | 6 | `APPLY_DICE_MODIFIER` | Children of the Forest 030-E01<br>Battle Axe 057-E01<br>Battle Axe 057-E02 |
| SUPPORTED | 6 | `DESTROY_MAGIC` | Fire Eleotoid 002-E01<br>Shield of Light 017-E01<br>Orc Magic 041-E01 |
| SUPPORTED | 6 | `ROLL_DAMAGE_TABLE` | Ignitus 050-E01<br>The Alchemist 113-E01<br>Magic Artillery 115-E01 |
| SUPPORTED | 6 | `ROLL_TABLE` | Shield of Light 017-E04<br>The Super Hero 053-E02<br>Steam Angel 057-E01 |
| SUPPORTED | 6 | `SUMMON_LIMITED_CREATURE_FROM_HAND` | Summoner 044-E01<br>Dawn of the Living Chickens 066-E01<br>Wolf Knight 100-E01 |
| SUPPORTED | 5 | `APPLY_STATUS` | Kraken 068-E01<br>Wings of the Beast 101-E01<br>Winter Chill 102-E01 |
| SUPPORTED | 5 | `HEAL_CREATURE` | Health Potion 061-E01<br>Healing Tree 069-E01<br>Bio-Regeneration 009-E02 |
| SUPPORTED | 5 | `NEGATE_ATTACK` | Junk Scarecrow 066-E01<br>Mimic Chest 073-E01<br>Sticky Goo 080-E01 |
| SUPPORTED | 5 | `NEGATE_CARD_EFFECT` | Possessed Dummy 021-E02<br>M.O.O.N. Sgt. 039-E02<br>Orc Mischief 042-E01 |
| SUPPORTED | 5 | `NEGATE_MAGIC_AND_SEND_TO_CEMETERY` | Blade in the Dark 028-E01<br>Goblin Tricks 057-E01<br>Mysterious Door 119-E02 |
| SUPPORTED | 4 | `DESTROY_ALL_MAGIC` | Silence From The Grave 151-E02<br>Adam Bomb 050-E01<br>Gluttony 083-E01 |
| SUPPORTED | 4 | `SHUFFLE_DECK` | Deercrow 051-E02<br>Shuffling Bones 094-E01<br>Close Encounters 131-E02 |
| SUPPORTED | 4 | `SUMMON_LIMITED_CREATURE` | Dark Knight 034-E01<br>Necromancer 076-E01<br>Undead King 004-E01 |
| SUPPORTED | 3 | `DEAL_PERCENTAGE_DAMAGE` | Demonic Magic 039-E03<br>Mimic Chest 073-E02<br>Hell Hath No Fury 054-E02 |
| SUPPORTED | 3 | `SUPPRESS_MODIFIER_LAYER` | Ball and Chain 024-E02<br>Curse 049-E02<br>Zombified 120-E03 |
| SUPPORTED | 2 | `APPLY_CONDITIONAL_DICE_MODIFIER` | Dark Elf 033-E01<br>Glarbstenford 056-E01 |
| SUPPORTED | 2 | `APPLY_DAMAGE_IMMUNITY` | Ghost Form 041-E01<br>Metallic Bone 073-E01 |
| SUPPORTED | 2 | `APPLY_MULTI_MODIFIER` | Epic Loot 048-E01<br>Sword of Light 150-E01 |
| SUPPORTED | 2 | `APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT` | Gnome 134-E01<br>The Heroine 140-E01 |
| SUPPORTED | 2 | `DISCARD_CARD` | Bait 104-E01<br>Negative 109-E02 |
| SUPPORTED | 2 | `DRAW_CARDS` | Dragon Rage 042-E03<br>Twister 105-E02 |
| SUPPORTED | 2 | `FORCE_SUMMON_FROM_HAND` | Foolish Tricks 086-E02<br>Judgement 113-E02 |
| SUPPORTED | 2 | `HEAL_BY_ROLL` | Herbal Poultice 103-E01<br>Cure Minor Wounds 121-E01 |
| SUPPORTED | 2 | `NEGATE_ATTACK_DAMAGE` | Minotaur Bodyguard 016-E01<br>Future Warrior 150-E01 |
| SUPPORTED | 2 | `PAY_CARD_COST` | Vampire Lord 084-E01<br>Wizard Frog 134-E01 |
| SUPPORTED | 2 | `ROLL_FOR_EFFECT` | Blue Dragon 001-E01<br>Minotaur 008-E01 |
| SUPPORTED | 1 | `ADD_CEMETERY_HP_ADJUSTMENT` | Flame of the Infinite 085-E02 |
| SUPPORTED | 1 | `ADJUST_CEMETERY_HP` | Reduce the Burden 125-E01 |
| SUPPORTED | 1 | `APPLY_DICE_LIMIT` | Smokescreen 014-E01 |
| SUPPORTED | 1 | `APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER` | Backstab 023-E01 |
| SUPPORTED | 1 | `APPLY_GLOBAL_CREATURE_EFFECT_NEGATION` | Demonic Magic 039-E02 |
| SUPPORTED | 1 | `APPLY_HEALING_OVER_TIME` | Acolyte 102-E01 |
| SUPPORTED | 1 | `APPLY_OPPONENT_MAGIC_PLAY_LOCK` | Silence From The Grave 151-E03 |
| SUPPORTED | 1 | `APPLY_REGENERATING_HEAL` | Troll Regeneration 107-E01 |
| SUPPORTED | 1 | `APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION` | Silence From The Grave 151-E04 |
| SUPPORTED | 1 | `DESTROY_LINKED_SUMMONED_CREATURE` | Helping Hand 114-E02 |
| SUPPORTED | 1 | `HEAL_TO_FULL` | Epic Loot 048-E02 |
| SUPPORTED | 1 | `NEGATE_LIGHTNING_AND_SEND_TO_CEMETERY` | Scroll of Silence 130-E02 |
| SUPPORTED | 1 | `PAY_DAMAGE_COST` | Mysterious Door 119-E01 |
| SUPPORTED | 1 | `PAY_DISCARD_MAGIC_COST` | Silence From The Grave 151-E01 |
| SUPPORTED | 1 | `SEARCH_DECK_TO_HAND` | Dragon Tamer 015-E01 |
| SUPPORTED | 1 | `SUMMON_FROM_CEMETERY_AND_EQUIP` | Revival Priest 115-E01 |
| SUPPORTED | 1 | `SUMMON_LIMITED_CREATURE_AND_EQUIP` | Helping Hand 114-E01 |
