import {
  assertMaxPayloadSize,
  sanitizeDiscordHandle,
  sanitizeMarketplaceText,
  SocketEventRateLimiter
} from "./guards.js";
import { resolveMarketplaceOwner, type MarketplaceActorContext, type MarketplaceOwner } from "./ownership.js";

export type MarketplacePostWriteInput = {
  title: unknown;
  note: unknown;
  priceText: unknown;
  description: unknown;
  discordHandle: unknown;
  reportablePostId?: string;
};

export type MarketplacePostWriteRecord = {
  title: string;
  note: string;
  priceText: string;
  description: string;
  discordHandle: string;
  createdBy: MarketplaceOwner;
  reportablePostId: string;
};

const limiter = new SocketEventRateLimiter();

/**
 * Shared guard/hook for marketplace event handlers.
 *
 * Migration path note:
 * - Current ownership uses local display-name-derived keys.
 * - Replace actor.userId fallback behavior with authenticated user ids once hosted auth is enabled.
 * - Keep createdBy/internalUserKey writes so legacy posts can be mapped during backfill.
 */
export function buildMarketplacePostWrite(
  eventKey: string,
  actor: MarketplaceActorContext,
  payload: MarketplacePostWriteInput
): MarketplacePostWriteRecord {
  limiter.checkOrThrow(eventKey, 10);
  assertMaxPayloadSize(payload, 12_000);

  return {
    title: sanitizeMarketplaceText(payload.title, 120),
    note: sanitizeMarketplaceText(payload.note, 300),
    priceText: sanitizeMarketplaceText(payload.priceText, 40),
    description: sanitizeMarketplaceText(payload.description, 2_000),
    discordHandle: sanitizeDiscordHandle(payload.discordHandle),
    createdBy: resolveMarketplaceOwner(actor),
    reportablePostId: payload.reportablePostId?.trim() || `post_${Date.now()}`
  };
}
