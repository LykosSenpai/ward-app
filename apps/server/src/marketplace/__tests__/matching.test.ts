import test from "node:test";
import assert from "node:assert/strict";

import { buildMatchId, scoreMarketplaceMatch } from "../matching.js";

test("buildMatchId is deterministic", () => {
  assert.equal(buildMatchId("a", "b", "MUTUAL_TRADE_MATCH"), "a:b:MUTUAL_TRADE_MATCH");
});

test("mutual trade scores higher than one-way trade", () => {
  const mutual = scoreMarketplaceMatch({ type: "MUTUAL_TRADE_MATCH", matchedQuantity: 2, reciprocalQuantity: 2 });
  const oneWay = scoreMarketplaceMatch({ type: "THEY_HAVE_WHAT_I_NEED", matchedQuantity: 2, reciprocalQuantity: 0 });
  assert.ok(mutual.score > oneWay.score);
});

test("recent activity increases score", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString();
  const recent = scoreMarketplaceMatch({ type: "I_HAVE_WHAT_THEY_NEED", matchedQuantity: 1, reciprocalQuantity: 0, sourceUpdatedAt: now, targetUpdatedAt: now });
  const stale = scoreMarketplaceMatch({ type: "I_HAVE_WHAT_THEY_NEED", matchedQuantity: 1, reciprocalQuantity: 0, sourceUpdatedAt: old, targetUpdatedAt: old });
  assert.ok(recent.score > stale.score);
});
