# WARD Card Library + Collection Completion Changes Plan

## Purpose

Improve the Card Library so users can track collection completion by generation and variant, quickly see which cards are missing, and use those missing cards for marketplace need-list creation.

The Card Library should keep the current browsing behavior:

```text
Default / Zero artwork selection stays in the dropdown.
Holo stays as a checkbox.
Zero Holo is created by selecting Zero artwork and checking Holo.
```

The completion checker should use checkboxes to decide which set variants to evaluate:

```text
[x] Default
[x] Holo
[x] Zero
[x] Zero Holo
```

---

## Core Goals

Users should be able to:

- View card library by generation.
- Track owned quantity for each card variant.
- Check whether they own a full generation set.
- See remaining cards needed for Default, Holo, Zero, and Zero Holo sets.
- Check multiple set variants at once.
- Focus the library browser to only missing cards.
- Add missing cards to the marketplace need list.
- Create a perpetual marketplace need rule for missing set cards later.

---

## Variant Model

Use these four normalized variants:

```ts
export type CardOwnershipVariant =
  | "DEFAULT"
  | "HOLO"
  | "ZERO"
  | "ZERO_HOLO";
```

### UI Mapping

Card browser controls:

```text
Artwork dropdown:
- Default
- Zero

Holo checkbox:
- unchecked
- checked
```

Mapping:

```text
Default   = artwork DEFAULT + holo unchecked
Holo      = artwork DEFAULT + holo checked
Zero      = artwork ZERO + holo unchecked
Zero Holo = artwork ZERO + holo checked
```

### Completion Checker Controls

The completion checker should use direct variant checkboxes:

```text
Check completion for:
[x] Default
[x] Holo
[ ] Zero
[ ] Zero Holo
```

This is separate from the browsing controls.

---

## Ownership Data Model

Use the existing collection ownership storage foundation.

Recommended shape:

```ts
export interface CardOwnershipRecord {
  cardId: string;
  owned: {
    DEFAULT: number;
    HOLO: number;
    ZERO: number;
    ZERO_HOLO: number;
  };
  updatedAt: string;
}
```

Storage file:

```text
data/collection/card-ownership.json
```

Rules:

```text
1. Missing ownership records are treated as zero for all variants.
2. Owned quantities cannot go below zero.
3. A card is complete for a variant when owned quantity is greater than or equal to required quantity.
4. Default required quantity is 1 per card per selected variant.
```

---

## Completion Calculation

### Inputs

```ts
interface CompletionRequest {
  generation: string;
  selectedVariants: CardOwnershipVariant[];
  requiredQuantityPerCard: number;
}
```

### Output

```ts
interface GenerationCompletionSummary {
  generation: string;
  totalCards: number;
  requiredQuantityPerCard: number;
  selectedVariants: CardOwnershipVariant[];
  variantSummaries: VariantCompletionSummary[];
  missingItems: MissingCollectionItem[];
}

interface VariantCompletionSummary {
  variant: CardOwnershipVariant;
  ownedCompleteCards: number;
  totalCards: number;
  missingCards: number;
  percentComplete: number;
}

interface MissingCollectionItem {
  cardId: string;
  cardName: string;
  generation: string;
  cardNumber: string;
  variant: CardOwnershipVariant;
  ownedQuantity: number;
  requiredQuantity: number;
  missingQuantity: number;
}
```

### Formula

```ts
missingQuantity = Math.max(0, requiredQuantity - ownedQuantity);
```

A card is complete for a variant when:

```ts
ownedQuantity >= requiredQuantity;
```

---

## Card Library UI Changes

### Keep Existing Browse Controls

Do not change the card image selection model.

Use:

```text
Artwork: [Default / Zero]
[x] Holo
```

Do not change this to a four-option variant dropdown in the card browser.

### Ownership Controls On Card Rows

Each card should expose owned counts for:

```text
Default:   [-] [count] [+]
Holo:      [-] [count] [+]
Zero:      [-] [count] [+]
Zero Holo: [-] [count] [+]
```

Optional compact display:

```text
Owned: D 3 | H 1 | Z 0 | ZH 0
```

### Completion Panel

Add or preserve a panel like:

```text
Generation Set Completion

Generation: [Gen 1]
Required quantity per card: [1]

Check completion for:
[x] Default
[x] Holo
[ ] Zero
[ ] Zero Holo

Summary:
Default: 120 / 150 complete, 30 missing
Holo: 40 / 150 complete, 110 missing

[Show Remaining Needed]
[Clear Remaining Focus]
[Add Missing to Marketplace Needs]
```

### Remaining Needed List

List missing cards like:

```text
001 Blue Dragon - Holo - owned 0 / needed 1
014 Smokescreen - Default - owned 0 / needed 1
024 Ball and Chain - Zero Holo - owned 0 / needed 1
```

If multiple variants are missing for the same card, show each variant separately.

---

## Library Filtering Behavior

Add focus mode for missing cards.

### Focus To Missing

When the user clicks a missing count or Show Remaining Needed:

```text
Card browser should filter to cards that have at least one missing selected variant.
```

### Clear Focus

Add:

```text
[Clear Remaining Focus]
```

This should restore normal card library filters.

### Important Rule

The completion checker should not permanently overwrite the normal card search/filter state. Treat missing-card focus as a temporary filter layer.

---

## Marketplace Integration

The Card Library should feed the Marketplace in two ways.

### 1. Add One Card To Marketplace

Each card row/detail should offer:

```text
[Add to Marketplace Have]
[Add to Marketplace Need]
```

Modal fields:

```text
Card: Blue Dragon
Variant: [Default / Holo / Zero / Zero Holo]
Quantity: [1]
Trade enabled: [x]
Sale enabled: [ ]
Price: [optional]
Note: [optional]

[Add]
```

### 2. Add Missing Cards To Need List

Completion panel action:

```text
[Add Missing to Marketplace Needs]
```

Options:

```text
Quantity needed per missing card: [1]
Merge with existing needs: [x]
Only add currently focused missing cards: [optional]
```

Behavior:

```text
For each missing card/variant, create or update a Marketplace NEED item.
If merge is enabled, increase or update the existing item instead of duplicating it.
```

### 3. Create Perpetual Need Rule Later

Later marketplace integration:

```text
[Create Perpetual Missing Rule]
```

This should create a rule that keeps need items synced as ownership changes.

---

## File Plan

### Files To Update

```text
apps/client/src/components/CardLibraryPanel.tsx
apps/client/src/components/CardImagePreview.tsx
apps/client/src/App.tsx
apps/client/src/App.css
apps/client/src/clientTypes.ts
apps/server/src/index.ts
apps/server/src/dataStore.ts
```

### Files To Add Later If The Panel Gets Too Large

```text
apps/client/src/components/CollectionCompletionPanel.tsx
apps/client/src/components/CardOwnershipControls.tsx
apps/client/src/components/AddCardToMarketplaceModal.tsx
apps/client/src/collectionCompletionHelpers.ts
```

### Data File

```text
data/collection/card-ownership.json
```

---

## Server Events

Use or add collection events:

```ts
"collection:getOwnership"
"collection:updateOwnership"
"collection:bulkUpdateOwnership"
```

Client receives:

```ts
"collection:ownership"
"collection:error"
```

For marketplace integration later:

```ts
"marketplace:addItemsFromLibrary"
"marketplace:addMissingNeedsFromCompletion"
"marketplace:createAutoNeedRule"
```

---

## Helper Functions

Create helper functions for consistent behavior.

```ts
function getOwnershipVariantFromArtworkAndHolo(
  artworkMode: "DEFAULT" | "ZERO",
  isHolo: boolean
): CardOwnershipVariant {
  if (artworkMode === "ZERO") {
    return isHolo ? "ZERO_HOLO" : "ZERO";
  }

  return isHolo ? "HOLO" : "DEFAULT";
}

function getOwnedQuantity(
  ownership: CardOwnershipRecord | undefined,
  variant: CardOwnershipVariant
): number {
  return ownership?.owned?.[variant] ?? 0;
}

function getMissingQuantity(
  ownedQuantity: number,
  requiredQuantity: number
): number {
  return Math.max(0, requiredQuantity - ownedQuantity);
}
```

---

## Rollout Phases

### Phase 1 — Preserve Browse Variant Behavior

Goal:

```text
Default/Zero remain dropdown options and Holo remains a checkbox.
```

Tasks:

- Confirm card image preview uses artwork dropdown + holo checkbox.
- Confirm Zero Holo is generated from Zero + Holo checked.
- Avoid replacing browser controls with a four-option variant dropdown.

### Phase 2 — Ownership Counts

Goal:

```text
Users can track owned quantities for each variant.
```

Tasks:

- Add quantity controls for Default, Holo, Zero, Zero Holo.
- Save to collection ownership JSON.
- Load ownership on app startup and reconnect.

### Phase 3 — Generation Completion Checker

Goal:

```text
Users can check full-set completion by generation and selected variants.
```

Tasks:

- Add generation selector.
- Add variant checkboxes.
- Add required quantity input.
- Calculate complete/missing cards.
- Show summary counts and percent complete.

### Phase 4 — Remaining Needed Focus

Goal:

```text
Users can filter the card browser to only missing cards.
```

Tasks:

- Add Show Remaining Needed.
- Add clickable missing counts.
- Add Clear Remaining Focus.
- Ensure normal filters still work after clearing.

### Phase 5 — Missing List Details

Goal:

```text
Users can see exactly which card variants are missing.
```

Tasks:

- Add missing card list.
- Include card number, name, variant, owned quantity, needed quantity, missing quantity.
- Group or sort by generation/card number.

### Phase 6 — Marketplace Need Export

Goal:

```text
Users can push missing cards into Marketplace Need items.
```

Tasks:

- Add Add Missing to Marketplace Needs button.
- Add modal for quantity/merge options.
- Create or update marketplace NEED items.

### Phase 7 — Marketplace Have Export

Goal:

```text
Users can add individual owned cards to Marketplace Have items.
```

Tasks:

- Add Add to Marketplace Have button.
- Add variant/quantity/trade/sale modal.
- Link to marketplace post editor.

### Phase 8 — Perpetual Need Rules

Goal:

```text
Users can keep need lists synced automatically from completion gaps.
```

Tasks:

- Create auto need rule type.
- Save selected generation and variants.
- Generate need list from current ownership dynamically.
- Update need list as ownership changes.

---

## Validation Rules

```text
1. Owned quantities cannot be negative.
2. Required quantity must be at least 1.
3. Completion must compare exact card ID and exact variant.
4. Completion should ignore non-card metadata files.
5. Missing card focus should not mutate ownership.
6. Adding missing cards to Marketplace Needs should not duplicate existing equivalent need items when merge is enabled.
7. Holo checkbox should not be removed from the card browser.
8. Default/Zero dropdown should not be replaced in the card browser.
```

---

## Smoke Test Checklist

```text
1. Open Card Library.
2. Confirm artwork dropdown has Default and Zero.
3. Confirm Holo is still a checkbox.
4. Select Default + unchecked Holo and confirm Default preview/ownership context.
5. Select Default + checked Holo and confirm Holo context.
6. Select Zero + unchecked Holo and confirm Zero context.
7. Select Zero + checked Holo and confirm Zero Holo context.
8. Add ownership counts for several cards.
9. Open Generation Set Completion.
10. Check Default only and confirm missing count.
11. Check Holo only and confirm missing count.
12. Check Default + Holo and confirm both summaries appear.
13. Click Show Remaining Needed.
14. Confirm browser filters to missing cards.
15. Click Clear Remaining Focus.
16. Confirm normal browser returns.
17. Add missing cards to Marketplace Needs.
18. Confirm marketplace receives exact card ID + variant + quantity.
19. Confirm no duplicate need item is created when merge is enabled.
```

---

## Notes For Future Implementation

Keep collection completion logic separate from gameplay engine logic. This is a card library and marketplace support feature, not a match-state feature.

Avoid changing card pack JSON directly for collection behavior. Collection state belongs in:

```text
data/collection/card-ownership.json
```

Card definitions stay in:

```text
data/cards/src/gen*/
data/cards/packs/ward-gen*.json
```
