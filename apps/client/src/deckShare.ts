import type { WardEngineEffect } from "@ward/shared";
import type { CardLibraryCardSummary } from "./clientTypes";

export type WardDeckSharePayload = {
  v: 1;
  kind: "WARD_DECK";
  name?: string;
  deckId?: string;
  cardIds: string[];
  cardArtKeys?: string[];
  startingHandSize?: number;
  notes?: string;
};

export const WARD_DECK_STRING_PREFIX = "WARDDECK1:";

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

export function encodeWardDeckString(payload: Omit<WardDeckSharePayload, "v" | "kind">): string {
  const cardIds = normalizeImportedCardIds(payload.cardIds);
  const normalizedPayload: WardDeckSharePayload = {
    v: 1,
    kind: "WARD_DECK",
    name: payload.name?.trim() || undefined,
    deckId: payload.deckId?.trim() || undefined,
    cardIds,
    cardArtKeys: normalizeImportedCardArtKeys(payload.cardArtKeys, cardIds.length),
    startingHandSize: Number.isFinite(payload.startingHandSize)
      ? Math.max(0, Math.floor(payload.startingHandSize ?? 0))
      : undefined,
    notes: payload.notes?.trim() || undefined
  };

  return `${WARD_DECK_STRING_PREFIX}${encodeUtf8Base64Url(JSON.stringify(normalizedPayload))}`;
}

export function decodeWardDeckString(value: string): WardDeckSharePayload {
  const trimmed = value.trim();

  if (!trimmed.startsWith(WARD_DECK_STRING_PREFIX)) {
    throw new Error(`Deck string must start with ${WARD_DECK_STRING_PREFIX}`);
  }

  const jsonText = decodeUtf8Base64Url(trimmed.slice(WARD_DECK_STRING_PREFIX.length));
  const parsed = JSON.parse(jsonText) as Partial<WardDeckSharePayload>;

  if (parsed.v !== 1 || parsed.kind !== "WARD_DECK") {
    throw new Error("Deck string is not a WARD deck string v1 payload.");
  }

  const cardIds = normalizeImportedCardIds(parsed.cardIds);

  return {
    v: 1,
    kind: "WARD_DECK",
    name: parsed.name ? String(parsed.name) : undefined,
    deckId: parsed.deckId ? String(parsed.deckId) : undefined,
    cardIds,
    cardArtKeys: normalizeImportedCardArtKeys(parsed.cardArtKeys, cardIds.length),
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
    `# ${args.name || "WARD Deck"} - Test Notes`,
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
    }),
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
