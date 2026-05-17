import { useMemo, useState } from "react";
import type { AuthUser, CardLibraryCardSummary, DeckDetail, DeckSummary } from "../clientTypes";
import { decodeWardDeckString, encodeWardDeckString, getWardDeckStringFormatLabel } from "../deckShare";
import { getDisplayMagicType } from "../gameViewHelpers";
import { CardImageThumbnail, getCardArtLabel, normalizeCardArtKey } from "./CardImagePreview";
import type { CardArtKey } from "./CardImagePreview";
import { ModalPanel } from "./ui/ModalPanel";
import { API_BASE_URL } from "../config";

type DeckLibraryPageProps = {
  decks: DeckSummary[];
  deckDetails: DeckDetail[];
  tournamentDeckSubmissions: DeckDetail[];
  currentUser: AuthUser | null;
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
  onRefreshDeckDetails: () => void;
  onReviewTournamentDeck: (ownerUserId: string, deckId: string, status: "VERIFIED" | "REJECTED", notes?: string) => void;
};

type DeckCardCount = {
  cardId: string;
  artKey: CardArtKey;
  count: number;
  card?: CardLibraryCardSummary;
};

function getDeckCounts(deck: DeckDetail): DeckCardCount[] {
  const counts = deck.cardIds.reduce<Record<string, DeckCardCount>>((result, cardId, index) => {
    const artKey = normalizeCardArtKey(deck.cardArtKeys?.[index]);
    const key = `${cardId}__${artKey}`;
    result[key] = result[key] ?? { cardId, artKey, count: 0 };
    result[key].count += 1;
    return result;
  }, {});

  return Object.values(counts)
    .sort((a, b) =>
      a.cardId.localeCompare(b.cardId, undefined, { numeric: true }) ||
      getCardArtLabel(a.artKey).localeCompare(getCardArtLabel(b.artKey))
    );
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

function getVerificationStatus(deck: DeckDetail | undefined): string {
  return deck?.tournamentVerification?.status ?? "UNSUBMITTED";
}

function getVerificationLabel(deck: DeckDetail | undefined): string {
  const status = getVerificationStatus(deck);
  if (status === "PENDING") return "Pending Verification";
  if (status === "VERIFIED") return "Verified";
  if (status === "REJECTED") return "Rejected";
  return "No Proof Submitted";
}

function getProofPhotoUrl(url: string | undefined): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

export function DeckLibraryPage({
  decks,
  deckDetails,
  tournamentDeckSubmissions,
  currentUser,
  cardLibrary,
  onEditDeck,
  onCloneDeck,
  onDeleteDeck,
  onImportDeckCode,
  onRefreshDeckDetails,
  onReviewTournamentDeck
}: DeckLibraryPageProps) {
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [importCode, setImportCode] = useState("");
  const [deckMessage, setDeckMessage] = useState("");
  const [proofUploadDeckId, setProofUploadDeckId] = useState("");
  const [reviewNotesByDeckKey, setReviewNotesByDeckKey] = useState<Record<string, string>>({});
  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const deckDetailById = useMemo(() => new Map(deckDetails.map(deck => [deck.id, deck])), [deckDetails]);
  const selectedDeck = selectedDeckId ? deckDetailById.get(selectedDeckId) : undefined;
  const selectedSummary = selectedDeckId ? decks.find(deck => deck.id === selectedDeckId) : undefined;
  const selectedDeckCards = selectedDeck
    ? getDeckCounts(selectedDeck).map(item => ({ ...item, card: cardById.get(item.cardId) }))
    : [];
  const selectedStats = getDeckStats(selectedDeck, cardLibrary);
  const canReviewTournamentDecks = currentUser?.role === "ADMIN" || currentUser?.role === "HOST";
  const importFormatLabel = getWardDeckStringFormatLabel(importCode);
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
    }, { cardLibrary });

    try {
      await navigator.clipboard.writeText(value);
      setDeckMessage(`Copied ${getWardDeckStringFormatLabel(value) ?? "WARDDECK"} export code for ${deck.name}.`);
    } catch {
      setDeckMessage(`${getWardDeckStringFormatLabel(value) ?? "WARDDECK"} export code for ${deck.name}: ${value}`);
    }
  }

  function importDeckCode() {
    try {
      const formatLabel = getWardDeckStringFormatLabel(importCode) ?? "deck";
      const payload = decodeWardDeckString(importCode, { cardLibrary });
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
          ? `Imported ${payload.cardIds.length} cards from ${formatLabel} import code. ${unknownCards.length} card ID(s) are not in the loaded packs.`
          : `Imported ${payload.cardIds.length} cards from ${formatLabel} import code into the Card Library editor.`
      );
    } catch (error) {
      setDeckMessage(error instanceof Error ? error.message : "Could not import deck code.");
    }
  }

  async function uploadProofPhotos(deckId: string, files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;

    try {
      setProofUploadDeckId(deckId);
      const photos = await Promise.all(selectedFiles.map(file => new Promise<{ fileName: string; dataUrl: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ fileName: file.name, dataUrl: String(reader.result ?? "") });
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
      })));

      const response = await fetch(`${API_BASE_URL}/api/decks/${encodeURIComponent(deckId)}/proof-photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ photos })
      });
      const data = await response.json() as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to upload proof photos.");
      }

      setDeckMessage(`Uploaded ${selectedFiles.length} proof photo${selectedFiles.length === 1 ? "" : "s"} for ${deckId}.`);
      onRefreshDeckDetails();
    } catch (error) {
      setDeckMessage(error instanceof Error ? error.message : "Could not upload proof photos.");
    } finally {
      setProofUploadDeckId("");
    }
  }

  function setReviewNotes(deck: DeckDetail, value: string) {
    const key = `${deck.ownerUserId ?? ""}:${deck.id}`;
    setReviewNotesByDeckKey(current => ({ ...current, [key]: value }));
  }

  function getReviewNotes(deck: DeckDetail): string {
    return reviewNotesByDeckKey[`${deck.ownerUserId ?? ""}:${deck.id}`] ?? "";
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
          <strong>{importFormatLabel ? `Import Deck Code (${importFormatLabel})` : "Import Deck Code"}</strong>
          <span>Paste a WARDDECK4SYM, WARDDECK4, or legacy WARDDECK3 code to open it in the Card Library deck editor.</span>
        </div>
        <textarea
          value={importCode}
          onChange={event => setImportCode(event.target.value)}
          rows={2}
          placeholder="WARDDECK4SYM:... or WARDDECK4:..."
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
              ? getDeckCounts(detail)
                  .slice(0, 5)
                  .map(item => ({ ...item, card: cardById.get(item.cardId) }))
                  .filter((item): item is DeckCardCount & { card: CardLibraryCardSummary } => !!item.card)
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
                  {getDeckFormat(detail) === "TOURNAMENT" ? (
                    <span className={`deck-verification-badge ${getVerificationStatus(detail).toLowerCase()}`}>
                      {getVerificationLabel(detail)}
                    </span>
                  ) : null}
                </div>

                <div className="deck-library-preview-row">
                  {previewCards.length === 0 ? (
                    <span className="event-meta">Deck details loading...</span>
                  ) : (
                    previewCards.map(({ cardId, artKey, card }) => <CardImageThumbnail card={card} artKey={artKey} key={`${cardId}:${artKey}`} />)
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
                {detail && getDeckFormat(detail) === "TOURNAMENT" ? (
                  <label className="deck-proof-upload">
                    <span>{proofUploadDeckId === deck.id ? "Uploading proof..." : "Attach ownership photos"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      disabled={proofUploadDeckId === deck.id}
                      onChange={event => {
                        void uploadProofPhotos(deck.id, event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {canReviewTournamentDecks ? (
        <section className="tournament-review-panel">
          <div className="deck-library-card-header">
            <div>
              <strong>Tournament Deck Review</strong>
              <span>{tournamentDeckSubmissions.length} submitted deck{tournamentDeckSubmissions.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          {tournamentDeckSubmissions.length === 0 ? (
            <p className="empty-zone">No tournament decks have ownership photos attached yet.</p>
          ) : (
            <div className="tournament-review-list">
              {tournamentDeckSubmissions.map(deck => {
                const notes = getReviewNotes(deck);
                return (
                  <article className="tournament-review-card" key={`${deck.ownerUserId}:${deck.id}`}>
                    <div>
                      <strong>{deck.name}</strong>
                      <span>{deck.ownerDisplayName} | {deck.id} | {getVerificationLabel(deck)}</span>
                    </div>
                    <div className="deck-proof-photo-grid">
                      {(deck.tournamentProofPhotos ?? []).map(photo => (
                        <a href={getProofPhotoUrl(photo.url)} target="_blank" rel="noreferrer" key={photo.id}>
                          <img src={getProofPhotoUrl(photo.url)} alt={photo.fileName} />
                          <span>{photo.fileName}</span>
                        </a>
                      ))}
                    </div>
                    <textarea
                      value={notes}
                      onChange={event => setReviewNotes(deck, event.target.value)}
                      rows={2}
                      placeholder="Review notes"
                    />
                    <div className="deck-library-actions">
                      <button onClick={() => onReviewTournamentDeck(deck.ownerUserId ?? "", deck.id, "VERIFIED", notes)}>
                        Verify for Tournament
                      </button>
                      <button className="delete-save-button" onClick={() => onReviewTournamentDeck(deck.ownerUserId ?? "", deck.id, "REJECTED", notes)}>
                        Reject
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

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
              {getDeckFormat(selectedDeck) === "TOURNAMENT" ? (
                <div>
                  <span className="label">Verification</span>
                  <strong>{getVerificationLabel(selectedDeck)}</strong>
                </div>
              ) : null}
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

            {getDeckFormat(selectedDeck) === "TOURNAMENT" ? (
              <section className="deck-proof-section">
                <h3>Ownership Proof</h3>
                {selectedDeck.tournamentProofPhotos?.length ? (
                  <div className="deck-proof-photo-grid">
                    {selectedDeck.tournamentProofPhotos.map(photo => (
                      <a href={getProofPhotoUrl(photo.url)} target="_blank" rel="noreferrer" key={photo.id}>
                        <img src={getProofPhotoUrl(photo.url)} alt={photo.fileName} />
                        <span>{photo.fileName}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="empty-zone">No ownership photos attached yet.</p>
                )}
              </section>
            ) : null}

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
                  {selectedDeckCards.map(({ cardId, artKey, count, card }) => (
                    <div className="deck-detail-card-row" key={`${cardId}:${artKey}`}>
                      {card ? <CardImageThumbnail card={card} artKey={artKey} /> : <span className="card-image-thumb missing">{cardId.slice(0, 1)}</span>}
                      <div>
                        <strong>{count}x {card?.name ?? cardId} {artKey !== "default" ? `(${getCardArtLabel(artKey)})` : ""}</strong>
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
