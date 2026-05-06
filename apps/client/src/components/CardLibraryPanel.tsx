import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import { buildDeckNotesMarkdown, decodeWardDeckString, downloadTextFile, encodeWardDeckString, sanitizeDownloadFileName } from "../deckShare";
import { getDisplayMagicType } from "../gameViewHelpers";
import { ACTIVE_CARD_ART_OPTIONS, CardImagePreview, CardImageThumbnail, getCardArtLabel } from "./CardImagePreview";
import type { CardArtKey } from "./CardImagePreview";

type CardTypeFilter = "ALL" | "CREATURE" | "MAGIC";
type DeckMembershipFilter = "ALL" | "IN_DECK" | "NOT_IN_DECK";
type OwnershipFilter = "ALL" | "OWNED" | "MISSING";
type SortMode = "number" | "name" | "generation" | "deckCount" | "ownedCount" | "armorLevel" | "hp" | "speed";

type CardLibraryPanelProps = {
  cardLibrary: CardLibraryCardSummary[];
  selectedPackCount: number;
  deckBuilderName: string;
  deckBuilderId: string;
  deckBuilderCardIds: string[];
  ownershipCounts: Record<string, number>;
  normalizeId: (value: string) => string;
  getDeckBuilderCounts: () => Record<string, number>;
  getDeckBuilderCardCount: (cardId: string) => number;
  onDeckNameChange: (value: string) => void;
  onDeckIdChange: (value: string) => void;
  onRefreshCardLibrary: () => void;
  onClearDeckBuilder: () => void;
  onNewDeck: () => void;
  onAddCard: (cardId: string) => void;
  onRemoveCard: (cardId: string) => void;
  onSetCardCopies: (cardId: string, copyCount: number) => void;
  onSetOwnedCopies: (cardId: string, ownedCount: number) => void;
  onSaveDeck: () => void;
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
  ownershipCounts,
  normalizeId,
  getDeckBuilderCounts,
  onDeckNameChange,
  onDeckIdChange,
  onRefreshCardLibrary,
  onClearDeckBuilder,
  onNewDeck,
  onAddCard,
  onRemoveCard,
  onSetCardCopies,
  onSetOwnedCopies,
  onSaveDeck
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
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [deckDropActive, setDeckDropActive] = useState(false);
  const [deckShareString, setDeckShareString] = useState("");
  const [deckImportString, setDeckImportString] = useState("");
  const [deckShareMessage, setDeckShareMessage] = useState("");

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

  const deckCards = useMemo(() => {
    return Object.entries(deckCounts)
      .map(([cardId, count]) => ({
        cardId,
        count,
        card: cardLibrary.find(item => item.id === cardId)
      }))
      .sort((a, b) => (a.card?.name ?? a.cardId).localeCompare(b.card?.name ?? b.cardId));
  }, [cardLibrary, deckCounts]);

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

    for (const { card, cardId, count } of deckCards) {
      const deckLimit = card?.deckLimit ?? 3;
      const ownedCount = getTotalOwnedCopiesForCard(cardId);

      if (deckLimit <= 0 && count > 0) warnings.push(`${card?.name ?? cardId} is banned.`);
      if (count > deckLimit) warnings.push(`${card?.name ?? cardId} has ${count}/${deckLimit} copies.`);
      if (ownedCount > 0 && count > ownedCount) warnings.push(`${card?.name ?? cardId} has ${count} deck copies but only ${ownedCount} total owned across art variants.`);
    }

    return warnings;
  }, [deckCards, deckStats.creatureCount, deckStats.total, ownershipCounts, selectedArtKeysByCardId]);

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
  }, [cardLibrary, creatureTypeFilter, deckCounts, deckMembershipFilter, effectTypeFilter, generationFilter, magicTypeFilter, ownershipCounts, ownershipFilter, rarityFilter, searchText, sortMode, typeFilter, selectedArtKeysByCardId]);

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
  }

  function setDeckCopiesFromInput(cardId: string, value: string) {
    onSetCardCopies(cardId, sanitizeCopies(value));
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

  function getOwnedCopiesForSelectedArt(cardId: string): number {
    return ownershipCounts[getCardArtOwnershipKey(cardId, getSelectedArtKey(cardId))] ?? 0;
  }

  function getTotalOwnedCopiesForCard(cardId: string): number {
    return ACTIVE_CARD_ART_OPTIONS.reduce((total, artOption) => {
      return total + (ownershipCounts[getCardArtOwnershipKey(cardId, artOption.key)] ?? 0);
    }, 0);
  }

  function setSelectedArtOwnedCopies(cardId: string, requestedOwnedCount: number) {
    const ownershipKey = getCardArtOwnershipKey(cardId, getSelectedArtKey(cardId));
    onSetOwnedCopies(ownershipKey, Math.min(999, Math.max(0, Math.floor(requestedOwnedCount))));
  }

  function setSelectedArtOwnedCopiesFromInput(cardId: string, value: string) {
    setSelectedArtOwnedCopies(cardId, sanitizeCopies(value));
  }

  function getCanAddCardToDeck(cardId: string) {
    const card = cardLibrary.find(item => item.id === cardId);
    const deckLimit = card?.deckLimit ?? 3;
    const deckCount = deckCounts[cardId] ?? 0;

    return !!card && deckLimit > 0 && deckCount < deckLimit && deckBuilderCardIds.length < 30;
  }

  function handleCardDragStart(event: DragEvent<HTMLElement>, cardId: string) {
    if (!getCanAddCardToDeck(cardId)) {
      event.preventDefault();
      return;
    }

    setDraggedCardId(cardId);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.setData("application/x-ward-card-id", cardId);
  }

  function handleDeckDragOver(event: DragEvent<HTMLElement>) {
    const cardId = draggedCardId || event.dataTransfer.getData("application/x-ward-card-id") || event.dataTransfer.getData("text/plain");

    if (!cardId || !getCanAddCardToDeck(cardId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDeckDropActive(true);
  }

  function handleDeckDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();

    const cardId = event.dataTransfer.getData("application/x-ward-card-id") || event.dataTransfer.getData("text/plain") || draggedCardId;
    setDeckDropActive(false);
    setDraggedCardId(null);

    if (cardId && getCanAddCardToDeck(cardId)) onAddCard(cardId);
  }

  async function copyCurrentDeckString() {
    if (deckBuilderCardIds.length === 0) {
      setDeckShareMessage("Add cards before generating a deck string.");
      return;
    }

    const value = encodeWardDeckString({
      name: deckBuilderName,
      deckId: normalizeId(deckBuilderId),
      cardIds: deckBuilderCardIds
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

      if (payload.name) onDeckNameChange(payload.name);
      if (payload.deckId) onDeckIdChange(normalizeId(payload.deckId));
      onClearDeckBuilder();

      const counts = payload.cardIds.reduce<Record<string, number>>((result, cardId) => {
        result[cardId] = (result[cardId] ?? 0) + 1;
        return result;
      }, {});

      for (const [cardId, count] of Object.entries(counts)) {
        onSetCardCopies(cardId, count);
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
      cardIds: deckBuilderCardIds
    });
    const markdown = buildDeckNotesMarkdown({
      name: deckBuilderName || "WARD Deck",
      deckId: normalizeId(deckBuilderId),
      cardIds: deckBuilderCardIds,
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

  return (
    <section className="setup-section library-option-a-section">
      <div className="library-option-a-toolbar">
        <div className="library-option-a-title-block">
          <h3>Card Library + Deck Editor</h3>
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
          </div>
        </div>

        <div className="library-option-a-actions">
          <button onClick={onRefreshCardLibrary}>Refresh</button>
          <button onClick={clearFilters}>Clear Filters</button>
          <button onClick={onNewDeck}>New Deck</button>
          <button onClick={onClearDeckBuilder} disabled={deckBuilderCardIds.length === 0}>Clear Deck</button>
          <button onClick={onSaveDeck} disabled={saveDisabled}>Save Deck</button>
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
            <h4>Cards</h4>
            <span>Drag, double-click, or use + Deck</span>
          </div>

          {cardLibrary.length === 0 ? (
            <p className="empty-zone">No cards loaded. Select at least one card pack.</p>
          ) : filteredCards.length === 0 ? (
            <p className="empty-zone">No cards match the current filters.</p>
          ) : (
            <div className="library-card-grid unified-library-card-grid library-option-a-card-grid">
              {filteredCards.map(card => {
                const selectedArtKey = getSelectedArtKey(card.id);
                const selectedArtLabel = getCardArtLabel(selectedArtKey);
                const ownedCount = getOwnedCopiesForSelectedArt(card.id);
                const deckLimit = card.deckLimit ?? 3;
                const canAdd = getCanAddCardToDeck(card.id);
                const deckLimitLabel = deckLimit === 0 ? "BANNED" : deckLimit < 3 ? `LIMIT ${deckLimit}` : "LIMIT 3";

                return (
                  <article
                    className={`library-card-entry unified-library-card-entry library-option-a-card-entry ${!canAdd ? "cannot-add" : ""}`}
                    draggable={canAdd}
                    key={`${card.packId}-${card.id}`}
                    onDoubleClick={() => { if (canAdd) onAddCard(card.id); }}
                    onDragEnd={() => {
                      setDraggedCardId(null);
                      setDeckDropActive(false);
                    }}
                    onDragStart={event => handleCardDragStart(event, card.id)}
                    title={canAdd ? "Drag to Current Deck or double-click to add 1 copy." : "Deck limit, ban, or 30-card cap prevents adding this card."}
                  >
                    <div className="library-card-content-grid library-option-a-card-content">
                      <div className="library-option-a-image-stack">
                        <CardImagePreview
                          card={card}
                          selectedArtKey={selectedArtKey}
                          onSelectedArtKeyChange={artKey => setSelectedArtKey(card.id, artKey)}
                        />

                        <div className="library-card-badges library-option-a-badges library-option-a-limit-only">
                          <span className={`limit-badge ${deckLimit === 0 ? "banned" : deckLimit < 3 ? "limited" : "normal"}`}>{deckLimitLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="unified-card-actions-row library-option-a-card-actions-row compact-art-ownership-row">
                      <button
                        className="library-option-a-mini-deck-add"
                        onClick={() => onAddCard(card.id)}
                        disabled={!canAdd}
                        title="Add 1 copy to the current deck. You can also drag or double-click this card."
                      >
                        Add to Deck
                      </button>

                      <div className="copy-stepper labeled-stepper art-owned-stepper">
                        <span>Owned {selectedArtLabel}</span>
                        <button
                          onClick={() => setSelectedArtOwnedCopies(card.id, ownedCount - 1)}
                          disabled={ownedCount === 0}
                          aria-label={`Remove one owned ${selectedArtLabel} copy of ${card.name}`}
                          title={`Remove one owned ${selectedArtLabel} copy`}
                        >
                          -
                        </button>
                        <input
                          value={ownedCount}
                          onChange={event => setSelectedArtOwnedCopiesFromInput(card.id, event.target.value)}
                          aria-label={`${card.name} ${selectedArtLabel} owned copies`}
                          title={`${selectedArtLabel} copies you own`}
                        />
                        <button
                          onClick={() => setSelectedArtOwnedCopies(card.id, ownedCount + 1)}
                          aria-label={`Add one owned ${selectedArtLabel} copy of ${card.name}`}
                          title={`Add one owned ${selectedArtLabel} copy`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
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
            {draggedCardId && getCanAddCardToDeck(draggedCardId) ? "Drop to add 1 copy" : "Drag cards here to add them"}
          </div>

          {deckBuilderCardIds.length === 0 ? (
            <p className="empty-zone">No cards added yet.</p>
          ) : (
            <div className="builder-card-list current-deck-list unified-current-deck-list library-option-a-current-deck-list">
              {deckCards.map(({ cardId, count, card }) => {
                const deckLimit = card?.deckLimit ?? 3;
                const ownedCount = getTotalOwnedCopiesForCard(cardId);

                return (
                  <div className="builder-card-entry current-deck-entry library-option-a-current-deck-entry visual-deck-stack-entry" key={cardId}>
                    <div className="visual-deck-card-stack">
                      {card ? <CardImageThumbnail card={card} className="visual-deck-card-image" /> : <span className="card-image-thumb missing visual-deck-card-image">{cardId.slice(0, 1)}</span>}
                      <span className="visual-deck-card-counter">{count}x</span>
                    </div>

                    <div className="visual-deck-card-copy">
                      <strong>{card?.name ?? cardId}</strong>
                      <div className="event-meta">
                        {card?.cardType ?? "UNKNOWN"} | {count}/{deckLimit} copies | Owned total: {ownedCount}
                      </div>

                      <div className="builder-card-actions compact-deck-actions library-option-a-current-deck-actions">
                        <button onClick={() => onRemoveCard(cardId)} aria-label={`Remove one ${card?.name ?? cardId}`}>-</button>
                        <input
                          value={count}
                          onChange={event => setDeckCopiesFromInput(cardId, event.target.value)}
                          aria-label={`${card?.name ?? cardId} copies`}
                        />
                        <button
                          onClick={() => onAddCard(cardId)}
                          disabled={count >= deckLimit || deckBuilderCardIds.length >= 30 || deckLimit <= 0}
                          aria-label={`Add one ${card?.name ?? cardId}`}
                        >
                          +
                        </button>
                        <button onClick={() => onSetCardCopies(cardId, 0)}>Remove</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </aside>
      </div>
    </section>
  );
}
