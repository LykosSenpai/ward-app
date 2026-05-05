import type { CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import {
  canSummonCreatureFromHand,
  creatureCannotBeSacrificed,
  getCardName,
  getCardText,
  getCreatureStatsLine,
  getMagicLine,
  getPrimarySummonSacrificeCandidates,
  getRequiredSacrificesForCard,
  isCreature,
  isLightningMagic,
  isMagic
} from "../../gameViewHelpers";

export function HandZone({
  match,
  player,
  discardRequiredForThisPlayer,
  canPlayPrimaryNow,
  canPlayMagicNow,
  canPlayLightningResponse,
  selectedSacrificesByCard,
  onDiscardFromHand,
  onToggleSacrifice,
  onPlayPrimary,
  onPlayMagic,
  onPlayLightningResponse
}: {
  match: AppMatchState;
  player: PlayerState;
  discardRequiredForThisPlayer: boolean;
  canPlayPrimaryNow: boolean;
  canPlayMagicNow: boolean;
  canPlayLightningResponse: boolean;
  selectedSacrificesByCard: Record<string, string[]>;
  onDiscardFromHand: (cardInstanceId: string) => void;
  onToggleSacrifice: (targetCardId: string, sacrificeCardId: string) => void;
  onPlayPrimary: (cardInstanceId: string) => void;
  onPlayMagic: (cardInstanceId: string) => void;
  onPlayLightningResponse: (cardInstanceId: string) => void;
}) {
  return (
    <section className="zone-box">
      <h3>Hand</h3>

      {player.hand.length === 0 ? (
        <p className="empty-zone">Hand is empty.</p>
      ) : (
        <div className="hand-list">
          {player.hand.map(card => (
            <HandCard
              key={card.instanceId}
              match={match}
              player={player}
              card={card}
              discardRequiredForThisPlayer={discardRequiredForThisPlayer}
              canPlayPrimaryNow={canPlayPrimaryNow}
              canPlayMagicNow={canPlayMagicNow}
              canPlayLightningResponse={canPlayLightningResponse}
              selectedSacrifices={selectedSacrificesByCard[card.instanceId] ?? []}
              onDiscardFromHand={onDiscardFromHand}
              onToggleSacrifice={onToggleSacrifice}
              onPlayPrimary={onPlayPrimary}
              onPlayMagic={onPlayMagic}
              onPlayLightningResponse={onPlayLightningResponse}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HandCard({
  match,
  player,
  card,
  discardRequiredForThisPlayer,
  canPlayPrimaryNow,
  canPlayMagicNow,
  canPlayLightningResponse,
  selectedSacrifices,
  onDiscardFromHand,
  onToggleSacrifice,
  onPlayPrimary,
  onPlayMagic,
  onPlayLightningResponse
}: {
  match: AppMatchState;
  player: PlayerState;
  card: CardInstance;
  discardRequiredForThisPlayer: boolean;
  canPlayPrimaryNow: boolean;
  canPlayMagicNow: boolean;
  canPlayLightningResponse: boolean;
  selectedSacrifices: string[];
  onDiscardFromHand: (cardInstanceId: string) => void;
  onToggleSacrifice: (targetCardId: string, sacrificeCardId: string) => void;
  onPlayPrimary: (cardInstanceId: string) => void;
  onPlayMagic: (cardInstanceId: string) => void;
  onPlayLightningResponse: (cardInstanceId: string) => void;
}) {
  const requiredSacrifices = getRequiredSacrificesForCard(match, card);
  const sacrificeCandidates = getPrimarySummonSacrificeCandidates(
    match,
    player,
    card
  );
  const primaryCreature = player.field.primaryCreature;
  const primaryCreatureCannotBeSacrificed = primaryCreature
    ? creatureCannotBeSacrificed(primaryCreature)
    : false;
  const autoRemoveCurrentPrimary = !!primaryCreature && primaryCreatureCannotBeSacrificed;
  const primarySacrificeRequired = !!primaryCreature && !autoRemoveCurrentPrimary;
  const selectedPrimarySacrifice =
    !primarySacrificeRequired ||
    (primaryCreature ? selectedSacrifices.includes(primaryCreature.instanceId) : true);
  const isPlayableCreature =
    isCreature(match, card) &&
    canPlayPrimaryNow &&
    canSummonCreatureFromHand(match, player, card) &&
    (!primarySacrificeRequired || selectedPrimarySacrifice) &&
    selectedSacrifices.length === requiredSacrifices;

  return (
    <div className="mini-card">
      <strong>{getCardName(match, card)}</strong>
      <span>{match.cardCatalog[card.cardId]?.cardType}</span>

      {discardRequiredForThisPlayer && (
        <button
          className="discard-button"
          onClick={() => onDiscardFromHand(card.instanceId)}
        >
          Discard for Hand Size
        </button>
      )}

      {isCreature(match, card) && (
        <>
          <span>{getCreatureStatsLine(match, card)}</span>
          <span>Required Sacrifices: {requiredSacrifices}</span>
        </>
      )}

      {isMagic(match, card) && (
        <>
          <span>{getMagicLine(match, card)}</span>
          <span className="magic-text">{getCardText(match, card)}</span>
        </>
      )}

      {isCreature(match, card) && canPlayPrimaryNow && autoRemoveCurrentPrimary && (
        <div className="warning-box compact-warning">
          Current field primary cannot be sacrificed. Playing this creature will send the current primary to the cemetery separately, then pay any required sacrifices from hand.
        </div>
      )}

      {isCreature(match, card) && canPlayPrimaryNow && requiredSacrifices > 0 && (
        <div className="sacrifice-box">
          <span className="label">
            Select {requiredSacrifices} sacrifice(s) from {autoRemoveCurrentPrimary ? "hand" : "hand or field"}:
          </span>

          {primaryCreatureCannotBeSacrificed && (
            <div className="warning-box compact-warning">
              Current field primary cannot be used as sacrifice material.
            </div>
          )}

          {sacrificeCandidates.length < requiredSacrifices && (
            <div className="warning-box compact-warning">
              Not enough valid hand/field creatures to summon this card.
            </div>
          )}

          {sacrificeCandidates.map(candidate => {
            const selected = selectedSacrifices.includes(candidate.instanceId);
            const isPrimarySacrifice =
              player.field.primaryCreature?.instanceId === candidate.instanceId;

            return (
              <button
                className={selected ? "sacrifice-chip selected" : "sacrifice-chip"}
                key={candidate.instanceId}
                onClick={() => onToggleSacrifice(card.instanceId, candidate.instanceId)}
              >
                {selected ? "Selected: " : ""}
                {isPrimarySacrifice ? "Field Primary: " : "Hand: "}
                {getCardName(match, candidate)}
              </button>
            );
          })}
        </div>
      )}

      {isCreature(match, card) && canPlayPrimaryNow && (
        <button onClick={() => onPlayPrimary(card.instanceId)} disabled={!isPlayableCreature}>
          Set as Primary
        </button>
      )}

      {isMagic(match, card) && canPlayMagicNow && (
        <button onClick={() => onPlayMagic(card.instanceId)}>Play Magic</button>
      )}

      {isLightningMagic(match, card) && canPlayLightningResponse && (
        <button
          className="lightning-button"
          onClick={() => onPlayLightningResponse(card.instanceId)}
        >
          Play Lightning Response
        </button>
      )}
    </div>
  );
}
