# Adding Cards Through Source JSON

The app now has a source-card workflow that is safer than editing generated pack files directly.

## Preferred workflow

1. Create or edit one source card file:

```text
data/cards/src/<pack-folder>/<number-card-slug>.json
```

2. Keep the card ID stable:

```json
"id": "promo_013_example_card"
```

3. Add a matching card image:

```text
apps/client/public/card-images/promo_013_example_card.webp
```

4. Rebuild generated packs:

```powershell
pnpm.cmd cards:build
```

5. Verify everything:

```powershell
pnpm.cmd cards:check
pnpm.cmd effects:audit
pnpm.cmd check
```

## Important rule

Do not hand-edit these generated files unless you are debugging:

```text
data/cards/packs/ward-gen1.json
data/cards/packs/ward-gen2.json
data/cards/packs/ward-gen3.json
data/cards/packs/ward-promos.json
```

The build script recreates generated pack files from `data/cards/src/**`.

## Promo pack numbering

The current promo pack uses:

```text
promo_001_aqua_dragon
promo_002_arcturus
...
promo_012_luc_tiberius
```

For the next uploaded promo image batch, continue at `promo_013_...` unless the card has an official promo number.
