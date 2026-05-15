export type MarketplaceFeatureFlags = {
  marketplace: boolean;
  tradeListings: boolean;
  wantLists: boolean;
  matchEngine: boolean;
  messaging: boolean;
  tradeOffers: boolean;
  checkout: boolean;
  payments: boolean;
  savedPaymentMethods: boolean;
  shipping: boolean;
  shippingLabels: boolean;
  trackingAutomation: boolean;
  escrow: boolean;
};

export const marketplaceFeatureFlags: MarketplaceFeatureFlags = {
  marketplace: true,
  tradeListings: true,
  wantLists: true,
  matchEngine: true,
  messaging: true,
  tradeOffers: true,
  checkout: false,
  payments: false,
  savedPaymentMethods: false,
  shipping: false,
  shippingLabels: false,
  trackingAutomation: false,
  escrow: false
};

export function assertMarketplaceFeatureEnabled(
  feature: keyof MarketplaceFeatureFlags,
  message?: string
): void {
  if (!marketplaceFeatureFlags[feature]) {
    throw new Error(message ?? `Feature '${feature}' is disabled for this release.`);
  }
}
