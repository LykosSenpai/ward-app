import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CardDefinition,
  CardPackDefinition,
  EffectQaStatus,
  WardEngineEffect,
  DeckCardLimitListDefinition,
  DeckCardLimitMap,
  DeckListDefinition,
  MatchState,
  TournamentDeckProofPhoto,
  TournamentDeckVerification
} from "@ward/shared";

import { normalizeMatch } from "@ward/engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const MATCHES_DIR = path.join(DATA_DIR, "matches");
const USER_DATA_DIR = path.join(DATA_DIR, "users");
const CARD_LIMITS_DIR = path.join(DATA_DIR, "rules", "card-limits");
const CARD_COLLECTION_DIR = path.join(DATA_DIR, "collection");
const CARD_OWNERSHIP_FILE = path.join(CARD_COLLECTION_DIR, "card-ownership.json");
const MARKETPLACE_DIR = path.join(DATA_DIR, "marketplace");
const MARKETPLACE_POSTS_FILE = path.join(MARKETPLACE_DIR, "posts.json");
const MARKETPLACE_SETTINGS_FILE = path.join(MARKETPLACE_DIR, "settings.json");
const MARKETPLACE_TRANSACTIONS_FILE = path.join(MARKETPLACE_DIR, "transactions.json");
const DEV_DATA_DIR = path.join(DATA_DIR, "dev");
const DECK_PROOF_PHOTO_DIR_NAME = "deck-proof-photos";
const EFFECT_RUNTIME_TEST_STATUS_FILE = path.join(DEV_DATA_DIR, "effect-runtime-test-status.json");
const DEFAULT_CARD_LIMIT_LIST_ID = "base-1v1";

function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

ensureDirectoryExists(MATCHES_DIR);
ensureDirectoryExists(USER_DATA_DIR);
ensureDirectoryExists(CARD_LIMITS_DIR);
ensureDirectoryExists(CARD_COLLECTION_DIR);
ensureDirectoryExists(DEV_DATA_DIR);
ensureDirectoryExists(MARKETPLACE_DIR);


export type EffectRuntimeTestStatus = EffectQaStatus;

export type EffectRuntimeIssueType =
  | "NONE"
  | "WRONG_TARGET"
  | "WRONG_TIMING"
  | "WRONG_DURATION"
  | "WRONG_COUNTER"
  | "WRONG_DAMAGE"
  | "WRONG_STAT_MODIFIER"
  | "MISSING_BUTTON"
  | "MISSING_PROMPT"
  | "MISSING_CHAIN_WINDOW"
  | "MISSING_CLEANUP"
  | "UNSUPPORTED_ACTION_TYPE";

export type EffectRuntimeTestStatusRecord = {
  key: string;
  packId: string;
  cardId: string;
  cardName: string;
  effectId: string;
  trigger?: string;
  actionType: string;
  status?: EffectRuntimeTestStatus;
  engineStatus: EffectRuntimeTestStatus;
  boardAffordanceStatus: EffectRuntimeTestStatus;
  boardAnimationStatus: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
  notes: string;
  lastTestedAt?: string;
  testedBy?: string;
};

export type EffectRuntimeTestStatusMap = Record<string, EffectRuntimeTestStatusRecord>;

export type EffectRuntimeTestStatusInput = Omit<Partial<EffectRuntimeTestStatusRecord>, "status" | "engineStatus" | "boardAffordanceStatus" | "boardAnimationStatus" | "issueType"> & {
  engineStatus?: string;
  boardAffordanceStatus?: string;
  boardAnimationStatus?: string;
  status?: string;
  issueType?: string;
};

type EffectRuntimeTestStatusFile = {
  version: 1;
  records: EffectRuntimeTestStatusRecord[];
};

const VALID_EFFECT_TEST_STATUSES = new Set<EffectRuntimeTestStatus>([
  "UNTESTED",
  "WORKING",
  "PARTIAL",
  "BROKEN",
  "BLOCKED",
  "MANUAL"
]);

const VALID_EFFECT_ISSUE_TYPES = new Set<EffectRuntimeIssueType>([
  "NONE",
  "WRONG_TARGET",
  "WRONG_TIMING",
  "WRONG_DURATION",
  "WRONG_COUNTER",
  "WRONG_DAMAGE",
  "WRONG_STAT_MODIFIER",
  "MISSING_BUTTON",
  "MISSING_PROMPT",
  "MISSING_CHAIN_WINDOW",
  "MISSING_CLEANUP",
  "UNSUPPORTED_ACTION_TYPE"
]);

export function getEffectRuntimeTestStatusKey(packId: string, cardId: string, effectId: string): string {
  return `${packId}:${cardId}:${effectId}`;
}

function normalizeEffectRuntimeTestStatusRecord(record: EffectRuntimeTestStatusInput): EffectRuntimeTestStatusRecord {
  const packId = String(record.packId ?? "").trim();
  const cardId = String(record.cardId ?? "").trim();
  const effectId = String(record.effectId ?? "").trim();

  if (!packId || !cardId || !effectId) {
    throw new Error("Effect runtime test status requires packId, cardId, and effectId.");
  }

  validateDataFileId(packId);
  validateDataFileId(cardId);
  validateDataFileId(effectId);

  const engineStatus = normalizeEffectRuntimeTestStatus(record.engineStatus ?? record.status);
  const boardAffordanceStatus = normalizeEffectRuntimeTestStatus(record.boardAffordanceStatus);
  const boardAnimationStatus = normalizeEffectRuntimeTestStatus(record.boardAnimationStatus);

  const issueType = VALID_EFFECT_ISSUE_TYPES.has(record.issueType as EffectRuntimeIssueType)
    ? record.issueType as EffectRuntimeIssueType
    : "NONE";

  return {
    key: getEffectRuntimeTestStatusKey(packId, cardId, effectId),
    packId,
    cardId,
    cardName: String(record.cardName ?? cardId),
    effectId,
    trigger: record.trigger ? String(record.trigger) : undefined,
    actionType: String(record.actionType ?? "UNKNOWN"),
    engineStatus,
    boardAffordanceStatus,
    boardAnimationStatus,
    issueType,
    notes: String(record.notes ?? ""),
    lastTestedAt: record.lastTestedAt ? String(record.lastTestedAt) : new Date().toISOString(),
    testedBy: record.testedBy ? String(record.testedBy) : "Dev"
  };
}

function normalizeEffectRuntimeTestStatus(value: unknown): EffectRuntimeTestStatus {
  if (VALID_EFFECT_TEST_STATUSES.has(value as EffectRuntimeTestStatus)) {
    return value as EffectRuntimeTestStatus;
  }

  switch (value) {
    case "BLOCKED_RUNTIME":
    case "BLOCKED_DATA":
      return "BLOCKED";
    case "NEEDS_RULES_REVIEW":
      return "MANUAL";
    default:
      return "UNTESTED";
  }
}

function hasSavedEffectRuntimeTestStatus(record: EffectRuntimeTestStatusRecord): boolean {
  return record.engineStatus !== "UNTESTED" ||
    record.boardAffordanceStatus !== "UNTESTED" ||
    record.boardAnimationStatus !== "UNTESTED" ||
    record.notes.trim().length > 0 ||
    record.issueType !== "NONE";
}

export function loadEffectRuntimeTestStatusMap(): EffectRuntimeTestStatusMap {
  ensureDirectoryExists(DEV_DATA_DIR);

  if (!fs.existsSync(EFFECT_RUNTIME_TEST_STATUS_FILE)) {
    return {};
  }

  const fileData = readJsonFile<Partial<EffectRuntimeTestStatusFile> | EffectRuntimeTestStatusMap>(EFFECT_RUNTIME_TEST_STATUS_FILE);
  const records = Array.isArray((fileData as Partial<EffectRuntimeTestStatusFile>).records)
    ? (fileData as Partial<EffectRuntimeTestStatusFile>).records ?? []
    : Object.values(fileData as EffectRuntimeTestStatusMap);

  return records.reduce<EffectRuntimeTestStatusMap>((result, record) => {
    try {
      const normalized = normalizeEffectRuntimeTestStatusRecord(record);
      result[normalized.key] = normalized;
    } catch {
      // Ignore invalid dev records instead of breaking app startup.
    }

    return result;
  }, {});
}

function saveEffectRuntimeTestStatusMap(statusMap: EffectRuntimeTestStatusMap): void {
  ensureDirectoryExists(DEV_DATA_DIR);

  const fileData: EffectRuntimeTestStatusFile = {
    version: 1,
    records: Object.values(statusMap)
      .filter(hasSavedEffectRuntimeTestStatus)
      .sort((a, b) =>
        a.packId.localeCompare(b.packId) ||
        a.cardId.localeCompare(b.cardId) ||
        a.effectId.localeCompare(b.effectId)
      )
  };

  fs.writeFileSync(EFFECT_RUNTIME_TEST_STATUS_FILE, `${JSON.stringify(fileData, null, 2)}\n`, "utf-8");
}

export function saveEffectRuntimeTestStatusRecord(record: EffectRuntimeTestStatusInput): EffectRuntimeTestStatusMap {
  const statusMap = loadEffectRuntimeTestStatusMap();
  const normalized = normalizeEffectRuntimeTestStatusRecord({
    ...record,
    lastTestedAt: new Date().toISOString()
  });

  if (!hasSavedEffectRuntimeTestStatus(normalized)) {
    delete statusMap[normalized.key];
  } else {
    statusMap[normalized.key] = normalized;
  }

  saveEffectRuntimeTestStatusMap(statusMap);
  return statusMap;
}

export function saveEffectRuntimeTestStatusRecords(records: EffectRuntimeTestStatusInput[]): EffectRuntimeTestStatusMap {
  const statusMap = loadEffectRuntimeTestStatusMap();

  for (const record of records) {
    const normalized = normalizeEffectRuntimeTestStatusRecord({
      ...record,
      lastTestedAt: new Date().toISOString()
    });

    if (!hasSavedEffectRuntimeTestStatus(normalized)) {
      delete statusMap[normalized.key];
    } else {
      statusMap[normalized.key] = normalized;
    }
  }

  saveEffectRuntimeTestStatusMap(statusMap);
  return statusMap;
}

export function validateSavedMatchId(matchId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(matchId)) {
    throw new Error("Invalid saved match ID.");
  }
}

export function validateDataFileId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(
      "IDs can only contain letters, numbers, underscores, and hyphens."
    );
  }
}

export const MARKETPLACE_VARIANTS = ["STANDARD", "FOIL", "ALT_ART"] as const;
export type MarketplaceVariant = (typeof MARKETPLACE_VARIANTS)[number];
export type MarketplacePostStatus = "OPEN" | "RESERVED" | "COMPLETED" | "CANCELLED";

export type MarketplacePostRecord = {
  id: string;
  sellerUserId: string;
  title: string;
  discordHandle: string;
  cardId: string;
  variant: MarketplaceVariant;
  quantity: number;
  status: MarketplacePostStatus;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceTransactionRecord = {
  id: string;
  postId: string;
  buyerUserId: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
};

export function validateMarketplaceVariant(value: string): MarketplaceVariant {
  if ((MARKETPLACE_VARIANTS as readonly string[]).includes(value)) {
    return value as MarketplaceVariant;
  }
  throw new Error(`Invalid marketplace variant: ${value}`);
}

export function validatePositiveQuantity(value: number, fieldName = "quantity"): number {
  const normalized = Number.isFinite(value) ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return normalized;
}

export function validateMarketplaceRequiredText(value: string, fieldName: "title" | "discordHandle"): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

export function validateMarketplaceStatusTransition(from: MarketplacePostStatus, to: MarketplacePostStatus): void {
  const allowed: Record<MarketplacePostStatus, MarketplacePostStatus[]> = {
    OPEN: ["OPEN", "RESERVED", "CANCELLED", "COMPLETED"],
    RESERVED: ["RESERVED", "OPEN", "CANCELLED", "COMPLETED"],
    COMPLETED: ["COMPLETED"],
    CANCELLED: ["CANCELLED"]
  };
  if (!allowed[from].includes(to)) {
    throw new Error(`Invalid marketplace status transition: ${from} -> ${to}`);
  }
}

function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function ensureMarketplaceFilesExist(): void {
  ensureDirectoryExists(MARKETPLACE_DIR);
  if (!fs.existsSync(MARKETPLACE_POSTS_FILE)) {
    writeJsonFileAtomic(MARKETPLACE_POSTS_FILE, { version: 1, posts: [] });
  }
  if (!fs.existsSync(MARKETPLACE_SETTINGS_FILE)) {
    writeJsonFileAtomic(MARKETPLACE_SETTINGS_FILE, {
      version: 1,
      settings: { isMarketplaceOpen: true },
      updatedAt: new Date().toISOString()
    });
  }
  if (!fs.existsSync(MARKETPLACE_TRANSACTIONS_FILE)) {
    writeJsonFileAtomic(MARKETPLACE_TRANSACTIONS_FILE, { version: 1, transactions: [] });
  }
}

export function loadMarketplacePosts(): MarketplacePostRecord[] {
  ensureMarketplaceFilesExist();
  const data = readJsonFile<{ posts?: unknown }>(MARKETPLACE_POSTS_FILE);
  if (!Array.isArray(data.posts)) return [];
  return data.posts.filter((post): post is MarketplacePostRecord =>
    typeof post === "object" && post !== null && typeof (post as MarketplacePostRecord).id === "string"
  );
}

export function saveMarketplacePosts(posts: MarketplacePostRecord[]): void {
  ensureMarketplaceFilesExist();
  const now = new Date().toISOString();
  const normalized = posts.map(post => ({
    ...post,
    createdAt: post.createdAt || now,
    updatedAt: now
  }));
  writeJsonFileAtomic(MARKETPLACE_POSTS_FILE, { version: 1, posts: normalized });
}

export function loadMarketplaceSettings(): { isMarketplaceOpen: boolean; updatedAt?: string } {
  ensureMarketplaceFilesExist();
  const data = readJsonFile<{ settings?: unknown; updatedAt?: unknown }>(MARKETPLACE_SETTINGS_FILE);
  const settings = data.settings as { isMarketplaceOpen?: unknown } | undefined;
  return {
    isMarketplaceOpen: settings?.isMarketplaceOpen !== false,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined
  };
}

export function saveMarketplaceSettings(settings: { isMarketplaceOpen: boolean }): void {
  ensureMarketplaceFilesExist();
  writeJsonFileAtomic(MARKETPLACE_SETTINGS_FILE, {
    version: 1,
    settings,
    updatedAt: new Date().toISOString()
  });
}

export function loadMarketplaceTransactions(): MarketplaceTransactionRecord[] {
  ensureMarketplaceFilesExist();
  const data = readJsonFile<{ transactions?: unknown }>(MARKETPLACE_TRANSACTIONS_FILE);
  if (!Array.isArray(data.transactions)) return [];
  return data.transactions.filter((item): item is MarketplaceTransactionRecord =>
    typeof item === "object" && item !== null && typeof (item as MarketplaceTransactionRecord).id === "string"
  );
}

export function saveMarketplaceTransactions(records: MarketplaceTransactionRecord[]): void {
  ensureMarketplaceFilesExist();
  const now = new Date().toISOString();
  const normalized = records.map(record => ({
    ...record,
    createdAt: record.createdAt || now,
    updatedAt: now
  }));
  writeJsonFileAtomic(MARKETPLACE_TRANSACTIONS_FILE, { version: 1, transactions: normalized });
}

export function getReservedQuantityByPostId(transactions: MarketplaceTransactionRecord[]): Record<string, number> {
  return transactions.reduce<Record<string, number>>((result, tx) => {
    if (tx.status === "PENDING" || tx.status === "CONFIRMED") {
      result[tx.postId] = (result[tx.postId] ?? 0) + validatePositiveQuantity(tx.quantity);
    }
    return result;
  }, {});
}

export function getReservedQuantityForPost(postId: string, transactions: MarketplaceTransactionRecord[]): number {
  return getReservedQuantityByPostId(transactions)[postId] ?? 0;
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  const clean = raw
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "");

  return JSON.parse(clean) as T;
}

function getMatchFilePath(matchId: string): string {
  validateSavedMatchId(matchId);
  return path.join(MATCHES_DIR, `${matchId}.json`);
}

export function saveMatchToDisk(match: MatchState): void {
  const normalizedMatch = normalizeMatch(match);
  const filePath = getMatchFilePath(normalizedMatch.matchId);
  fs.writeFileSync(filePath, JSON.stringify(normalizedMatch, null, 2), "utf-8");
}

export function loadMatchFromDisk(matchId: string): MatchState {
  const filePath = getMatchFilePath(matchId);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Saved match not found: ${matchId}`);
  }

  return normalizeMatch(readJsonFile<MatchState>(filePath));
}

export function deleteMatchFromDisk(matchId: string): void {
  const filePath = getMatchFilePath(matchId);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Saved match not found: ${matchId}`);
  }

  fs.unlinkSync(filePath);
}

export type SavedMatchSummary = {
  matchId: string;
  format: string;
  turnNumber: number;
  turnCycleNumber: number;
  activePlayerId: string;
  phase: string;
  updatedAt: string;
};

export function listSavedMatches(): SavedMatchSummary[] {
  ensureDirectoryExists(MATCHES_DIR);

  return fs
    .readdirSync(MATCHES_DIR)
    .filter(fileName => fileName.endsWith(".json"))
    .map(fileName => {
      const filePath = path.join(MATCHES_DIR, fileName);
      const match = normalizeMatch(readJsonFile<MatchState>(filePath));
      const stats = fs.statSync(filePath);

      return {
        matchId: match.matchId,
        format: match.format,
        turnNumber: match.turn.turnNumber,
        turnCycleNumber: match.turn.turnCycleNumber,
        activePlayerId: match.turn.activePlayerId,
        phase: match.turn.phase,
        updatedAt: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadCardCatalog(packIds: string[]): Record<string, CardDefinition> {
  const catalog: Record<string, CardDefinition> = {};

  for (const packId of packIds) {
    validateDataFileId(packId);

    const packPath = getCardPackFilePath(packId);

    if (!fs.existsSync(packPath)) {
      throw new Error(`Card pack not found: ${packId}`);
    }

    const pack = readJsonFile<CardPackDefinition>(packPath);

    for (const card of pack.cards) {
      if (catalog[card.id]) {
        throw new Error(`Duplicate card ID found while loading packs: ${card.id}`);
      }

      catalog[card.id] = card;
    }
  }

  return catalog;
}


function getCardPackFilePath(packId: string): string {
  validateDataFileId(packId);
  return path.join(DATA_DIR, "cards", "packs", `${packId}.json`);
}

export function updateCardEffectsInPack(args: {
  packId: string;
  cardId: string;
  text: string;
  effects: WardEngineEffect[];
  metadata?: {
    rarity?: string;
    creatureType?: string;
    artworkEffect?: string;
    artworkTags?: string[];
  };
}): CardLibraryCardSummary {
  const packPath = getCardPackFilePath(args.packId);

  if (!fs.existsSync(packPath)) {
    throw new Error(`Card pack not found: ${args.packId}`);
  }

  const pack = readJsonFile<CardPackDefinition>(packPath);
  const cardIndex = pack.cards.findIndex(card => card.id === args.cardId);

  if (cardIndex === -1) {
    throw new Error(`Card not found in ${args.packId}: ${args.cardId}`);
  }

  const card = pack.cards[cardIndex] as CardDefinitionMetadata;

  const nextCard = {
    ...card,
    text: args.text,
    effects: args.effects,
    rarity: args.metadata?.rarity?.trim() || card.rarity,
    artworkEffect: args.metadata?.artworkEffect?.trim() || undefined,
    artworkTags: Array.isArray(args.metadata?.artworkTags)
      ? args.metadata.artworkTags
          .map(tag => tag.trim().toUpperCase().replace(/[\s-]+/g, "_"))
          .filter(Boolean)
      : Array.isArray(card.artworkTags)
        ? card.artworkTags
        : []
  } as CardDefinitionMetadata;

  if (nextCard.cardType === "CREATURE" && args.metadata?.creatureType?.trim()) {
    nextCard.creatureType = args.metadata.creatureType.trim();
  }

  pack.cards[cardIndex] = nextCard as CardDefinition;

  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, "utf-8");

  const updatedCard = listCardLibraryForPacks([args.packId], loadCardLimitMap()).find(
    item => item.id === args.cardId
  );

  if (!updatedCard) {
    throw new Error(`Card was saved but could not be reloaded: ${args.cardId}`);
  }

  return updatedCard;
}

export function loadDeckList(deckId: string): DeckListDefinition {
  validateDataFileId(deckId);

  const deckPath = path.join(DATA_DIR, "decks", `${deckId}.json`);

  if (!fs.existsSync(deckPath)) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  return readJsonFile<DeckListDefinition>(deckPath);
}

export function loadUserDeckList(userId: string, deckId: string): DeckListDefinition {
  validateDataFileId(userId);
  validateDataFileId(deckId);

  const deckPath = getUserDeckFilePath(userId, deckId);

  if (!fs.existsSync(deckPath)) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  return readJsonFile<DeckListDefinition>(deckPath);
}

export function loadCardLimitMap(
  limitListId = DEFAULT_CARD_LIMIT_LIST_ID
): DeckCardLimitMap {
  validateDataFileId(limitListId);

  const limitPath = path.join(CARD_LIMITS_DIR, `${limitListId}.json`);

  if (!fs.existsSync(limitPath)) {
    return {};
  }

  const limitList = readJsonFile<DeckCardLimitListDefinition>(limitPath);

  const result: DeckCardLimitMap = {};

  for (const rule of limitList.rules) {
    result[rule.cardId] = {
      limit: rule.limit,
      reason: rule.reason
    };
  }

  return result;
}

export function updateCardLimitRule(args: {
  cardId: string;
  limit: number;
  reason?: string;
  limitListId?: string;
}): DeckCardLimitMap {
  validateDataFileId(args.cardId);
  const limitListId = args.limitListId ?? DEFAULT_CARD_LIMIT_LIST_ID;
  validateDataFileId(limitListId);

  const limitPath = path.join(CARD_LIMITS_DIR, `${limitListId}.json`);
  const limitList = fs.existsSync(limitPath)
    ? readJsonFile<DeckCardLimitListDefinition>(limitPath)
    : {
        id: limitListId,
        name: "Base 1v1 Card Limits",
        version: "1.0.0",
        rules: []
      };
  const normalizedLimit = Math.min(3, Math.max(0, Math.floor(args.limit)));
  const nextRules = limitList.rules.filter(rule => rule.cardId !== args.cardId);

  if (normalizedLimit < 3) {
    nextRules.push({
      cardId: args.cardId,
      limit: normalizedLimit,
      reason: args.reason?.trim() || (normalizedLimit === 0 ? "Tournament banned" : "Tournament limited")
    });
  }

  nextRules.sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }));
  fs.writeFileSync(
    limitPath,
    `${JSON.stringify({ ...limitList, rules: nextRules }, null, 2)}\n`,
    "utf-8"
  );

  return loadCardLimitMap(limitListId);
}

export type CardPackSummary = {
  id: string;
  name: string;
  version: string;
  cardCount: number;
};

export type DeckSummary = {
  id: string;
  name: string;
  cardCount: number;
};

export type TournamentDeckSubmission = DeckListDefinition & {
  ownerUserId: string;
  ownerDisplayName: string;
};

export type SetupOptions = {
  cardPacks: CardPackSummary[];
  decks: DeckSummary[];
};

export type CardLibraryCardSummary = {
  id: string;
  name: string;
  packId: string;
  cardType: "CREATURE" | "MAGIC";

  generation?: string;
  edition?: string;
  rarity?: string;
  cardNumber?: string;
  effectCount?: number;
  effectTypes?: string[];

  artworkEffect?: string;
  artworkTags?: string[];
  effects?: WardEngineEffect[];

  deckLimit: number;
  deckLimitReason?: string;

  creatureType?: string;
  armorLevel?: number;
  speed?: number;
  hp?: number;
  attackDice?: number;
  modifier?: number;

  magicType?: "STANDARD" | "INFINITE" | "LIGHTNING" | "BATTLE_LIGHTNING";
  magicSubType?: "FIELD" | "EQUIP" | "NONE";
  text?: string;
};

type CardDefinitionMetadata = CardDefinition & {
  generation?: string | number;
  edition?: string;
  rarity?: string;
  cardNumber?: string | number;
  effects?: WardEngineEffect[];
};

function getCardEffectTypes(card: CardDefinition): string[] {
  const metadata = card as CardDefinitionMetadata;

  if (!Array.isArray(metadata.effects)) {
    return [];
  }

  const values = metadata.effects.flatMap(effect => {
    const typedEffect = effect as {
      trigger?: unknown;
      actionType?: unknown;
      effectGroup?: unknown;
      reusableFunction?: unknown;
    };

    return [
      typedEffect.trigger,
      typedEffect.actionType,
      typedEffect.effectGroup,
      typedEffect.reusableFunction
    ];
  });

  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map(value => value.trim())
    )
  ).sort((a, b) => a.localeCompare(b));
}

function getCardLibraryMetadata(card: CardDefinition): Pick<
  CardLibraryCardSummary,
  "generation" | "edition" | "rarity" | "cardNumber" | "artworkEffect" | "artworkTags" | "effectCount" | "effectTypes" | "effects"
> {
  const metadata = card as CardDefinitionMetadata;

  return {
    generation: metadata.generation === undefined ? undefined : String(metadata.generation),
    edition: metadata.edition,
    rarity: metadata.rarity,
    cardNumber: metadata.cardNumber === undefined ? undefined : String(metadata.cardNumber).padStart(3, "0"),
    artworkEffect: metadata.artworkEffect,
    artworkTags: Array.isArray(metadata.artworkTags) ? metadata.artworkTags : [],
    effectCount: Array.isArray(metadata.effects) ? metadata.effects.length : 0,
    effectTypes: getCardEffectTypes(card),
    effects: Array.isArray(metadata.effects) ? metadata.effects : []
  };
}

export function listCardPacks(): CardPackSummary[] {
  const packsDir = path.join(DATA_DIR, "cards", "packs");

  if (!fs.existsSync(packsDir)) {
    return [];
  }

  return fs
    .readdirSync(packsDir)
    .filter(fileName => fileName.endsWith(".json"))
    .map(fileName => {
      const filePath = path.join(packsDir, fileName);
      const pack = readJsonFile<CardPackDefinition>(filePath);

      return {
        id: pack.id,
        name: pack.name,
        version: pack.version,
        cardCount: pack.cards.length
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listDecks(): DeckSummary[] {
  const decksDir = path.join(DATA_DIR, "decks");

  if (!fs.existsSync(decksDir)) {
    return [];
  }

  return fs
    .readdirSync(decksDir)
    .filter(fileName => fileName.endsWith(".json"))
    .map(fileName => {
      const filePath = path.join(decksDir, fileName);
      const deck = readJsonFile<DeckListDefinition>(filePath);

      return {
        id: deck.id,
        name: deck.name,
        cardCount: deck.cardIds.length
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listUserDecks(userId: string): DeckSummary[] {
  validateDataFileId(userId);
  const decksDir = getUserDecksDir(userId);

  if (!fs.existsSync(decksDir)) {
    return [];
  }

  return fs
    .readdirSync(decksDir)
    .filter(fileName => fileName.endsWith(".json"))
    .map(fileName => {
      const filePath = path.join(decksDir, fileName);
      const deck = readJsonFile<DeckListDefinition>(filePath);

      return {
        id: deck.id,
        name: deck.name,
        cardCount: deck.cardIds.length
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listSetupOptions(): SetupOptions {
  return {
    cardPacks: listCardPacks(),
    decks: listDecks()
  };
}

export function getDeckFilePath(deckId: string): string {
  validateDataFileId(deckId);
  return path.join(DATA_DIR, "decks", `${deckId}.json`);
}

export function getUserDecksDir(userId: string): string {
  validateDataFileId(userId);
  return path.join(USER_DATA_DIR, userId, "decks");
}

export function getUserDeckFilePath(userId: string, deckId: string): string {
  validateDataFileId(deckId);
  return path.join(getUserDecksDir(userId), `${deckId}.json`);
}

export function getUserDeckProofPhotoDir(userId: string, deckId: string): string {
  validateDataFileId(userId);
  validateDataFileId(deckId);
  return path.join(USER_DATA_DIR, userId, DECK_PROOF_PHOTO_DIR_NAME, deckId);
}

export function getUserDeckProofPhotoPath(userId: string, deckId: string, photoId: string): string {
  validateDataFileId(photoId);
  return path.join(getUserDeckProofPhotoDir(userId, deckId), photoId);
}

export function deckFileExists(deckId: string): boolean {
  return fs.existsSync(getDeckFilePath(deckId));
}

export function userDeckFileExists(userId: string, deckId: string): boolean {
  return fs.existsSync(getUserDeckFilePath(userId, deckId));
}

export function listCardLibraryForPacks(
  packIds: string[],
  cardLimits: DeckCardLimitMap = {}
): CardLibraryCardSummary[] {
  const results: CardLibraryCardSummary[] = [];

  for (const packId of packIds) {
    validateDataFileId(packId);

    const packPath = getCardPackFilePath(packId);

    if (!fs.existsSync(packPath)) {
      throw new Error(`Card pack not found: ${packId}`);
    }

    const pack = readJsonFile<CardPackDefinition>(packPath);

    for (const card of pack.cards) {
      const limitRule = cardLimits[card.id];
      const deckLimit = Math.min(3, Math.max(0, limitRule?.limit ?? 3));

      const metadata = getCardLibraryMetadata(card);

      if (card.cardType === "CREATURE") {
        results.push({
          id: card.id,
          name: card.name,
          packId: pack.id,
          cardType: card.cardType,
          ...metadata,
          deckLimit,
          deckLimitReason: limitRule?.reason,
          creatureType: card.creatureType,
          armorLevel: card.armorLevel,
          speed: card.speed,
          hp: card.hp,
          attackDice: card.attackDice,
          modifier: card.modifier,
          text: card.text
        });

        continue;
      }

      results.push({
        id: card.id,
        name: card.name,
        packId: pack.id,
        cardType: card.cardType,
        ...metadata,
        deckLimit,
        deckLimitReason: limitRule?.reason,
        magicType: card.magicType,
        magicSubType: card.magicSubType,
        text: card.text
      });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function listDefaultCardLibrary(): CardLibraryCardSummary[] {
  const cardPacks = listCardPacks();
  const packIds = cardPacks.map(pack => pack.id);

  if (packIds.length === 0) {
    return [];
  }

  return listCardLibraryForPacks(packIds, loadCardLimitMap());
}

export type CardOwnershipMap = Record<string, number>;
export type CardOwnershipVariant = "default" | "holo" | "zero-art" | "zero-art-holo";
export type CardOwnershipByVariant = Partial<Record<CardOwnershipVariant, number>>;
export type CardOwnershipCollectionMap = Record<string, CardOwnershipByVariant>;

type CardOwnershipFile = {
  version: 1;
  cards: Array<{
    cardId: string;
    ownedCount: number;
    updatedAt?: string;
  }>;
};

function normalizeOwnershipCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(999, Math.max(0, Math.floor(value)));
}

export function loadCardOwnershipMap(): CardOwnershipMap {
  ensureDirectoryExists(CARD_COLLECTION_DIR);
ensureDirectoryExists(DEV_DATA_DIR);

  if (!fs.existsSync(CARD_OWNERSHIP_FILE)) {
    return {};
  }

  const fileData = readJsonFile<Partial<CardOwnershipFile> | CardOwnershipMap>(CARD_OWNERSHIP_FILE);

  if (Array.isArray((fileData as Partial<CardOwnershipFile>).cards)) {
    const ownershipFile = fileData as CardOwnershipFile;

    return ownershipFile.cards.reduce<CardOwnershipMap>((result, record) => {
      result[record.cardId] = normalizeOwnershipCount(record.ownedCount);
      return result;
    }, {});
  }

  return Object.entries(fileData as CardOwnershipMap).reduce<CardOwnershipMap>((result, [cardId, ownedCount]) => {
    result[cardId] = normalizeOwnershipCount(ownedCount);
    return result;
  }, {});
}

function saveCardOwnershipMap(ownershipMap: CardOwnershipMap): void {
  ensureDirectoryExists(CARD_COLLECTION_DIR);
ensureDirectoryExists(DEV_DATA_DIR);

  const ownershipFile: CardOwnershipFile = {
    version: 1,
    cards: Object.entries(ownershipMap)
      .filter(([, ownedCount]) => ownedCount > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cardId, ownedCount]) => ({
        cardId,
        ownedCount,
        updatedAt: new Date().toISOString()
      }))
  };

  fs.writeFileSync(CARD_OWNERSHIP_FILE, JSON.stringify(ownershipFile, null, 2), "utf-8");
}

export function setCardOwnershipCount(cardId: string, ownedCount: number): CardOwnershipMap {
  validateDataFileId(cardId);

  const ownershipMap = loadCardOwnershipMap();
  const safeOwnedCount = normalizeOwnershipCount(ownedCount);

  if (safeOwnedCount <= 0) {
    delete ownershipMap[cardId];
  } else {
    ownershipMap[cardId] = safeOwnedCount;
  }

  saveCardOwnershipMap(ownershipMap);
  return ownershipMap;
}

function normalizeCardOwnershipVariant(variant: string): CardOwnershipVariant {
  if (variant === "default" || variant === "holo" || variant === "zero-art" || variant === "zero-art-holo") {
    return variant;
  }

  throw new Error(`Unknown card variant "${variant}".`);
}

export function loadCardOwnershipCollection(): CardOwnershipCollectionMap {
  const baseOwnershipMap = loadCardOwnershipMap();
  return Object.entries(baseOwnershipMap).reduce<CardOwnershipCollectionMap>((result, [cardId, ownedCount]) => {
    result[cardId] = { default: ownedCount };
    return result;
  }, {});
}

export function upsertCardOwnership(args: {
  cardId: string;
  variant?: string;
  ownedCount: number;
  requiredCount?: number;
}): CardOwnershipCollectionMap {
  validateDataFileId(args.cardId);
  const variant = normalizeCardOwnershipVariant(String(args.variant ?? "default").trim());
  const safeOwnedCount = normalizeOwnershipCount(args.ownedCount);

  if (!Number.isFinite(args.ownedCount) || args.ownedCount < 0) {
    throw new Error("Owned quantity cannot be negative.");
  }

  if (args.requiredCount !== undefined && (!Number.isFinite(args.requiredCount) || args.requiredCount < 1)) {
    throw new Error("Required quantity must be greater than or equal to 1.");
  }

  const ownershipCollection = loadCardOwnershipCollection();
  const current = ownershipCollection[args.cardId] ?? {};

  if (safeOwnedCount <= 0) {
    delete current[variant];
  } else {
    current[variant] = safeOwnedCount;
  }

  if (Object.keys(current).length === 0) {
    delete ownershipCollection[args.cardId];
    setCardOwnershipCount(args.cardId, 0);
  } else {
    ownershipCollection[args.cardId] = current;
    setCardOwnershipCount(args.cardId, current.default ?? 0);
  }

  return ownershipCollection;
}


export function saveDeckListToDisk(deck: DeckListDefinition): void {
  validateDataFileId(deck.id);

  const filePath = getDeckFilePath(deck.id);

  fs.writeFileSync(filePath, JSON.stringify(deck, null, 2), "utf-8");
}

export function saveUserDeckListToDisk(userId: string, deck: DeckListDefinition): void {
  validateDataFileId(userId);
  validateDataFileId(deck.id);
  const decksDir = getUserDecksDir(userId);
  ensureDirectoryExists(decksDir);

  fs.writeFileSync(getUserDeckFilePath(userId, deck.id), JSON.stringify(deck, null, 2), "utf-8");
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

export function saveUserDeckProofPhoto(args: {
  userId: string;
  deckId: string;
  photo: {
    id: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  };
}): DeckListDefinition {
  validateDataFileId(args.userId);
  validateDataFileId(args.deckId);
  validateDataFileId(args.photo.id);

  const deck = loadUserDeckList(args.userId, args.deckId);

  if (deck.format !== "TOURNAMENT") {
    throw new Error("Only tournament decks can receive ownership proof photos.");
  }

  const proofDir = getUserDeckProofPhotoDir(args.userId, args.deckId);
  ensureDirectoryExists(proofDir);
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

  const nextDeck: DeckListDefinition = {
    ...deck,
    tournamentProofPhotos: [...proofPhotos, nextPhoto],
    tournamentVerification: {
      status: "PENDING",
      submittedAt: new Date().toISOString()
    }
  };

  saveUserDeckListToDisk(args.userId, nextDeck);
  return nextDeck;
}

export function reviewTournamentDeckSubmission(args: {
  ownerUserId: string;
  deckId: string;
  reviewerUserId: string;
  reviewerDisplayName: string;
  status: "VERIFIED" | "REJECTED";
  notes?: string;
}): DeckListDefinition {
  const deck = loadUserDeckList(args.ownerUserId, args.deckId);

  if (deck.format !== "TOURNAMENT") {
    throw new Error("Only tournament decks can be reviewed.");
  }

  const nextDeck: DeckListDefinition = {
    ...deck,
    tournamentVerification: {
      ...normalizeTournamentVerification(deck.tournamentVerification),
      status: args.status,
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: args.reviewerUserId,
      reviewedByDisplayName: args.reviewerDisplayName,
      notes: args.notes?.trim() || undefined
    }
  };

  saveUserDeckListToDisk(args.ownerUserId, nextDeck);
  return nextDeck;
}

export function listTournamentDeckSubmissions(users: Array<{ id: string; displayName: string }>): TournamentDeckSubmission[] {
  const submissions: TournamentDeckSubmission[] = [];

  for (const user of users) {
    for (const deck of listUserDecks(user.id)) {
      const detail = loadUserDeckList(user.id, deck.id);
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

export function deleteDeckFromDisk(deckId: string): void {
  validateDataFileId(deckId);

  const filePath = getDeckFilePath(deckId);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  fs.unlinkSync(filePath);
}

export function deleteUserDeckFromDisk(userId: string, deckId: string): void {
  validateDataFileId(userId);
  validateDataFileId(deckId);

  const filePath = getUserDeckFilePath(userId, deckId);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  fs.unlinkSync(filePath);
}


