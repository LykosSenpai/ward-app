# Adding Cards to the WARD App Card Library

The app now supports card data through split source files. Do not edit generated pack JSON directly unless you are doing a temporary local experiment.

## Where to add cards

Promo cards live here:

```text
data/cards/src/promos/
```

The generated pack file is built here:

```text
data/cards/packs/ward-promos.json
```

Card images live here:

```text
apps/client/public/card-images/
```

Use a file name that matches the card id, for example:

```text
promo_023_new_card_name.webp
```

## Normal add-card workflow

1. Add one JSON file per card under `data/cards/src/promos/`.
2. Add the matching card image under `apps/client/public/card-images/`.
3. Add the image file name to `apps/client/public/card-images/manifest.json`.
4. Rebuild generated packs.
5. Run the project checks.

```powershell
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd cards:build
pnpm.cmd cards:check
pnpm.cmd effects:audit
pnpm.cmd check
```

## Next promo ids

The current promo pack uses:

```text
promo_001_aqua_dragon
...
promo_022_zanj_the_hunter
```

Continue future uploads with:

```text
promo_023_<slug>
promo_024_<slug>
```

Keep future promo cards in the promo source pack unless you intentionally want them mixed into Gen 1, Gen 2, or Gen 3.
