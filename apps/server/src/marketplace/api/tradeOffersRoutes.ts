import { Router } from "express";
import { fail, ok } from "../http.js";
import { singleItemResponseSchema, tradeOffersListResponseSchema } from "../responseSchemas.js";
import { marketplacePaginationQuerySchema, marketplaceTradeOfferCreateSchema, marketplaceTradeOfferUpdateSchema } from "../schemas.js";

type TradeOfferStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "CANCELED" | "COMPLETED_MANUALLY";

type TradeOffer = {
  id: string;
  createdByUserId: string;
  recipientUserId: string;
  status: TradeOfferStatus;
  message?: string;
  createdAt: string;
  updatedAt: string;
};

type TradeOfferStore = {
  listForUser: (userId: string, args?: { page?: number; limit?: number }) => Promise<TradeOffer[]> | TradeOffer[];
  create: (userId: string, payload: Record<string, unknown>) => Promise<TradeOffer> | TradeOffer;
  getById: (userId: string, offerId: string) => Promise<TradeOffer | undefined> | TradeOffer | undefined;
  updateStatus: (userId: string, offerId: string, status: TradeOfferStatus, message?: string) => Promise<TradeOffer | undefined> | TradeOffer | undefined;
};

const allowedStatuses: TradeOfferStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "COUNTERED", "CANCELED", "COMPLETED_MANUALLY"];

export function createTradeOffersRouter(store: TradeOfferStore): Router {
  const router = Router();
  const getUserId = (req: { session?: { user?: { id?: string } } }) => String(req.session?.user?.id ?? "");

  router.get("/trade-offers", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const pagination = marketplacePaginationQuerySchema.safeParse(req.query ?? {});
    if (!pagination.success) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid pagination params."));
    const items = await store.listForUser(userId, { page: pagination.data.page, limit: pagination.data.limit });
    const response = ok({ items, total: items.length, page: pagination.data.page, limit: pagination.data.limit });
    tradeOffersListResponseSchema.parse(response);
    return res.json(response);
  });

  router.post("/trade-offers", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    try {
      const payload = marketplaceTradeOfferCreateSchema.parse(req.body ?? {});
      const item = await store.create(userId, payload as Record<string, unknown>);
      const response = ok({ item });
      singleItemResponseSchema.parse(response);
      return res.status(201).json(response);
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to create offer."));
    }
  });

  router.get("/trade-offers/:id", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const item = await store.getById(userId, String(req.params.id ?? ""));
    if (!item) return res.status(404).json(fail("NOT_FOUND", "Trade offer not found."));
    const response = ok({ item });
    singleItemResponseSchema.parse(response);
    return res.json(response);
  });

  router.patch("/trade-offers/:id", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    try {
      const payload = marketplaceTradeOfferUpdateSchema.parse(req.body ?? {});
      const status = payload.status;
      if (!allowedStatuses.includes(status as TradeOfferStatus)) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid status."));
      const item = await store.updateStatus(userId, String(req.params.id ?? ""), status as TradeOfferStatus, payload.message);
      if (!item) return res.status(404).json(fail("NOT_FOUND", "Trade offer not found."));
      const response = ok({ item });
      singleItemResponseSchema.parse(response);
      return res.json(response);
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid request payload."));
    }
  });

  for (const [suffix, status] of [["accept", "ACCEPTED"], ["reject", "REJECTED"], ["counter", "COUNTERED"], ["cancel", "CANCELED"], ["complete-manually", "COMPLETED_MANUALLY"]] as const) {
    router.post(`/trade-offers/:id/${suffix}`, async (req, res) => {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
      try {
        const item = await store.updateStatus(userId, String(req.params.id ?? ""), status, typeof req.body?.message === "string" ? req.body.message : undefined);
        if (!item) return res.status(404).json(fail("NOT_FOUND", "Trade offer not found."));
        const response = ok({ item });
        singleItemResponseSchema.parse(response);
        return res.json(response);
      } catch (error) {
        return res.status(403).json(fail("FORBIDDEN", error instanceof Error ? error.message : "Trade offer action not allowed."));
      }
    });
  }

  return router;
}
