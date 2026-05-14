import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import { buildDeckNotesMarkdown, decodeWardDeckString, downloadTextFile, encodeWardDeckString, sanitizeDownloadFileName } from "../deckShare";
import { getDisplayMagicType } from "../gameViewHelpers";
import { ACTIVE_CARD_ART_OPTIONS, CardImagePreview, CardImageThumbnail, getCardArtLabel } from "./CardImagePreview";
import type { CardArtKey } from "./CardImagePreview";
import { AddCardToMarketplaceModal } from "./AddCardToMarketplaceModal";

type CardTypeFilter = "ALL" | "CREATURE" | "MAGIC";
type DeckMembershipFilter = "ALL" | "IN_DECK" | "NOT_IN_DECK";
type OwnershipFilter = "ALL" | "OWNED" | "MISSING";
type TournamentLimitStatus = "LEGAL" | "LIMITED" | "BANNED";
type DeckFormat = "FREE_PLAY" | "TOURNAMENT";
type SortMode = "number" | "name" | "generation" | "deckCount" | "ownedCount" | "armorLevel" | "hp" | "speed";

type CollectionVariant = "default" | "holo" | "zero-art" | "zero-art-holo";

type VariantCompletionSummary = {
  variant: CollectionVariant;
  label: string;
  ownedMatches: number;
  requiredMatches: number;
  completionPercent: number;
};

type MissingCollectionItem = {
  cardId: string;
  cardName: string;
  generation: string;
  variant: CollectionVariant;
  variantLabel: string;
  owned: number;
  required: number;
  missing: number;
};

const FIXED_HOLO_INTENSITY = 10;
const INITIAL_VISIBLE_CARD_COUNT = 72;
const VISIBLE_CARD_INCREMENT = 72;

type CardLibraryPanelProps = {
  cardLibrary: CardLibraryCardSummary[];
  selectedPackCount: number;
  deckBuilderName: string;
  deckBuilderId: string;
  deckBuilderCardIds: string[];
  deckBuilderCardArtKeys: CardArtKey[];
  deckBuilderFormat: DeckFormat;
  ownershipCounts: Record<string, number>;
  normalizeId: (value: string) => string;
  getDeckBuilderCounts: () => Record<string, number>;
  getDeckBuilderCardCount: (cardId: string) => number;
  onDeckNameChange: (value: string) => void;
  onDeckIdChange: (value: string) => void;
  onDeckFormatChange: (value: DeckFormat) => void;
  onRefreshCardLibrary: () => void;
  onClearDeckBuilder: () => void;
  onNewDeck: () => void;
  onAddCard: (cardId: string, artKey?: CardArtKey) => void;
  onRemoveCard: (cardId: string, artKey?: CardArtKey) => void;
  onSetCardCopies: (cardId: string, copyCount: number, artKey?: CardArtKey) => void;
  onSetOwnedCopies: (cardId: string, ownedCount: number) => void;
  onSaveDeck: () => void;
  onAddMarketplaceNeed?: (payload: Record<string, unknown>) => void;
  onAddMarketplaceHave?: (payload: Record<string, unknown>) => void;
  canUseDevTools?: boolean;
  onSaveCardLimit?: (cardId: string, status: TournamentLimitStatus) => void;
  onOpenMarketplaceOverride?: (cardId: string) => void;
};

function getUniqueValues(values: Array<string | number | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string | number => value !== undefined && value !== null && `${value}`.trim() !== "")
        .map(value => `${value}`)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function getCardSearchText(card: CardLibraryCardSummary): string {
  return [
    card.id,
    card.name,
    card.cardNumber,
    card.generation,
    card.edition,
    card.rarity,
    card.cardType,
    card.creatureType,
    card.magicType,
    card.magicSubType,
    card.text,
    ...(card.effectTypes ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCardSortNumber(card: CardLibraryCardSummary): string {
  return `${card.generation ?? ""}`.padStart(3, "0") + `-${card.cardNumber ?? card.id}`;
}

function getTournamentLimitStatus(card: CardLibraryCardSummary): TournamentLimitStatus {
  if ((card.deckLimit ?? 3) <= 0) return "BANNED";
  if ((card.deckLimit ?? 3) < 3) return "LIMITED";
  return "LEGAL";
}

function getEffectiveDeckLimit(card: CardLibraryCardSummary | undefined, format: DeckFormat): number {
  return format === "TOURNAMENT" ? card?.deckLimit ?? 3 : 3;
}

function sanitizeCopies(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function CardLibraryPanel({
  cardLibrary,
  selectedPackCount,
  deckBuilderName,
  deckBuilderId,
  deckBuilderCardIds,
  deckBuilderCardArtKeys,
  deckBuilderFormat,
  ownershipCounts,
  normalizeId,
  getDeckBuilderCounts,
  onDeckNameChange,
  onDeckIdChange,
  onDeckFormatChange,
  onRefreshCardLibrary,
  onClearDeckBuilder,
  onNewDeck,
  onAddCard,
  onRemoveCard,
  onSetCardCopies,
  onSetOwnedCopies,
  onSaveDeck,
  onAddMarketplaceNeed,
  onAddMarketplaceHave,
  canUseDevTools = false,
  onSaveCardLimit,
  onOpenMarketplaceOverride
}: CardLibraryPanelProps) {
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<CardTypeFilter>("ALL");
  const [generationFilter, setGenerationFilter] = useState("ALL");
  const [rarityFilter, setRarityFilter] = useState("ALL");
  const [creatureTypeFilter, setCreatureTypeFilter] = useState("ALL");
  const [magicTypeFilter, setMagicTypeFilter] = useState("ALL");
  const [effectTypeFilter, setEffectTypeFilter] = useState("ALL");
  const [deckMembershipFilter, setDeckMembershipFilter] = useState<DeckMembershipFilter>("ALL");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("number");
  const [selectedArtKeysByCardId, setSelectedArtKeysByCardId] = useState<Record<string, CardArtKey>>({});
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; artKey: CardArtKey } | null>(null);
  const [deckDropActive, setDeckDropActive] = useState(false);
  const [deckShareString, setDeckShareString] = useState("");
  const [deckImportString, setDeckImportString] = useState("");
  const [deckShareMessage, setDeckShareMessage] = useState("");
  const [unloadedCardCount, setUnloadedCardCount] = useState(0);
  const [visibleCardCount, setVisibleCardCount] = useState(INITIAL_VISIBLE_CARD_COUNT);
  const [missingFocusCardIds, setMissingFocusCardIds] = useState<string[] | null>(null);
  const [gridColumnCount, setGridColumnCount] = useState(1);
  const [activeMarketplaceAction, setActiveMarketplaceAction] = useState<null | { cardId: string; mode: "need" | "have" }>(null);

  const [estimatedCardBlockSize, setEstimatedCardBlockSize] = useState(360);
  const [completionGeneration, setCompletionGeneration] = useState("ALL");
  const [requiredQuantityPerCard, setRequiredQuantityPerCard] = useState(1);
  const [completionVariants, setCompletionVariants] = useState<Record<CollectionVariant, boolean>>({ default: true, holo: false, "zero-art": false, "zero-art-holo": false });
  const cardGridRef = useRef<HTMLDivElement | null>(null);
  const loadPreviousSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const deckCounts = useMemo(() => getDeckBuilderCounts(), [deckBuilderCardIds, getDeckBuilderCounts]);

  const generations = useMemo(
    () => getUniqueValues(cardLibrary.map(card => card.generation)),
    [cardLibrary]
  );
  const rarities = useMemo(
    () => getUniqueValues(cardLibrary.map(card => card.rarity)),
    [cardLibrary]
  );
  const creatureTypes = useMemo(
    () => getUniqueValues(cardLibrary.map(card => card.creatureType)),
    [cardLibrary]
  );
  const magicTypes = useMemo(
    () => getUniqueValues(cardLibrary.map(card => getDisplayMagicType(card.magicType))),
    [cardLibrary]
  );
  const effectTypes = useMemo(
    () => getUniqueValues(cardLibrary.flatMap(card => card.effectTypes ?? [])),
    [cardLibrary]
  );

  const collectionVariantOptions: Array<{ key: CollectionVariant; label: string }> = [
    { key: "default", label: "Default" },
    { key: "holo", label: "Holo" },
    { key: "zero-art", label: "Zero" },
    { key: "zero-art-holo", label: "Zero Holo" }
  ];

  const selectedCompletionVariants = collectionVariantOptions.filter(option => completionVariants[option.key]);

  const completionCards = useMemo(
    () => cardLibrary.filter(card => completionGeneration === "ALL" || `${card.generation ?? ""}` === completionGeneration),
    [cardLibrary, completionGeneration]
  );

  const variantCompletion = useMemo(() => {
    const summaries: VariantCompletionSummary[] = [];
    const missingItems: MissingCollectionItem[] = [];

    for (const variantOption of selectedCompletionVariants) {
      const requiredMatches = completionCards.length * requiredQuantityPerCard;
      const ownedMatches = completionCards.reduce((total, card) => {
        const owned = ownershipCounts[getCardArtOwnershipKey(card.id, variantOption.key)] ?? 0;
        return total + Math.min(requiredQuantityPerCard, owned);
      }, 0);

      for (const card of completionCards) {
        const owned = ownershipCounts[getCardArtOwnershipKey(card.id, variantOption.key)] ?? 0;
        const missing = Math.max(0, requiredQuantityPerCard - owned);

        if (missing > 0) {
          missingItems.push({
            cardId: card.id,
            cardName: card.name,
            generation: `${card.generation ?? ""}`,
            variant: variantOption.key,
            variantLabel: variantOption.label,
            owned,
            required: requiredQuantityPerCard,
            missing
          });
        }
      }

      summaries.push({
        variant: variantOption.key,
        label: variantOption.label,
        ownedMatches,
        requiredMatches,
        completionPercent: requiredMatches === 0 ? 100 : Math.round((ownedMatches / requiredMatches) * 1000) / 10
      });
    }

    return { summaries, missingItems };
  }, [completionCards, ownershipCounts, requiredQuantityPerCard, selectedCompletionVariants]);

  const deckCards = useMemo(() => {
    const variantCounts = deckBuilderCardIds.reduce<Record<string, { cardId: string; artKey: CardArtKey; count: number }>>(
      (result, cardId, index) => {
        const artKey = deckBuilderCardArtKeys[index] ?? "default";
        const key = `${cardId}__${artKey}`;
        const existing = result[key];

        if (existing) {
          existing.count += 1;
        } else {
          result[key] = { cardId, artKey, count: 1 };
        }

        return result;
      },
      {}
    );

    return Object.values(variantCounts)
      .map(({ cardId, artKey, count }) => ({
        cardId,
        artKey,
        count,
        card: cardLibrary.find(item => item.id === cardId)
      }))
      .sort((a, b) =>
        (a.card?.name ?? a.cardId).localeCompare(b.card?.name ?? b.cardId) ||
        getCardArtLabel(a.artKey).localeCompare(getCardArtLabel(b.artKey))
      );
  }, [cardLibrary, deckBuilderCardArtKeys, deckBuilderCardIds]);


  const missingDeckVariants = useMemo(() => {
    return deckCards
      .map(({ cardId, artKey, count, card }) => {
        const ownedCount = ownershipCounts[getCardArtOwnershipKey(cardId, artKey)] ?? 0;
        const missingCount = Math.max(0, count - ownedCount);

        return {
          cardId,
          artKey,
          requiredCount: count,
          ownedCount,
          missingCount,
          card
        };
      })
      .filter(entry => entry.missingCount > 0)
      .sort((a, b) => {
        const generationA = Number.parseInt(`${a.card?.generation ?? ""}`, 10);
        const generationB = Number.parseInt(`${b.card?.generation ?? ""}`, 10);
        const normalizedGenerationA = Number.isFinite(generationA) ? generationA : Number.MAX_SAFE_INTEGER;
        const normalizedGenerationB = Number.isFinite(generationB) ? generationB : Number.MAX_SAFE_INTEGER;
        if (normalizedGenerationA !== normalizedGenerationB) return normalizedGenerationA - normalizedGenerationB;

        const numberA = `${a.card?.cardNumber ?? ""}`;
        const numberB = `${b.card?.cardNumber ?? ""}`;
        const byNumber = numberA.localeCompare(numberB, undefined, { numeric: true });
        if (byNumber !== 0) return byNumber;

        const byId = a.cardId.localeCompare(b.cardId, undefined, { numeric: true });
        if (byId !== 0) return byId;

        return getCardArtLabel(a.artKey).localeCompare(getCardArtLabel(b.artKey));
      });
  }, [deckCards, ownershipCounts]);

  const deckStats = useMemo(() => {
    const creatureCards = deckBuilderCardIds
      .map(cardId => cardLibrary.find(card => card.id === cardId))
      .filter((card): card is CardLibraryCardSummary => !!card && card.cardType === "CREATURE");
    const magicCards = deckBuilderCardIds
      .map(cardId => cardLibrary.find(card => card.id === cardId))
      .filter((card): card is CardLibraryCardSummary => !!card && card.cardType === "MAGIC");

    const averageAL = creatureCards.length === 0
      ? 0
      : creatureCards.reduce((total, card) => total + (card.armorLevel ?? 0), 0) / creatureCards.length;

    return {
      total: deckBuilderCardIds.length,
      creatureCount: creatureCards.length,
      magicCount: magicCards.length,
      standardMagicCount: magicCards.filter(card => card.magicType === "STANDARD").length,
      infiniteMagicCount: magicCards.filter(card => card.magicType === "INFINITE").length,
      lightningMagicCount: magicCards.filter(card => card.magicType === "LIGHTNING" || card.magicType === "BATTLE_LIGHTNING").length,
      averageAL
    };
  }, [cardLibrary, deckBuilderCardIds]);

  const librarySummary = useMemo(() => {
    const creatures = cardLibrary.filter(card => card.cardType === "CREATURE").length;
    const magic = cardLibrary.filter(card => card.cardType === "MAGIC").length;
    const ownedUnique = cardLibrary.filter(card => getTotalOwnedCopiesForCard(card.id) > 0).length;
    const ownedTotal = cardLibrary.reduce((total, card) => total + getTotalOwnedCopiesForCard(card.id), 0);

    return {
      total: cardLibrary.length,
      creatures,
      magic,
      ownedUnique,
      ownedTotal,
      banned: cardLibrary.filter(card => card.deckLimit === 0).length,
      limited: cardLibrary.filter(card => card.deckLimit > 0 && card.deckLimit < 3).length
    };
  }, [cardLibrary, ownershipCounts, selectedArtKeysByCardId]);

  const deckWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (deckStats.total !== 30) warnings.push(`Deck must be exactly 30 cards. Current: ${deckStats.total}.`);
    if (deckStats.creatureCount < 8) warnings.push("Recommended minimum is 8 creatures.");
    if (deckStats.creatureCount > 12) warnings.push("Recommended maximum is 12 creatures.");

    for (const [cardId, count] of Object.entries(deckCounts)) {
      const card = cardLibrary.find(item => item.id === cardId);
      const deckLimit = getEffectiveDeckLimit(card, deckBuilderFormat);
      const ownedCount = getTotalOwnedCopiesForCard(cardId);

      if (deckBuilderFormat === "TOURNAMENT" && deckLimit <= 0 && count > 0) warnings.push(`${card?.name ?? cardId} is banned.`);
      if (deckBuilderFormat === "TOURNAMENT" && count > deckLimit) warnings.push(`${card?.name ?? cardId} has ${count}/${deckLimit} copies.`);
      if (ownedCount > 0 && count > ownedCount) warnings.push(`${card?.name ?? cardId} has ${count} deck copies but only ${ownedCount} total owned across art variants.`);
    }

    return warnings;
  }, [cardLibrary, deckBuilderFormat, deckCounts, deckStats.creatureCount, deckStats.total, ownershipCounts, selectedArtKeysByCardId]);

  const missingCompletionSummary = useMemo(() => {
    const entries = Object.entries(deckCounts)
      .map(([cardId, count]) => {
        const ownedCount = getTotalOwnedCopiesForCard(cardId);
        const needed = Math.max(0, count - ownedCount);

        if (needed === 0) return null;

        return {
          cardId,
          needed,
          ownedCount,
          count,
          card: cardLibrary.find(item => item.id === cardId)
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.needed - a.needed || (a.card?.name ?? a.cardId).localeCompare(b.card?.name ?? b.cardId));

    return {
      missingCardTypes: entries.length,
      missingTotalCopies: entries.reduce((total, entry) => total + entry.needed, 0),
      entries
    };
  }, [cardLibrary, deckCounts, ownershipCounts, selectedArtKeysByCardId]);

  const filteredCards = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return cardLibrary
      .filter(card => {
        const deckCount = deckCounts[card.id] ?? 0;
        const ownedCount = getTotalOwnedCopiesForCard(card.id);

        if (typeFilter !== "ALL" && card.cardType !== typeFilter) return false;
        if (generationFilter !== "ALL" && `${card.generation ?? ""}` !== generationFilter) return false;
        if (rarityFilter !== "ALL" && `${card.rarity ?? ""}` !== rarityFilter) return false;
        if (creatureTypeFilter !== "ALL" && `${card.creatureType ?? ""}` !== creatureTypeFilter) return false;
        if (magicTypeFilter !== "ALL" && getDisplayMagicType(card.magicType) !== magicTypeFilter) return false;
        if (effectTypeFilter !== "ALL" && !(card.effectTypes ?? []).includes(effectTypeFilter)) return false;
        if (deckMembershipFilter === "IN_DECK" && deckCount === 0) return false;
        if (deckMembershipFilter === "NOT_IN_DECK" && deckCount > 0) return false;
        if (ownershipFilter === "OWNED" && ownedCount === 0) return false;
        if (ownershipFilter === "MISSING" && ownedCount > 0) return false;
        if (missingFocusCardIds && !missingFocusCardIds.includes(card.id)) return false;
        if (deckBuilderFormat === "TOURNAMENT" && getTournamentLimitStatus(card) === "BANNED") return false;
        if (normalizedSearch && !getCardSearchText(card).includes(normalizedSearch)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "name") return a.name.localeCompare(b.name);
        if (sortMode === "generation") {
          return `${a.generation ?? ""}`.localeCompare(`${b.generation ?? ""}`, undefined, { numeric: true }) ||
            `${a.cardNumber ?? ""}`.localeCompare(`${b.cardNumber ?? ""}`, undefined, { numeric: true }) ||
            a.name.localeCompare(b.name);
        }
        if (sortMode === "deckCount") return (deckCounts[b.id] ?? 0) - (deckCounts[a.id] ?? 0) || a.name.localeCompare(b.name);
        if (sortMode === "ownedCount") return getTotalOwnedCopiesForCard(b.id) - getTotalOwnedCopiesForCard(a.id) || a.name.localeCompare(b.name);
        if (sortMode === "armorLevel") return (b.armorLevel ?? -1) - (a.armorLevel ?? -1) || a.name.localeCompare(b.name);
        if (sortMode === "hp") return (b.hp ?? -1) - (a.hp ?? -1) || a.name.localeCompare(b.name);
        if (sortMode === "speed") return (b.speed ?? -1) - (a.speed ?? -1) || a.name.localeCompare(b.name);

        return getCardSortNumber(a).localeCompare(getCardSortNumber(b), undefined, { numeric: true }) || a.name.localeCompare(b.name);
      });
  }, [cardLibrary, creatureTypeFilter, deckBuilderFormat, deckCounts, deckMembershipFilter, effectTypeFilter, generationFilter, magicTypeFilter, missingFocusCardIds, ownershipCounts, ownershipFilter, rarityFilter, searchText, sortMode, typeFilter, selectedArtKeysByCardId]);

  const visibleCards = useMemo(
    () => filteredCards.slice(unloadedCardCount, visibleCardCount),
    [filteredCards, unloadedCardCount, visibleCardCount]
  );
  const unloadedTopSpacerHeight = Math.ceil(unloadedCardCount / gridColumnCount) * estimatedCardBlockSize;
  const hiddenAboveCardCount = unloadedCardCount;
  const hiddenBelowCardCount = Math.max(0, filteredCards.length - visibleCardCount);

  useEffect(() => {
    setUnloadedCardCount(0);
    setVisibleCardCount(INITIAL_VISIBLE_CARD_COUNT);
  }, [
    creatureTypeFilter,
    deckMembershipFilter,
    effectTypeFilter,
    generationFilter,
    magicTypeFilter,
    ownershipFilter,
    rarityFilter,
    searchText,
    sortMode,
    typeFilter
  ]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = cardGridRef.current;

    if (!sentinel || !root || hiddenBelowCardCount === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) {
          return;
        }

        setVisibleCardCount(current => Math.min(current + VISIBLE_CARD_INCREMENT, filteredCards.length));
      },
      {
        root,
        rootMargin: "700px 0px 900px 0px",
        threshold: 0.01
      }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [filteredCards.length, hiddenBelowCardCount, visibleCardCount]);

  useEffect(() => {
    const sentinel = loadPreviousSentinelRef.current;
    const root = cardGridRef.current;

    if (!sentinel || !root || hiddenAboveCardCount === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) {
          return;
        }

        setUnloadedCardCount(current => Math.max(0, current - VISIBLE_CARD_INCREMENT));
      },
      {
        root,
        rootMargin: "900px 0px 700px 0px",
        threshold: 0.01
      }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hiddenAboveCardCount, unloadedCardCount]);

  useEffect(() => {
    const grid = cardGridRef.current;

    if (!grid) {
      return;
    }

    function updateGridMeasurements() {
      if (!grid) {
        return;
      }

      const computedStyle = window.getComputedStyle(grid);
      const columnCount = computedStyle.gridTemplateColumns
        .split(" ")
        .filter(column => column.trim() !== "").length;
      const rowGap = Number.parseFloat(computedStyle.rowGap) || 0;
      const firstCard = grid.querySelector<HTMLElement>(".library-option-a-card-entry");
      const cardHeight = firstCard?.getBoundingClientRect().height;

      setGridColumnCount(Math.max(1, columnCount));
      if (cardHeight && Number.isFinite(cardHeight)) {
        setEstimatedCardBlockSize(Math.max(260, cardHeight + rowGap));
      }
    }

    updateGridMeasurements();

    const resizeObserver = new ResizeObserver(updateGridMeasurements);
    resizeObserver.observe(grid);

    return () => resizeObserver.disconnect();
  }, [visibleCards.length]);

  function clearFilters() {
    setSearchText("");
    setTypeFilter("ALL");
    setGenerationFilter("ALL");
    setRarityFilter("ALL");
    setCreatureTypeFilter("ALL");
    setMagicTypeFilter("ALL");
    setEffectTypeFilter("ALL");
    setDeckMembershipFilter("ALL");
    setOwnershipFilter("ALL");
    setSortMode("number");
    setMissingFocusCardIds(null);
  }

  function setDeckCopiesFromInput(cardId: string, value: string, artKey: CardArtKey = "default") {
    onSetCardCopies(cardId, sanitizeCopies(value), artKey);
  }

  function getSelectedArtKey(cardId: string): CardArtKey {
    return selectedArtKeysByCardId[cardId] ?? "default";
  }

  function setSelectedArtKey(cardId: string, artKey: CardArtKey) {
    setSelectedArtKeysByCardId(current => ({
      ...current,
      [cardId]: artKey
    }));
  }

  function getCardArtOwnershipKey(cardId: string, artKey: CardArtKey): string {
    return artKey === "default" ? cardId : `${cardId}__art_${artKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  function getOwnershipVariantFromArtworkAndHolo(artworkMode: "DEFAULT" | "ZERO", isHolo: boolean): CardArtKey {
    if (artworkMode === "ZERO") {
      return isHolo ? "zero-art-holo" : "zero-art";
    }

    return isHolo ? "holo" : "default";
  }

  function getOwnedCopiesForArt(cardId: string, artKey: CardArtKey): number {
    return ownershipCounts[getCardArtOwnershipKey(cardId, artKey)] ?? 0;
  }


  function getTotalOwnedCopiesForCard(cardId: string): number {
    return ACTIVE_CARD_ART_OPTIONS.reduce((total, artOption) => {
      return total + (ownershipCounts[getCardArtOwnershipKey(cardId, artOption.key)] ?? 0);
    }, 0);
  }

  function setArtOwnedCopies(cardId: string, artKey: CardArtKey, requestedOwnedCount: number) {
    const ownershipKey = getCardArtOwnershipKey(cardId, artKey);
    onSetOwnedCopies(ownershipKey, Math.min(999, Math.max(0, Math.floor(requestedOwnedCount))));
  }

  function setArtOwnedCopiesFromInput(cardId: string, artKey: CardArtKey, value: string) {
    setArtOwnedCopies(cardId, artKey, sanitizeCopies(value));
  }

  function getCanAddCardToDeck(cardId: string) {
    const card = cardLibrary.find(item => item.id === cardId);
    const deckLimit = getEffectiveDeckLimit(card, deckBuilderFormat);
    const deckCount = deckCounts[cardId] ?? 0;

    return !!card && deckLimit > 0 && deckCount < deckLimit && deckBuilderCardIds.length < 30;
  }

  function handleCardDragStart(event: DragEvent<HTMLElement>, cardId: string, artKey: CardArtKey) {
    if (!getCanAddCardToDeck(cardId)) {
      event.preventDefault();
      return;
    }

    setDraggedCard({ cardId, artKey });
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.setData("application/x-ward-card-id", cardId);
    event.dataTransfer.setData("application/x-ward-card-art-key", artKey);
  }

  function handleDeckDragOver(event: DragEvent<HTMLElement>) {
    const cardId = draggedCard?.cardId || event.dataTransfer.getData("application/x-ward-card-id") || event.dataTransfer.getData("text/plain");

    if (!cardId || !getCanAddCardToDeck(cardId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDeckDropActive(true);
  }

  function handleDeckDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();

    const cardId = event.dataTransfer.getData("application/x-ward-card-id") || event.dataTransfer.getData("text/plain") || draggedCard?.cardId;
    const artKey = (event.dataTransfer.getData("application/x-ward-card-art-key") || draggedCard?.artKey || "default") as CardArtKey;
    setDeckDropActive(false);
    setDraggedCard(null);

    if (cardId && getCanAddCardToDeck(cardId)) onAddCard(cardId, artKey);
  }

  async function copyCurrentDeckString() {
    if (deckBuilderCardIds.length === 0) {
      setDeckShareMessage("Add cards before generating a deck string.");
      return;
    }

    const value = encodeWardDeckString({
      name: deckBuilderName,
      deckId: normalizeId(deckBuilderId),
      cardIds: deckBuilderCardIds,
      cardArtKeys: deckBuilderCardArtKeys,
      format: deckBuilderFormat
    });

    setDeckShareString(value);

    try {
      await navigator.clipboard.writeText(value);
      setDeckShareMessage("Copied deck string to clipboard.");
    } catch {
      setDeckShareMessage("Deck string generated. Clipboard copy was blocked by the browser.");
    }
  }

  function importDeckStringIntoBuilder() {
    try {
      const payload = decodeWardDeckString(deckImportString);
      const unknownCards = payload.cardIds.filter(cardId => !cardLibrary.some(card => card.id === cardId));
      const artKeys = payload.cardArtKeys ?? Array.from({ length: payload.cardIds.length }, () => "default");

      if (payload.name) onDeckNameChange(payload.name);
      if (payload.deckId) onDeckIdChange(normalizeId(payload.deckId));
      onDeckFormatChange(payload.format === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY");
      onClearDeckBuilder();

      const counts = payload.cardIds.reduce<Record<string, { cardId: string; artKey: CardArtKey; count: number }>>((result, cardId, index) => {
        const artKey = (artKeys[index] === "holo" || artKeys[index] === "zero-art" || artKeys[index] === "zero-art-holo" ? artKeys[index] : "default") as CardArtKey;
        const key = `${cardId}__${artKey}`;
        result[key] = result[key] ?? { cardId, artKey, count: 0 };
        result[key].count += 1;
        return result;
      }, {});

      for (const { cardId, artKey, count } of Object.values(counts)) {
        onSetCardCopies(cardId, count, artKey);
      }

      setDeckShareMessage(
        unknownCards.length > 0
          ? `Imported ${payload.cardIds.length} cards. ${unknownCards.length} card ID(s) are not in the currently loaded packs.`
          : `Imported ${payload.cardIds.length} cards from deck string.`
      );
    } catch (error) {
      setDeckShareMessage(error instanceof Error ? error.message : "Could not import deck string.");
    }
  }

  function downloadCurrentDeckNotes() {
    if (deckBuilderCardIds.length === 0) {
      setDeckShareMessage("Add cards before generating notes.");
      return;
    }

    const deckString = encodeWardDeckString({
      name: deckBuilderName,
      deckId: normalizeId(deckBuilderId),
      cardIds: deckBuilderCardIds,
      cardArtKeys: deckBuilderCardArtKeys,
      format: deckBuilderFormat
    });
    const markdown = buildDeckNotesMarkdown({
      name: deckBuilderName || "Ward Nexus Deck",
      deckId: normalizeId(deckBuilderId),
      cardIds: deckBuilderCardIds,
      cardArtKeys: deckBuilderCardArtKeys,
      cardLibrary,
      sourceLabel: "Regular Deck Builder",
      deckString
    });
    const fileName = `${sanitizeDownloadFileName(deckBuilderId || deckBuilderName, "ward-deck")}-notes.md`;

    downloadTextFile(fileName, markdown);
    setDeckShareString(deckString);
    setDeckShareMessage(`Generated notes file: ${fileName}`);
  }

  const saveDisabled = deckBuilderCardIds.length !== 30 || !deckBuilderName.trim() || !normalizeId(deckBuilderId);

  function applyMissingFocus() {
    if (missingCompletionSummary.entries.length === 0) {
      setMissingFocusCardIds(null);
      return;
    }

    setMissingFocusCardIds(missingCompletionSummary.entries.map(entry => entry.cardId));
  }

  function clearMissingFocus() {
    setMissingFocusCardIds(null);
  }

  return (
    <section className="setup-section library-option-a-section">
      <div className="library-option-a-toolbar">
        <div className="library-option-a-title-block">
          <h3>Card Library + Deck Editor</h3>
          <p className="library-option-a-variant-hint">Art update: choose <strong>Default</strong> or <strong>Zero</strong> in each card, then toggle <strong>Holo Finish</strong>.</p>
          <div className="library-option-a-format-toggle" role="group" aria-label="Deck format">
            <button
              type="button"
              className={deckBuilderFormat === "FREE_PLAY" ? "active" : undefined}
              onClick={() => onDeckFormatChange("FREE_PLAY")}
            >
              Free Play
            </button>
            <button
              type="button"
              className={deckBuilderFormat === "TOURNAMENT" ? "active" : undefined}
              onClick={() => onDeckFormatChange("TOURNAMENT")}
            >
              Tournament Legal
            </button>
          </div>
          <div className="library-option-a-chip-row" aria-label="Library and deck summary">
            <span><strong>{librarySummary.total}</strong> cards</span>
            <span><strong>{librarySummary.creatures}</strong> creatures</span>
            <span><strong>{librarySummary.magic}</strong> magic</span>
            <span><strong>{selectedPackCount}</strong> packs</span>
            <span><strong>{librarySummary.ownedUnique}</strong> owned cards</span>
            <span><strong>{librarySummary.ownedTotal}</strong> owned art copies</span>
            <span><strong>{deckStats.total}/30</strong> deck</span>
            <span><strong>{deckStats.creatureCount}</strong> creatures</span>
            <span><strong>{deckStats.magicCount}</strong> magic</span>
            <button type="button" onClick={applyMissingFocus} disabled={missingCompletionSummary.missingTotalCopies === 0}>Show Remaining Needed</button>
            <button type="button" onClick={applyMissingFocus} disabled={missingCompletionSummary.missingCardTypes === 0}>
              Missing cards: <strong>{missingCompletionSummary.missingCardTypes}</strong>
            </button>
            <button type="button" onClick={applyMissingFocus} disabled={missingCompletionSummary.missingTotalCopies === 0}>
              Missing copies: <strong>{missingCompletionSummary.missingTotalCopies}</strong>
            </button>
            <button type="button" onClick={clearMissingFocus} disabled={!missingFocusCardIds}>Clear Remaining Focus</button>
          </div>
        </div>

        <div className="library-option-a-actions">
          <button onClick={onRefreshCardLibrary}>Refresh</button>
          <button onClick={clearFilters}>Clear Filters</button>
          <button onClick={onNewDeck}>New Deck</button>
          <button onClick={onClearDeckBuilder} disabled={deckBuilderCardIds.length === 0}>Clear Deck</button>
          <button onClick={onSaveDeck} disabled={saveDisabled}>Save Deck</button>
          <button onClick={() => onAddMissingNeedsOnce?.({ desiredQuantityPerCard, selectedGenerations: generationFilter === "ALL" ? [] : [generationFilter], selectedArtKeys: [includeDefaultArt ? "default" : null, includeZeroArt ? "zero" : null].filter(Boolean) as CardArtKey[] })}>Add Missing Once to Marketplace Needs</button>
          <button onClick={() => onCreatePerpetualNeedRule?.({ desiredQuantityPerCard, selectedGenerations: generationFilter === "ALL" ? [] : [generationFilter], selectedArtKeys: [includeDefaultArt ? "default" : null, includeZeroArt ? "zero" : null].filter(Boolean) as CardArtKey[] })}>Create Perpetual Need Rule</button>
        </div>
      </div>

      {deckWarnings.length > 0 && (
        <div className="library-option-a-warning-strip">
          {deckWarnings.map(warning => <span key={warning}>{warning}</span>)}
        </div>
      )}

      <div className="library-option-a-grid">
        <aside className="library-option-a-filter-panel">
          <div className="library-option-a-panel-header">
            <h4>Filters</h4>
            <span>{filteredCards.length}/{cardLibrary.length}</span>
          </div>

          <div className="library-option-a-filter-stack">
            <label>
              Search
              <input
                value={searchText}
                onChange={event => setSearchText(event.target.value)}
                placeholder="Name, text, effect, type, card #..."
              />
            </label>

            <label>
              Card Type
              <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as CardTypeFilter)}>
                <option value="ALL">All</option>
                <option value="CREATURE">Creatures</option>
                <option value="MAGIC">Magic</option>
              </select>
            </label>

            <label>
              Sort
              <select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>
                <option value="number">Generation / Number</option>
                <option value="name">Name</option>
                <option value="generation">Generation</option>
                <option value="deckCount">Deck Count</option>
                <option value="ownedCount">Owned Count</option>
                <option value="armorLevel">Highest AL</option>
                <option value="hp">Highest HP</option>
                <option value="speed">Highest SPD</option>
              </select>
            </label>

            <details className="library-option-a-details-drawer">
              <summary>Collection completion</summary>
              <div className="library-option-a-drawer-grid">
                <label>
                  Generation
                  <select value={completionGeneration} onChange={event => setCompletionGeneration(event.target.value)}>
                    <option value="ALL">All</option>
                    {generations.map(value => <option value={value} key={`completion-${value}`}>{value}</option>)}
                  </select>
                </label>
                <label>
                  Required per card
                  <input
                    type="number"
                    min={1}
                    value={requiredQuantityPerCard}
                    onChange={event => setRequiredQuantityPerCard(Math.max(1, sanitizeCopies(event.target.value) || 1))}
                  />
                </label>
              </div>
              <div className="library-option-a-chip-row" role="group" aria-label="Collection variants">
                {collectionVariantOptions.map(option => (
                  <label key={`variant-${option.key}`}>
                    <input
                      type="checkbox"
                      checked={completionVariants[option.key]}
                      onChange={event => setCompletionVariants(current => ({ ...current, [option.key]: event.target.checked }))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {variantCompletion.summaries.length === 0 ? (
                <p className="event-meta">Select at least one variant.</p>
              ) : (
                <div className="library-option-a-filter-stack">
                  {variantCompletion.summaries.map(summary => (
                    <div key={`summary-${summary.variant}`}>
                      <strong>{summary.label}</strong>
                      <span> {summary.ownedMatches}/{summary.requiredMatches} ({summary.completionPercent.toFixed(1)}%)</span>
                    </div>
                  ))}
                  <span>{variantCompletion.missingItems.length} missing card-variant targets.</span>
                </div>
              )}
            </details>

            <details className="library-option-a-details-drawer">
              <summary>Advanced filters</summary>
              <div className="library-option-a-drawer-grid">
                <label>
                  Generation
                  <select value={generationFilter} onChange={event => setGenerationFilter(event.target.value)}>
                    <option value="ALL">All</option>
                    {generations.map(value => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>

                <label>
                  Rarity
                  <select value={rarityFilter} onChange={event => setRarityFilter(event.target.value)}>
                    <option value="ALL">All</option>
                    {rarities.map(value => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>

                <label>
                  Creature Type
                  <select value={creatureTypeFilter} onChange={event => setCreatureTypeFilter(event.target.value)}>
                    <option value="ALL">All</option>
                    {creatureTypes.map(value => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>

                <label>
                  Magic Type
                  <select value={magicTypeFilter} onChange={event => setMagicTypeFilter(event.target.value)}>
                    <option value="ALL">All</option>
                    {magicTypes.map(value => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>

                <label>
                  Effect Type
                  <select value={effectTypeFilter} onChange={event => setEffectTypeFilter(event.target.value)}>
                    <option value="ALL">All</option>
                    {effectTypes.map(value => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>

                <label>
                  Deck
                  <select value={deckMembershipFilter} onChange={event => setDeckMembershipFilter(event.target.value as DeckMembershipFilter)}>
                    <option value="ALL">All Cards</option>
                    <option value="IN_DECK">In Current Deck</option>
                    <option value="NOT_IN_DECK">Not In Deck</option>
                  </select>
                </label>

                <label>
                  Desired Qty/Card
                  <input type="number" min={1} max={999} value={desiredQuantityPerCard} onChange={event => setDesiredQuantityPerCard(Math.max(1, sanitizeCopies(event.target.value)))} />
                </label>

                <label><input type="checkbox" checked={includeDefaultArt} onChange={event => setIncludeDefaultArt(event.target.checked)} /> Include Default variant</label>
                <label><input type="checkbox" checked={includeZeroArt} onChange={event => setIncludeZeroArt(event.target.checked)} /> Include Zero variant</label>

                <label>
                  Owned
                  <select value={ownershipFilter} onChange={event => setOwnershipFilter(event.target.value as OwnershipFilter)}>
                    <option value="ALL">All Cards</option>
                    <option value="OWNED">Owned Only</option>
                    <option value="MISSING">Missing Only</option>
                  </select>
                </label>

              </div>
            </details>
          </div>
        </aside>

        <section className="library-option-a-browser-panel">
          <div className="library-option-a-panel-header">
            <div>
              <h4>Cards</h4>
              <span>Drag, double-click, or use + Deck</span>
            </div>
          </div>

          {cardLibrary.length === 0 ? (
            <p className="empty-zone">No cards loaded. Select at least one card pack.</p>
          ) : filteredCards.length === 0 ? (
            <p className="empty-zone">No cards match the current filters.</p>
          ) : (
            <div className="library-card-grid unified-library-card-grid library-option-a-card-grid" ref={cardGridRef}>
              {hiddenAboveCardCount > 0 && (
                <div
                  className="library-option-a-unloaded-spacer top"
                  ref={loadPreviousSentinelRef}
                  style={{ minHeight: unloadedTopSpacerHeight }}
                >
                  <button
                    type="button"
                    onClick={() => setUnloadedCardCount(current => Math.max(0, current - VISIBLE_CARD_INCREMENT))}
                  >
                    Restore Earlier Cards
                  </button>
                  <span>{hiddenAboveCardCount} earlier cards unloaded after idle time</span>
                </div>
              )}
              {visibleCards.map(card => {
                const selectedArtKey = getSelectedArtKey(card.id);
                const selectedArtworkMode = selectedArtKey === "zero-art" || selectedArtKey === "zero-art-holo" ? "ZERO" : "DEFAULT";
                const selectedIsHolo = selectedArtKey === "holo" || selectedArtKey === "zero-art-holo";
                const effectivePreviewVariant = getOwnershipVariantFromArtworkAndHolo(selectedArtworkMode, selectedIsHolo);
                const ownershipVariants: Array<{ label: string; key: CardArtKey }> = [
                  { label: "Default", key: "default" },
                  { label: "Holo", key: "holo" },
                  { label: "Zero", key: "zero-art" },
                  { label: "Zero Holo", key: "zero-art-holo" }
                ];
                const deckLimit = getEffectiveDeckLimit(card, deckBuilderFormat);
                const canAdd = getCanAddCardToDeck(card.id);
                const deckLimitLabel = deckBuilderFormat === "TOURNAMENT"
                  ? deckLimit === 0 ? "BANNED" : deckLimit < 3 ? `LIMIT ${deckLimit}` : "LEGAL"
                  : "FREE PLAY";
                const tournamentLimitStatus = getTournamentLimitStatus(card);

                return (
                  <article
                    className={`library-card-entry unified-library-card-entry library-option-a-card-entry ${!canAdd ? "cannot-add" : ""}`}
                    draggable={canAdd}
                    key={`${card.packId}-${card.id}`}
                    onDoubleClick={() => { if (canAdd) onAddCard(card.id, selectedArtKey); }}
                    onDragEnd={() => {
                      setDraggedCard(null);
                      setDeckDropActive(false);
                    }}
                    onDragStart={event => handleCardDragStart(event, card.id, selectedArtKey)}
                    title={canAdd ? "Drag to Current Deck or double-click to add 1 copy." : "Deck limit, ban, or 30-card cap prevents adding this card."}
                  >
                    <div className="library-card-content-grid library-option-a-card-content">
                      <div className="library-option-a-image-stack">
                        <CardImagePreview
                          card={card}
                          selectedArtKey={selectedArtKey}
                          holoIntensity={FIXED_HOLO_INTENSITY}
                          onSelectedArtKeyChange={artKey => setSelectedArtKey(card.id, artKey)}
                        />
                      </div>
                    </div>

                    <div className="unified-card-actions-row library-option-a-card-actions-row compact-art-ownership-row">
                      <div className="library-option-a-limit-add-row">
                        <span className={`limit-badge ${deckLimit === 0 ? "banned" : deckLimit < 3 ? "limited" : "normal"}`}>{deckLimitLabel}</span>
                        {canUseDevTools && onSaveCardLimit ? (
                          <label className="library-option-a-limit-editor" title={card.deckLimitReason ?? "Tournament limit status"}>
                            <span>Tournament</span>
                            <select
                              value={tournamentLimitStatus}
                              onChange={event => onSaveCardLimit(card.id, event.target.value as TournamentLimitStatus)}
                            >
                              <option value="LEGAL">Legal</option>
                              <option value="LIMITED">Limited</option>
                              <option value="BANNED">Banned</option>
                            </select>
                          </label>
                        ) : null}
                        <button type="button" onClick={() => setActiveMarketplaceAction({ cardId: card.id, mode: "need" })}>Add to Marketplace Need</button>
                        <button type="button" onClick={() => setActiveMarketplaceAction({ cardId: card.id, mode: "have" })}>Add to Marketplace Have</button>
                        <button
                          className="library-option-a-mini-deck-add"
                          onClick={() => onAddCard(card.id, selectedArtKey)}
                          disabled={!canAdd}
                          title="Add 1 copy to the current deck. You can also drag or double-click this card."
                        >
                          Add to Deck
                        </button>
                      </div>

                      <div className="library-option-a-ownership-grid" aria-label={`${card.name} ownership controls`}>
                        {ownershipVariants.map(({ label, key }) => {
                          const variantOwnedCount = getOwnedCopiesForArt(card.id, key);
                          const isSelectedPreviewVariant = key === effectivePreviewVariant;

                          return (
                            <div className="copy-stepper labeled-stepper art-owned-stepper" key={key}>
                              <span title={`Owned ${label}${isSelectedPreviewVariant ? " (current preview)" : ""}`}>
                                Own {label}{isSelectedPreviewVariant ? "*" : ""}
                              </span>
                              <button
                                onClick={() => setArtOwnedCopies(card.id, key, Math.max(0, variantOwnedCount - 1))}
                                disabled={variantOwnedCount === 0}
                                aria-label={`Remove one owned ${label} copy of ${card.name}`}
                                title={`Remove one owned ${label} copy`}
                              >
                                -
                              </button>
                              <input
                                value={variantOwnedCount}
                                onChange={event => setArtOwnedCopiesFromInput(card.id, key, event.target.value)}
                                aria-label={`${card.name} ${label} owned copies`}
                                title={`${label} copies you own`}
                              />
                              <button
                                onClick={() => setArtOwnedCopies(card.id, key, variantOwnedCount + 1)}
                                aria-label={`Add one owned ${label} copy of ${card.name}`}
                                title={`Add one owned ${label} copy`}
                              >
                                +
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {onOpenMarketplaceOverride ? (
                        <button
                          type="button"
                          className="library-option-a-mini-deck-add"
                          onClick={() => onOpenMarketplaceOverride(card.id)}
                          title="Open marketplace override settings for this card"
                        >
                          Override Auto-List
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {hiddenBelowCardCount > 0 && (
                <div className="library-option-a-load-more" ref={loadMoreSentinelRef}>
                  <button
                    type="button"
                    onClick={() => setVisibleCardCount(current => Math.min(current + VISIBLE_CARD_INCREMENT, filteredCards.length))}
                  >
                    Load More Now
                  </button>
                  <span>Loading more automatically near the bottom. {hiddenBelowCardCount} still hidden.</span>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="library-option-a-deck-rail">
          <div className="library-option-a-details-drawer deck-share-tools-card library-option-a-code-tools library-option-a-deck-rail-codes">
            <div className="deck-share-tools-grid">
              <label>
                Export Code
                <textarea value={deckShareString} readOnly rows={2} placeholder="Click Copy Export Code." />
              </label>

              <label>
                Import Code
                <textarea value={deckImportString} onChange={event => setDeckImportString(event.target.value)} rows={2} placeholder="Paste WARDDECK1:... here." />
              </label>
            </div>

            <div className="actions small-actions deck-share-actions">
              <button onClick={copyCurrentDeckString} disabled={deckBuilderCardIds.length === 0}>Copy Export</button>
              <button onClick={importDeckStringIntoBuilder} disabled={!deckImportString.trim()}>Import Code</button>
              <button onClick={downloadCurrentDeckNotes} disabled={deckBuilderCardIds.length === 0}>Notes</button>
            </div>

            {deckShareMessage && <p className="event-meta">{deckShareMessage}</p>}
          </div>


          <div className="library-option-a-details-drawer deck-share-tools-card library-option-a-code-tools library-option-a-deck-rail-codes">
            <div className="current-deck-header-row library-option-a-current-deck-header">
              <h4>Missing for Completion</h4>
              <span>{missingDeckVariants.length} variant{missingDeckVariants.length === 1 ? "" : "s"}</span>
            </div>
            {missingDeckVariants.length === 0 ? (
              <p className="event-meta">All current deck card variants meet required quantity.</p>
            ) : (
              <div className="builder-card-list current-deck-list unified-current-deck-list library-option-a-current-deck-list">
                {missingDeckVariants.map(entry => (
                  <div className="builder-card-entry current-deck-entry library-option-a-current-deck-entry" key={`missing-${entry.cardId}-${entry.artKey}`}>
                    <div className="visual-deck-card-copy">
                      <strong>{entry.card?.cardNumber ?? "?"} · {entry.card?.name ?? entry.cardId} · Gen {entry.card?.generation ?? "?"} · {getCardArtLabel(entry.artKey)}</strong>
                      <div className="event-meta">Owned: {entry.ownedCount} | Required: {entry.requiredCount} | Missing: {entry.missingCount}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>


          <div
            className={`current-deck-panel unified-current-deck-panel library-option-a-current-deck-panel ${deckDropActive ? "drag-over" : ""}`}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDeckDropActive(false);
            }}
            onDragOver={handleDeckDragOver}
            onDrop={handleDeckDrop}
          >
            <div className="library-option-a-current-deck-topline">
              <label className="library-option-a-current-deck-name">
                Deck Name
                <input value={deckBuilderName} onChange={event => onDeckNameChange(event.target.value)} />
              </label>

              <button onClick={onSaveDeck} disabled={saveDisabled}>Save</button>
            </div>

            <div className="current-deck-header-row library-option-a-current-deck-header">
              <h4>Current Deck</h4>
              <span>{deckCards.length} unique  -  {deckStats.total}/30 cards</span>
            </div>

          <div className="deck-builder-summary deck-stat-strip library-option-a-deck-stat-strip">
            <span>Creatures: {deckStats.creatureCount}</span>
            <span>Magic: {deckStats.magicCount}</span>
          </div>

          <div className="library-option-a-drop-hint">
            {draggedCard && getCanAddCardToDeck(draggedCard.cardId) ? `Drop to add 1 ${getCardArtLabel(draggedCard.artKey)} copy` : "Drag cards here to add them"}
          </div>

          {deckBuilderCardIds.length === 0 ? (
            <p className="empty-zone">No cards added yet.</p>
          ) : (
            <div className="builder-card-list current-deck-list unified-current-deck-list library-option-a-current-deck-list">
              {deckCards.map(({ cardId, artKey, count, card }) => {
                const deckLimit = getEffectiveDeckLimit(card, deckBuilderFormat);
                const ownedCount = getTotalOwnedCopiesForCard(cardId);
                const artLabel = getCardArtLabel(artKey);

                return (
                  <div className="builder-card-entry current-deck-entry library-option-a-current-deck-entry visual-deck-stack-entry" key={`${cardId}-${artKey}`}>
                    <div className="visual-deck-card-stack">
                      {card ? <CardImageThumbnail card={card} className="visual-deck-card-image" /> : <span className="card-image-thumb missing visual-deck-card-image">{cardId.slice(0, 1)}</span>}
                      <span className="visual-deck-card-counter">{count}x</span>
                    </div>

                    <div className="visual-deck-card-copy">
                      <strong>{card?.name ?? cardId} {artKey !== "default" ? `(${artLabel})` : ""}</strong>
                      <div className="event-meta">
                        {card?.cardType ?? "UNKNOWN"} | {artLabel} | {count}/{deckLimit} copies | Owned total: {ownedCount}
                      </div>

                      <div className="builder-card-actions compact-deck-actions library-option-a-current-deck-actions">
                        <button onClick={() => onRemoveCard(cardId, artKey)} aria-label={`Remove one ${artLabel} ${card?.name ?? cardId}`}>-</button>
                        <input
                          value={count}
                          onChange={event => setDeckCopiesFromInput(cardId, event.target.value, artKey)}
                          aria-label={`${card?.name ?? cardId} ${artLabel} copies`}
                        />
                        <button
                          onClick={() => onAddCard(cardId, artKey)}
                          disabled={count >= deckLimit || deckBuilderCardIds.length >= 30 || deckLimit <= 0}
                          aria-label={`Add one ${artLabel} ${card?.name ?? cardId}`}
                        >
                          +
                        </button>
                        <button onClick={() => onSetCardCopies(cardId, 0, artKey)}>Remove</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </aside>
      {activeMarketplaceAction ? (
        <AddCardToMarketplaceModal
          title={activeMarketplaceAction.mode === "need" ? "Add to Marketplace Need" : "Add to Marketplace Have"}
          onClose={() => setActiveMarketplaceAction(null)}
          onSubmit={payload => {
            const nextPayload = { ...payload, cardId: activeMarketplaceAction.cardId };
            if (activeMarketplaceAction.mode === "need") onAddMarketplaceNeed?.(nextPayload);
            else onAddMarketplaceHave?.(nextPayload);
            setActiveMarketplaceAction(null);
          }}
        />
      ) : null}
      </div>
    </section>
  );
}
