import { Router } from "express";
import { fail, ok } from "../http.js";
import { messageThreadDetailResponseSchema, messagesThreadsListResponseSchema, singleItemResponseSchema } from "../responseSchemas.js";
import { marketplaceMessageCreateSchema, marketplaceMessageThreadCreateSchema, marketplacePaginationQuerySchema } from "../schemas.js";

type MessageThread = {
  id: string;
  participantUserIds: string[];
  relatedPostId?: string;
  relatedTradeOfferId?: string;
  createdAt: string;
  updatedAt: string;
};

type MessageRecord = {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
};

type MessagesStore = {
  listThreadsForUser: (userId: string, args?: { page?: number; limit?: number }) => Promise<MessageThread[]> | MessageThread[];
  createThread: (userId: string, payload: Record<string, unknown>) => Promise<MessageThread> | MessageThread;
  getThreadForUser: (userId: string, threadId: string, args?: { page?: number; limit?: number }) => Promise<{ thread: MessageThread; messages: MessageRecord[] } | undefined> | { thread: MessageThread; messages: MessageRecord[] } | undefined;
  listMessagesForThread: (userId: string, threadId: string, args?: { page?: number; limit?: number }) => Promise<MessageRecord[] | undefined> | MessageRecord[] | undefined;
  addMessage: (userId: string, threadId: string, payload: Record<string, unknown>) => Promise<MessageRecord | undefined> | MessageRecord | undefined;
};

export function createMessagesRouter(store: MessagesStore): Router {
  const router = Router();
  const getUserId = (req: { session?: { user?: { id?: string } } }) => String(req.session?.user?.id ?? "");

  router.get("/messages/threads", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const pagination = marketplacePaginationQuerySchema.safeParse(req.query ?? {});
    if (!pagination.success) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid pagination params."));
    const items = await store.listThreadsForUser(userId, { page: pagination.data.page, limit: pagination.data.limit });
    const response = ok({ items, total: items.length, page: pagination.data.page, limit: pagination.data.limit });
    messagesThreadsListResponseSchema.parse(response);
    return res.json(response);
  });

  router.post("/messages/threads", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    try {
      const payload = marketplaceMessageThreadCreateSchema.parse(req.body ?? {});
      const thread = await store.createThread(userId, payload as Record<string, unknown>);
      const response = ok({ thread });
      singleItemResponseSchema.parse({ ok: true, data: { item: thread } });
      return res.status(201).json(response);
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to create thread."));
    }
  });

  router.get("/messages/threads/:threadId", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const pagination = marketplacePaginationQuerySchema.safeParse(req.query ?? {});
    if (!pagination.success) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid pagination params."));
    const data = await store.getThreadForUser(userId, String(req.params.threadId ?? ""), { page: pagination.data.page, limit: pagination.data.limit });
    if (!data) return res.status(404).json(fail("NOT_FOUND", "Thread not found."));
    const response = ok(data);
    messageThreadDetailResponseSchema.parse(response);
    return res.json(response);
  });

  router.get("/messages/threads/:threadId/messages", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    const pagination = marketplacePaginationQuerySchema.safeParse(req.query ?? {});
    if (!pagination.success) return res.status(400).json(fail("VALIDATION_ERROR", "Invalid pagination params."));
    const items = await store.listMessagesForThread(userId, String(req.params.threadId ?? ""), { page: pagination.data.page, limit: pagination.data.limit });
    if (!items) return res.status(404).json(fail("NOT_FOUND", "Thread not found."));
    return res.json(ok({ items, total: items.length, page: pagination.data.page, limit: pagination.data.limit }));
  });

  router.post("/messages/threads/:threadId/messages", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json(fail("UNAUTHORIZED", "Login required."));
    try {
      const payload = marketplaceMessageCreateSchema.parse(req.body ?? {});
      const message = await store.addMessage(userId, String(req.params.threadId ?? ""), payload as Record<string, unknown>);
      if (!message) return res.status(404).json(fail("NOT_FOUND", "Thread not found."));
      const response = ok({ message });
      singleItemResponseSchema.parse({ ok: true, data: { item: message } });
      return res.status(201).json(response);
    } catch (error) {
      return res.status(400).json(fail("VALIDATION_ERROR", error instanceof Error ? error.message : "Unable to add message."));
    }
  });

  return router;
}
