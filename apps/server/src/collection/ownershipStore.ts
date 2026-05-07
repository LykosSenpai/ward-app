import { validateDataFileId } from "../dataStore.js";
import { getDbPool } from "../db/pool.js";

export type CardOwnershipMap = Record<string, number>;

type OwnershipRow = {
  card_id: string;
  art_key: string;
  owned_count: number;
};

function normalizeOwnershipCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(999, Math.max(0, Math.floor(value)));
}

export function getCardArtOwnershipKey(cardId: string, artKey: string): string {
  return artKey === "default" ? cardId : `${cardId}__art_${artKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function parseCardArtOwnershipKey(ownershipKey: string): { cardId: string; artKey: string } {
  const artMarker = "__art_";
  const markerIndex = ownershipKey.indexOf(artMarker);

  if (markerIndex === -1) {
    validateDataFileId(ownershipKey);
    return { cardId: ownershipKey, artKey: "default" };
  }

  const cardId = ownershipKey.slice(0, markerIndex);
  const artKey = ownershipKey.slice(markerIndex + artMarker.length);

  validateDataFileId(cardId);
  validateDataFileId(artKey);

  return { cardId, artKey };
}

export async function loadUserCardOwnershipMap(userId: string): Promise<CardOwnershipMap> {
  const result = await getDbPool().query<OwnershipRow>(
    `
      select card_id, art_key, owned_count
      from user_card_ownership
      where user_id = $1 and owned_count > 0
      order by card_id, art_key
    `,
    [userId]
  );

  return result.rows.reduce<CardOwnershipMap>((ownershipMap, row) => {
    ownershipMap[getCardArtOwnershipKey(row.card_id, row.art_key)] = normalizeOwnershipCount(row.owned_count);
    return ownershipMap;
  }, {});
}

export async function setUserCardOwnershipCount(args: {
  userId: string;
  ownershipKey: string;
  ownedCount: number;
}): Promise<CardOwnershipMap> {
  const { cardId, artKey } = parseCardArtOwnershipKey(args.ownershipKey);
  const safeOwnedCount = normalizeOwnershipCount(args.ownedCount);

  if (safeOwnedCount <= 0) {
    await getDbPool().query(
      `
        delete from user_card_ownership
        where user_id = $1 and card_id = $2 and art_key = $3
      `,
      [args.userId, cardId, artKey]
    );
  } else {
    await getDbPool().query(
      `
        insert into user_card_ownership (user_id, card_id, art_key, owned_count, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (user_id, card_id, art_key)
        do update set owned_count = excluded.owned_count, updated_at = now()
      `,
      [args.userId, cardId, artKey, safeOwnedCount]
    );
  }

  return loadUserCardOwnershipMap(args.userId);
}
