# WARD Marketplace UI / UX Reference Sheet

**Project:** WARD fan website marketplace module  
**Feature:** Trading-first card marketplace dashboard  
**Visual target:** Dark fantasy marketplace dashboard with active listings, trade matching, want-list tracking, and disabled future payment/shipping features  
**Recommended repo path:** `docs/ward-marketplace-ui-reference-sheet.md`

---

## 1. Product Intent

The WARD Marketplace should function primarily as a **card trading and collector-matching hub**. Users can post cards they own, mark cards they want, browse active listings, and discover other users who either:

- have cards the current user needs,
- need cards the current user posted,
- form a mutual trade opportunity,
- help complete a set or want-list goal.

The interface should feel like a premium modern marketplace, but the current release should avoid real checkout, payment processing, shipping purchase, or label generation.

### Current Release Scope

Enabled now:

- Browse WARD card listings.
- Post cards for trade or sale metadata.
- Manage “My Posted Cards.”
- Maintain a want list.
- View automatic trade/match suggestions.
- Send trade offers or messages.
- Track matches, views, and listing metadata.
- Show reputation/trust indicators.
- Show marketplace value/price fields where useful.

Built but disabled for future release:

- Integrated payments.
- Checkout flow.
- Shipping label generation.
- In-app transaction settlement.
- In-app package tracking.

Important: **For Sale** listings can exist as marketplace metadata, but the app should not perform payment capture or shipping transactions until the feature flags are enabled.

---

## 2. Overall Layout

The page is a single desktop marketplace dashboard with a dark fantasy UI style.

### Primary Structure

```txt
┌──────────────────────────────────────────────────────────────────────────────┐
│ Top Navigation / Search / User Profile                                      │
├───────────────┬───────────────────────────────────────────────┬──────────────┤
│ Left Filters  │ Center Marketplace Content                    │ Right Match  │
│ Sidebar       │ - Active listings grid                        │ Sidebar      │
│               │ - My posted cards table                       │              │
├───────────────┴───────────────────────────────────────────────┴──────────────┤
│ Page background / dashboard shell                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Suggested Desktop Column Widths

| Region | Suggested Width | Purpose |
|---|---:|---|
| Left filter sidebar | 230–260px | Search refinement, marketplace filters, disabled future modules |
| Center content | Flexible, 720–860px | Active listings and user post management |
| Right sidebar | 330–400px | Match discovery, want-list overview, trading tools |
| Gaps | 12–18px | Clear separation between dashboard panels |

Use a max-width dashboard shell around `1440px` for desktop. The layout should remain readable at `1280px` and collapse gracefully for tablet/mobile.

---

## 3. Visual Design Direction

### Theme

The UI should feel like a **dark fantasy collector marketplace**: refined, premium, and game-oriented without becoming cluttered.

Core visual traits:

- Dark charcoal/navy page background.
- Slightly lighter card/panel surfaces.
- Purple, blue, teal, and amber accents.
- Rounded cards and panels.
- Thin borders with subtle glow.
- High-contrast typography.
- Fantasy card thumbnails with colored rarity frames.
- Marketplace-style trust, quantity, condition, and match badges.

### Suggested Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `--bg-page` | `#071019` | Main background |
| `--bg-panel` | `#0D1824` | Sidebar and section panels |
| `--bg-card` | `#111E2B` | Listing cards and table rows |
| `--border-soft` | `#223244` | Panel/card borders |
| `--text-primary` | `#F3F7FB` | Primary text |
| `--text-secondary` | `#9EADBE` | Metadata and helper text |
| `--accent-purple` | `#7C3AED` | Active nav, primary actions, magic highlights |
| `--accent-blue` | `#2563EB` | View/details actions, sale tags |
| `--accent-teal` | `#22C7A7` | Positive match/reputation indicators |
| `--accent-amber` | `#F59E0B` | Trade tags, needs-your-card badges |
| `--danger-muted` | `#7F1D1D` | Error/blocked states |
| `--disabled-bg` | `#1F2937` | Disabled future features |
| `--disabled-text` | `#6B7280` | Disabled labels |

### Typography

Use a clean, modern sans-serif UI font. Suggested stack:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

WARD logo text can use a decorative fantasy display font or image logo, but all functional UI text should stay readable.

Suggested text hierarchy:

| Element | Size | Weight |
|---|---:|---:|
| Page title / logo | 24–32px | 700–800 |
| Section headings | 14–16px | 700 |
| Card names | 13–15px | 600–700 |
| Metadata | 11–13px | 400–500 |
| Buttons | 12–14px | 600 |
| Table text | 12–14px | 400–600 |

---

## 4. Top Navigation

### Purpose

The header gives the user global access to search, marketplace sections, notifications, and profile actions.

### Elements

Left side:

- WARD crystal/logo mark.
- Text: `WARD`.
- Subtitle: `TRADING HUB` or `MARKETPLACE`.

Center:

- Global search bar.
- Placeholder: `Search cards, sets, users, or trades...`.
- Keyboard shortcut chip: `⌘ K` or `Ctrl K`.

Navigation tabs:

- `Marketplace`
- `Trade Listings`
- `Wants`
- `My Posts`
- `Matches` with count badge, for example `12`

Right side:

- Notification bell with unread badge.
- User avatar.
- Username, for example `Arcanist42`.
- User subtitle, for example `Ward Seeker • Level 27`.
- Dropdown chevron.

### UX Behavior

- Active tab receives a purple underline and brighter text.
- Search should support card name, card number, set name, rarity, username, and trade terms.
- Notification badge should show new matches, messages, or trade offer updates.
- Profile dropdown should include account, profile, my posts, want list, settings, and sign out.

---

## 5. Left Sidebar: Filters

### Purpose

The filter sidebar lets users quickly narrow the marketplace without leaving the dashboard.

### Sections

#### Trade / Sale Toggle

Two-segment control:

- `For Trade`
- `For Sale`

Default should prioritize `For Trade` because this marketplace release is trading-first.

#### Set Filter

Dropdown:

- Example selected set: `Echoes of the Rift`
- Include optional `All Sets` checkbox or select option.

#### Rarity Filter

Checkbox list with colored rarity icons and counts:

- Common
- Uncommon
- Rare
- Epic
- Legendary
- Mythic

Each item should include a count of matching listings.

#### Condition Filter

Pill buttons:

- `NM`
- `LP`
- `MP`
- `HP`
- `DMG`

Selected state should be visually clear.

#### Price Range

Even though integrated payments are disabled, price/value fields can still be used for market reference and seller listing metadata.

Controls:

- Min value input.
- Max value input.
- Range slider.
- Label: `PRICE RANGE (USD)` or `VALUE RANGE`.

#### Availability

Checkboxes:

- `Available Now`
- `Ships to Me`

Because shipping is disabled, `Ships to Me` should be treated as a user preference or informational listing flag, not a shipping label workflow.

#### Other Filters

Checkboxes:

- `Verified Sellers`
- `Local Pickup`
- `Foil Only`
- `Altered`

#### Apply / Reset

- `Apply Filters` primary purple button.
- `Reset` text button at top of sidebar.

### Disabled Future Module Block

At the bottom of the sidebar, include a visible but inactive card:

```txt
Payments & Shipping
Payments         Disabled
Shipping Labels  Disabled
Planned for a future update.
```

UX requirements:

- Disabled rows are greyed out.
- Include an info icon explaining these are future features.
- No active checkout, payment, or label-generation CTA should be shown.

---

## 6. Center Panel: Active WARD Listings

### Purpose

This is the primary browsing area. It shows active WARD marketplace posts in a dense but readable grid.

### Section Header

Text:

```txt
ACTIVE WARD LISTINGS
1,286 active listings
```

Controls:

- Sort dropdown: `Sort by: Newest`.
- Grid/list toggle.
- Optional quick filters/chips.

### Listing Card Anatomy

Each listing card should include:

1. Card artwork thumbnail.
2. Mana/cost/stat/rank marker if relevant to WARD cards.
3. Card name.
4. Listing type badge:
   - `For Trade` in amber/orange.
   - `For Sale` in blue.
5. Optional price/value.
6. Set name.
7. Rarity.
8. Card identifier, for example `#RFT-089`.
9. Condition, for example `NM`.
10. Quantity, for example `1x`.
11. Seller/trader username.
12. Verification/reputation indicator.
13. Action button.

### Example Listing Cards

Use WARD-themed placeholder cards until real content is connected:

| Card | Type | Example Metadata | CTA |
|---|---|---|---|
| Drakemaw Overlord | For Trade | Echoes of the Rift • Mythic • #RFT-089 • NM • 1x | Offer Trade |
| Aether Sentinel | For Sale | Echoes of the Rift • Epic • #RFT-045 • $18.50 • NM • 1x | View Details |
| Void Herald | For Trade | Echoes of the Rift • Legendary • #RFT-078 • NM • 1x | Offer Trade |
| Sylvan Warden | For Sale | Echoes of the Rift • Rare • #RFT-201 • $2.75 • NM • 2x | View Details |
| Radiant Paladin | For Trade | Echoes of the Rift • Epic • #RFT-112 • NM • 1x | Offer Trade |
| Gravecaller Adept | For Sale | Echoes of the Rift • Rare • #RFT-156 • $6.40 • NM • 1x | View Details |
| Riftstorm Phoenix | For Trade | Echoes of the Rift • Mythic • #RFT-033 • NM • 1x | Offer Trade |
| Frostbound Citadel | For Sale | Echoes of the Rift • Uncommon • #RFT-221 • $1.25 • NM • 3x | View Details |

### CTA Behavior

#### `Offer Trade`

Opens a trade offer modal or page. User can select from their posted inventory, attach a message, and send a proposed trade.

#### `View Details`

Opens a listing detail panel/page. For sale listings may show asking price/value, but checkout remains unavailable.

Suggested disabled copy for sale details:

```txt
Integrated payments are not available yet. Contact the poster or use trade/message tools.
```

### Listing States

Implement states for:

- Loading skeletons.
- Empty results.
- No matches for filters.
- Card unavailable/closed.
- Listing owned by current user.
- Listing with disabled sale checkout.

---

## 7. Center Lower Panel: My Posted Cards

### Purpose

This section gives the user a management table for cards they have posted and shows how much marketplace activity each post has generated.

### Header

```txt
MY POSTED CARDS
8 active posts
+ New Post
```

### Table Columns

| Column | Purpose |
|---|---|
| Card | Thumbnail, name, set, rarity |
| I Have | Quantity posted |
| I Need | Desired card, rarity, set, or trade condition |
| Type | `For Trade` or `For Sale` |
| Value (USD) | Price/value field or `Trade Only` |
| Matches | Matched users / count |
| Views | Listing view count |
| Actions | Edit, message, more menu |

### Example Rows

| Card | I Have | I Need | Type | Value | Matches | Views |
|---|---:|---|---|---|---:|---:|
| Drakemaw Overlord | 1x | Mythic / Legendary | For Trade | Trade Only | 7 | 42 |
| Aether Sentinel | 1x | PayPal / Store Credit | For Sale | $18.50 | 5 | 38 |
| Void Herald | 1x | Any Epic I Need | For Trade | Trade Only | 9 | 61 |
| Sylvan Warden | 2x | Bulk Rare / Uncommon | For Sale | $2.75 | 3 | 29 |

### UX Behavior

- `+ New Post` opens a post creation flow.
- Row click opens listing detail/edit page.
- Edit icon opens quick edit.
- More menu includes close listing, duplicate post, mark unavailable, delete, report issue.
- Matches avatars should link to the filtered match view for that listing.

### Important Sale Behavior

For sale posts can store an asking price or trade value, but should not start a checkout.

Use clear labels:

- `Value (USD)` rather than `Checkout Price`.
- `For Sale` as listing intent.
- Disabled checkout notice in sale details.

---

## 8. Right Sidebar: People Who Have / Need Your Cards

### Purpose

This is the key marketplace differentiator. It should make automatic trade discovery obvious.

### Header

```txt
PEOPLE WHO HAVE / NEED YOUR CARDS
```

Tabs:

- `All Matches` with count.
- `Need Your Cards` with count.
- `You Need` with count.

### Match Card Types

#### Good Match

Used when another user has a card from the current user’s want list.

Example:

```txt
GOOD MATCH
ShadowBinder • 97% (189)
Has a card you need
They have: Aether Sentinel
1x • Near Mint
[View Match]
```

#### Needs Your Card

Used when another user wants a card the current user posted.

Example:

```txt
NEEDS YOUR CARD
DragonTamer77 • 98% (245)
Needs a card you posted
You posted: Drakemaw Overlord
They need it
[View Match]
```

#### Mutual Trade

Used when both users have something the other wants.

Example:

```txt
MUTUAL TRADE
MysticMage • 99% (312)
Great mutual trade potential
You posted: Void Herald ⇄ They have: Gravecaller Adept
[View Match]
```

#### Set Completion Match

Used when a match directly helps complete a collection/set goal.

Example:

```txt
SET COMPLETION MATCH
LeafLover • 100% (76)
Helps complete your set
They have: Riftstorm Phoenix
Completes your set!
[View Match]
```

### UX Behavior

- `View Match` opens a match detail drawer/page.
- Match detail should show both users’ relevant cards side by side.
- Mutual matches should be ranked highest.
- Set completion matches should receive strong visual emphasis.
- Cards the current user owns should be labeled `You posted` or `You have`.
- Cards the other user owns should be labeled `They have`.
- Cards wanted by either party should be labeled `You need it` or `They need it`.

### Match Ranking Logic

Suggested priority order:

1. Mutual trade match.
2. Exact card on want list.
3. Set completion match.
4. Same rarity substitute.
5. Same set substitute.
6. General open-to-offers match.

---

## 9. Right Lower Panels

### Want List Overview

Purpose: summarize collection goals and top wants.

Elements:

- Title: `YOUR WANT LIST OVERVIEW`.
- Count, for example `12 cards`.
- Set completion progress bar.
- Percent complete, for example `68%`.
- Top priority want thumbnails.
- `View All` link.
- `+8` overflow tile.

UX behavior:

- Click a wanted card to open its card detail page filtered to users who have it.
- Click progress to open set collection view.
- Top priority wants should be sorted by user priority, set completion impact, or rarity.

### Trading Tools

Purpose: lightweight utility settings for the marketplace.

Suggested rows:

```txt
Auto-Match
Get notified of new matches
[On toggle]

Price Tracker
Track card value changes
[On toggle]
```

Behavior:

- Auto-Match toggle controls notifications for new matches.
- Price Tracker can track values but should not imply integrated payment.

---

## 10. Disabled Payments & Shipping Requirements

Payment and shipping features should be present in the architecture and UI shell, but unavailable in the current release.

### Feature Flags

Use explicit flags:

```ts
const marketplaceFeatureFlags = {
  paymentsEnabled: false,
  shippingEnabled: false,
  checkoutEnabled: false,
  shippingLabelsEnabled: false,
};
```

### UI Rules

When disabled:

- Do not show `Buy Now`.
- Do not show `Checkout`.
- Do not collect card/payment information.
- Do not generate labels.
- Do not show package tracking as active.
- Do not calculate taxes or transaction fees.
- Do not imply the site is processing money.

Allowed:

- Display listing value/asking price.
- Display `For Sale` as listing intent.
- Display disabled badges such as `Payments Disabled`.
- Display future module cards labelled `Planned` or `Coming Later`.
- Allow messaging or trade offers.

### Disabled State Copy

Recommended copy:

```txt
Payments are disabled for this release.
Sales can be listed for reference, but transactions must be handled outside the app until checkout is enabled.
```

```txt
Shipping labels are planned for a future update.
No shipping purchase or label generation is available yet.
```

### Backend Rules

Even if future database tables exist, the app should block payment/shipping actions at API level.

Suggested guard behavior:

```ts
if (!marketplaceFeatureFlags.checkoutEnabled) {
  throw new Error("Checkout is disabled for this release.");
}
```

---

## 11. Core Component Inventory

### Layout Components

- `MarketplacePage`
- `MarketplaceShell`
- `MarketplaceHeader`
- `FilterSidebar`
- `ListingsGrid`
- `ListingCard`
- `MyPostedCardsTable`
- `MatchSidebar`
- `MatchCard`
- `WantListOverview`
- `TradingToolsPanel`
- `DisabledFutureFeaturesPanel`

### Modal / Drawer Components

- `CreateListingModal`
- `EditListingModal`
- `TradeOfferModal`
- `ListingDetailsDrawer`
- `MatchDetailsDrawer`
- `WantListPickerModal`

### UI Primitive Components

- `Badge`
- `ConditionPill`
- `RarityIcon`
- `UserReputationChip`
- `CardThumbnail`
- `AvatarStack`
- `SegmentedControl`
- `RangeSlider`
- `DisabledFeatureRow`
- `EmptyState`
- `LoadingSkeleton`

---

## 12. Suggested Data Shapes

### Card

```ts
type WardCard = {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  cardNumber: string;
  rarity: "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary" | "Mythic";
  imageUrl: string;
  colorIdentity?: string[];
};
```

### Listing

```ts
type MarketplaceListing = {
  id: string;
  cardId: string;
  ownerId: string;
  listingType: "trade" | "sale";
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  quantity: number;
  valueUsd?: number | null;
  tradeOnly: boolean;
  wantsDescription?: string | null;
  status: "active" | "pending" | "closed" | "unavailable";
  createdAt: string;
  updatedAt: string;
};
```

### Want List Item

```ts
type WantListItem = {
  id: string;
  userId: string;
  cardId: string;
  priority: "low" | "medium" | "high";
  targetCondition?: "NM" | "LP" | "MP" | "HP" | "DMG";
  desiredQuantity: number;
};
```

### Match Result

```ts
type MarketplaceMatch = {
  id: string;
  matchType: "good_match" | "needs_your_card" | "mutual_trade" | "set_completion";
  currentUserListingId?: string;
  otherUserListingId?: string;
  currentUserNeedsCardId?: string;
  otherUserNeedsCardId?: string;
  otherUserId: string;
  score: number;
  reason: string;
  createdAt: string;
};
```

---

## 13. Main User Flows

### Browse Listings

1. User opens Marketplace.
2. Listings load by newest or best match.
3. User filters by set, rarity, condition, trade/sale, availability.
4. User clicks a listing.
5. User can view details, message poster, or offer trade.

### Create Post

1. User clicks `+ New Post`.
2. User selects card they have.
3. User sets condition and quantity.
4. User chooses `For Trade` or `For Sale`.
5. User enters wants, value, or notes.
6. User publishes post.
7. App recalculates matches.

### Offer Trade

1. User clicks `Offer Trade`.
2. Modal shows card they want and their available cards.
3. User selects offered card(s).
4. User adds optional message.
5. User submits offer.
6. Other user receives notification.

### View Match

1. User clicks `View Match`.
2. Drawer shows both users and relevant cards.
3. User can send trade offer or message.
4. User can save, dismiss, or mark not interested.

### Manage Want List

1. User opens want list.
2. Adds card with priority and target condition.
3. App updates match sidebar.
4. Set completion progress recalculates.

---

## 14. UX States and Feedback

### Loading

Use skeleton panels for:

- Listing grid.
- Match cards.
- My posted cards table.
- Want list thumbnails.

### Empty States

Examples:

```txt
No active listings match your filters.
Try clearing rarity, condition, or set filters.
```

```txt
No matches yet.
Add cards to your want list or post cards you have to unlock match suggestions.
```

### Success States

Examples:

```txt
Post created. We found 4 possible matches.
```

```txt
Trade offer sent to MysticMage.
```

### Error States

Examples:

```txt
This listing is no longer available.
```

```txt
Checkout is disabled for this release.
```

---

## 15. Responsive Behavior

### Desktop

- Three-column layout.
- Listings display 3–4 columns depending on viewport width.
- Right sidebar remains visible.
- Left filters can be sticky.

### Tablet

- Header remains full width.
- Left filters become collapsible drawer.
- Right match sidebar may move below listings or become a tab.
- Listings display 2–3 columns.

### Mobile

- Top nav compresses to logo, search icon, menu.
- Filters become bottom sheet or drawer.
- Listings become single-column cards.
- Match panel becomes its own tab or carousel.
- My Posted Cards table converts to stacked cards.

---

## 16. Accessibility Requirements

- Maintain strong contrast between text and dark backgrounds.
- All controls must be keyboard accessible.
- Use visible focus rings.
- Tabs require ARIA roles.
- Toggle states should be announced to screen readers.
- Card images require meaningful alt text.
- Badges should not rely on color only; include text labels.
- Disabled payment/shipping features should use `aria-disabled="true"` where appropriate.
- Avoid tiny unreadable metadata; keep minimum functional text around 12px.

---

## 17. Implementation Notes for WARD App

### Suggested Route

```txt
/marketplace
```

Optional subroutes:

```txt
/marketplace/listings
/marketplace/wants
/marketplace/posts
/marketplace/matches
/marketplace/listings/[listingId]
/marketplace/matches/[matchId]
```

### Suggested File Structure

```txt
src/
  app/
    marketplace/
      page.tsx
      loading.tsx
  components/
    marketplace/
      MarketplaceHeader.tsx
      FilterSidebar.tsx
      ListingsGrid.tsx
      ListingCard.tsx
      MyPostedCardsTable.tsx
      MatchSidebar.tsx
      MatchCard.tsx
      WantListOverview.tsx
      TradingToolsPanel.tsx
      DisabledPaymentsShippingPanel.tsx
      CreateListingModal.tsx
      TradeOfferModal.tsx
  lib/
    marketplace/
      featureFlags.ts
      mockData.ts
      matchScoring.ts
      types.ts
```

### Initial Build Approach

Start with mock data and static UI. Then connect real data after the layout and interactions are stable.

Recommended phases:

1. Build static marketplace dashboard.
2. Add mock data arrays and reusable components.
3. Add filters/search/sort locally.
4. Add create/edit listing modal.
5. Add want-list management.
6. Add match scoring logic.
7. Add persistence/backend integration.
8. Add notifications/messages.
9. Keep payment/shipping modules disabled behind feature flags.

---

## 18. Acceptance Criteria

The implementation is successful when:

- The marketplace page visually matches the dark WARD trading hub direction.
- Users can clearly distinguish listings, posted cards, matches, and wants.
- The right sidebar clearly shows who has or needs the user’s cards.
- Mutual trade opportunities are easy to identify.
- `My Posted Cards` shows active posts and match counts.
- Payments and shipping are visible as future modules but disabled.
- No active checkout or shipping label flow is reachable.
- UI works with mock data before backend integration.
- Layout remains usable on desktop, tablet, and mobile.

---

## 19. Build Prompt for a Coding Agent

Use this prompt to generate the marketplace implementation:

```txt
Build a WARD fan website marketplace dashboard based on the WARD Marketplace UI / UX Reference Sheet.

Create a modern dark fantasy trading-card marketplace page for the WARD app. The page should prioritize card trading, listing management, want-list matching, and user-to-user discovery. Payment and shipping features must be architected but disabled.

Implement a desktop-first responsive marketplace page with:
- top navigation/header with WARD branding, global search, marketplace tabs, notifications, and user profile area;
- left filter sidebar with trade/sale toggle, set filter, rarity filter, condition pills, value/price range, availability, other filters, apply/reset actions, and a disabled Payments & Shipping panel;
- center Active WARD Listings grid with listing cards showing card art, card name, set, rarity, card number, condition, quantity, seller reputation, listing type, value, and action buttons;
- lower My Posted Cards table showing the current user's posted cards, quantities, wants, listing type, value, match counts, views, and actions;
- right sidebar showing People Who Have / Need Your Cards with tabs for All Matches, Need Your Cards, and You Need;
- match cards for Good Match, Needs Your Card, Mutual Trade, and Set Completion Match;
- want-list overview panel with completion progress and priority wants;
- trading tools panel with Auto-Match and Price Tracker toggles.

Use mock WARD card data first. Example cards: Drakemaw Overlord, Aether Sentinel, Void Herald, Sylvan Warden, Radiant Paladin, Gravecaller Adept, Riftstorm Phoenix, and Frostbound Citadel.

Important constraints:
- Do not implement active checkout.
- Do not implement payment capture.
- Do not implement shipping label generation.
- Do not show Buy Now or Checkout CTAs.
- For Sale listings may show value/asking price only as metadata.
- Add feature flags for paymentsEnabled, shippingEnabled, checkoutEnabled, and shippingLabelsEnabled, all false by default.
- Disabled payment/shipping UI should be visible but greyed out and labelled Disabled or Planned for a future update.

Focus on clean component structure, reusable marketplace components, accessible controls, responsive layout, and a polished dark fantasy UI matching the reference image.
```
