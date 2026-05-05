import type { CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import {
  getAttachedCreatureLabel,
  getCardName,
  getCardText,
  getMagicLine,
  isEquipMagic
} from "../../gameViewHelpers";

type AttachTargetKind = "PRIMARY_CREATURE" | "LIMITED_SUMMON";

type AttachTarget = {
  key: string;
  label: string;
  playerId: string;
  creatureInstanceId: string;
  targetKind: AttachTargetKind;
};

function getAttachTargets(match: AppMatchState): AttachTarget[] {
  return match.players.flatMap(targetPlayer => {
    const targets: AttachTarget[] = [];

    if (targetPlayer.field.primaryCreature) {
      targets.push({
        key: `${targetPlayer.id}:primary:${targetPlayer.field.primaryCreature.instanceId}`,
        label: `${targetPlayer.displayName} Primary: ${getCardName(
          match,
          targetPlayer.field.primaryCreature
        )}`,
        playerId: targetPlayer.id,
        creatureInstanceId: targetPlayer.field.primaryCreature.instanceId,
        targetKind: "PRIMARY_CREATURE"
      });
    }

    for (const limitedSummon of targetPlayer.field.limitedSummons) {
      targets.push({
        key: `${targetPlayer.id}:limited:${limitedSummon.instanceId}`,
        label: `${targetPlayer.displayName} Limited: ${getCardName(match, limitedSummon)}`,
        playerId: targetPlayer.id,
        creatureInstanceId: limitedSummon.instanceId,
        targetKind: "LIMITED_SUMMON"
      });
    }

    return targets;
  });
}

export function MagicSlotsZone({
  match,
  player,
  anyDiscardRequired,
  onAttachEquipMagic,
  onDestroyMagic
}: {
  match: AppMatchState;
  player: PlayerState;
  anyDiscardRequired: boolean;
  onAttachEquipMagic: (
    magicCardInstanceId: string,
    targetPlayerId: string,
    targetCreatureInstanceId: string,
    targetKind: AttachTargetKind
  ) => void;
  onDestroyMagic: (cardInstanceId: string) => void;
}) {
  return (
    <section className="zone-box">
      <h3>Magic Slots</h3>

      {player.field.magicSlots.length === 0 ? (
        <p className="empty-zone">No Infinite Magic cards on field.</p>
      ) : (
        <div className="magic-slot-list">
          {player.field.magicSlots.map(card => (
            <MagicSlotCard
              key={card.instanceId}
              match={match}
              card={card}
              anyDiscardRequired={anyDiscardRequired}
              onAttachEquipMagic={onAttachEquipMagic}
              onDestroyMagic={onDestroyMagic}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MagicSlotCard({
  match,
  card,
  anyDiscardRequired,
  onAttachEquipMagic,
  onDestroyMagic
}: {
  match: AppMatchState;
  card: CardInstance;
  anyDiscardRequired: boolean;
  onAttachEquipMagic: (
    magicCardInstanceId: string,
    targetPlayerId: string,
    targetCreatureInstanceId: string,
    targetKind: AttachTargetKind
  ) => void;
  onDestroyMagic: (cardInstanceId: string) => void;
}) {
  const interactionDisabled =
    !!match.pendingPrompt ||
    !!match.pendingChain ||
    !!match.pendingEffectTargetPrompt ||
    anyDiscardRequired ||
    !!match.setup.primaryReplacementRequiredForPlayerId;
  const attachTargets = getAttachTargets(match);
  const isWaitingForSourceLinkedPrompt =
    match.pendingEffectTargetPrompt?.sourceCardInstanceId === card.instanceId &&
    [
      "SUMMON_LIMITED_CREATURE_AND_EQUIP",
      "SUMMON_FROM_CEMETERY_AND_EQUIP"
    ].includes(match.pendingEffectTargetPrompt.actionType);

  return (
    <div className="mini-card magic-card">
      <strong>{getCardName(match, card)}</strong>
      <span>{getMagicLine(match, card)}</span>

      {isWaitingForSourceLinkedPrompt && (
        <span className="magic-text">
          Waiting for the Limited Summon target. This card will attach automatically.
        </span>
      )}

      {isEquipMagic(match, card) && !isWaitingForSourceLinkedPrompt && (
        <div className="attachment-box">
          <span className="label">Attachment</span>
          <strong>{getAttachedCreatureLabel(match, card.attachedToInstanceId)}</strong>

          {!card.attachedToInstanceId && (
            <div className="attach-target-list">
              {attachTargets.length === 0 ? (
                <div className="empty-zone">No valid creature targets.</div>
              ) : (
                attachTargets.map(target => (
                  <button
                    key={target.key}
                    onClick={() =>
                      onAttachEquipMagic(
                        card.instanceId,
                        target.playerId,
                        target.creatureInstanceId,
                        target.targetKind
                      )
                    }
                    disabled={interactionDisabled}
                  >
                    Attach to {target.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <span className="magic-text">{getCardText(match, card)}</span>

      <button
        className="destroy-magic-button"
        onClick={() => onDestroyMagic(card.instanceId)}
        disabled={interactionDisabled}
      >
        Destroy / Remove Magic
      </button>
    </div>
  );
}
