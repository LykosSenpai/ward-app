import { useMemo, useState } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import { getDisplayMagicType } from "../gameViewHelpers";

type DeckBuilderProps = {
  selectedPackCount: number;
  cardLibrary: CardLibraryCardSummary[];
  deckBuilderName: string;
  deckBuilderId: string;
  deckBuilderCardIds: string[];
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
  onSaveDeck: () => void;
};

type BuilderFilterType = "ALL" | "CREATURE" | "MAGIC" | "IN_DECK" | "NOT_IN_DECK";
type BuilderSortMode = "name" | "number" | "deckCount" | "armorLevel" | "hp" | "speed";

function getCardText(card: CardLibraryCardSummary): string {
  return [
    card.id,
    card.name,
    card.cardNumber,
    card.generation,
    card.rarity,
    card.cardType,
    card.creatureType,
    card.magicType,
    card.magicSubType,
    card.text
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCardSortNumber(card: CardLibraryCardSummary): string {
  return `${card.generation ?? ""}`.padStart(3, "0") + `-${card.cardNumber ?? card.id}`;
}

export function DeckBuilder({
  selectedPackCount,
  cardLibrary,
  deckBuilderName,
  deckBuilderId,
  deckBuilderCardIds,
  normalizeId,
  getDeckBuilderCounts,
  getDeckBuilderCardCount,
  onDeckNameChange,
  onDeckIdChange,
  onRefreshCardLibrary,
  onClearDeckBuilder,
  onNewDeck,
  onAddCard,
  onRemoveCard,
  onSetCardCopies,
  onSaveDeck
}: DeckBuilderProps) {
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<BuilderFilterType>("ALL");
  const [sortMode, setSortMode] = useState<BuilderSortMode>("number");
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  const deckCounts = useMemo(() => getDeckBuilderCounts(), [deckBuilderCardIds, getDeckBuilderCounts]);

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

  const deckWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (deckStats.total !== 30) warnings.push(`Deck must be exactly 30 cards. Current: ${deckStats.total}.`);
    if (deckStats.creatureCount < 8) warnings.push("Recommended minimum is 8 creatures.");
    if (deckStats.creatureCount > 12) warnings.push("Recommended maximum is 12 creatures.");

    for (const { card, cardId, count } of deckCards) {
      const deckLimit = card?.deckLimit ?? 3;
      if (deckLimit <= 0 && count > 0) warnings.push(`${card?.name ?? cardId} is banned.`);
      if (count > deckLimit) warnings.push(`${card?.name ?? cardId} has ${count}/${deckLimit} copies.`);
    }

    return warnings;
  }, [deckCards, deckStats.creatureCount, deckStats.total]);

  const filteredLibrary = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return cardLibrary
      .filter(card => {
        const count = deckCounts[card.id] ?? 0;
        if (filterType === "CREATURE" && card.cardType !== "CREATURE") return false;
        if (filterType === "MAGIC" && card.cardType !== "MAGIC") return false;
        if (filterType === "IN_DECK" && count === 0) return false;
        if (filterType === "NOT_IN_DECK" && count > 0) return false;
        if (normalizedSearch && !getCardText(card).includes(normalizedSearch)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "name") return a.name.localeCompare(b.name);
        if (sortMode === "deckCount") return (deckCounts[b.id] ?? 0) - (deckCounts[a.id] ?? 0) || a.name.localeCompare(b.name);
        if (sortMode === "armorLevel") return (b.armorLevel ?? -1) - (a.armorLevel ?? -1) || a.name.localeCompare(b.name);
        if (sortMode === "hp") return (b.hp ?? -1) - (a.hp ?? -1) || a.name.localeCompare(b.name);
        if (sortMode === "speed") return (b.speed ?? -1) - (a.speed ?? -1) || a.name.localeCompare(b.name);
        return getCardSortNumber(a).localeCompare(getCardSortNumber(b), undefined, { numeric: true }) || a.name.localeCompare(b.name);
      });
  }, [cardLibrary, deckCounts, filterType, searchText, sortMode]);

  function toggleExpanded(cardId: string) {
    setExpandedCardIds(current => ({ ...current, [cardId]: !current[cardId] }));
  }

  function setCopiesFromInput(cardId: string, value: string) {
    const parsed = Number.parseInt(value, 10);
    onSetCardCopies(cardId, Number.isFinite(parsed) ? parsed : 0);
  }

  return (
    <section className="setup-section deck-builder-section enhanced-deck-builder-section">
      <div className="deck-builder-header">
        <div>
          <h3>Deck Editor</h3>
          <p>Build, edit, clone, and save 30-card decks from the selected card packs.</p>
        </div>

        <div className="deck-builder-header-actions">
          <button onClick={onRefreshCardLibrary}>Refresh Card Library</button>
          <button onClick={onNewDeck}>New Deck</button>
          <button onClick={onClearDeckBuilder} disabled={deckBuilderCardIds.length === 0}>Clear Cards</button>
        </div>
      </div>

      <div className="deck-builder-fields enhanced-deck-builder-fields">
        <label>
          Deck Name
          <input value={deckBuilderName} onChange={event => onDeckNameChange(event.target.value)} />
        </label>

        <label>
          Deck ID / File Name
          <input value={deckBuilderId} onChange={event => onDeckIdChange(event.target.value)} />
        </label>
      </div>

      <div className="deck-builder-summary deck-stat-strip">
        <strong>Cards: {deckStats.total}/30</strong>
        <span>Creatures: {deckStats.creatureCount}</span>
        <span>Magic: {deckStats.magicCount}</span>
        <span>Standard: {deckStats.standardMagicCount}</span>
        <span>Infinite: {deckStats.infiniteMagicCount}</span>
        <span>Lightning: {deckStats.lightningMagicCount}</span>
        <span>Avg AL: {deckStats.averageAL.toFixed(1)}</span>
        <span>Selected Packs: {selectedPackCount}</span>
      </div>

      {deckWarnings.length > 0 && (
        <div className="deck-warning-list">
          {deckWarnings.map(warning => <span key={warning}>{warning}</span>)}
        </div>
      )}

      <div className="builder-filter-grid">
        <label>
          Search Library
          <input
            value={searchText}
            onChange={event => setSearchText(event.target.value)}
            placeholder="Name, text, type, card #..."
          />
        </label>

        <label>
          Filter
          <select value={filterType} onChange={event => setFilterType(event.target.value as BuilderFilterType)}>
            <option value="ALL">All Cards</option>
            <option value="CREATURE">Creatures</option>
            <option value="MAGIC">Magic</option>
            <option value="IN_DECK">In Current Deck</option>
            <option value="NOT_IN_DECK">Not In Deck</option>
          </select>
        </label>

        <label>
          Sort
          <select value={sortMode} onChange={event => setSortMode(event.target.value as BuilderSortMode)}>
            <option value="number">Generation / Number</option>
            <option value="name">Name</option>
            <option value="deckCount">Deck Count</option>
            <option value="armorLevel">Highest AL</option>
            <option value="hp">Highest HP</option>
            <option value="speed">Highest SPD</option>
          </select>
        </label>
      </div>

      <div className="deck-builder-grid enhanced-deck-builder-grid">
        <section className="card-library-panel">
          <h4>Available Cards ({filteredLibrary.length})</h4>

          {cardLibrary.length === 0 ? (
            <p className="empty-zone">No cards loaded. Select at least one card pack.</p>
          ) : filteredLibrary.length === 0 ? (
            <p className="empty-zone">No cards match the current filter.</p>
          ) : (
            <div className="builder-card-list enhanced-builder-card-list">
              {filteredLibrary.map(card => {
                const count = getDeckBuilderCardCount(card.id);
                const deckLimit = card.deckLimit ?? 3;
                const canAdd = deckLimit > 0 && count < deckLimit && deckBuilderCardIds.length < 30;
                const expanded = !!expandedCardIds[card.id];

                return (
                  <div className="builder-card-entry enhanced-builder-card-entry" key={`${card.packId}-${card.id}`}>
                    <div className="builder-card-main-info">
                      <button className="linklike-card-button" onClick={() => toggleExpanded(card.id)}>
                        <strong>{card.name}</strong>
                        <span>{card.generation ? `Gen ${card.generation}` : card.packId} {card.cardNumber ? `#${card.cardNumber}` : ""}  -  {card.rarity ?? "Unknown"}</span>
                      </button>

                      <div className="event-meta">
                        {card.cardType === "CREATURE"
                          ? `${card.creatureType ?? "Creature"} | AL ${card.armorLevel} | SPD ${card.speed} | HP ${card.hp} | ATK ${card.attackDice}D6 | MOD ${card.modifier}`
                          : `${getDisplayMagicType(card.magicType)} | ${card.magicSubType}`}
                      </div>

                      {expanded && (
                        <p className="builder-card-rules-text">{card.text?.trim() || "No rules text."}</p>
                      )}
                    </div>

                    <div className="builder-card-actions enhanced-builder-card-actions">
                      <span className={`limit-badge ${deckLimit === 0 ? "banned" : deckLimit < 3 ? "limited" : "normal"}`}>
                        {deckLimit === 0 ? "BANNED" : deckLimit < 3 ? `LIMIT ${deckLimit}` : "LIMIT 3"}
                      </span>

                      <div className="copy-stepper">
                        <button onClick={() => onRemoveCard(card.id)} disabled={count === 0}>-</button>
                        <input
                          value={count}
                          onChange={event => setCopiesFromInput(card.id, event.target.value)}
                          aria-label={`${card.name} copies`}
                        />
                        <button onClick={() => onAddCard(card.id)} disabled={!canAdd}>+</button>
                      </div>

                      <button onClick={() => onAddCard(card.id)} disabled={!canAdd}>Add</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="current-deck-panel enhanced-current-deck-panel">
          <h4>Current Deck ({deckCards.length} unique)</h4>

          {deckBuilderCardIds.length === 0 ? (
            <p className="empty-zone">No cards added yet.</p>
          ) : (
            <div className="builder-card-list current-deck-list">
              {deckCards.map(({ cardId, count, card }) => {
                const deckLimit = card?.deckLimit ?? 3;

                return (
                  <div className="builder-card-entry current-deck-entry" key={cardId}>
                    <div>
                      <strong>{card?.name ?? cardId}</strong>
                      <div className="event-meta">
                        {card?.cardType ?? "UNKNOWN"} | Copies: {count}/{deckLimit}
                      </div>
                    </div>

                    <div className="builder-card-actions compact-deck-actions">
                      <button onClick={() => onRemoveCard(cardId)}>-</button>
                      <input
                        value={count}
                        onChange={event => setCopiesFromInput(cardId, event.target.value)}
                        aria-label={`${card?.name ?? cardId} copies`}
                      />
                      <button
                        onClick={() => onAddCard(cardId)}
                        disabled={count >= deckLimit || deckBuilderCardIds.length >= 30 || deckLimit <= 0}
                      >
                        +
                      </button>
                      <button onClick={() => onSetCardCopies(cardId, 0)}>Remove All</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="actions deck-editor-save-actions">
        <button
          onClick={onSaveDeck}
          disabled={deckBuilderCardIds.length !== 30 || !deckBuilderName.trim() || !normalizeId(deckBuilderId)}
        >
          Save Deck
        </button>
      </div>
    </section>
  );
}

