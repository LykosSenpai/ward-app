import type { CardLibraryCardSummary, CardOwnershipVariant, MissingCollectionItem, VariantCompletionSummary } from "./clientTypes";

export function getOwnershipVariantFromArtworkAndHolo(artworkMode: "DEFAULT" | "ZERO", isHolo: boolean): CardOwnershipVariant {
  if (artworkMode === "ZERO") return isHolo ? "ZERO_HOLO" : "ZERO";
  return isHolo ? "HOLO" : "DEFAULT";
}

export function getMissingQuantity(ownedQuantity: number, requiredQuantity: number): number {
  return Math.max(0, requiredQuantity - ownedQuantity);
}

export function getOwnedQuantityForVariant(getOwnedCountByArt: (cardId: string, artKey: string) => number, cardId: string, variant: CardOwnershipVariant): number {
  if (variant === "DEFAULT") return getOwnedCountByArt(cardId, "default");
  if (variant === "HOLO") return getOwnedCountByArt(cardId, "holo");
  if (variant === "ZERO") return getOwnedCountByArt(cardId, "zero");
  return getOwnedCountByArt(cardId, "zero_holo");
}

export function buildGenerationCompletion(args: {
  cards: CardLibraryCardSummary[];
  generation: string;
  selectedVariants: CardOwnershipVariant[];
  requiredQuantity: number;
  getOwnedCountByVariant: (cardId: string, variant: CardOwnershipVariant) => number;
}): { variantSummaries: VariantCompletionSummary[]; missingItems: MissingCollectionItem[] } {
  const generationCards = args.cards.filter(card => `${card.generation ?? ""}` === args.generation);
  const totalCards = generationCards.length;
  const missingItems: MissingCollectionItem[] = [];

  const variantSummaries = args.selectedVariants.map(variant => {
    let ownedCompleteCards = 0;

    for (const card of generationCards) {
      const ownedQuantity = args.getOwnedCountByVariant(card.id, variant);
      const missingQuantity = getMissingQuantity(ownedQuantity, args.requiredQuantity);

      if (missingQuantity === 0) {
        ownedCompleteCards += 1;
      } else {
        missingItems.push({
          cardId: card.id,
          cardName: card.name,
          generation: `${card.generation ?? ""}`,
          cardNumber: `${card.cardNumber ?? ""}`,
          variant,
          ownedQuantity,
          requiredQuantity: args.requiredQuantity,
          missingQuantity
        });
      }
    }

    return {
      variant,
      ownedCompleteCards,
      totalCards,
      missingCards: Math.max(0, totalCards - ownedCompleteCards),
      percentComplete: totalCards === 0 ? 0 : Math.round((ownedCompleteCards / totalCards) * 100)
    };
  });

  return { variantSummaries, missingItems };
}
