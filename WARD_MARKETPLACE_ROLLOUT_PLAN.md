# WARD Marketplace Rollout Plan

## Purpose

Build a website-hosted WARD marketplace that helps players connect for trades and optional direct sales without handling payments, shipping, postage, addresses, or checkout inside the site.

The marketplace should let users:

- List cards they have available for trade.
- Mark cards as available for sale later.
- List cards they need.
- Auto-generate trade/sale availability from owned collection counts.
- Auto-generate need lists from set-completion gaps.
- Automatically compare posts against other users and cross-link matches.
- Contact matched users through Discord.
- Reserve cards as pending during a trade/sale agreement.
- Confirm, deny, cancel, or expire pending transactions.

## Non-Goals

Do not build these into the first marketplace version:

- Payment processing.
- Shipping or postage labels.
- Tax handling.
- User addresses.
- Tracking numbers.
- Checkout carts.
- Escrow.
- Direct on-site messaging.
- Automatic valuation/pricing engine.

The site only facilitates discovery and contact. Users complete arrangements externally, preferably through Discord.

---

## Core Marketplace Concepts

### Marketplace Post

A user creates one or more marketplace posts containing:

- Cards they have.
- Cards they need.
- Optional trade/sale settings.
- Discord contact information.
- Auto-generated items from their collection and set-completion rules.

### Have Items

Cards a user is willing to trade or sell.

Each item needs:

- Card ID.
- Card name.
- Generation.
- Card number.
- Variant.
- Quantity.
- Trade enabled.
- Sale enabled.
- Optional price text.
- Optional note.

### Need Items

Cards a user wants.

Each item needs:

- Card ID.
- Card name.
- Generation.
- Card number.
- Variant.
- Quantity needed.
- Optional note.

### Supported Card Variants

Use one normalized variant value in marketplace data:

```ts
export type MarketplaceCardVariant =
  | "DEFAULT"
  | "HOLO"
  | "ZERO"
  | "ZERO_HOLO";
```

Display names:

```text
Default
Holo
Zero
Zero Holo
```

Variant mapping should align with the card library ownership model:

```text
Default   = default artwork + holo unchecked
Holo      = default artwork + holo checked
Zero      = zero artwork + holo unchecked
Zero Holo = zero artwork + holo checked
```

---

## Data Model

### Files

Add these JSON files:

```text
data/marketplace/posts.json
data/marketplace/settings.json
data/marketplace/transactions.json
```

### Marketplace Post Types

```ts
export type MarketplacePostStatus = "ACTIVE" | "PAUSED" | "CLOSED";
export type MarketplaceItemPurpose = "HAVE" | "NEED";
export type MarketplaceItemSource =
  | "MANUAL"
  | "AUTO_COLLECTION"
  | "AUTO_COMPLETION_NEED";

export interface MarketplacePostItem {
  id: string;
  source: MarketplaceItemSource;
  purpose: MarketplaceItemPurpose;

  cardId: string;
  cardName: string;
  generation: string;
  cardNumber: string;
  variant: MarketplaceCardVariant;

  quantity: number;

  tradeEnabled: boolean;
  saleEnabled: boolean;
  askingPriceText?: string;
  note?: string;

  createdAt: string;
  updatedAt: string;
}

export interface MarketplacePost {
  id: string;
  userDisplayName: string;
  discordHandle: string;

  title: string;
  description?: string;
  status: MarketplacePostStatus;

  manualItems: MarketplacePostItem[];

  autoListingSettingsId?: string;
  autoNeedRuleIds?: string[];

  createdAt: string;
  updatedAt: string;
}
```

---

## Auto Listing Settings

Users should be able to auto-list extra cards based on how many copies they want to retain.

### Global Retain Settings

Example UI:

```text
Keep this many before listing extras:
Default:   [3]
Holo:      [1]
Zero:      [1]
Zero Holo: [1]

[x] Auto-list extra cards for trade
[ ] Auto-list extra cards for sale

Default sale price: [optional]
Default trade note: [optional]

Included generations:
[x] Gen 1 [x] Gen 2 [x] Gen 3
```

### Type

```ts
export interface MarketplaceAutoListingSettings {
  id: string;
  enabled: boolean;

  retainByVariant: Record<MarketplaceCardVariant, number>;

  tradeEnabled: boolean;
  saleEnabled: boolean;

  defaultSalePriceText?: string;
  defaultTradeNote?: string;

  includeGenerations: string[];
  includeRarities?: string[];

  createdAt: string;
  updatedAt: string;
}
```

### Available Quantity Formula

```ts
availableQuantity = Math.max(
  0,
  ownedQuantity - retainQuantity - pendingQuantity - manualReservedQuantity
);
```

Example:

```text
Blue Dragon Default
Owned: 6
Retain: 3
Pending: 1
Available for marketplace: 2
```

### Important Rule

Auto listing should not duplicate ownership data. Auto-listed cards should be generated at read time from ownership counts, retain settings, and pending reservations.

---

## Individual Card Overrides

Users need per-card/per-variant control over auto listing.

### Override Type

```ts
export interface MarketplaceRetainOverride {
  id: string;

  cardId: string;
  variant: MarketplaceCardVariant;

  retainQuantity: number;

  tradeEnabled?: boolean;
  saleEnabled?: boolean;

  forceListQuantity?: number;
  neverAutoList?: boolean;

  salePriceText?: string;
  note?: string;

  updatedAt: string;
}
```

### Override UI

Add controls from card library card detail or marketplace editor:

```text
Marketplace Override

[x] Use global retain rule
Retain quantity: [3]

[ ] Never auto-list this card
[ ] Always list this quantity: [ ]

[x] Trade enabled
[ ] Sale enabled
Price: [optional]
Note: [optional]

[Save Override]
```

---

## Auto Needs From Set Completion

Users should be able to generate need lists from missing set completion cards.

### Modes

```text
Add Missing Once
- Adds current missing cards as manual NEED items.

Create Perpetual Missing Rule
- Keeps needed cards synced as ownership changes.
```

### Type

```ts
export interface MarketplaceAutoNeedRule {
  id: string;

  enabled: boolean;
  generation: string;
  variants: MarketplaceCardVariant[];

  desiredQuantityPerCard: number;
  includeOwnedBelowDesired: boolean;

  createdAt: string;
  updatedAt: string;
}
```

### Completion Checker Integration

Add buttons to the generation completion panel:

```text
[Add Missing Once to Marketplace Needs]
[Create Perpetual Need Rule]
```

The selected completion checkboxes should control which variants are added:

```text
[x] Default
[x] Holo
[ ] Zero
[ ] Zero Holo
```

---

## Matching System

Marketplace matching should compare all active posts.

### Matching Key

```ts
function marketplaceCardKey(cardId: string, variant: MarketplaceCardVariant) {
  return `${cardId}::${variant}`;
}
```

### Match Types

```ts
export type MarketplaceMatchType =
  | "THEY_HAVE_WHAT_I_NEED"
  | "I_HAVE_WHAT_THEY_NEED"
  | "MUTUAL_TRADE_MATCH";
```

### Match Rules

```text
They have what I need:
My NEED item matches their HAVE item.

I have what they need:
My HAVE item matches their NEED item.

Mutual trade match:
My NEED matches their HAVE AND their NEED matches my HAVE.
```

### Quantity Rule

```ts
matchedQuantity = Math.min(neededQuantity, availableQuantity);
```

### Pending Reservations

Matching must subtract pending cards from public availability.

```ts
publicAvailableQuantity = listedQuantity - pendingReservedQuantity;
```

For auto collection items:

```ts
publicAvailableQuantity =
  ownedQuantity - retainQuantity - pendingReservedQuantity;
```

---

## Transaction / Pending Trade System

When users agree to trade or sale externally, the marketplace should let them reserve items as pending.

### Transaction Statuses

```ts
export type MarketplaceTransactionStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED_BY_ONE_PARTY"
  | "COMPLETED"
  | "DENIED"
  | "EXPIRED"
  | "CANCELLED";
```

### Transaction Type

```ts
export interface MarketplaceTransaction {
  id: string;

  createdAt: string;
  updatedAt: string;
  expiresAt: string;

  status: MarketplaceTransactionStatus;

  initiatorPostId: string;
  counterpartyPostId: string;

  initiatorUserDisplayName: string;
  counterpartyUserDisplayName: string;

  initiatorDiscordHandle: string;
  counterpartyDiscordHandle: string;

  itemsFromInitiator: MarketplaceTransactionItem[];
  itemsFromCounterparty: MarketplaceTransactionItem[];

  confirmations: {
    initiatorConfirmedAt?: string;
    counterpartyConfirmedAt?: string;
    initiatorDeniedAt?: string;
    counterpartyDeniedAt?: string;
  };

  completionNote?: string;
}

export interface MarketplaceTransactionItem {
  id: string;
  ownerPostId: string;

  cardId: string;
  cardName: string;
  generation: string;
  cardNumber: string;
  variant: MarketplaceCardVariant;

  quantity: number;
  source: MarketplaceItemSource;
}
```

---

## Transaction Flow

### Create Pending Trade / Sale

```text
1. User opens a matched post.
2. User selects cards involved.
3. User clicks Create Trade Request / Mark Pending.
4. Selected quantities become pending on both posts.
5. Cards are removed from public available matching while pending.
6. Users contact each other through Discord.
```

### Confirm Completed

```text
1. One user confirms completed.
2. Status becomes CONFIRMED_BY_ONE_PARTY.
3. Other user confirms completed.
4. Status becomes COMPLETED.
5. Items are removed from public posts.
6. Owner can optionally update collection counts.
```

### Deny / Cancel

```text
Denied or cancelled transactions release the pending items.
```

### Expiration

Pending transactions expire after one week.

```text
Pending for 7 days.
After 7 days:
- transaction becomes EXPIRED
- items remain out of public availability until the owner chooses an action
- owner can return expired items to pool, keep reserved, or remove from marketplace
```

### Expiration Check

Run expiration checks during:

```text
server startup
marketplace:listPosts
marketplace:listMatches
marketplace:listTransactions
```

No background worker is required for the local-first version.

---

## Server Events

Add Socket.IO events:

```ts
"marketplace:getSettings"
"marketplace:updateSettings"

"marketplace:listPosts"
"marketplace:createPost"
"marketplace:updatePost"
"marketplace:deletePost"

"marketplace:listMatches"
"marketplace:listMyMatches"

"marketplace:createTransaction"
"marketplace:confirmTransaction"
"marketplace:denyTransaction"
"marketplace:cancelTransaction"
"marketplace:returnExpiredItemsToPool"
"marketplace:listTransactions"
```

Client receives:

```ts
"marketplace:settings"
"marketplace:posts"
"marketplace:matches"
"marketplace:transactions"
"marketplace:error"
```

---

## Files To Add

```text
apps/client/src/components/MarketplacePage.tsx
apps/client/src/components/MarketplaceAutoListingSettingsPanel.tsx
apps/client/src/components/MarketplacePostEditor.tsx
apps/client/src/components/MarketplacePostCard.tsx
apps/client/src/components/MarketplaceMatchesPanel.tsx
apps/client/src/components/MarketplaceTransactionPanel.tsx
apps/client/src/components/AddCardToMarketplaceModal.tsx
apps/client/src/marketplaceHelpers.ts
```

---

## Files To Update

```text
apps/client/src/App.tsx
apps/client/src/App.css
apps/client/src/clientTypes.ts
apps/client/src/components/CardLibraryPanel.tsx
apps/server/src/index.ts
apps/server/src/dataStore.ts
packages/shared/src/index.ts
```

If persisted marketplace-related match or post state is later stored in match saves, also update:

```text
packages/engine/src/normalizeMatch.ts
```

---

## Rollout Phases

### Phase 1 — Marketplace Data + Manual Posts

Goal:

```text
Users can create marketplace posts and manually add Have/Need cards.
```

Build:

- Marketplace tab.
- Manual post editor.
- Post browser.
- Discord contact fields.
- Trade/sale flags.
- Optional price text.

### Phase 2 — Auto Matching

Goal:

```text
Posts automatically cross-link when one user has what another user needs.
```

Build:

- Exact card + variant matching.
- Match panel on each post.
- Mutual trade match detection.
- Open linked post action.

### Phase 3 — Auto Listing From Collection

Goal:

```text
Users can auto-list extras beyond retain counts.
```

Build:

- Global retain settings.
- Generated available pool.
- Public availability subtracts retained + pending.
- Preview auto pool.

### Phase 4 — Individual Auto Listing Overrides

Goal:

```text
Users can override retain/listing behavior per card variant.
```

Build:

- Per-card override modal.
- Never auto-list.
- Force list quantity.
- Per-card sale/trade flags and notes.

### Phase 5 — Completion Checker To Need List

Goal:

```text
Users can generate needs from missing set cards.
```

Build:

- Add missing once.
- Perpetual missing rule.
- Desired quantity per card.
- Generation + variant selection.

### Phase 6 — Pending Transaction System

Goal:

```text
Matched users can reserve cards as pending while they work out trade/sale details on Discord.
```

Build:

- Create transaction.
- Reserve selected quantities.
- Remove pending from public availability.
- Transaction panel.

### Phase 7 — Confirm / Deny / Expire Flow

Goal:

```text
Both parties can confirm completed trades, deny/cancel pending trades, or handle expired pending cards.
```

Build:

- Confirm completed by both parties.
- Deny/cancel.
- 7-day expiration.
- Return expired items to pool.
- Optional update collection counts after completion.

### Phase 8 — Hosted User Layer Later

Goal:

```text
Make marketplace safe for website hosting.
```

Build later:

- User accounts.
- Post ownership.
- Edit permissions.
- Discord verification.
- Moderation/reporting.
- Rate limits.
- Hidden/private posts.

---

## UX Copy To Include

Use this disclaimer in the marketplace page:

```text
WARD Marketplace helps players find trade and sale matches. Payments, shipping, postage, addresses, and final trade terms are handled outside the website. Use Discord to contact the other user and work out the details directly.
```

---

## Smoke Test Checklist

After implementation, test:

```text
1. Create a marketplace post.
2. Add a Have item manually.
3. Add a Need item manually.
4. Create a second post with opposite Have/Need cards.
5. Confirm both posts show a match.
6. Confirm mutual trade match appears when both users have what the other needs.
7. Set global retain counts.
8. Confirm owned extras generate auto Have items.
9. Confirm cards under retain quantity do not list.
10. Add a per-card never-auto-list override.
11. Confirm it disappears from auto pool.
12. Add missing set cards from completion checker to Need list.
13. Create pending transaction from a match.
14. Confirm pending quantities are removed from public availability.
15. Confirm both-party completion marks transaction completed.
16. Confirm denied/cancelled transaction releases items.
17. Confirm 7-day expiration marks old pending transactions expired.
18. Confirm owner can return expired items to pool.
```
