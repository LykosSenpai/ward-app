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
  isBattleLightningMagic,
  isChainLightningMagic,
  isCreature,
  isMagic
} from "../../gameViewHelpers";

function isSilenceFromTheGraveCard(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];
  const name = String(definition?.name ?? "").trim().toLowerCase();
  const id = String(definition?.id ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return isMagic(match, card) && (
    name === "silence from the grave" ||
    id.includes("silence-from-the-grave") ||
    id.includes("silence_from_the_grave") ||
    (cardNumber === "151" && name.includes("silence"))
  );
}

function canPaySilenceFromTheGraveCost(match: AppMatchState, player: PlayerState, card: CardInstance): boolean {
  return player.hand.some(candidate => candidate.instanceId !== card.instanceId && isMagic(match, candidate));
}

function isMinotaurBodyguardCard(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];
  const name = String(definition?.name ?? "").trim().toLowerCase();
  const id = String(definition?.id ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return isBattleLightningMagic(match, card) && (
    name === "minotaur bodyguard" ||
    id.includes("minotaur-bodyguard") ||
    id.includes("minotaur_bodyguard") ||
    (cardNumber === "016" && name.includes("minotaur") && name.includes("bodyguard"))
  );
}

export function HandZone({
  match,
  player,
  discardRequiredForThisPlayer,
  canPlayPrimaryNow,
  canPlayMagicNow,
  canPlayLightningResponse,
  canPlayBattleResponse,
  selectedSacrificesByCard,
  onDiscardFromHand,
  onToggleSacrifice,
  onPlayPrimary,
  onPlayMagic,
  onPlayLightningResponse,
  onPlayBattleResponse
}: {
  match: AppMatchState;
  player: PlayerState;
  discardRequiredForThisPlayer: boolean;
  canPlayPrimaryNow: boolean;
  canPlayMagicNow: boolean;
  canPlayLightningResponse: boolean;
  canPlayBattleResponse: boolean;
  selectedSacrificesByCard: Record<string, string[]>;
  onDiscardFromHand: (cardInstanceId: string) => void;
  onToggleSacrifice: (targetCardId: string, sacrificeCardId: string) => void;
  onPlayPrimary: (cardInstanceId: string) => void;
  onPlayMagic: (cardInstanceId: string) => void;
  onPlayLightningResponse: (cardInstanceId: string) => void;
  onPlayBattleResponse: (cardInstanceId: string) => void;
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
              canPlayBattleResponse={canPlayBattleResponse}
              selectedSacrifices={selectedSacrificesByCard[card.instanceId] ?? []}
              onDiscardFromHand={onDiscardFromHand}
              onToggleSacrifice={onToggleSacrifice}
              onPlayPrimary={onPlayPrimary}
              onPlayMagic={onPlayMagic}
              onPlayLightningResponse={onPlayLightningResponse}
              onPlayBattleResponse={onPlayBattleResponse}
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
  canPlayBattleResponse,
  selectedSacrifices,
  onDiscardFromHand,
  onToggleSacrifice,
  onPlayPrimary,
  onPlayMagic,
  onPlayLightningResponse,
  onPlayBattleResponse
}: {
  match: AppMatchState;
  player: PlayerState;
  card: CardInstance;
  discardRequiredForThisPlayer: boolean;
  canPlayPrimaryNow: boolean;
  canPlayMagicNow: boolean;
  canPlayLightningResponse: boolean;
  canPlayBattleResponse: boolean;
  selectedSacrifices: string[];
  onDiscardFromHand: (cardInstanceId: string) => void;
  onToggleSacrifice: (targetCardId: string, sacrificeCardId: string) => void;
  onPlayPrimary: (cardInstanceId: string) => void;
  onPlayMagic: (cardInstanceId: string) => void;
  onPlayLightningResponse: (cardInstanceId: string) => void;
  onPlayBattleResponse: (cardInstanceId: string) => void;
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
  const isSilenceCard = isSilenceFromTheGraveCard(match, card);
  const isMinotaurBodyguard = isMinotaurBodyguardCard(match, card);
  const silenceCanPayCost = !isSilenceCard || canPaySilenceFromTheGraveCost(match, player, card);

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
        <>
          {isSilenceCard && !silenceCanPayCost && (
            <div className="warning-box compact-warning">
              Silence From The Grave requires 1 other Magic card in hand to discard before it can enter the Magic Chain.
            </div>
          )}
          <button onClick={() => onPlayMagic(card.instanceId)} disabled={!silenceCanPayCost}>
            Play Magic
          </button>
        </>
      )}

      {isChainLightningMagic(match, card) && canPlayLightningResponse && (
        <button
          className="lightning-button"
          onClick={() => onPlayLightningResponse(card.instanceId)}
        >
          Play Lightning Response
        </button>
      )}

      {isMinotaurBodyguard && canPlayBattleResponse && (
        <button
          className="lightning-button"
          onClick={() => onPlayBattleResponse(card.instanceId)}
        >
          Play Battle Response
        </button>
      )}
    </div>
  );
}
