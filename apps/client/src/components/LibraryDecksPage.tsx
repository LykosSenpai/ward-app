import type { CardLibraryCardSummary } from "../clientTypes";
import { CardLibraryPanel } from "./CardLibraryPanel";
import type { CardArtKey } from "./CardImagePreview";

type LibraryDecksPageProps = {
  selectedPackCount: number;
  cardLibrary: CardLibraryCardSummary[];
  deckBuilderName: string;
  deckBuilderId: string;
  deckBuilderCardIds: string[];
  deckBuilderCardArtKeys: CardArtKey[];
  ownershipCounts: Record<string, number>;
  normalizeId: (value: string) => string;
  getDeckBuilderCounts: () => Record<string, number>;
  getDeckBuilderCardCount: (cardId: string) => number;
  onDeckNameChange: (value: string) => void;
  onDeckIdChange: (value: string) => void;
  onRefreshCardLibrary: () => void;
  onClearDeckBuilder: () => void;
  onNewDeck: () => void;
  onAddCard: (cardId: string, artKey?: CardArtKey) => void;
  onRemoveCard: (cardId: string, artKey?: CardArtKey) => void;
  onSetCardCopies: (cardId: string, copyCount: number, artKey?: CardArtKey) => void;
  onSetOwnedCopies: (cardId: string, ownedCount: number) => void;
  onSaveDeck: () => void;
  canUseDevTools?: boolean;
  onSaveCardLimit?: (cardId: string, status: "LEGAL" | "LIMITED" | "BANNED") => void;
};

export function LibraryDecksPage({
  selectedPackCount,
  cardLibrary,
  deckBuilderName,
  deckBuilderId,
  deckBuilderCardIds,
  deckBuilderCardArtKeys,
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
  canUseDevTools = false,
  onSaveCardLimit
}: LibraryDecksPageProps) {
  return (
    <section className="library-decks-page library-decks-page-compact">
      <CardLibraryPanel
        cardLibrary={cardLibrary}
        selectedPackCount={selectedPackCount}
        deckBuilderName={deckBuilderName}
        deckBuilderId={deckBuilderId}
        deckBuilderCardIds={deckBuilderCardIds}
        deckBuilderCardArtKeys={deckBuilderCardArtKeys}
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
        canUseDevTools={canUseDevTools}
        onSaveCardLimit={onSaveCardLimit}
      />
    </section>
  );
}
