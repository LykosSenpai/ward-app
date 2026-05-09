import { useMemo, useState } from "react";
import type { CardLibraryCardSummary, DeckDetail, DeckSummary } from "../clientTypes";
import { decodeWardDeckString, encodeWardDeckString } from "../deckShare";
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
  onImportDeckCode: (payload: {
    name?: string;
    deckId?: string;
    cardIds: string[];
    cardArtKeys?: string[];
    format?: "FREE_PLAY" | "TOURNAMENT";
  }) => void;
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

function getDeckFormat(deck: DeckDetail | undefined): "FREE_PLAY" | "TOURNAMENT" {
  return deck?.format === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY";
}

function getDeckFormatLabel(deck: DeckDetail | undefined): string {
  return getDeckFormat(deck) === "TOURNAMENT" ? "Tournament Legal" : "Free Play";
}

export function DeckLibraryPage({
  decks,
  deckDetails,
  cardLibrary,
  onEditDeck,
  onCloneDeck,
  onDeleteDeck,
  onImportDeckCode
}: DeckLibraryPageProps) {
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [importCode, setImportCode] = useState("");
  const [deckMessage, setDeckMessage] = useState("");
  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const deckDetailById = useMemo(() => new Map(deckDetails.map(deck => [deck.id, deck])), [deckDetails]);
  const selectedDeck = selectedDeckId ? deckDetailById.get(selectedDeckId) : undefined;
  const selectedSummary = selectedDeckId ? decks.find(deck => deck.id === selectedDeckId) : undefined;
  const selectedDeckCards = selectedDeck
    ? getDeckCounts(selectedDeck).map(item => ({ ...item, card: cardById.get(item.cardId) }))
    : [];
  const selectedStats = getDeckStats(selectedDeck, cardLibrary);
  const libraryStats = useMemo(() => {
    const loadedDecks = decks.filter(deck => deckDetailById.has(deck.id)).length;
    const totalCards = deckDetails.reduce((total, deck) => total + deck.cardIds.length, 0);
    const largestDeck = deckDetails.reduce((largest, deck) => Math.max(largest, deck.cardIds.length), 0);

    return {
      loadedDecks,
      totalCards,
      largestDeck
    };
  }, [deckDetailById, deckDetails, decks]);

  async function copyDeckExportCode(deck: DeckSummary, detail: DeckDetail | undefined) {
    if (!detail) {
      setDeckMessage("Deck details are still loading. Try again in a moment.");
      return;
    }

    const value = encodeWardDeckString({
      name: deck.name,
      deckId: deck.id,
      cardIds: detail.cardIds,
      cardArtKeys: detail.cardArtKeys,
      format: getDeckFormat(detail)
    });

    try {
      await navigator.clipboard.writeText(value);
      setDeckMessage(`Copied export code for ${deck.name}.`);
    } catch {
      setDeckMessage(`Export code for ${deck.name}: ${value}`);
    }
  }

  function importDeckCode() {
    try {
      const payload = decodeWardDeckString(importCode);
      const unknownCards = payload.cardIds.filter(cardId => !cardById.has(cardId));

      onImportDeckCode({
        name: payload.name,
        deckId: payload.deckId,
        cardIds: payload.cardIds,
        cardArtKeys: payload.cardArtKeys,
        format: payload.format
      });
      setImportCode("");
      setDeckMessage(
        unknownCards.length > 0
          ? `Imported ${payload.cardIds.length} cards. ${unknownCards.length} card ID(s) are not in the loaded packs.`
          : `Imported ${payload.cardIds.length} cards into the Card Library editor.`
      );
    } catch (error) {
      setDeckMessage(error instanceof Error ? error.message : "Could not import deck code.");
    }
  }

  return (
    <section className="deck-library-page">
      <div className="deck-library-header">
        <div>
          <h2>Deck Library</h2>
          <span>{decks.length} saved decks ready for play, edits, and sharing</span>
        </div>
        <div className="deck-library-header-stats" aria-label="Deck library summary">
          <span><strong>{libraryStats.loadedDecks}</strong> loaded</span>
          <span><strong>{libraryStats.totalCards}</strong> cards indexed</span>
          <span><strong>{libraryStats.largestDeck}</strong> max size</span>
        </div>
      </div>

      <div className="deck-library-import-panel">
        <div>
          <strong>Import Deck Code</strong>
          <span>Paste a WARDDECK1 code to open it in the Card Library deck editor.</span>
        </div>
        <textarea
          value={importCode}
          onChange={event => setImportCode(event.target.value)}
          rows={2}
          placeholder="WARDDECK1:..."
        />
        <button onClick={importDeckCode} disabled={!importCode.trim()}>Import</button>
      </div>

      {deckMessage && <p className="deck-library-message">{deckMessage}</p>}

      {decks.length === 0 ? (
        <div className="deck-library-empty">
          <strong>No saved decks found.</strong>
          <span>Build one in the Card Library, or import a deck code above to start from a shared list.</span>
        </div>
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
                  <span className={`deck-format-badge ${getDeckFormat(detail) === "TOURNAMENT" ? "tournament" : "free-play"}`}>
                    {getDeckFormatLabel(detail)}
                  </span>
                  <button onClick={() => setSelectedDeckId(deck.id)}>View</button>
                </div>

                <div className="deck-library-stat-row">
                  <span>{stats.total} cards</span>
                  <span>{stats.uniqueCards} unique</span>
                  <span>{stats.creatures} creatures</span>
                  <span>{stats.magic} magic</span>
                </div>

                <div className="deck-library-mix-row">
                  <span>Avg AL <strong>{stats.averageArmorLevel.toFixed(1)}</strong></span>
                  <span>{stats.missingCount > 0 ? `${stats.missingCount} missing card records` : "All card records loaded"}</span>
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
                  <button onClick={() => copyDeckExportCode(deck, detail)} disabled={!detail}>Export Code</button>
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
                <span className="label">Format</span>
                <strong>{getDeckFormatLabel(selectedDeck)}</strong>
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
