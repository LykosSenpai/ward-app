import { assertMarketplaceFeatureEnabled, marketplaceFeatureFlags } from "../featureFlags.js";

export function getCheckoutStatus() {
  return {
    enabled: marketplaceFeatureFlags.checkout,
    code: marketplaceFeatureFlags.checkout ? "CHECKOUT_ENABLED" : "CHECKOUT_DISABLED",
    message: marketplaceFeatureFlags.checkout
      ? "Integrated checkout is available."
      : "Integrated checkout is disabled for this release."
  };
}

export function createCheckoutSessionDisabled() {
  assertMarketplaceFeatureEnabled(
    "checkout",
    "Integrated checkout is disabled for this release."
  );
}

export function getShippingStatus() {
  return {
    enabled: marketplaceFeatureFlags.shipping,
    code: marketplaceFeatureFlags.shipping ? "SHIPPING_ENABLED" : "SHIPPING_DISABLED",
    message: marketplaceFeatureFlags.shipping
      ? "Platform shipping is available."
      : "Platform shipping is disabled for this release."
  };
}

export function requestShippingRateDisabled() {
  assertMarketplaceFeatureEnabled(
    "shipping",
    "Platform shipping is disabled for this release."
  );
}

export function createShippingLabelDisabled() {
  assertMarketplaceFeatureEnabled(
    "shippingLabels",
    "Platform shipping labels are disabled for this release."
  );
}
