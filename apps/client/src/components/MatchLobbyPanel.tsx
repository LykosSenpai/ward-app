import { useEffect, useState } from "react";
import type { AuthUser, CardPackSummary, DeckSummary, MatchLobby } from "../clientTypes";

type MatchLobbyPanelProps = {
  user: AuthUser;
  lobbies: MatchLobby[];
  activeLobby?: MatchLobby;
  decks: DeckSummary[];
  cardPacks: CardPackSummary[];
  selectedPackIds: string[];
  onToggleSelectedPack: (packId: string) => void;
  onRefresh: () => void;
  onCreateLobby: (data: { name: string }) => void;
  onJoinLobby: (lobbyId: string) => void;
  onViewLobby: (lobbyId: string) => void;
  onLeaveLobby: (lobbyId: string) => void;
  onStartMatch: (lobbyId: string) => void;
  canUseDevTools?: boolean;
  onCleanupStaleLobbies?: () => void;
};

function getDeckName(decks: DeckSummary[], deckId?: string): string {
  if (!deckId) {
    return "No deck selected";
  }

  return decks.find(deck => deck.id === deckId)?.name ?? deckId;
}

function getLobbyPackName(pack: CardPackSummary): string {
  return pack.name.replace(/^WARD\s+/i, "");
}

function getIsoTimeMs(value?: string): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getLobbyAge(lobby: MatchLobby, nowMs: number): string {
  return formatDuration(nowMs - getIsoTimeMs(lobby.createdAt));
}

function getLobbyIdleTime(lobby: MatchLobby, nowMs: number): string {
  return formatDuration(nowMs - getIsoTimeMs(lobby.lastActivityAt ?? lobby.updatedAt ?? lobby.createdAt));
}

function getLobbyAutoCloseTime(lobby: MatchLobby, nowMs: number): string | undefined {
  if (!lobby.autoCloseAt) {
    return undefined;
  }

  return formatDuration(getIsoTimeMs(lobby.autoCloseAt) - nowMs);
}

export function MatchLobbyPanel({
  user,
  lobbies,
  activeLobby,
  decks,
  cardPacks,
  selectedPackIds,
  onToggleSelectedPack,
  onRefresh,
  onCreateLobby,
  onJoinLobby,
  onViewLobby,
  onLeaveLobby,
  onStartMatch,
  canUseDevTools = false,
  onCleanupStaleLobbies
}: MatchLobbyPanelProps) {
  const [newLobbyName, setNewLobbyName] = useState(`${user.displayName}'s Match`);
  const [nowMs, setNowMs] = useState(Date.now());
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
      selectedLobby.players.length === 2
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="match-lobby-page">
      <div className="match-lobby-header">
        <div>
          <h2>Match Lobby</h2>
          <p>Make a table, pick an account deck, and jump into the match when both seats are ready.</p>
        </div>

        <div className="match-lobby-header-actions">
          {canUseDevTools && onCleanupStaleLobbies && (
            <button type="button" onClick={onCleanupStaleLobbies}>Clean Stale</button>
          )}
          <button type="button" onClick={onRefresh}>Refresh</button>
        </div>
      </div>

      <div className="match-lobby-layout">
        <section className="match-lobby-side">
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

                <div className="match-lobby-timer-grid">
                  <span>Created {getLobbyAge(selectedLobby, nowMs)} ago</span>
                  <span>Idle {getLobbyIdleTime(selectedLobby, nowMs)}</span>
                  {getLobbyAutoCloseTime(selectedLobby, nowMs) && (
                    <span>Auto close in {getLobbyAutoCloseTime(selectedLobby, nowMs)}</span>
                  )}
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
                        <strong>{getLobbyPackName(pack)}</strong>
                        <span>{pack.cardCount} cards</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <button
              type="button"
              className="attention-button"
              onClick={() => onCreateLobby({ name: newLobbyName })}
              disabled={selectedPackIds.length === 0}
            >
              Create Lobby
            </button>
          </section>
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
                        <span>{lobby.players.length}/2 seats</span>
                        <span>Created {getLobbyAge(lobby, nowMs)} ago</span>
                        <span>Idle {getLobbyIdleTime(lobby, nowMs)}</span>
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
        </section>
      </div>

    </section>
  );
}
