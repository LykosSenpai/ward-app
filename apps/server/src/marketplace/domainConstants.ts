export const MARKETPLACE_LISTING_TYPES = ["TRADE_ONLY", "SELL_ONLY", "TRADE_OR_SELL"] as const;
export const MARKETPLACE_LISTING_STATUSES = ["OPEN", "PENDING", "CLOSED"] as const;

export type MarketplaceListingType = (typeof MARKETPLACE_LISTING_TYPES)[number];
export type MarketplaceListingStatus = (typeof MARKETPLACE_LISTING_STATUSES)[number];

export function isMarketplaceListingType(value: string): value is MarketplaceListingType {
  return (MARKETPLACE_LISTING_TYPES as readonly string[]).includes(value);
}

export function isMarketplaceListingStatus(value: string): value is MarketplaceListingStatus {
  return (MARKETPLACE_LISTING_STATUSES as readonly string[]).includes(value);
}
