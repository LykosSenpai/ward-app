# Promo Card Intake - 2026-05-19

Added a standalone promo pack to keep promotional/pre-order/boss cards separate from the normal Gen 1, Gen 2, and Gen 3 packs.

## Pack

```text
data/cards/src/promos/_pack.json
data/cards/packs/ward-promos.json
```

## Current promo cards

| # | Card | Kind | Type/Subtype | Effects | Runtime note |
|---:|---|---|---|---:|---|
| 001 | Aqua Dragon | Creature | Dragon | 1 | Conditional Atk Dice Rolls +2 modeled. |
| 002 | Arcturus | Creature | Humanoid | 1 | Needs non-base damage reducer QA. |
| 003 | Artist Eg’Toroth | Creature | Demon | 0 | No visible rules text beyond attack profile. |
| 004 | Cosmic Storm | Magic | Infinite Field | 1 | Needs all-player turn-start roll automation. |
| 005 | Cryovore | Creature | Bug | 2 | Choice effect needs activated-choice routing. |
| 006 | Denraa The Bull | Creature | Beast | 0 | No visible rules text beyond attack profile. |
| 007 | Dragon of Time | Creature | Dragon | 4 | Activated D6 roll table branches modeled. |
| 008 | Ghul'Vok | Creature | Beast | 2 | Full Moon summon/cleanup needs named-card runtime QA. |
| 009 | God Killer Brox | Creature | Humanoid | 1 | Conditional 4x damage against effective AL 12 modeled. |
| 010 | Hell Walker | Creature | Humanoid | 2 | Demon damage multiplier modeled; Magic lock needs guard QA. |
| 011 | Lord Marshal Goroth | Creature | Beast | 0 | No visible rules text beyond attack profile. |
| 012 | Luc Tiberius | Creature | Humanoid | 1 | Needs hit-dice-match battle metadata QA. |
| 013 | Maximum Ward | Magic | Infinite Field | 1 | Needs all-player matching-roll field wipe resolver. |
| 014 | Moon Owl | Creature | Beast | 3 | Removal-to-equip replacement and equipped-creature cleanup need QA. |
| 015 | Nadara | Creature | Humanoid | 1 | Alternate attack profile modeled. |
| 016 | Omega Titan | Creature | Cosmic | 2 | Roll-gated damage prevention and Magic lock need QA. |
| 017 | Perseus Valenthil | Creature | Humanoid | 2 | Roll-gated damage immunity and self Magic lock need QA. |
| 018 | Rampage Orc | Creature | Humanoid | 0 | No visible rules text beyond attack profile. |
| 019 | Scarlett | Creature | Humanoid | 2 | Hit-dice-match requirement needs battle metadata QA; AL increase suppression modeled. |
| 020 | Sweet-Tooth | Creature | Cosmic | 0 | No visible rules text beyond attack profile. |
| 021 | Ward United | Magic | Infinite Field | 1 | Sacrifice-value transfer needs summon-pipeline QA. |
| 022 | Zanj the Hunter | Creature | Humanoid | 2 | Base-AL reduction and opponent AL increase suppression modeled. |

## Totals

- 22 promo cards
- 29 atomic effects
- 22 promo card images

## Review items

The following promo effects were intentionally marked `needsReview: true` because they need runtime handlers or targeted QA:

```text
Arcturus non-base damage filtering
Cosmic Storm all-player lowest-roll field damage
Cryovore player-choice activation
Dragon of Time D6 roll-table branches
Ghul'Vok Full Moon summon override and named-card cleanup
Hell Walker Demon-based Magic play restriction
Luc Tiberius hit-dice-match draw trigger
Maximum Ward all-player matching-roll field wipe
Moon Owl removal replacement, equip conversion, turn-start HP loss, and deck return
Nadara alternate attack selection
Omega Titan roll-gated damage prevention and Magic lock
Perseus roll-gated damage immunity and self Magic lock
Scarlett hit-dice-match requirement
Ward United sacrifice attack-profile transfer
Zanj base-AL reduction and AL-increase suppression scope
```
