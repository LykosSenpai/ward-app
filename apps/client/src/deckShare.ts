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
export const WARD_DECK_STRING_V4_SYMBOLIC_PREFIX = "WARDDECK4SYM:";
export const WARD_DECK_STRING_V4_PREFIX = "WARDDECK4:";

export type WardDeckStringFormat = "WARDDECK4SYM" | "WARDDECK4" | "WARDDECK3" | "WARDDECK2" | "WARDDECK1";

const WARD_DECK_STRING_FORMAT_LABELS: Record<WardDeckStringFormat, string> = {
  WARDDECK4SYM: "WARDDECK4SYM symbolic",
  WARDDECK4: "WARDDECK4 packed",
  WARDDECK3: "WARDDECK3 JSON",
  WARDDECK2: "WARDDECK2 legacy",
  WARDDECK1: "WARDDECK1 legacy"
};

export function getWardDeckStringFormat(value: string): WardDeckStringFormat | undefined {
  const trimmed = value.trim();

  if (trimmed.startsWith(WARD_DECK_STRING_V4_SYMBOLIC_PREFIX)) return "WARDDECK4SYM";
  if (trimmed.startsWith(WARD_DECK_STRING_V4_PREFIX)) return "WARDDECK4";
  if (trimmed.startsWith(WARD_DECK_STRING_PREFIX)) return "WARDDECK3";
  if (trimmed.startsWith(WARD_DECK_STRING_V2_PREFIX)) return "WARDDECK2";
  if (trimmed.startsWith(WARD_DECK_STRING_V1_PREFIX)) return "WARDDECK1";
  return undefined;
}

export function getWardDeckStringFormatLabel(value: string): string | undefined {
  const format = getWardDeckStringFormat(value);
  return format ? WARD_DECK_STRING_FORMAT_LABELS[format] : undefined;
}

export function getWardDeckStringAcceptedPrefixesLabel(): string {
  return [
    WARD_DECK_STRING_V4_SYMBOLIC_PREFIX,
    WARD_DECK_STRING_V4_PREFIX,
    WARD_DECK_STRING_PREFIX,
    WARD_DECK_STRING_V2_PREFIX,
    WARD_DECK_STRING_V1_PREFIX
  ].join(", ");
}

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
    throw new Error("Deck code is missing a cardIds array.");
  }

  const result = cardIds
    .map(cardId => String(cardId ?? "").trim())
    .filter(Boolean);

  if (result.length === 0) {
    throw new Error("Deck code does not contain any cards.");
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



const V4_SYMBOLS_151 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_~.$*";
const V4_GEN_CAPTURE_BY_VALUE: Record<number, [string, string]> = {
  1: ["!", "!"],
  2: ["@", "@"],
  3: ["#", "#"],
  4: ["$", "$"],
  5: ["%", "%"],
  6: ["^", "^"],
  7: ["&", "&"],
  8: ["(", ")"]
};
const V4_GEN_CAPTURE_TO_VALUE = new Map<string, number>(Object.entries(V4_GEN_CAPTURE_BY_VALUE).map(([k, v]) => [v[0], Number(k)]));

function encodeV4SymbolCardNumber(cardNumber: number): string {
  const normalized = Math.floor(cardNumber);
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 151) {
    throw new Error(`Card number is out of V4 symbolic range: ${cardNumber}`);
  }
  return V4_SYMBOLS_151[normalized - 1] ?? "";
}

function decodeV4SymbolCardNumber(symbol: string): number {
  const index = V4_SYMBOLS_151.indexOf(symbol);
  if (index < 0) throw new Error(`Unknown V4 symbolic card token: ${symbol}`);
  return index + 1;
}

function buildV4SymbolicFromRefs(cardRefs: string[], cardArtKeys?: string[]): string {
  const grouped = new Map<number, { n: number; a: string }[]>();
  for (let i = 0; i < cardRefs.length; i += 1) {
    const [g36, n36] = String(cardRefs[i] ?? "").split(".");
    const gen = parseInt(g36 ?? "", 36);
    const cardNumber = parseInt(n36 ?? "", 36);
    if (!Number.isInteger(gen) || !Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > 151 || gen < 1 || gen > 8) {
      throw new Error("Unable to encode symbolic WARDDECK4 for one or more cards.");
    }
    const list = grouped.get(gen) ?? [];
    list.push({ n: cardNumber, a: encodeCompactArtKey(normalizeShareArtKey(cardArtKeys?.[i])) ?? "" });
    grouped.set(gen, list);
  }

  const segments: string[] = [];
  for (const gen of Array.from(grouped.keys()).sort((a, b) => a - b)) {
    const capture = V4_GEN_CAPTURE_BY_VALUE[gen];
    if (!capture) continue;
    const [open, close] = capture;
    const cards = grouped.get(gen) ?? [];
    const defaults: string[] = [];
    const zeros: string[] = [];
    const holos: string[] = [];
    const zeroHolos: string[] = [];
    for (const card of cards) {
      const symbol = encodeV4SymbolCardNumber(card.n);
      if (card.a === "z") zeros.push(symbol);
      else if (card.a === "h") holos.push(symbol);
      else if (card.a === "zh") zeroHolos.push(symbol);
      else defaults.push(symbol);
    }
    const body = [
      defaults.join(""),
      zeros.length ? `[${zeros.join("")}]` : "",
      holos.length ? `{${holos.join("")}}` : "",
      zeroHolos.length ? `<${zeroHolos.join("")}>` : ""
    ].join("");
    segments.push(`${open}${body}${close}`);
  }

  if (segments.length === 0) throw new Error("Unable to encode symbolic WARDDECK4 for this deck.");
  return `${WARD_DECK_STRING_V4_SYMBOLIC_PREFIX}${segments.join("")}`;
}

function decodeV4SymbolicToRefs(input: string): { cardRefs: string[]; cardArtKeys?: string[] } {
  const text = input.trim();
  const body = text.slice(WARD_DECK_STRING_V4_SYMBOLIC_PREFIX.length);
  const refs: string[] = [];
  const arts: string[] = [];
  let i = 0;
  while (i < body.length) {
    const open = body[i];
    const gen = V4_GEN_CAPTURE_TO_VALUE.get(open);
    if (!gen) throw new Error("Invalid symbolic WARDDECK4 generation capture.");
    const close = V4_GEN_CAPTURE_BY_VALUE[gen]?.[1] ?? open;
    i += 1;
    let mode: "" | "z" | "h" | "zh" = "";
    while (i < body.length && body[i] !== close) {
      const ch = body[i];
      if (ch === "[") { mode = "z"; i += 1; continue; }
      if (ch === "{") { mode = "h"; i += 1; continue; }
      if (ch === "<") { mode = "zh"; i += 1; continue; }
      if ((mode === "z" && ch === "]") || (mode === "h" && ch === "}") || (mode === "zh" && ch === ">")) { mode = ""; i += 1; continue; }
      const n = decodeV4SymbolCardNumber(ch);
      refs.push(`${gen.toString(36)}.${(n).toString(36)}`);
      arts.push(decodeCompactArtKey(mode));
      i += 1;
    }
    if (body[i] !== close) throw new Error("Unclosed symbolic WARDDECK4 generation capture.");
    i += 1;
  }
  const hasNonDefault = arts.some(a => a !== "default");
  return { cardRefs: refs, cardArtKeys: hasNonDefault ? arts : undefined };
}



function encodeV4PackedFromRefs(cardRefs: string[], cardArtKeys?: string[]): string {
  const cards = cardRefs.map((ref, index) => {
    const [g36, n36] = String(ref ?? "").split(".");
    const gen = parseInt(g36 ?? "", 36);
    const cardNumber = parseInt(n36 ?? "", 36);
    if (!Number.isInteger(gen) || gen < 0 || gen > 15 || !Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > 151) {
      throw new Error("Unable to encode packed WARDDECK4 for one or more cards.");
    }
    const artCode = encodeCompactArtKey(normalizeShareArtKey(cardArtKeys?.[index])) ?? "";
    const artBits = artCode === "h" ? 1 : artCode === "z" ? 2 : artCode === "zh" ? 3 : 0;
    return { gen, cardNumber, artBits };
  });

  if (cards.length < 1 || cards.length > 63) {
    throw new Error("Packed WARDDECK4 card count is out of range.");
  }

  cards.sort((a, b) => a.gen - b.gen || a.cardNumber - b.cardNumber || a.artBits - b.artBits);
  const bits: number[] = [];
  const pushBits = (value: number, width: number): void => {
    for (let bit = width - 1; bit >= 0; bit -= 1) {
      bits.push((value >> bit) & 1);
    }
  };

  pushBits(4, 4);
  pushBits(cards.length, 6);
  for (const card of cards) {
    pushBits(card.gen, 4);
    pushBits(card.cardNumber - 1, 8);
    pushBits(card.artBits, 2);
  }

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const bytes = new Uint8Array(bits.length / 8);
  for (let offset = 0; offset < bits.length; offset += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | bits[offset + bit];
    }
    bytes[offset / 8] = value;
  }

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  const payload = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${WARD_DECK_STRING_V4_PREFIX}${payload}`;
}

function decodeV4PackedToRefs(input: string): { cardRefs: string[]; cardArtKeys?: string[] } {
  const encoded = input.trim().slice(WARD_DECK_STRING_V4_PREFIX.length);
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const bits: number[] = [];
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((byte >> bit) & 1);
    }
  }

  let cursor = 0;
  const readBits = (width: number): number => {
    if (cursor + width > bits.length) {
      throw new Error("Packed WARDDECK4 payload is truncated.");
    }
    let value = 0;
    for (let index = 0; index < width; index += 1) {
      value = (value << 1) | bits[cursor + index];
    }
    cursor += width;
    return value;
  };

  const version = readBits(4);
  if (version !== 4) {
    throw new Error("Packed WARDDECK4 payload has an unsupported version.");
  }

  const count = readBits(6);
  if (count < 1 || count > 63) {
    throw new Error("Packed WARDDECK4 payload has an invalid card count.");
  }

  const cardRefs: string[] = [];
  const cardArtKeys: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const gen = readBits(4);
    const cardNumber = readBits(8) + 1;
    const artBits = readBits(2);

    if (gen < 0 || gen > 15 || cardNumber < 1 || cardNumber > 151) {
      throw new Error("Packed WARDDECK4 payload contains out-of-range card values.");
    }

    cardRefs.push(`${gen.toString(36)}.${cardNumber.toString(36)}`);
    cardArtKeys.push(artBits === 1 ? "holo" : artBits === 2 ? "zero-art" : artBits === 3 ? "zero-art-holo" : "default");
  }

  return {
    cardRefs,
    cardArtKeys: cardArtKeys.some(value => value !== "default") ? cardArtKeys : undefined
  };
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
    throw new Error("Deck code is missing a compact card list.");
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
    try {
      return buildV4SymbolicFromRefs(compactCardRefEntries.map(entry => Array.isArray(entry) ? String(entry[0]) : String(entry)), (() => {
        const expanded = expandCompactCardEntries(compactCardRefEntries, { usesCardRefs: false });
        return expanded.cardArtKeys;
      })());
    } catch {
      // Fall through to packed V4 format when symbolic encoding is not possible.
    }

    try {
      return encodeV4PackedFromRefs(compactCardRefEntries.map(entry => Array.isArray(entry) ? String(entry[0]) : String(entry)), (() => {
        const expanded = expandCompactCardEntries(compactCardRefEntries, { usesCardRefs: false });
        return expanded.cardArtKeys;
      })());
    } catch {
      // Fall through to v3 payload format when packed v4 encoding is not possible.
    }

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

  if (trimmed.startsWith(WARD_DECK_STRING_V4_SYMBOLIC_PREFIX)) {
    const symbolic = decodeV4SymbolicToRefs(trimmed);
    const expandedCards = expandCompactCardEntries(symbolic.cardRefs, {
      cardLibrary: options.cardLibrary,
      usesCardRefs: true
    });

    return {
      v: 1,
      kind: "WARD_DECK",
      cardIds: expandedCards.cardIds,
      cardArtKeys: symbolic.cardArtKeys ?? expandedCards.cardArtKeys
    };
  }

  if (trimmed.startsWith(WARD_DECK_STRING_V4_PREFIX)) {
    const packed = decodeV4PackedToRefs(trimmed);
    const expandedCards = expandCompactCardEntries(packed.cardRefs, {
      cardLibrary: options.cardLibrary,
      usesCardRefs: true
    });

    return {
      v: 1,
      kind: "WARD_DECK",
      cardIds: expandedCards.cardIds,
      cardArtKeys: packed.cardArtKeys ?? expandedCards.cardArtKeys
    };
  }

  if (trimmed.startsWith(WARD_DECK_STRING_PREFIX)) {
    const jsonText = decodeUtf8Base64Url(trimmed.slice(WARD_DECK_STRING_PREFIX.length));
    const parsed = JSON.parse(jsonText) as Partial<WardDeckSharePayloadV3>;

    if (parsed.v !== 3 || parsed.k !== "WD") {
      throw new Error("Deck code is not a Ward Nexus WARDDECK3 payload.");
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
      throw new Error("Deck code is not a Ward Nexus WARDDECK2 payload.");
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
    throw new Error(`Deck code must start with ${getWardDeckStringAcceptedPrefixesLabel()}.`);
  }

  const jsonText = decodeUtf8Base64Url(trimmed.slice(WARD_DECK_STRING_V1_PREFIX.length));
  const parsed = JSON.parse(jsonText) as Partial<WardDeckSharePayload>;

  if (parsed.v !== 1 || parsed.kind !== "WARD_DECK") {
    throw new Error("Deck code is not a Ward Nexus WARDDECK1 payload.");
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
  const deckString = args.deckString ?? encodeWardDeckString({
    name: args.name,
    deckId: args.deckId,
    cardIds: args.cardIds,
    cardArtKeys: args.cardArtKeys,
    startingHandSize: args.startingHandSize
  }, { cardLibrary: args.cardLibrary });
  const deckStringFormatLabel = getWardDeckStringFormatLabel(deckString) ?? "WARDDECK";

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
    `## Share Code (${deckStringFormatLabel})`,
    "",
    deckString,
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
