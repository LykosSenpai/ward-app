import type { CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import { MatchCardImage } from "../MatchCardImage";
import {
  canSummonCreatureFromHand,
  creatureCannotBeSacrificed,
  getCardName,
  getCardText,
  getCreatureStatsLine,
  getMagicLine,
  getPrimarySummonSacrificeCandidates,
  getRequiredSacrificesForCard,
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

function isAutomatedBattleResponseCard(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];
  if (definition?.cardType !== "MAGIC") return false;
  if (definition.magicType !== "BATTLE_LIGHTNING" && definition.magicType !== "LIGHTNING") return false;

  return Boolean(definition.effects?.some(effect => {
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const actionType = String(effect.actionType ?? "").trim().toUpperCase();
    const isBattleTrigger = trigger === "DURING_BATTLE_FROM_HAND" ||
      trigger === "ON_HIT_FROM_HAND" ||
      trigger === "WHEN_OPPONENT_FINISHES_ATTACK" ||
      trigger.includes("ATTACK_HITS");
    const isSupportedAction = actionType === "NEGATE_ATTACK_DAMAGE" ||
      actionType === "PREVENT_ATTACK_DAMAGE" ||
      actionType === "NEGATE_ATTACK_OR_MAGIC" ||
      actionType === "NEGATE_ATTACK" ||
      actionType === "PREVENT_ATTACK" ||
      actionType === "APPLY_DICE_MODIFIER" ||
      actionType === "APPLY_STAT_MODIFIER" ||
      actionType === "DEAL_INSTANT_DAMAGE" ||
      actionType === "DAMAGE" ||
      actionType === "DAMAGE_CREATURE";
    return isBattleTrigger && isSupportedAction;
  }));
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
  const isBattleResponseCard = isAutomatedBattleResponseCard(match, card);
  const silenceCanPayCost = !isSilenceCard || canPaySilenceFromTheGraveCost(match, player, card);
  const canPerformCardClick =
    discardRequiredForThisPlayer ||
    isPlayableCreature ||
    (isMagic(match, card) && canPlayMagicNow && silenceCanPayCost) ||
    (isChainLightningMagic(match, card) && canPlayLightningResponse) ||
    (isBattleResponseCard && canPlayBattleResponse);

  function performCardClick() {
    if (discardRequiredForThisPlayer) {
      onDiscardFromHand(card.instanceId);
      return;
    }

    if (isPlayableCreature) {
      onPlayPrimary(card.instanceId);
      return;
    }

    if (isMagic(match, card) && canPlayMagicNow && silenceCanPayCost) {
      onPlayMagic(card.instanceId);
      return;
    }

    if (isChainLightningMagic(match, card) && canPlayLightningResponse) {
      onPlayLightningResponse(card.instanceId);
      return;
    }

    if (isBattleResponseCard && canPlayBattleResponse) {
      onPlayBattleResponse(card.instanceId);
    }
  }

  return (
    <div
      className={[
        "mini-card",
        "hand-card",
        isCreature(match, card) ? "creature-card" : "magic-card",
        canPerformCardClick ? "playable" : ""
      ].filter(Boolean).join(" ")}
      role={canPerformCardClick ? "button" : undefined}
      tabIndex={canPerformCardClick ? 0 : undefined}
      draggable
      onClick={canPerformCardClick ? performCardClick : undefined}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-ward-hand-card", JSON.stringify({
          playerId: player.id,
          cardInstanceId: card.instanceId,
          cardId: card.cardId
        }));
      }}
      onKeyDown={event => {
        if (!canPerformCardClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          performCardClick();
        }
      }}
      title="Click to play when legal, or drag to a matching board zone"
    >
      <MatchCardImage match={match} card={card} />

      <div className="hand-card-body">
        <strong>{getCardName(match, card)}</strong>
        <span>{match.cardCatalog[card.cardId]?.cardType}</span>

        {discardRequiredForThisPlayer && (
          <span className="hand-card-action-note discard">Click or drag to cemetery</span>
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
          <div className="sacrifice-box" onClick={event => event.stopPropagation()}>
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
                <span
                  className={selected ? "sacrifice-chip selected" : "sacrifice-chip"}
                  key={candidate.instanceId}
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggleSacrifice(card.instanceId, candidate.instanceId)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleSacrifice(card.instanceId, candidate.instanceId);
                    }
                  }}
                >
                  {selected ? "Selected: " : ""}
                  {isPrimarySacrifice ? "Field Primary: " : "Hand: "}
                  {getCardName(match, candidate)}
                </span>
              );
            })}
          </div>
        )}

        {isCreature(match, card) && canPlayPrimaryNow && (
          <span className={isPlayableCreature ? "hand-card-action-note" : "hand-card-action-note blocked"}>
            {isPlayableCreature ? "Click or drag to Primary" : "Select sacrifices first"}
          </span>
        )}

        {isMagic(match, card) && canPlayMagicNow && (
          <>
            {isSilenceCard && !silenceCanPayCost && (
              <div className="warning-box compact-warning">
                Silence From The Grave requires 1 other Magic card in hand to discard before it can enter the Magic Chain.
              </div>
            )}
            <span className={silenceCanPayCost ? "hand-card-action-note" : "hand-card-action-note blocked"}>
              {silenceCanPayCost ? "Click or drag to Magic" : "Needs another Magic card"}
            </span>
          </>
        )}

        {isChainLightningMagic(match, card) && canPlayLightningResponse && (
          <span className="hand-card-action-note lightning">Click to respond</span>
        )}

        {isBattleResponseCard && canPlayBattleResponse && (
          <span className="hand-card-action-note lightning">Click for battle response</span>
        )}
      </div>

      <div className="card-hover-preview hand-hover-preview" aria-hidden="true">
        <div className="card-hover-preview-art">
          <MatchCardImage match={match} card={card} />
        </div>
        <div className="card-hover-preview-copy">
          <strong>{getCardName(match, card)}</strong>
          <span>{match.cardCatalog[card.cardId]?.cardType}</span>
          {isCreature(match, card) && (
            <>
              <span>{getCreatureStatsLine(match, card)}</span>
              <span>Required Sacrifices: {requiredSacrifices}</span>
            </>
          )}
          {isMagic(match, card) && (
            <>
              <span>{getMagicLine(match, card)}</span>
              <span>{getCardText(match, card)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
