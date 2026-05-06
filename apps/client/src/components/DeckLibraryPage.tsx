import { useMemo, useState } from "react";
import type { CardLibraryCardSummary, DeckDetail, DeckSummary } from "../clientTypes";
import { getDisplayMagicType } from "../gameViewHelpers";
import { CardImageThumbnail } from "./CardImagePreview";
import { ModalPanel } from "./ui/ModalPanel";

type DeckLibraryPageProps = {
  decks: DeckSummary[];
  deckDetails: DeckDetail[];
  cardLibrary: CardLibraryCardSummary[];
  onEditDeck: (deckId: string) => void;
  onCloneDeck: (deckId: string) => void;
  onDeleteDeck: (deckId: string) => void;
};

type DeckCardCount = {
  cardId: string;
  count: number;
  card?: CardLibraryCardSummary;
};

function getDeckCounts(deck: DeckDetail): DeckCardCount[] {
  const counts = deck.cardIds.reduce<Record<string, number>>((result, cardId) => {
    result[cardId] = (result[cardId] ?? 0) + 1;
    return result;
  }, {});

  return Object.entries(counts)
    .map(([cardId, count]) => ({ cardId, count }))
    .sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }));
}

function getDeckStats(deck: DeckDetail | undefined, cardLibrary: CardLibraryCardSummary[]) {
  const cardById = new Map(cardLibrary.map(card => [card.id, card]));
  const cardIds = deck?.cardIds ?? [];
  const cards = cardIds.map(cardId => cardById.get(cardId)).filter((card): card is CardLibraryCardSummary => !!card);
  const creatures = cards.filter(card => card.cardType === "CREATURE");
  const magic = cards.filter(card => card.cardType === "MAGIC");
  const uniqueCards = new Set(cardIds).size;
  const missingCount = cardIds.length - cards.length;
  const rarityCounts = cards.reduce<Record<string, number>>((result, card) => {
    const rarity = card.rarity ?? "Unknown";
    result[rarity] = (result[rarity] ?? 0) + 1;
    return result;
  }, {});

  return {
    total: cardIds.length,
    uniqueCards,
    creatures: creatures.length,
    magic: magic.length,
    missingCount,
    rarityCounts,
    averageArmorLevel: creatures.length === 0
      ? 0
      : creatures.reduce((total, card) => total + (card.armorLevel ?? 0), 0) / creatures.length
  };
}

function formatCardLine(card: CardLibraryCardSummary | undefined, cardId: string): string {
  if (!card) return cardId;

  if (card.cardType === "CREATURE") {
    return `${card.creatureType ?? "Creature"} | AL ${card.armorLevel ?? "?"} | SPD ${card.speed ?? "?"} | HP ${card.hp ?? "?"}`;
  }

  return `${getDisplayMagicType(card.magicType)} | ${card.magicSubType ?? "NONE"}`;
}

export function DeckLibraryPage({
  decks,
  deckDetails,
  cardLibrary,
  onEditDeck,
  onCloneDeck,
  onDeleteDeck
}: DeckLibraryPageProps) {
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const deckDetailById = useMemo(() => new Map(deckDetails.map(deck => [deck.id, deck])), [deckDetails]);
  const selectedDeck = selectedDeckId ? deckDetailById.get(selectedDeckId) : undefined;
  const selectedSummary = selectedDeckId ? decks.find(deck => deck.id === selectedDeckId) : undefined;
  const selectedDeckCards = selectedDeck
    ? getDeckCounts(selectedDeck).map(item => ({ ...item, card: cardById.get(item.cardId) }))
    : [];
  const selectedStats = getDeckStats(selectedDeck, cardLibrary);

  return (
    <section className="deck-library-page">
      <div className="deck-library-header">
        <div>
          <h2>Deck Library</h2>
          <span>{decks.length} saved decks</span>
        </div>
      </div>

      {decks.length === 0 ? (
        <p className="empty-zone">No saved decks found.</p>
      ) : (
        <div className="deck-library-grid">
          {decks.map(deck => {
            const detail = deckDetailById.get(deck.id);
            const stats = getDeckStats(detail, cardLibrary);
            const previewCards = detail
              ? getDeckCounts(detail).slice(0, 5).map(item => cardById.get(item.cardId)).filter((card): card is CardLibraryCardSummary => !!card)
              : [];

            return (
              <article className="deck-library-card" key={deck.id}>
                <div className="deck-library-card-header">
                  <div>
                    <strong>{deck.name}</strong>
                    <span>{deck.id}</span>
                  </div>
                  <button onClick={() => setSelectedDeckId(deck.id)}>View</button>
                </div>

                <div className="deck-library-stat-row">
                  <span>{stats.total} cards</span>
                  <span>{stats.uniqueCards} unique</span>
                  <span>{stats.creatures} creatures</span>
                  <span>{stats.magic} magic</span>
                </div>

                <div className="deck-library-preview-row">
                  {previewCards.length === 0 ? (
                    <span className="event-meta">Deck details loading...</span>
                  ) : (
                    previewCards.map(card => <CardImageThumbnail card={card} key={card.id} />)
                  )}
                </div>

                <div className="deck-library-actions">
                  <button onClick={() => onEditDeck(deck.id)}>Edit in Card Library</button>
                  <button onClick={() => onCloneDeck(deck.id)}>Clone</button>
                  <button
                    className="delete-save-button"
                    onClick={() => onDeleteDeck(deck.id)}
                    disabled={deck.id === "demo-30-card"}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedDeck && selectedSummary && (
        <ModalPanel title={selectedDeck.name} onClose={() => setSelectedDeckId("")} wide>
          <div className="deck-detail-modal">
            <div className="deck-detail-summary">
              <div>
                <span className="label">Deck ID</span>
                <strong>{selectedDeck.id}</strong>
              </div>
              <div>
                <span className="label">Cards</span>
                <strong>{selectedStats.total}</strong>
              </div>
              <div>
                <span className="label">Unique</span>
                <strong>{selectedStats.uniqueCards}</strong>
              </div>
              <div>
                <span className="label">Creatures</span>
                <strong>{selectedStats.creatures}</strong>
              </div>
              <div>
                <span className="label">Magic</span>
                <strong>{selectedStats.magic}</strong>
              </div>
              <div>
                <span className="label">Avg AL</span>
                <strong>{selectedStats.averageArmorLevel.toFixed(1)}</strong>
              </div>
            </div>

            <div className="deck-detail-action-row">
              <button onClick={() => onEditDeck(selectedDeck.id)}>Edit in Card Library</button>
              <button onClick={() => onCloneDeck(selectedDeck.id)}>Clone to Card Library</button>
              <button
                className="delete-save-button"
                onClick={() => onDeleteDeck(selectedDeck.id)}
                disabled={selectedDeck.id === "demo-30-card"}
              >
                Delete
              </button>
            </div>

            <div className="deck-detail-breakdown">
              <section>
                <h3>Rarity Mix</h3>
                {Object.keys(selectedStats.rarityCounts).length === 0 ? (
                  <p className="empty-zone">No loaded card rarity data.</p>
                ) : (
                  <div className="deck-detail-chip-row">
                    {Object.entries(selectedStats.rarityCounts).map(([rarity, count]) => (
                      <span key={rarity}>{rarity}: {count}</span>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3>Cards</h3>
                <div className="deck-detail-card-list">
                  {selectedDeckCards.map(({ cardId, count, card }) => (
                    <div className="deck-detail-card-row" key={cardId}>
                      {card ? <CardImageThumbnail card={card} /> : <span className="card-image-thumb missing">{cardId.slice(0, 1)}</span>}
                      <div>
                        <strong>{count}x {card?.name ?? cardId}</strong>
                        <span>{formatCardLine(card, cardId)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </ModalPanel>
      )}
    </section>
  );
}
