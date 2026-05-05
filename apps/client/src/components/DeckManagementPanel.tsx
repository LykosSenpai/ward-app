import type { DeckSummary } from "../clientTypes";

type DeckManagementPanelProps = {
  decks: DeckSummary[];
  onLoadDeck: (deckId: string, mode: "edit" | "clone") => void;
  onDeleteDeck: (deckId: string) => void;
};

export function DeckManagementPanel({
  decks,
  onLoadDeck,
  onDeleteDeck
}: DeckManagementPanelProps) {
  return (
    <section className="setup-section deck-management-section">
      <div className="deck-builder-header">
        <div>
          <h3>Deck Management</h3>
          <p>Load a saved deck into the editor, clone it into a new deck, or delete old test decks.</p>
        </div>
      </div>

      {decks.length === 0 ? (
        <p className="empty-zone">No deck files found in data/decks.</p>
      ) : (
        <div className="deck-management-list enhanced-deck-management-list">
          {decks.map(deck => (
            <div className="deck-management-entry enhanced-deck-management-entry" key={deck.id}>
              <div>
                <strong>{deck.name}</strong>
                <div className="event-meta">
                  {deck.id} | {deck.cardCount} cards
                </div>
              </div>

              <div className="deck-management-actions">
                <button onClick={() => onLoadDeck(deck.id, "edit")}>Edit</button>
                <button onClick={() => onLoadDeck(deck.id, "clone")}>Clone</button>
                <button
                  className="delete-save-button"
                  onClick={() => onDeleteDeck(deck.id)}
                  disabled={deck.id === "demo-30-card"}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
