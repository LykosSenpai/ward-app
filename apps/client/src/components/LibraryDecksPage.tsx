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
  deckBuilderFormat: "FREE_PLAY" | "TOURNAMENT";
  ownershipCounts: Record<string, number>;
  normalizeId: (value: string) => string;
  getDeckBuilderCounts: () => Record<string, number>;
  getDeckBuilderCardCount: (cardId: string) => number;
  onDeckNameChange: (value: string) => void;
  onDeckFormatChange: (value: "FREE_PLAY" | "TOURNAMENT") => void;
  onImportDeckCode: (payload: {
    name?: string;
    deckId?: string;
    cardIds: string[];
    cardArtKeys?: string[];
    format?: "FREE_PLAY" | "TOURNAMENT";
  }) => void;
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
  canManageZeroArtVariants?: boolean;
  onSaveCardLimit?: (cardId: string, status: "LEGAL" | "LIMITED" | "BANNED") => void;
  onSaveCardZeroArtVariant?: (cardId: string, hasZeroArtVariant: boolean) => void;
};

export function LibraryDecksPage({
  selectedPackCount,
  cardLibrary,
  deckBuilderName,
  deckBuilderId,
  deckBuilderCardIds,
  deckBuilderCardArtKeys,
  deckBuilderFormat,
  ownershipCounts,
  normalizeId,
  getDeckBuilderCounts,
  getDeckBuilderCardCount,
  onDeckNameChange,
  onDeckFormatChange,
  onImportDeckCode,
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
  canManageZeroArtVariants = false,
  onSaveCardLimit,
  onSaveCardZeroArtVariant
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
        deckBuilderFormat={deckBuilderFormat}
        ownershipCounts={ownershipCounts}
        normalizeId={normalizeId}
        getDeckBuilderCounts={getDeckBuilderCounts}
        getDeckBuilderCardCount={getDeckBuilderCardCount}
        onDeckNameChange={onDeckNameChange}
        onDeckFormatChange={onDeckFormatChange}
        onImportDeckCode={onImportDeckCode}
        onRefreshCardLibrary={onRefreshCardLibrary}
        onClearDeckBuilder={onClearDeckBuilder}
        onNewDeck={onNewDeck}
        onAddCard={onAddCard}
        onRemoveCard={onRemoveCard}
        onSetCardCopies={onSetCardCopies}
        onSetOwnedCopies={onSetOwnedCopies}
        onSaveDeck={onSaveDeck}
        onAddMarketplaceNeed={onAddMarketplaceNeed}
        onAddMarketplaceHave={onAddMarketplaceHave}
        canUseDevTools={canUseDevTools}
        canManageZeroArtVariants={canManageZeroArtVariants}
        onSaveCardLimit={onSaveCardLimit}
        onSaveCardZeroArtVariant={onSaveCardZeroArtVariant}
      />
    </section>
  );
}
