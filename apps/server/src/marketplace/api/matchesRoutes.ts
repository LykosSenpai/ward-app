import { Router } from "express";
import { fail, ok } from "../http.js";
import { matchesListResponseSchema, matchesSummaryResponseSchema } from "../responseSchemas.js";
import { marketplaceMatchUpdateSchema, marketplaceMatchesQuerySchema } from "../schemas.js";

type MatchStatus = "NEW" | "VIEWED" | "SAVED" | "DISMISSED";

type MatchStore = {
  listForUser: (userId: string, type?: string) => Promise<unknown[]> | unknown[];
  setStatus: (userId: string, matchId: string, status: MatchStatus) => Promise<boolean> | boolean;
};

const allowedStatuses: MatchStatus[] = ["NEW", "VIEWED", "SAVED", "DISMISSED"];

export function createMatchesRouter(store: MatchStore): Router {
  const router = Router();
  const getUserId = (req: { session?: { user?: { id?: string } } }) => String(req.session?.user?.id ?? "");

  router.get("/matches", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const query = marketplaceMatchesQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid matches query params."));
    const type = query.data.type;
    const items = await store.listForUser(userId, type);
    const response = ok({ items, total: items.length });
    matchesListResponseSchema.parse(response);
    return res.json(response);
  });

  router.get("/matches/summary", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const items = await store.listForUser(userId);
    const response = ok({ total: items.length });
    matchesSummaryResponseSchema.parse(response);
    return res.json(response);
  });

  router.patch("/matches/:id", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    try {
      const payload = marketplaceMatchUpdateSchema.parse(req.body ?? {});
      const status = payload.status;
      if (!allowedStatuses.includes(status as MatchStatus)) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid status."));
      const updated = await store.setStatus(userId, String(req.params.id ?? ""), status as MatchStatus);
      if (!updated) return res.status(404).json(fail("NOT_FOUND", "Match not found."));
      return res.json(ok({ ok: true }));
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid request payload."));
    }
  });

  return router;
}
