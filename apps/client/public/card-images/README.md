# WARD card image assets

Place card photos in this folder so the client can load them at browser URL `/card-images/...`.

## Preferred default card image naming

Use the card ID from the card pack JSON:

```text
gen1_001_blue_dragon.webp
gen1_014_smokescreen.webp
gen2_001_example_card.webp
gen3_150_example_card.webp
```

The client checks these extensions in order:

```text
.webp
.png
.jpg
.jpeg
```

## Accepted fallback naming

The app also checks common human-file-name variants so images copied from Windows are easier to use:

```text
gen1_001_blue dragon.png
gen1_001 blue_dragon.png
gen1_001 blue dragon.png
```

Preferred naming should still use underscores everywhere:

```text
gen1_001_blue_dragon.png
```

## Alternate art naming

Use a double underscore followed by `alt-#`:

```text
gen1_001_blue_dragon__alt-1.webp
gen1_001_blue_dragon__alt-2.webp
gen1_001_blue_dragon__alt-3.webp
gen1_001_blue_dragon__alt-4.webp
```

Fallback variants also work for alternate art:

```text
gen1_001_blue dragon__alt-1.png
gen1_001 blue dragon__alt-1.png
```

The Card Library art selector currently exposes Default plus Alt 1 through Alt 4.
