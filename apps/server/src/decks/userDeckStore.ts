import fs from "node:fs";
import path from "node:path";

import type { DeckListDefinition, TournamentDeckProofPhoto, TournamentDeckVerification } from "@ward/shared";

import { getDbPool } from "../db/pool.js";
import {
  deleteUserDeckFromDisk,
  getUserDeckProofPhotoDir,
  listUserDecks as listUserDecksFromDisk,
  loadUserDeckList as loadUserDeckListFromDisk,
  saveUserDeckListToDisk,
  userDeckFileExists as userDeckFileExistsOnDisk,
  validateDataFileId,
  type DeckSummary,
  type TournamentDeckSubmission
} from "../dataStore.js";

type UserDeckRow = {
  deck_id: string;
  deck_name: string;
  deck_data: DeckListDefinition | string | null;
  card_count: number;
  format: string;
};

const migratedDiskDeckUsers = new Set<string>();

function normalizeDeckFormat(value: unknown): "FREE_PLAY" | "TOURNAMENT" {
  return value === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY";
}

function normalizeDeckDefinition(value: DeckListDefinition): DeckListDefinition {
  const id = String(value.id ?? "").trim();
  validateDataFileId(id);

  const cardIds = Array.isArray(value.cardIds)
    ? value.cardIds.map(cardId => String(cardId ?? "").trim()).filter(Boolean)
    : [];
  const cardArtKeys = Array.isArray(value.cardArtKeys)
    ? value.cardArtKeys.map(artKey => String(artKey ?? "default").trim() || "default")
    : undefined;
  const tournamentProofPhotos = Array.isArray(value.tournamentProofPhotos)
    ? value.tournamentProofPhotos
    : undefined;

  return {
    id,
    name: String(value.name ?? id).trim() || id,
    cardIds,
    cardArtKeys,
    format: normalizeDeckFormat(value.format),
    tournamentProofPhotos,
    tournamentVerification: value.tournamentVerification
  };
}

function parseDeckData(row: UserDeckRow): DeckListDefinition {
  const rawData = typeof row.deck_data === "string"
    ? JSON.parse(row.deck_data) as Partial<DeckListDefinition>
    : row.deck_data ?? {};

  return normalizeDeckDefinition({
    ...rawData,
    id: row.deck_id,
    name: row.deck_name || rawData.name || row.deck_id,
    format: normalizeDeckFormat(rawData.format ?? row.format)
  } as DeckListDefinition);
}

async function persistUserDeckList(userId: string, deckInput: DeckListDefinition, options: { mirrorToDisk: boolean }): Promise<DeckListDefinition> {
  validateDataFileId(userId);
  const deck = normalizeDeckDefinition(deckInput);
  const format = normalizeDeckFormat(deck.format);

  await getDbPool().query(
    `
      insert into user_deck_lists (user_id, deck_id, deck_name, deck_data, card_count, format, updated_at)
      values ($1, $2, $3, $4::jsonb, $5, $6, now())
      on conflict (user_id, deck_id)
      do update set
        deck_name = excluded.deck_name,
        deck_data = excluded.deck_data,
        card_count = excluded.card_count,
        format = excluded.format,
        updated_at = now()
    `,
    [userId, deck.id, deck.name, JSON.stringify(deck), deck.cardIds.length, format]
  );

  if (options.mirrorToDisk) {
    try {
      saveUserDeckListToDisk(userId, deck);
    } catch {
      // Postgres is the source of truth; disk is only a local/dev mirror.
    }
  }

  return deck;
}

async function migrateDiskDecksOnce(userId: string): Promise<void> {
  validateDataFileId(userId);
  if (migratedDiskDeckUsers.has(userId)) return;

  for (const summary of listUserDecksFromDisk(userId)) {
    try {
      const deck = loadUserDeckListFromDisk(userId, summary.id);
      await persistUserDeckList(userId, deck, { mirrorToDisk: false });
    } catch {
      // Ignore bad local deck files so one corrupted file cannot hide DB decks.
    }
  }

  migratedDiskDeckUsers.add(userId);
}

export async function listUserDecks(userId: string): Promise<DeckSummary[]> {
  validateDataFileId(userId);
  await migrateDiskDecksOnce(userId);

  const result = await getDbPool().query<UserDeckRow>(
    `
      select deck_id, deck_name, deck_data, card_count, format
      from user_deck_lists
      where user_id = $1
      order by lower(deck_name), deck_id
    `,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.deck_id,
    name: row.deck_name,
    cardCount: Number(row.card_count) || parseDeckData(row).cardIds.length
  }));
}

export async function loadUserDeckList(userId: string, deckId: string): Promise<DeckListDefinition> {
  validateDataFileId(userId);
  validateDataFileId(deckId);
  await migrateDiskDecksOnce(userId);

  const result = await getDbPool().query<UserDeckRow>(
    `
      select deck_id, deck_name, deck_data, card_count, format
      from user_deck_lists
      where user_id = $1 and deck_id = $2
    `,
    [userId, deckId]
  );

  const row = result.rows[0];
  if (row) return parseDeckData(row);

  if (userDeckFileExistsOnDisk(userId, deckId)) {
    const deck = loadUserDeckListFromDisk(userId, deckId);
    return await persistUserDeckList(userId, deck, { mirrorToDisk: false });
  }

  throw new Error(`Deck not found: ${deckId}`);
}

export async function userDeckFileExists(userId: string, deckId: string): Promise<boolean> {
  validateDataFileId(userId);
  validateDataFileId(deckId);
  await migrateDiskDecksOnce(userId);

  const result = await getDbPool().query<{ exists: boolean }>(
    "select exists(select 1 from user_deck_lists where user_id = $1 and deck_id = $2)",
    [userId, deckId]
  );

  return result.rows[0]?.exists === true || userDeckFileExistsOnDisk(userId, deckId);
}

export async function saveUserDeckList(userId: string, deck: DeckListDefinition): Promise<DeckListDefinition> {
  return await persistUserDeckList(userId, deck, { mirrorToDisk: true });
}

export async function deleteUserDeck(userId: string, deckId: string): Promise<void> {
  validateDataFileId(userId);
  validateDataFileId(deckId);
  await migrateDiskDecksOnce(userId);

  const diskExisted = userDeckFileExistsOnDisk(userId, deckId);
  const result = await getDbPool().query(
    "delete from user_deck_lists where user_id = $1 and deck_id = $2",
    [userId, deckId]
  );

  if (diskExisted) {
    try {
      deleteUserDeckFromDisk(userId, deckId);
    } catch {
      // Deck is already gone from the durable store.
    }
  }

  if (result.rowCount === 0 && !diskExisted) {
    throw new Error(`Deck not found: ${deckId}`);
  }
}

function normalizeTournamentVerification(
  value: DeckListDefinition["tournamentVerification"]
): TournamentDeckVerification {
  const status = value?.status === "PENDING" || value?.status === "VERIFIED" || value?.status === "REJECTED"
    ? value.status
    : "UNSUBMITTED";

  return {
    status,
    submittedAt: value?.submittedAt,
    reviewedAt: value?.reviewedAt,
    reviewedByUserId: value?.reviewedByUserId,
    reviewedByDisplayName: value?.reviewedByDisplayName,
    notes: value?.notes
  };
}

export async function saveUserDeckProofPhoto(args: {
  userId: string;
  deckId: string;
  photo: {
    id: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  };
}): Promise<DeckListDefinition> {
  validateDataFileId(args.userId);
  validateDataFileId(args.deckId);
  validateDataFileId(args.photo.id);

  const deck = await loadUserDeckList(args.userId, args.deckId);

  if (deck.format !== "TOURNAMENT") {
    throw new Error("Only tournament decks can receive ownership proof photos.");
  }

  const proofDir = getUserDeckProofPhotoDir(args.userId, args.deckId);
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, args.photo.id), args.photo.bytes);

  const proofPhotos = deck.tournamentProofPhotos ?? [];
  const nextPhoto: TournamentDeckProofPhoto = {
    id: args.photo.id,
    fileName: args.photo.fileName,
    mimeType: args.photo.mimeType,
    sizeBytes: args.photo.bytes.byteLength,
    uploadedAt: new Date().toISOString(),
    uploadedByUserId: args.userId
  };

  return await saveUserDeckList(args.userId, {
    ...deck,
    tournamentProofPhotos: [...proofPhotos, nextPhoto],
    tournamentVerification: {
      status: "PENDING",
      submittedAt: new Date().toISOString()
    }
  });
}

export async function reviewTournamentDeckSubmission(args: {
  ownerUserId: string;
  deckId: string;
  reviewerUserId: string;
  reviewerDisplayName: string;
  status: "VERIFIED" | "REJECTED";
  notes?: string;
}): Promise<DeckListDefinition> {
  const deck = await loadUserDeckList(args.ownerUserId, args.deckId);

  if (deck.format !== "TOURNAMENT") {
    throw new Error("Only tournament decks can be reviewed.");
  }

  return await saveUserDeckList(args.ownerUserId, {
    ...deck,
    tournamentVerification: {
      ...normalizeTournamentVerification(deck.tournamentVerification),
      status: args.status,
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: args.reviewerUserId,
      reviewedByDisplayName: args.reviewerDisplayName,
      notes: args.notes?.trim() || undefined
    }
  });
}

export async function listTournamentDeckSubmissions(users: Array<{ id: string; displayName: string }>): Promise<TournamentDeckSubmission[]> {
  const submissions: TournamentDeckSubmission[] = [];

  for (const user of users) {
    for (const deck of await listUserDecks(user.id)) {
      const detail = await loadUserDeckList(user.id, deck.id);
      if (detail.format !== "TOURNAMENT" || !detail.tournamentProofPhotos?.length) continue;
      submissions.push({
        ...detail,
        ownerUserId: user.id,
        ownerDisplayName: user.displayName
      });
    }
  }

  return submissions.sort((a, b) =>
    (b.tournamentVerification?.submittedAt ?? "").localeCompare(a.tournamentVerification?.submittedAt ?? "") ||
    a.name.localeCompare(b.name)
  );
}
