import type { AuthUser } from "../auth/session.js";
import { getDbPool } from "../db/pool.js";

export type MarketplaceMatchType = "THEY_HAVE_WHAT_I_NEED" | "I_HAVE_WHAT_THEY_NEED" | "MUTUAL_TRADE_MATCH";
export type MarketplacePostItem = { cardId: string; variant?: string; quantity: number; pendingReservedQuantity?: number; trade?: boolean; sale?: boolean };
export type MarketplacePost = {
  id?: string;
  userId?: string;
  displayName?: string;
  discordHandle?: string;
  discord?: AuthUser["discord"];
  linkedPostId?: string;
  status?: "OPEN" | "PENDING" | "CLOSED";
  haveItems?: MarketplacePostItem[];
  needItems?: MarketplacePostItem[];
  listingKinds?: Array<"TRADE" | "SALE">;
  title?: string;
  description?: string;
  salePrice?: number;
  note?: string;
  gameId?: string;
  cardId?: string;
  quantity?: number;
  updatedAt?: string;
};
export type MarketplaceTradeLine = { cardId: string; quantity: number };
export type MarketplaceTransactionStatus = "PENDING_CONFIRMATION" | "CONFIRMED_BY_ONE_PARTY" | "COMPLETED" | "DENIED" | "CANCELED" | "EXPIRED";
export type MarketplaceTransaction = {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: MarketplaceTransactionStatus;
  requesterUserId: string;
  responderUserId: string;
  offered: MarketplaceTradeLine[];
  requested: MarketplaceTradeLine[];
  confirmedByUserIds: string[];
};

type PostRow = {
  id: string;
  user_id: string;
  post_data: MarketplacePost | string;
  status: MarketplacePost["status"];
  updated_at: Date | string;
};

type TransactionRow = {
  id: string;
  transaction_data: MarketplaceTransaction | string;
  status: MarketplaceTransactionStatus;
  expires_at: Date | string;
  updated_at: Date | string;
};

function parseJsonb<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizePost(row: PostRow): MarketplacePost {
  const post = parseJsonb<MarketplacePost>(row.post_data);
  return {
    ...post,
    id: row.id,
    userId: row.user_id,
    status: row.status ?? post.status ?? "OPEN",
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function normalizeTransaction(row: TransactionRow): MarketplaceTransaction {
  const transaction = parseJsonb<MarketplaceTransaction>(row.transaction_data);
  return {
    ...transaction,
    id: row.id,
    status: row.status,
    expiresAt: serializeTimestamp(row.expires_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

export async function listLegacyMarketplacePosts(): Promise<MarketplacePost[]> {
  const result = await getDbPool().query<PostRow>(
    `select id, user_id, post_data, status, updated_at
       from marketplace_socket_posts
      order by updated_at desc, id`
  );
  return result.rows.map(normalizePost);
}

export async function listLegacyMarketplacePostsByUser(userId: string): Promise<MarketplacePost[]> {
  const result = await getDbPool().query<PostRow>(
    `select id, user_id, post_data, status, updated_at
       from marketplace_socket_posts
      where user_id = $1
      order by updated_at desc, id`,
    [userId]
  );
  return result.rows.map(normalizePost);
}

export async function upsertLegacyMarketplacePost(post: MarketplacePost): Promise<void> {
  if (!post.id || !post.userId) {
    throw new Error("Marketplace post id and user id are required.");
  }

  const status = post.status ?? "OPEN";
  const updatedAt = post.updatedAt ? new Date(post.updatedAt) : new Date();
  await getDbPool().query(
    `insert into marketplace_socket_posts (id, user_id, post_data, status, updated_at)
     values ($1, $2, $3::jsonb, $4, $5)
     on conflict (id)
     do update set
       user_id = excluded.user_id,
       post_data = excluded.post_data,
       status = excluded.status,
       updated_at = excluded.updated_at`,
    [post.id, post.userId, JSON.stringify(post), status, updatedAt]
  );
}

export async function listLegacyMarketplaceTransactions(): Promise<MarketplaceTransaction[]> {
  const result = await getDbPool().query<TransactionRow>(
    `select id, transaction_data, status, expires_at, updated_at
       from marketplace_socket_transactions
      order by updated_at desc, id`
  );
  return result.rows.map(normalizeTransaction);
}

export async function getLegacyMarketplaceTransaction(transactionId: string): Promise<MarketplaceTransaction | undefined> {
  const result = await getDbPool().query<TransactionRow>(
    `select id, transaction_data, status, expires_at, updated_at
       from marketplace_socket_transactions
      where id = $1`,
    [transactionId]
  );
  return result.rows[0] ? normalizeTransaction(result.rows[0]) : undefined;
}

export async function upsertLegacyMarketplaceTransaction(transaction: MarketplaceTransaction): Promise<void> {
  await getDbPool().query(
    `insert into marketplace_socket_transactions (
       id,
       requester_user_id,
       responder_user_id,
       transaction_data,
       status,
       expires_at,
       created_at,
       updated_at
     )
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     on conflict (id)
     do update set
       requester_user_id = excluded.requester_user_id,
       responder_user_id = excluded.responder_user_id,
       transaction_data = excluded.transaction_data,
       status = excluded.status,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    [
      transaction.id,
      transaction.requesterUserId,
      transaction.responderUserId,
      JSON.stringify(transaction),
      transaction.status,
      new Date(transaction.expiresAt),
      new Date(transaction.createdAt),
      new Date(transaction.updatedAt)
    ]
  );
}

export async function expireLegacyMarketplaceTransactions(nowMs = Date.now()): Promise<number> {
  const result = await getDbPool().query<TransactionRow>(
    `select id, transaction_data, status, expires_at, updated_at
       from marketplace_socket_transactions
      where status in ('PENDING_CONFIRMATION', 'CONFIRMED_BY_ONE_PARTY')
        and expires_at <= $1`,
    [new Date(nowMs)]
  );

  for (const row of result.rows) {
    const transaction = normalizeTransaction(row);
    transaction.status = "EXPIRED";
    transaction.updatedAt = new Date(nowMs).toISOString();
    transaction.confirmedByUserIds = [];
    await upsertLegacyMarketplaceTransaction(transaction);
  }

  return result.rows.length;
}
