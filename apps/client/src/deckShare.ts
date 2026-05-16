import type { WardEngineEffect } from "@ward/shared";
import type { CardLibraryCardSummary } from "./clientTypes";

export type WardDeckSharePayload = {
  v: 1;
  kind: "WARD_DECK";
  name?: string;
  deckId?: string;
  cardIds: string[];
  cardArtKeys?: string[];
  format?: "FREE_PLAY" | "TOURNAMENT";
  startingHandSize?: number;
  notes?: string;
};

type CompactDeckEntry = string | [string, number] | [string, number, string];

type WardDeckSharePayloadV2 = {
  v: 2;
  k: "WD";
  n?: string;
  d?: string;
  c: CompactDeckEntry[];
  f?: "F" | "T";
  h?: number;
  m?: string;
};

type WardDeckSharePayloadV3 = Omit<WardDeckSharePayloadV2, "v"> & {
  v: 3;
};

type DeckShareCodecOptions = {
  cardLibrary?: CardLibraryCardSummary[];
};

export const WARD_DECK_STRING_V1_PREFIX = "WARDDECK1:";
export const WARD_DECK_STRING_V2_PREFIX = "WARDDECK2:";
export const WARD_DECK_STRING_PREFIX = "WARDDECK3:";

function encodeUtf8Base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeUtf8Base64Url(value: string): string {
  const normalized = value
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function normalizeImportedCardIds(cardIds: unknown): string[] {
  if (!Array.isArray(cardIds)) {
    throw new Error("Deck string is missing a cardIds array.");
  }

  const result = cardIds
    .map(cardId => String(cardId ?? "").trim())
    .filter(Boolean);

  if (result.length === 0) {
    throw new Error("Deck string does not contain any cards.");
  }

  return result;
}

function normalizeImportedCardArtKeys(cardArtKeys: unknown, cardCount: number): string[] | undefined {
  if (!Array.isArray(cardArtKeys)) {
    return undefined;
  }

  const result = cardArtKeys
    .slice(0, cardCount)
    .map(artKey => String(artKey ?? "default").trim() || "default");

  if (result.every(artKey => artKey === "default")) {
    return undefined;
  }

  return [
    ...result,
    ...Array.from({ length: Math.max(0, cardCount - result.length) }, () => "default")
  ];
}

function normalizeShareArtKey(artKey: unknown): string {
  const value = String(artKey ?? "default").trim();
  return value === "holo" || value === "zero-art" || value === "zero-art-holo" ? value : "default";
}

function encodeCompactArtKey(artKey: string): string | undefined {
  switch (normalizeShareArtKey(artKey)) {
    case "holo": return "h";
    case "zero-art": return "z";
    case "zero-art-holo": return "zh";
    default: return undefined;
  }
}

function decodeCompactArtKey(artKey: unknown): string {
  switch (String(artKey ?? "").trim()) {
    case "h": return "holo";
    case "z": return "zero-art";
    case "zh": return "zero-art-holo";
    default: return "default";
  }
}

function getCompactNumber(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  if (!normalized) return undefined;

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.floor(numeric).toString(36);
}

function getCompactCardRef(card: CardLibraryCardSummary): string | undefined {
  const generation = getCompactNumber(card.generation);
  const cardNumber = getCompactNumber(card.cardNumber);

  if (!generation || !cardNumber) return undefined;
  return `${generation}.${cardNumber}`;
}

function buildCompactCardCatalog(cardLibrary?: CardLibraryCardSummary[]): {
  cardIdToRef: Map<string, string>;
  refToCardId: Map<string, string>;
} {
  const cardIdToRef = new Map<string, string>();
  const refToCardId = new Map<string, string>();
  const duplicateRefs = new Set<string>();

  for (const card of cardLibrary ?? []) {
    const ref = getCompactCardRef(card);
    if (!ref) continue;
    if (duplicateRefs.has(ref)) continue;

    if (refToCardId.has(ref) && refToCardId.get(ref) !== card.id) {
      duplicateRefs.add(ref);
      refToCardId.delete(ref);
      continue;
    }

    refToCardId.set(ref, card.id);
    cardIdToRef.set(card.id, ref);
  }

  for (const [cardId, ref] of cardIdToRef) {
    if (duplicateRefs.has(ref)) {
      cardIdToRef.delete(cardId);
    }
  }

  for (const ref of duplicateRefs) {
    refToCardId.delete(ref);
  }

  return { cardIdToRef, refToCardId };
}

function buildCompactCardEntries(cardIds: string[], cardArtKeys?: string[]): CompactDeckEntry[] {
  const groupedCards = new Map<string, { cardId: string; artKey: string; count: number }>();

  cardIds.forEach((cardId, index) => {
    const artKey = normalizeShareArtKey(cardArtKeys?.[index]);
    const key = `${cardId}\u0000${artKey}`;
    const existing = groupedCards.get(key);

    if (existing) {
      existing.count += 1;
      return;
    }

    groupedCards.set(key, { cardId, artKey, count: 1 });
  });

  return Array.from(groupedCards.values()).map(entry => {
    const compactArtKey = encodeCompactArtKey(entry.artKey);

    if (entry.count === 1 && !compactArtKey) {
      return entry.cardId;
    }

    if (!compactArtKey) {
      return [entry.cardId, entry.count];
    }

    return [entry.cardId, entry.count, compactArtKey];
  });
}

function buildCompactCardRefEntries(cardIds: string[], cardArtKeys: string[] | undefined, cardLibrary?: CardLibraryCardSummary[]): CompactDeckEntry[] | undefined {
  const { cardIdToRef } = buildCompactCardCatalog(cardLibrary);
  if (cardIdToRef.size === 0) return undefined;

  const cardRefs = cardIds.map(cardId => cardIdToRef.get(cardId));
  if (cardRefs.some(ref => !ref)) return undefined;

  return buildCompactCardEntries(cardRefs as string[], cardArtKeys);
}

function expandCompactCardEntries(
  cardEntries: unknown,
  options: { cardLibrary?: CardLibraryCardSummary[]; usesCardRefs?: boolean } = {}
): { cardIds: string[]; cardArtKeys?: string[] } {
  if (!Array.isArray(cardEntries)) {
    throw new Error("Deck string is missing a compact card list.");
  }

  const { refToCardId } = options.usesCardRefs
    ? buildCompactCardCatalog(options.cardLibrary)
    : { refToCardId: new Map<string, string>() };
  const cardIds: string[] = [];
  const cardArtKeys: string[] = [];
  let hasNonDefaultArtKey = false;
  let missingRefCount = 0;

  for (const entry of cardEntries) {
    const rawCardId = Array.isArray(entry) ? entry[0] : entry;
    const rawCardIdText = String(rawCardId ?? "").trim();
    const cardId = options.usesCardRefs ? refToCardId.get(rawCardIdText) ?? "" : rawCardIdText;
    const rawCount = Array.isArray(entry) ? Number(entry[1] ?? 1) : 1;
    const count = Math.max(1, Math.min(500, Math.floor(Number.isFinite(rawCount) ? rawCount : 1)));
    const artKey = Array.isArray(entry) ? decodeCompactArtKey(entry[2]) : "default";

    if (!cardId) {
      if (options.usesCardRefs && rawCardIdText) {
        missingRefCount += 1;
      }
      continue;
    }

    if (artKey !== "default") {
      hasNonDefaultArtKey = true;
    }

    for (let index = 0; index < count; index += 1) {
      cardIds.push(cardId);
      cardArtKeys.push(artKey);
    }
  }

  if (options.usesCardRefs && missingRefCount > 0) {
    throw new Error("This shortened deck code needs the matching card library loaded before it can import.");
  }

  return {
    cardIds: normalizeImportedCardIds(cardIds),
    cardArtKeys: hasNonDefaultArtKey ? cardArtKeys : undefined
  };
}

export function encodeWardDeckString(payload: Omit<WardDeckSharePayload, "v" | "kind">, options: DeckShareCodecOptions = {}): string {
  const cardIds = normalizeImportedCardIds(payload.cardIds);
  const cardArtKeys = normalizeImportedCardArtKeys(payload.cardArtKeys, cardIds.length);
  const compactCardRefEntries = buildCompactCardRefEntries(cardIds, cardArtKeys, options.cardLibrary);

  if (compactCardRefEntries) {
    const normalizedPayload: WardDeckSharePayloadV3 = {
      v: 3,
      k: "WD",
      n: payload.name?.trim() || undefined,
      d: payload.deckId?.trim() || undefined,
      c: compactCardRefEntries,
      f: payload.format === "TOURNAMENT" ? "T" : payload.format === "FREE_PLAY" ? "F" : undefined,
      h: Number.isFinite(payload.startingHandSize)
        ? Math.max(0, Math.floor(payload.startingHandSize ?? 0))
        : undefined,
      m: payload.notes?.trim() || undefined
    };

    return `${WARD_DECK_STRING_PREFIX}${encodeUtf8Base64Url(JSON.stringify(normalizedPayload))}`;
  }

  const normalizedPayload: WardDeckSharePayloadV2 = {
    v: 2,
    k: "WD",
    n: payload.name?.trim() || undefined,
    d: payload.deckId?.trim() || undefined,
    c: buildCompactCardEntries(cardIds, cardArtKeys),
    f: payload.format === "TOURNAMENT" ? "T" : payload.format === "FREE_PLAY" ? "F" : undefined,
    h: Number.isFinite(payload.startingHandSize)
      ? Math.max(0, Math.floor(payload.startingHandSize ?? 0))
      : undefined,
    m: payload.notes?.trim() || undefined
  };

  return `${WARD_DECK_STRING_V2_PREFIX}${encodeUtf8Base64Url(JSON.stringify(normalizedPayload))}`;
}

export function decodeWardDeckString(value: string, options: DeckShareCodecOptions = {}): WardDeckSharePayload {
  const trimmed = value.trim();

  if (trimmed.startsWith(WARD_DECK_STRING_PREFIX)) {
    const jsonText = decodeUtf8Base64Url(trimmed.slice(WARD_DECK_STRING_PREFIX.length));
    const parsed = JSON.parse(jsonText) as Partial<WardDeckSharePayloadV3>;

    if (parsed.v !== 3 || parsed.k !== "WD") {
      throw new Error("Deck string is not a Ward Nexus deck string v3 payload.");
    }

    const expandedCards = expandCompactCardEntries(parsed.c, {
      cardLibrary: options.cardLibrary,
      usesCardRefs: true
    });

    return {
      v: 1,
      kind: "WARD_DECK",
      name: parsed.n ? String(parsed.n) : undefined,
      deckId: parsed.d ? String(parsed.d) : undefined,
      cardIds: expandedCards.cardIds,
      cardArtKeys: expandedCards.cardArtKeys,
      format: parsed.f === "T" ? "TOURNAMENT" : parsed.f === "F" ? "FREE_PLAY" : undefined,
      startingHandSize: Number.isFinite(parsed.h)
        ? Math.max(0, Math.floor(parsed.h ?? 0))
        : undefined,
      notes: parsed.m ? String(parsed.m) : undefined
    };
  }

  if (trimmed.startsWith(WARD_DECK_STRING_V2_PREFIX)) {
    const jsonText = decodeUtf8Base64Url(trimmed.slice(WARD_DECK_STRING_V2_PREFIX.length));
    const parsed = JSON.parse(jsonText) as Partial<WardDeckSharePayloadV2>;

    if (parsed.v !== 2 || parsed.k !== "WD") {
      throw new Error("Deck string is not a Ward Nexus deck string v2 payload.");
    }

    const expandedCards = expandCompactCardEntries(parsed.c);

    return {
      v: 1,
      kind: "WARD_DECK",
      name: parsed.n ? String(parsed.n) : undefined,
      deckId: parsed.d ? String(parsed.d) : undefined,
      cardIds: expandedCards.cardIds,
      cardArtKeys: expandedCards.cardArtKeys,
      format: parsed.f === "T" ? "TOURNAMENT" : parsed.f === "F" ? "FREE_PLAY" : undefined,
      startingHandSize: Number.isFinite(parsed.h)
        ? Math.max(0, Math.floor(parsed.h ?? 0))
        : undefined,
      notes: parsed.m ? String(parsed.m) : undefined
    };
  }

  if (!trimmed.startsWith(WARD_DECK_STRING_V1_PREFIX)) {
    throw new Error(`Deck string must start with ${WARD_DECK_STRING_PREFIX}, ${WARD_DECK_STRING_V2_PREFIX}, or ${WARD_DECK_STRING_V1_PREFIX}`);
  }

  const jsonText = decodeUtf8Base64Url(trimmed.slice(WARD_DECK_STRING_V1_PREFIX.length));
  const parsed = JSON.parse(jsonText) as Partial<WardDeckSharePayload>;

  if (parsed.v !== 1 || parsed.kind !== "WARD_DECK") {
    throw new Error("Deck string is not a Ward Nexus deck string v1 payload.");
  }

  const cardIds = normalizeImportedCardIds(parsed.cardIds);

  return {
    v: 1,
    kind: "WARD_DECK",
    name: parsed.name ? String(parsed.name) : undefined,
    deckId: parsed.deckId ? String(parsed.deckId) : undefined,
    cardIds,
    cardArtKeys: normalizeImportedCardArtKeys(parsed.cardArtKeys, cardIds.length),
    format: parsed.format === "TOURNAMENT" ? "TOURNAMENT" : parsed.format === "FREE_PLAY" ? "FREE_PLAY" : undefined,
    startingHandSize: Number.isFinite(parsed.startingHandSize)
      ? Math.max(0, Math.floor(parsed.startingHandSize ?? 0))
      : undefined,
    notes: parsed.notes ? String(parsed.notes) : undefined
  };
}

export function summarizeDeckCardCounts(cardIds: string[]): Array<{ cardId: string; count: number }> {
  const counts = cardIds.reduce<Record<string, number>>((result, cardId) => {
    result[cardId] = (result[cardId] ?? 0) + 1;
    return result;
  }, {});

  return Object.entries(counts)
    .map(([cardId, count]) => ({ cardId, count }))
    .sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }));
}

function formatEffectForNotes(effect: WardEngineEffect, index: number): string {
  const lines = [
    `  ${index + 1}. ${effect.id} | ${effect.trigger ?? "NO_TRIGGER"} | ${effect.actionType ?? "NO_ACTION_TYPE"}`
  ];

  const actionText = effect.actionText ?? effect.value;
  if (actionText) lines.push(`     - Action: ${actionText}`);
  if (effect.target) lines.push(`     - Target: ${effect.target}`);
  if (effect.duration?.text) lines.push(`     - Duration: ${effect.duration.text}`);
  if (effect.reusableFunction) lines.push(`     - Handler: ${effect.reusableFunction}`);
  if (effect.needsReview) lines.push(`     - Needs Review: true`);
  if (effect.notes) lines.push(`     - Effect Notes: ${effect.notes}`);

  return lines.join("\n");
}

function formatCardStats(card: CardLibraryCardSummary): string {
  if (card.cardType === "CREATURE") {
    return `${card.creatureType ?? "Creature"} | AL ${card.armorLevel ?? "?"} | SPD ${card.speed ?? "?"} | HP ${card.hp ?? "?"} | ATK ${card.attackDice ?? "?"}D6 | MOD ${card.modifier ?? "?"}`;
  }

  const displayMagicType = card.magicType === "BATTLE_LIGHTNING" ? "LIGHTNING" : card.magicType ?? "MAGIC";
  return `${displayMagicType} | ${card.magicSubType ?? "NONE"}`;
}

export function buildDeckNotesMarkdown(args: {
  name: string;
  deckId?: string;
  cardIds: string[];
  cardArtKeys?: string[];
  cardLibrary: CardLibraryCardSummary[];
  sourceLabel: string;
  deckString?: string;
  startingHandSize?: number;
}): string {
  const counts = summarizeDeckCardCounts(args.cardIds);
  const cards = counts.map(item => ({
    ...item,
    card: args.cardLibrary.find(card => card.id === item.cardId)
  }));
  const creatureCount = args.cardIds.filter(cardId => args.cardLibrary.find(card => card.id === cardId)?.cardType === "CREATURE").length;
  const magicCount = args.cardIds.filter(cardId => args.cardLibrary.find(card => card.id === cardId)?.cardType === "MAGIC").length;
  const generatedAt = new Date().toISOString();

  const lines: string[] = [
    `# ${args.name || "Ward Nexus Deck"} - Test Notes`,
    "",
    `Generated: ${generatedAt}`,
    `Source: ${args.sourceLabel}`,
    args.deckId ? `Deck ID: ${args.deckId}` : "Deck ID:",
    `Cards: ${args.cardIds.length}`,
    `Unique Cards: ${counts.length}`,
    `Creatures: ${creatureCount}`,
    `Magic: ${magicCount}`,
    args.startingHandSize !== undefined ? `Starting Hand Size: ${args.startingHandSize}` : "",
    "",
    "## Share String",
    "",
    args.deckString ?? encodeWardDeckString({
      name: args.name,
      deckId: args.deckId,
      cardIds: args.cardIds,
      cardArtKeys: args.cardArtKeys,
      startingHandSize: args.startingHandSize
    }, { cardLibrary: args.cardLibrary }),
    "",
    "## Deck Checklist",
    ""
  ].filter(line => line !== "");

  for (const { cardId, count, card } of cards) {
    lines.push(`- [ ] ${count}x ${card?.name ?? cardId} (${cardId})`);
  }

  lines.push("", "## Card Effect Notes", "");

  for (const { cardId, count, card } of cards) {
    lines.push(`### ${count}x ${card?.name ?? cardId}`);
    lines.push("");
    lines.push(`Card ID: ${cardId}`);

    if (card) {
      lines.push(`Card: ${card.generation ? `Gen ${card.generation}` : card.packId} ${card.cardNumber ? `#${card.cardNumber}` : ""} | ${card.rarity ?? "Unknown Rarity"} | ${card.cardType}`);
      lines.push(`Stats/Type: ${formatCardStats(card)}`);
      lines.push("");
      lines.push("Rules Text:");
      lines.push(card.text?.trim() || "No rules text.");
      lines.push("");

      if (card.effects && card.effects.length > 0) {
        lines.push("Parsed Effects:");
        card.effects.forEach((effect, index) => lines.push(formatEffectForNotes(effect, index)));
      } else {
        lines.push("Parsed Effects: None");
      }
    } else {
      lines.push("Card data not loaded in the current card library.");
    }

    lines.push("", "Test Notes:", "- Status:", "- Issue:", "- Fix / retest notes:", "");
  }

  return `${lines.join("\n")}\n`;
}

export function downloadTextFile(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function sanitizeDownloadFileName(value: string, fallback = "ward-deck-notes"): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}
