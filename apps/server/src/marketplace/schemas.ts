import { z } from "zod";

export const marketplaceListingCreateSchema = z.object({
  cardId: z.string().trim().min(1),
  quantity: z.number().int().positive().default(1),
  listingType: z.enum(["TRADE_ONLY", "SELL_ONLY", "TRADE_OR_SELL"]).default("TRADE_ONLY"),
  status: z.enum(["OPEN", "PENDING", "CLOSED"]).default("OPEN"),
  preferredReturn: z.string().trim().max(280).optional(),
  description: z.string().trim().max(1200).optional(),
  gameId: z.string().trim().optional()
});

export const marketplaceListingUpdateSchema = marketplaceListingCreateSchema.partial().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required for update."
});

export const marketplaceWantCreateSchema = z.object({
  cardId: z.string().trim().min(1),
  desiredQuantity: z.number().int().positive().default(1),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "TOP"]).default("MEDIUM"),
  notes: z.string().trim().max(600).optional(),
  gameId: z.string().trim().optional()
});

export const marketplaceWantUpdateSchema = marketplaceWantCreateSchema.partial().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required for update."
});

export const marketplaceTradeOfferCreateSchema = z.object({
  recipientUserId: z.string().trim().min(1),
  message: z.string().trim().max(1000).optional()
});

export const marketplaceTradeOfferUpdateSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "COUNTERED", "CANCELED", "COMPLETED_MANUALLY"]),
  message: z.string().trim().max(1000).optional()
});

export const marketplaceMessageThreadCreateSchema = z.object({
  otherUserId: z.string().trim().min(1),
  relatedPostId: z.string().trim().optional(),
  relatedTradeOfferId: z.string().trim().optional()
});

export const marketplaceMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const marketplaceMatchUpdateSchema = z.object({
  status: z.enum(["NEW", "VIEWED", "SAVED", "DISMISSED"])
});

export const marketplaceListingsQuerySchema = z.object({
  q: z.string().trim().optional(),
  listingType: z.enum(["TRADE_ONLY", "SELL_ONLY", "TRADE_OR_SELL"]).optional(),
  gameId: z.string().trim().optional()
});

export const marketplaceMatchesQuerySchema = z.object({
  type: z.enum(["ALL", "THEY_HAVE_WHAT_I_NEED", "I_HAVE_WHAT_THEY_NEED", "MUTUAL_TRADE_MATCH"]).optional(),
  status: z.enum(["NEW", "VIEWED", "SAVED", "DISMISSED"]).optional()
});

export const marketplacePaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const marketplaceCatalogQuerySchema = z.object({
  packId: z.string().trim().optional(),
  q: z.string().trim().optional()
});

export const marketplaceCardsQuerySchema = z.object({
  q: z.string().trim().optional(),
  packId: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(100).default(30)
});

export const marketplaceRecommendationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(8)
});
