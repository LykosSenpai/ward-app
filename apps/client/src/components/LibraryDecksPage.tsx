import type { CardLibraryCardSummary, DeckSummary } from "../clientTypes";
import { CardLibraryPanel } from "./CardLibraryPanel";
import { DeckManagementPanel } from "./DeckManagementPanel";

type LibraryDecksPageProps = {
  decks: DeckSummary[];
  selectedPackCount: number;
  cardLibrary: CardLibraryCardSummary[];
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
  onLoadDeckIntoBuilder: (deckId: string, mode: "edit" | "clone") => void;
  onDeleteDeck: (deckId: string) => void;
};

export function LibraryDecksPage({
  decks,
  selectedPackCount,
  cardLibrary,
  deckBuilderName,
  deckBuilderId,
  deckBuilderCardIds,
  ownershipCounts,
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
  onSetOwnedCopies,
  onSaveDeck,
  onLoadDeckIntoBuilder,
  onDeleteDeck
}: LibraryDecksPageProps) {
  return (
    <section className="library-decks-page library-decks-page-compact">
      <div className="library-page-mini-header">
        <div>
          <h2>Library / Decks</h2>
          <span>Browse cards, track owned copies, build decks, and manage saved deck files.</span>
        </div>
      </div>

      <CardLibraryPanel
        cardLibrary={cardLibrary}
        selectedPackCount={selectedPackCount}
        deckBuilderName={deckBuilderName}
        deckBuilderId={deckBuilderId}
        deckBuilderCardIds={deckBuilderCardIds}
        ownershipCounts={ownershipCounts}
        normalizeId={normalizeId}
        getDeckBuilderCounts={getDeckBuilderCounts}
        getDeckBuilderCardCount={getDeckBuilderCardCount}
        onDeckNameChange={onDeckNameChange}
        onDeckIdChange={onDeckIdChange}
        onRefreshCardLibrary={onRefreshCardLibrary}
        onClearDeckBuilder={onClearDeckBuilder}
        onNewDeck={onNewDeck}
        onAddCard={onAddCard}
        onRemoveCard={onRemoveCard}
        onSetCardCopies={onSetCardCopies}
        onSetOwnedCopies={onSetOwnedCopies}
        onSaveDeck={onSaveDeck}
      />

      <details className="card library-deck-management-card library-deck-management-drawer">
        <summary>Saved Decks ({decks.length})</summary>
        <DeckManagementPanel
          decks={decks}
          onLoadDeck={onLoadDeckIntoBuilder}
          onDeleteDeck={onDeleteDeck}
        />
      </details>
    </section>
  );
}
