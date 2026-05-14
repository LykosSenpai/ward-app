export type MarketplacePostStatus = "OPEN" | "PENDING" | "CLOSED";

export type MarketplaceListingKind = "TRADE" | "SALE";

export type MarketplacePostLineItem = {
  cardId: string;
  name?: string;
  variant?: string;
  quantity: number;
  trade?: boolean;
  sale?: boolean;
  price?: string;
};

export const MARKETPLACE_STATUS_LABELS: Record<MarketplacePostStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  CLOSED: "Closed"
};

export const MARKETPLACE_LISTING_VARIANT_LABELS: Record<MarketplaceListingKind, string> = {
  TRADE: "Trade",
  SALE: "Sale"
};

export function formatCurrencyUsd(price: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

export function splitManualItems(value: string): string[] {
  return value
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean);
}

export function joinManualItems(items: string[]): string {
  return items.join("\n");
}

export function getMarketplaceVariantLabel(variant?: string): string {
  switch (variant) {
    case "holo":
    case "HOLO":
      return "Holo";
    case "zero-art":
    case "ZERO":
      return "Zero";
    case "zero-art-holo":
    case "ZERO_HOLO":
      return "Zero Holo";
    default:
      return "Default";
  }
}
