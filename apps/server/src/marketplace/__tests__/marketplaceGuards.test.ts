import test from "node:test";
import assert from "node:assert/strict";

import { isMarketplaceListingStatus, isMarketplaceListingType } from "../domainConstants.js";
import { createCheckoutSessionDisabled, createShippingLabelDisabled, getCheckoutStatus, getShippingStatus } from "../services/disabledCommerceServices.js";
import { sanitizeMarketplaceText } from "../sanitize.js";
import { assertSingleGameId } from "../catalog.js";

test("listing type guard accepts valid values", () => {
  assert.equal(isMarketplaceListingType("TRADE_ONLY"), true);
  assert.equal(isMarketplaceListingType("SELL_ONLY"), true);
  assert.equal(isMarketplaceListingType("TRADE_OR_SELL"), true);
});

test("listing type guard rejects invalid values", () => {
  assert.equal(isMarketplaceListingType("FOR_TRADE"), false);
  assert.equal(isMarketplaceListingType(""), false);
});

test("listing status guard accepts valid values", () => {
  assert.equal(isMarketplaceListingStatus("OPEN"), true);
  assert.equal(isMarketplaceListingStatus("PENDING"), true);
  assert.equal(isMarketplaceListingStatus("CLOSED"), true);
});

test("disabled commerce status endpoints remain disabled by default", () => {
  assert.deepEqual(getCheckoutStatus(), {
    enabled: false,
    code: "CHECKOUT_DISABLED",
    message: "Integrated checkout is disabled for this release."
  });

  assert.deepEqual(getShippingStatus(), {
    enabled: false,
    code: "SHIPPING_DISABLED",
    message: "Platform shipping is disabled for this release."
  });
});

test("sanitizeMarketplaceText strips script tags and angle brackets", () => {
  const raw = `  <script>alert('x')</script><b>Hello</b>  `;
  assert.equal(sanitizeMarketplaceText(raw), "alert('x')bHello/b");
});

test("assertSingleGameId rejects unsupported games", () => {
  assert.doesNotThrow(() => assertSingleGameId("ward"));
  assert.throws(() => assertSingleGameId("mythic-realms"));
});

test("disabled commerce actions throw when flags are disabled", () => {
  assert.throws(() => createCheckoutSessionDisabled());
  assert.throws(() => createShippingLabelDisabled());
});
