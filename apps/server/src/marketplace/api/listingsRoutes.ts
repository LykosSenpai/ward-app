import { Router } from "express";
import { MARKETPLACE_GAME } from "../catalog.js";
import { fail, ok } from "../http.js";
import { listingsListResponseSchema, singleItemResponseSchema } from "../responseSchemas.js";
import { marketplaceListingCreateSchema, marketplaceListingUpdateSchema, marketplaceListingsQuerySchema, marketplacePaginationQuerySchema } from "../schemas.js";

type ListingReader = {
  list: (args?: { page?: number; limit?: number }) => Promise<unknown[]> | unknown[];
  getById: (id: string) => Promise<unknown | undefined> | unknown | undefined;
  create?: (userId: string, payload: Record<string, unknown>) => Promise<unknown> | unknown;
  update?: (userId: string, listingId: string, payload: Record<string, unknown>) => Promise<unknown> | unknown;
  remove?: (userId: string, listingId: string) => Promise<boolean> | boolean;
};

export function createMarketplaceListingsRouter(reader: ListingReader): Router {
  const router = Router();

  router.get("/marketplace/listings", async (req, res) => {
    const query = marketplaceListingsQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      res.status(400).json(fail("VALIDATION_ERROR", "Invalid listings query params."));
      return;
    }
    const pagination = marketplacePaginationQuerySchema.safeParse(req.query ?? {});
    if (!pagination.success) {
      res.status(400).json(fail("VALIDATION_ERROR", "Invalid pagination params."));
      return;
    }
    const gameId = String(query.data.gameId ?? "").trim();
    if (gameId && gameId !== MARKETPLACE_GAME.id) {
      res.json(ok({ items: [], total: 0 }));
      return;
    }
    const q = String(query.data.q ?? "").trim().toLowerCase();
    const listingType = String(query.data.listingType ?? "").trim();

    const items = (await reader.list({ page: pagination.data.page, limit: pagination.data.limit })).filter(item => {
      const data = item as Record<string, unknown>;
      const cardName = String(data.cardName ?? data.cardId ?? "").toLowerCase();
      const displayName = String(data.displayName ?? "").toLowerCase();
      const type = String(data.listingType ?? "");

      if (q && !cardName.includes(q) && !displayName.includes(q)) return false;
      if (listingType && listingType !== type) return false;
      return true;
    });

    const response = ok({ items, total: items.length, page: pagination.data.page, limit: pagination.data.limit });
    listingsListResponseSchema.parse(response);
    res.json(response);
  });

  router.get("/marketplace/listings/:id", async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const item = await reader.getById(id);
    if (!item) {
      res.status(404).json(fail("NOT_FOUND", "Listing not found."));
      return;
    }
    const response = ok({ item });
    singleItemResponseSchema.parse(response);
    res.json(response);
  });

  router.post("/marketplace/listings", async (req, res) => {
    if (!reader.create) {
      res.status(400).json(fail("BAD_REQUEST", "Listing creation is not configured."));
      return;
    }
    const userId = String((req.session as { user?: { id?: string } } | undefined)?.user?.id ?? "");
    if (!userId) {
      res.status(401).json(fail("UNAUTHORIZED", "Login required."));
      return;
    }
    try {
      const payload = marketplaceListingCreateSchema.parse(req.body ?? {});
      const created = await reader.create(userId, payload as Record<string, unknown>);
      const response = ok({ item: created });
      singleItemResponseSchema.parse(response);
      res.status(201).json(response);
    } catch (error) {
      res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to create listing."));
    }
  });

  router.patch("/marketplace/listings/:id", async (req, res) => {
    if (!reader.update) {
      res.status(400).json(fail("BAD_REQUEST", "Listing updates are not configured."));
      return;
    }
    const userId = String((req.session as { user?: { id?: string } } | undefined)?.user?.id ?? "");
    if (!userId) {
      res.status(401).json(fail("UNAUTHORIZED", "Login required."));
      return;
    }
    const id = String(req.params.id ?? "").trim();
    try {
      const payload = marketplaceListingUpdateSchema.parse(req.body ?? {});
      const updated = await reader.update(userId, id, payload as Record<string, unknown>);
      if (!updated) {
        res.status(404).json(fail("NOT_FOUND", "Listing not found."));
        return;
      }
      const response = ok({ item: updated });
      singleItemResponseSchema.parse(response);
      res.json(response);
    } catch (error) {
      res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to update listing."));
    }
  });

  router.delete("/marketplace/listings/:id", async (req, res) => {
    if (!reader.remove) {
      res.status(400).json(fail("BAD_REQUEST", "Listing deletion is not configured."));
      return;
    }
    const userId = String((req.session as { user?: { id?: string } } | undefined)?.user?.id ?? "");
    if (!userId) {
      res.status(401).json(fail("UNAUTHORIZED", "Login required."));
      return;
    }
    const id = String(req.params.id ?? "").trim();
    try {
      const removed = await reader.remove(userId, id);
      if (!removed) {
        res.status(404).json(fail("NOT_FOUND", "Listing not found."));
        return;
      }
      res.status(204).send();
    } catch (error) {
      res.status(400).json(fail("BAD_REQUEST", error instanceof Error ? error.message : "Unable to delete listing."));
    }
  });

  return router;
}
