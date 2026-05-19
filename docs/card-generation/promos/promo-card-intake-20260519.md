# WARD Promo Card Intake - 2026-05-19

Added a separate `ward-promos` card source pack from the first uploaded promo image batch.

## Source pack

```text
data/cards/src/promos/_pack.json
data/cards/src/promos/001-aqua-dragon.json
...
data/cards/src/promos/012-luc-tiberius.json
```

Generated pack:

```text
data/cards/packs/ward-promos.json
```

Card images were added under:

```text
apps/client/public/card-images/promo_001_aqua_dragon.webp
...
apps/client/public/card-images/promo_012_luc_tiberius.webp
```

## Cards added

| # | Card | Kind | Type/Subtype | Stats / Magic | Effect count | Review notes |
|---:|---|---|---|---|---:|---|
| 001 | Aqua Dragon | Creature | Dragon | AL 12 / SPD 6 / HP 110 / 4D6 +7 | 1 | Steam modeled as name contains `Steam`. |
| 002 | Arcturus | Creature | Humanoid | AL 6 / SPD 8 / HP 70 / 4D6 +2 | 1 | Needs battle-pipeline QA for only-base-attack damage filtering. |
| 003 | Artist Eg’Toroth | Creature | Demon | AL 2 / SPD 12 / HP 10 / 5D6 +5 | 0 | No visible rules effect. |
| 004 | Cosmic Storm | Magic | Infinite Field | Field | 1 | Needs turn-start all-player lowest-roll handling. |
| 005 | Cryovore | Creature | Bug | AL 8 / SPD 4 / HP 100 / 2D6 +2 | 2 | Choice between +10 attack damage and self-heal needs routing QA. |
| 006 | Denraa The Bull | Creature | Beast | AL 10 / SPD 9 / HP 90 / 2D6 +10 | 0 | No visible rules effect. |
| 007 | Dragon of Time | Creature | Dragon | AL 12 / SPD 4 / HP 80 / 1D6 +20 | 4 | Roll-table branches need runtime QA. |
| 008 | Ghul'Vok | Creature | Beast | AL 12 / SPD 6 / HP 100 / 5D6 +5 | 2 | Full Moon conditional summon/cleanup needs runtime QA. |
| 009 | God Killer Brox | Creature | Humanoid | AL 11 / SPD 5 / HP 110 / 2D6 +5 | 1 | Uses effective AL 12 including Magic increases. |
| 010 | Hell Walker | Creature | Humanoid | AL 12 / SPD 9 / HP 110 / 3D6 +5 | 2 | Magic-play lock needs guard QA. |
| 011 | Lord Marshal Goroth | Creature | Beast | AL 8 / SPD 10 / HP 70 / 4D6 +4 | 0 | No visible rules effect. |
| 012 | Luc Tiberius | Creature | Humanoid | AL 7 / SPD 10 / HP 80 / 3D6 +2 | 1 | Needs hit-dice-doubles metadata routing QA. |

## How to add the next promo batch

1. Add new JSON files to `data/cards/src/promos/` using the next card numbers, for example `013-card-name.json`.
2. Use IDs in this format: `promo_013_card_name`.
3. Put the image in `apps/client/public/card-images/` with the same ID, for example `promo_013_card_name.webp` or `.png`.
4. Run:

```powershell
pnpm.cmd cards:build
pnpm.cmd cards:check
pnpm.cmd effects:audit
pnpm.cmd check
```

This keeps promo additions separate from Gen 1, Gen 2, and Gen 3 base packs.
