import type {
  CardPackSummary,
  DeckSummary
} from "../clientTypes";

type MatchSetupPanelProps = {
  cardPacks: CardPackSummary[];
  decks: DeckSummary[];
  selectedPackIds: string[];
  selectedPlayer1DeckId: string;
  selectedPlayer2DeckId: string;
  onRefreshSetupOptions: () => void;
  onToggleSelectedPack: (packId: string) => void;
  onPlayer1DeckChange: (deckId: string) => void;
  onPlayer2DeckChange: (deckId: string) => void;
  onCreateConfiguredMatch: () => void;
};

export function MatchSetupPanel({
  cardPacks,
  decks,
  selectedPackIds,
  selectedPlayer1DeckId,
  selectedPlayer2DeckId,
  onRefreshSetupOptions,
  onToggleSelectedPack,
  onPlayer1DeckChange,
  onPlayer2DeckChange,
  onCreateConfiguredMatch
}: MatchSetupPanelProps) {
  return (
    <section className="card match-setup-card compact-setup-card match-only-setup-card">
      <div className="match-setup-header">
        <div>
          <h2>Create 1v1 Match</h2>
          <p>Choose card packs, select both saved decks, then start the match. Use the Library / Decks tab to edit deck files.</p>
        </div>

        <button onClick={onRefreshSetupOptions}>Refresh Decks / Packs</button>
      </div>

      <div className="setup-quick-grid">
        <section className="setup-section">
          <h3>Enabled Card Packs</h3>

          {cardPacks.length === 0 ? (
            <p className="empty-zone">No card packs found in data/cards/packs.</p>
          ) : (
            <div className="pack-list compact-pack-list">
              {cardPacks.map(pack => {
                const selected = selectedPackIds.includes(pack.id);

                return (
                  <button
                    className={selected ? "pack-chip selected" : "pack-chip"}
                    key={pack.id}
                    onClick={() => onToggleSelectedPack(pack.id)}
                  >
                    <strong>{pack.name}</strong>
                    <span>{pack.id} | v{pack.version} | {pack.cardCount} cards</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="setup-section">
          <h3>Deck Selection</h3>

          {decks.length === 0 ? (
            <p className="empty-zone">No decks found in data/decks. Build one from the Library / Decks tab.</p>
          ) : (
            <div className="deck-select-grid compact-deck-select-grid">
              <label>
                Player 1 Deck
                <select
                  value={selectedPlayer1DeckId}
                  onChange={event => onPlayer1DeckChange(event.target.value)}
                >
                  {decks.map(deck => (
                    <option value={deck.id} key={deck.id}>
                      {deck.name} ({deck.cardCount} cards)
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Player 2 Deck
                <select
                  value={selectedPlayer2DeckId}
                  onChange={event => onPlayer2DeckChange(event.target.value)}
                >
                  {decks.map(deck => (
                    <option value={deck.id} key={deck.id}>
                      {deck.name} ({deck.cardCount} cards)
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="actions setup-create-actions">
            <button
              onClick={onCreateConfiguredMatch}
              disabled={selectedPackIds.length === 0 || !selectedPlayer1DeckId || !selectedPlayer2DeckId}
            >
              Create 1v1 Match
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
