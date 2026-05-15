import { randomUUID } from "node:crypto";

import { getDbPool } from "../../db/pool.js";

export type MarketplaceMessageThreadRecord = {
  id: string;
  participantUserIds: string[];
  relatedPostId?: string;
  relatedTradeOfferId?: string;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceMessageRecord = {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
};

export async function listMarketplaceThreadsForUser(userId: string, args?: { page?: number; limit?: number }): Promise<MarketplaceMessageThreadRecord[]> {
  const page = Math.max(1, args?.page ?? 1);
  const limit = Math.max(1, Math.min(args?.limit ?? 20, 100));
  const offset = (page - 1) * limit;
  const result = await getDbPool().query<{
    id: string;
    related_post_id: string | null;
    related_trade_offer_id: string | null;
    created_at: string;
    updated_at: string;
    participant_user_ids: string[];
  }>(
    `select t.id,
            t.related_post_id,
            t.related_trade_offer_id,
            t.created_at,
            t.updated_at,
            array_agg(p.user_id order by p.user_id) as participant_user_ids
       from marketplace_message_threads t
       join marketplace_message_thread_participants p on p.thread_id = t.id
      where t.id in (
        select thread_id from marketplace_message_thread_participants where user_id = $1
      )
      group by t.id, t.related_post_id, t.related_trade_offer_id, t.created_at, t.updated_at
      order by t.updated_at desc
      limit $2 offset $3`,
    [userId, limit, offset]
  );

  return result.rows.map(row => ({
    id: row.id,
    participantUserIds: row.participant_user_ids,
    relatedPostId: row.related_post_id ?? undefined,
    relatedTradeOfferId: row.related_trade_offer_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function createMarketplaceThread(args: {
  requesterUserId: string;
  otherUserId: string;
  relatedPostId?: string;
  relatedTradeOfferId?: string;
}): Promise<MarketplaceMessageThreadRecord> {
  const existing = await getDbPool().query<{ thread_id: string }>(
    `select p1.thread_id
       from marketplace_message_thread_participants p1
       join marketplace_message_thread_participants p2 on p2.thread_id = p1.thread_id
      where p1.user_id = $1 and p2.user_id = $2
      limit 1`,
    [args.requesterUserId, args.otherUserId]
  );
  if (existing.rows[0]?.thread_id) {
    const existingThread = await getMarketplaceThreadForUser({
      userId: args.requesterUserId,
      threadId: existing.rows[0].thread_id,
      page: 1,
      limit: 1
    });
    if (existingThread) return existingThread.thread;
  }

  const threadId = randomUUID();
  const participantA = randomUUID();
  const participantB = randomUUID();
  await getDbPool().query("begin");
  try {
    await getDbPool().query(
      `insert into marketplace_message_threads (id, related_post_id, related_trade_offer_id)
       values ($1,$2,$3)`,
      [threadId, args.relatedPostId ?? null, args.relatedTradeOfferId ?? null]
    );
    await getDbPool().query(
      `insert into marketplace_message_thread_participants (id, thread_id, user_id)
       values ($1,$2,$3), ($4,$2,$5)`,
      [participantA, threadId, args.requesterUserId, participantB, args.otherUserId]
    );
    await getDbPool().query("commit");
  } catch (error) {
    await getDbPool().query("rollback");
    throw error;
  }

  return {
    id: threadId,
    participantUserIds: [args.requesterUserId, args.otherUserId],
    relatedPostId: args.relatedPostId,
    relatedTradeOfferId: args.relatedTradeOfferId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export async function getMarketplaceThreadForUser(args: { userId: string; threadId: string; page?: number; limit?: number }): Promise<{ thread: MarketplaceMessageThreadRecord; messages: MarketplaceMessageRecord[] } | undefined> {
  const page = Math.max(1, args.page ?? 1);
  const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
  const offset = (page - 1) * limit;
  const allowed = await getDbPool().query<{ ok: number }>(
    `select 1 as ok from marketplace_message_thread_participants where thread_id = $1 and user_id = $2`,
    [args.threadId, args.userId]
  );
  if (!allowed.rows[0]) return undefined;

  const threadResult = await getDbPool().query<{
    id: string;
    related_post_id: string | null;
    related_trade_offer_id: string | null;
    created_at: string;
    updated_at: string;
    participant_user_ids: string[];
  }>(
    `select t.id,
            t.related_post_id,
            t.related_trade_offer_id,
            t.created_at,
            t.updated_at,
            array_agg(p.user_id order by p.user_id) as participant_user_ids
       from marketplace_message_threads t
       join marketplace_message_thread_participants p on p.thread_id = t.id
      where t.id = $1
      group by t.id, t.related_post_id, t.related_trade_offer_id, t.created_at, t.updated_at`,
    [args.threadId]
  );

  const threadRow = threadResult.rows[0];
  if (!threadRow) return undefined;

  const messagesResult = await getDbPool().query<{
    id: string;
    thread_id: string;
    sender_user_id: string;
    body: string;
    created_at: string;
  }>(
    `select id, thread_id, sender_user_id, body, created_at
       from marketplace_messages
      where thread_id = $1
      order by created_at asc
      limit $2 offset $3`,
    [args.threadId, limit, offset]
  );

  return {
    thread: {
      id: threadRow.id,
      participantUserIds: threadRow.participant_user_ids,
      relatedPostId: threadRow.related_post_id ?? undefined,
      relatedTradeOfferId: threadRow.related_trade_offer_id ?? undefined,
      createdAt: threadRow.created_at,
      updatedAt: threadRow.updated_at
    },
    messages: messagesResult.rows.map(row => ({
      id: row.id,
      threadId: row.thread_id,
      senderUserId: row.sender_user_id,
      body: row.body,
      createdAt: row.created_at
    }))
  };
}

export async function addMarketplaceMessage(args: { userId: string; threadId: string; body: string }): Promise<MarketplaceMessageRecord | undefined> {
  const allowed = await getDbPool().query<{ ok: number }>(
    `select 1 as ok from marketplace_message_thread_participants where thread_id = $1 and user_id = $2`,
    [args.threadId, args.userId]
  );
  if (!allowed.rows[0]) return undefined;

  const id = randomUUID();
  const result = await getDbPool().query<{
    id: string;
    thread_id: string;
    sender_user_id: string;
    body: string;
    created_at: string;
  }>(
    `insert into marketplace_messages (id, thread_id, sender_user_id, body)
     values ($1,$2,$3,$4)
     returning id, thread_id, sender_user_id, body, created_at`,
    [id, args.threadId, args.userId, args.body]
  );
  await getDbPool().query(`update marketplace_message_threads set updated_at = now() where id = $1`, [args.threadId]);

  const row = result.rows[0];
  return {
    id: row.id,
    threadId: row.thread_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    createdAt: row.created_at
  };
}

export async function listMarketplaceMessagesForThread(args: { userId: string; threadId: string; page?: number; limit?: number }): Promise<MarketplaceMessageRecord[] | undefined> {
  const page = Math.max(1, args.page ?? 1);
  const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
  const offset = (page - 1) * limit;

  const allowed = await getDbPool().query<{ ok: number }>(
    `select 1 as ok from marketplace_message_thread_participants where thread_id = $1 and user_id = $2`,
    [args.threadId, args.userId]
  );
  if (!allowed.rows[0]) return undefined;

  const result = await getDbPool().query<{
    id: string;
    thread_id: string;
    sender_user_id: string;
    body: string;
    created_at: string;
  }>(
    `select id, thread_id, sender_user_id, body, created_at
       from marketplace_messages
      where thread_id = $1
      order by created_at asc
      limit $2 offset $3`,
    [args.threadId, limit, offset]
  );

  return result.rows.map(row => ({
    id: row.id,
    threadId: row.thread_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    createdAt: row.created_at
  }));
}
