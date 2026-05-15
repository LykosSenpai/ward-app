import { Router } from "express";
import { fail, ok } from "../http.js";
import { singleItemResponseSchema, wantsListResponseSchema } from "../responseSchemas.js";
import { marketplacePaginationQuerySchema, marketplaceWantCreateSchema, marketplaceWantUpdateSchema } from "../schemas.js";

type WantItem = {
  id: string;
  userId: string;
  cardId: string;
  desiredQuantity: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
  notes?: string;
  updatedAt: string;
};

type WantsStore = {
  listByUser: (userId: string, args?: { page?: number; limit?: number }) => Promise<WantItem[]> | WantItem[];
  create: (userId: string, payload: Record<string, unknown>) => Promise<WantItem> | WantItem;
  update: (userId: string, id: string, payload: Record<string, unknown>) => Promise<WantItem | undefined> | WantItem | undefined;
  remove: (userId: string, id: string) => Promise<boolean> | boolean;
};

export function createWantsRouter(store: WantsStore): Router {
  const router = Router();

  function getUserId(req: { session?: { user?: { id?: string } } }): string {
    return String(req.session?.user?.id ?? "");
  }

  router.get("/wants", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const pagination = marketplacePaginationQuerySchema.safeParse(req.query ?? {});
    if (!pagination.success) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid pagination params."));
    const items = await store.listByUser(userId, { page: pagination.data.page, limit: pagination.data.limit });
    const response = ok({ items, total: items.length, page: pagination.data.page, limit: pagination.data.limit });
    wantsListResponseSchema.parse(response);
    return res.json(response);
  });

  router.post("/wants", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    try {
      const payload = marketplaceWantCreateSchema.parse(req.body ?? {});
      const item = await store.create(userId, payload as Record<string, unknown>);
      const response = ok({ item });
      singleItemResponseSchema.parse(response);
      return res.status(201).json(response);
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to create want."));
    }
  });

  router.patch("/wants/:id", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const id = String(req.params.id ?? "");
    try {
      const payload = marketplaceWantUpdateSchema.parse(req.body ?? {});
      const item = await store.update(userId, id, payload as Record<string, unknown>);
      if (!item) return res.status(404).json(fail("NOT_FOUND", "Want not found."));
      const response = ok({ item });
      singleItemResponseSchema.parse(response);
      return res.json(response);
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to update want."));
    }
  });

  router.delete("/wants/:id", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const id = String(req.params.id ?? "");
    if (!(await store.remove(userId, id))) return res.status(404).json(fail("NOT_FOUND", "Want not found."));
    return res.status(204).send();
  });

  return router;
}
