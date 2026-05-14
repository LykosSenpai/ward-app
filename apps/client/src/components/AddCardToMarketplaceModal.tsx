import type { CardLibraryCardSummary } from "../clientTypes";

type Props = {
  cards: CardLibraryCardSummary[];
  onAdd: (item: string) => void;
};

export function AddCardToMarketplaceModal({ cards, onAdd }: Props) {
  return (
    <section className="marketplace-card">
      <h3>Quick Add from Card Library</h3>
      <div className="marketplace-chip-list">
        {cards.slice(0, 40).map(card => (
          <button key={card.id} type="button" className="marketplace-chip" onClick={() => onAdd(card.name)}>
            {card.name}
          </button>
        ))}
      </div>
    </section>
  );
}
