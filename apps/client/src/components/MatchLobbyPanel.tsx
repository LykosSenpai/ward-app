import { useMemo, useState } from "react";
import type { AuthUser, CardPackSummary, DeckDetail, DeckSummary, MatchLobby } from "../clientTypes";
import { ModalPanel } from "./ui/ModalPanel";

type MatchLobbyPanelProps = {
  user: AuthUser;
  lobbies: MatchLobby[];
  activeLobby?: MatchLobby;
  decks: DeckSummary[];
  deckDetails: DeckDetail[];
  cardPacks: CardPackSummary[];
  selectedPackIds: string[];
  onToggleSelectedPack: (packId: string) => void;
  onRefresh: () => void;
  onCreateLobby: (data: { name: string; selectedDeckId?: string }) => void;
  onJoinLobby: (lobbyId: string) => void;
  onViewLobby: (lobbyId: string) => void;
  onLeaveLobby: (lobbyId: string) => void;
  onSelectDeck: (lobbyId: string, deckId: string) => void;
  onStartMatch: (lobbyId: string) => void;
};

type DeckPickerMode = "create" | "lobby";

type DeckPickerState = {
  mode: DeckPickerMode;
  lobbyId?: string;
};

function getDeckDescription(deck: DeckSummary, detail?: DeckDetail): string {
  if (!detail) {
    return `${deck.cardCount} cards`;
  }

  const uniqueCount = new Set(detail.cardIds).size;
  return `${detail.cardIds.length} cards | ${uniqueCount} unique`;
}

function getDeckName(decks: DeckSummary[], deckId?: string): string {
  if (!deckId) {
    return "No deck selected";
  }

  return decks.find(deck => deck.id === deckId)?.name ?? deckId;
}

export function MatchLobbyPanel({
  user,
  lobbies,
  activeLobby,
  decks,
  deckDetails,
  cardPacks,
  selectedPackIds,
  onToggleSelectedPack,
  onRefresh,
  onCreateLobby,
  onJoinLobby,
  onViewLobby,
  onLeaveLobby,
  onSelectDeck,
  onStartMatch
}: MatchLobbyPanelProps) {
  const [newLobbyName, setNewLobbyName] = useState(`${user.displayName}'s Match`);
  const [createDeckId, setCreateDeckId] = useState("");
  const [deckPicker, setDeckPicker] = useState<DeckPickerState | null>(null);
  const deckDetailById = useMemo(() => new Map(deckDetails.map(deck => [deck.id, deck])), [deckDetails]);
  const selectedLobby = activeLobby;
  const selectedLobbyPlayer = selectedLobby?.players.find(player => player.userId === user.id);
  const isSelectedLobbyHost = selectedLobby?.hostUserId === user.id;
  const canJoinSelectedLobby = Boolean(
    selectedLobby &&
      selectedLobby.status === "OPEN" &&
      !selectedLobbyPlayer &&
      selectedLobby.players.length < 2
  );
  const canStart = Boolean(
    selectedLobby &&
      isSelectedLobbyHost &&
      selectedLobby.status === "OPEN" &&
      selectedLobby.players.length === 2 &&
      selectedLobby.players.every(player => player.selectedDeckId)
  );

  function selectDeck(deckId: string) {
    if (!deckPicker) {
      return;
    }

    if (deckPicker.mode === "create") {
      setCreateDeckId(deckId);
    } else if (deckPicker.lobbyId) {
      onSelectDeck(deckPicker.lobbyId, deckId);
    }

    setDeckPicker(null);
  }

  return (
    <section className="match-lobby-page">
      <div className="match-lobby-header">
        <div>
          <h2>Match Lobby</h2>
          <p>Make a table, pick an account deck, and jump into the match when both seats are ready.</p>
        </div>

        <button type="button" onClick={onRefresh}>Refresh</button>
      </div>

      <div className="match-lobby-layout">
        <section className="match-lobby-create-panel">
          <div className="match-lobby-section-header">
            <h3>Create Match</h3>
            <span>{selectedPackIds.length} packs</span>
          </div>

          <label>
            Lobby Name
            <input value={newLobbyName} onChange={event => setNewLobbyName(event.target.value)} />
          </label>

          <section className="match-lobby-fieldset">
            <h4>Card Packs</h4>
            {cardPacks.length === 0 ? (
              <p className="empty-zone">No card packs found.</p>
            ) : (
              <div className="match-lobby-pack-grid">
                {cardPacks.map(pack => {
                  const selected = selectedPackIds.includes(pack.id);

                  return (
                    <button
                      type="button"
                      className={selected ? "match-lobby-pack-chip selected" : "match-lobby-pack-chip"}
                      key={pack.id}
                      onClick={() => onToggleSelectedPack(pack.id)}
                    >
                      <strong>{pack.name}</strong>
                      <span>{pack.cardCount} cards</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="match-lobby-fieldset">
            <h4>Starting Deck</h4>
            <div className="match-lobby-deck-pick">
              <select value={createDeckId} onChange={event => setCreateDeckId(event.target.value)}>
                <option value="">Choose a deck...</option>
                {decks.map(deck => (
                  <option value={deck.id} key={deck.id}>{deck.name} ({deck.cardCount})</option>
                ))}
              </select>

              <button type="button" onClick={() => setDeckPicker({ mode: "create" })} disabled={decks.length === 0}>
                Deck Library
              </button>
            </div>
          </section>

          <button
            type="button"
            className="attention-button"
            onClick={() => onCreateLobby({ name: newLobbyName, selectedDeckId: createDeckId || undefined })}
            disabled={selectedPackIds.length === 0}
          >
            Create Lobby
          </button>
        </section>

        <section className="match-lobby-main">
          <section className="match-lobby-list-panel">
            <div className="match-lobby-section-header">
              <h3>Active Lobbies</h3>
              <span>{lobbies.length}</span>
            </div>

            {lobbies.length === 0 ? (
              <p className="empty-zone">No lobbies yet.</p>
            ) : (
              <div className="match-lobby-list">
                {lobbies.map(lobby => {
                  const isJoined = lobby.players.some(player => player.userId === user.id);
                  const isSelected = selectedLobby?.id === lobby.id;

                  return (
                    <article className={isSelected ? "match-lobby-card selected" : "match-lobby-card"} key={lobby.id}>
                      <button type="button" className="match-lobby-card-body" onClick={() => onViewLobby(lobby.id)}>
                        <span className="match-lobby-status">{lobby.status}</span>
                        <strong>{lobby.name}</strong>
                        <span>{lobby.players.length}/2 players</span>
                      </button>

                      <div className="match-lobby-card-actions">
                        {lobby.status === "OPEN" && !isJoined && (
                          <button type="button" onClick={() => onJoinLobby(lobby.id)}>Join</button>
                        )}
                        <button type="button" onClick={() => onViewLobby(lobby.id)}>
                          {lobby.matchId ? "Watch" : "View"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="match-lobby-active-panel">
            <div className="match-lobby-section-header">
              <h3>Selected Lobby</h3>
              {selectedLobby && <span>{selectedLobby.status}</span>}
            </div>

            {!selectedLobby ? (
              <p className="empty-zone">Select, create, or join a lobby.</p>
            ) : (
              <>
                <div className="match-lobby-active-title">
                  <strong>{selectedLobby.name}</strong>
                  <span>{selectedLobby.players.length}/2 seats filled</span>
                </div>

                <div className="match-lobby-seat-list">
                  {selectedLobby.players.map(player => (
                    <div className="match-lobby-seat" key={player.userId}>
                      <span>Seat {player.seat}</span>
                      <strong>{player.displayName}</strong>
                      <em>{getDeckName(decks, player.selectedDeckId)}</em>
                    </div>
                  ))}
                </div>

                {selectedLobbyPlayer && selectedLobby.status === "OPEN" && (
                  <section className="match-lobby-fieldset">
                    <h4>Your Deck</h4>
                    <div className="match-lobby-deck-pick">
                      <select
                        value={selectedLobbyPlayer.selectedDeckId ?? ""}
                        onChange={event => onSelectDeck(selectedLobby.id, event.target.value)}
                      >
                        <option value="">Choose a deck...</option>
                        {decks.map(deck => (
                          <option value={deck.id} key={deck.id}>{deck.name} ({deck.cardCount})</option>
                        ))}
                      </select>

                      <button type="button" onClick={() => setDeckPicker({ mode: "lobby", lobbyId: selectedLobby.id })} disabled={decks.length === 0}>
                        Deck Library
                      </button>
                    </div>
                  </section>
                )}

                <div className="match-lobby-card-actions">
                  {canJoinSelectedLobby && (
                    <button type="button" onClick={() => onJoinLobby(selectedLobby.id)}>Join Lobby</button>
                  )}
                  {selectedLobbyPlayer && selectedLobby.status === "OPEN" && (
                    <button type="button" onClick={() => onLeaveLobby(selectedLobby.id)}>Leave Lobby</button>
                  )}
                  {selectedLobby.matchId && (
                    <button type="button" onClick={() => onViewLobby(selectedLobby.id)}>Watch Match</button>
                  )}
                  {isSelectedLobbyHost && selectedLobby.status === "OPEN" && (
                    <button type="button" onClick={() => onStartMatch(selectedLobby.id)} disabled={!canStart}>Start Match</button>
                  )}
                </div>
              </>
            )}
          </section>
        </section>
      </div>

      {deckPicker && (
        <ModalPanel title="Select Deck" onClose={() => setDeckPicker(null)} wide>
          <div className="match-lobby-deck-modal">
            {decks.length === 0 ? (
              <p className="empty-zone">No account decks found. Build and save a deck from the Card Library first.</p>
            ) : (
              decks.map(deck => {
                const detail = deckDetailById.get(deck.id);

                return (
                  <button type="button" className="match-lobby-deck-option" key={deck.id} onClick={() => selectDeck(deck.id)}>
                    <strong>{deck.name}</strong>
                    <span>{deck.id}</span>
                    <em>{getDeckDescription(deck, detail)}</em>
                  </button>
                );
              })
            )}
          </div>
        </ModalPanel>
      )}
    </section>
  );
}
