import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import {
  getCardName,
  getCreatureStatsLine,
  getPlayerName
} from "../../gameViewHelpers";

function getAttachedEquipItems(match: AppMatchState, creatureInstanceId: string) {
  return match.players
    .flatMap(fieldOwner =>
      fieldOwner.field.magicSlots.map(magicCard => ({
        fieldOwner,
        magicCard
      }))
    )
    .filter(item => item.magicCard.attachedToInstanceId === creatureInstanceId);
}

export function CreatureDetails({
  match,
  card,
  showHp = true
}: {
  match: AppMatchState;
  card: CardInstance;
  showHp?: boolean;
}) {
  const attachedEquipItems = getAttachedEquipItems(match, card.instanceId);
  const anchorSource = card.anchorSourceInstanceId
    ? match.players
        .flatMap(fieldOwner => fieldOwner.field.magicSlots)
        .find(magicCard => magicCard.instanceId === card.anchorSourceInstanceId)
    : undefined;

  return (
    <>
      <strong>{getCardName(match, card)}</strong>
      <span>{getCreatureStatsLine(match, card)}</span>

      {showHp && (
        <span>
          HP: {card.currentHp}/{card.baseHp}
        </span>
      )}

      {card.anchorSourceInstanceId && (
        <span className="anchor-source-line">
          Anchored by: {anchorSource ? getCardName(match, anchorSource) : "source card not found"}
        </span>
      )}

      {card.activeStatModifiers && card.activeStatModifiers.length > 0 && (
        <div className="active-modifier-list">
          <span className="label">Active Modifiers</span>

          {card.activeStatModifiers.map(modifier => (
            <div className="active-modifier" key={modifier.id}>
              {modifier.sourceCardName}: {modifier.stat}{" "}
              {modifier.delta > 0 ? `+${modifier.delta}` : modifier.delta}{" "}
              {modifier.durationType === "PERMANENT_UNTIL_SOURCE_REMOVED"
                ? "until source card is removed"
                : `until ${getPlayerName(
                    match,
                    modifier.expiresOnPlayerId ?? ""
                  )}'s turn start #${modifier.expiresAtPlayerTurnStartCount}`}
            </div>
          ))}
        </div>
      )}


      {card.activeStatuses && card.activeStatuses.length > 0 && (
        <div className="active-modifier-list">
          <span className="label">Active Statuses</span>

          {card.activeStatuses.map(status => (
            <div className="active-modifier" key={status.id}>
              {status.sourceCardName}: {status.status}  -  {status.label}{" "}
              {status.durationType === "PERMANENT_UNTIL_SOURCE_REMOVED"
                ? "until source card is removed"
                : `until ${getPlayerName(
                    match,
                    status.expiresOnPlayerId ?? ""
                  )}'s turn start #${status.expiresAtPlayerTurnStartCount}`}
            </div>
          ))}
        </div>
      )}

      {card.activeEffectInstances && card.activeEffectInstances.length > 0 && (
        <div className="active-modifier-list">
          <span className="label">Active Effect Instances</span>

          {card.activeEffectInstances.map(instance => (
            <div className="active-modifier" key={instance.id}>
              {instance.sourceCardName}: {instance.kind}  -  {instance.label}
              {instance.ticksRemaining !== undefined ? ` (${instance.ticksRemaining} tick(s) left)` : ""}
              {instance.diceLimitValue !== undefined ? `  -  ${instance.rollKind ?? "ROLL"} max ${instance.diceLimitValue}D6` : ""}
              {instance.durationType === "TARGET_PLAYER_TURN_STARTS" && instance.expiresOnPlayerId
                ? ` until ${getPlayerName(match, instance.expiresOnPlayerId)}'s turn start #${instance.expiresAtPlayerTurnStartCount}`
                : ""}
            </div>
          ))}
        </div>
      )}

      {card.activeRecurringEffects && card.activeRecurringEffects.length > 0 && (
        <div className="active-modifier-list">
          <span className="label">Recurring Effects</span>

          {card.activeRecurringEffects.map(effect => {
            const nextTickPlayerName = effect.nextTickPlayerId
              ? getPlayerName(match, effect.nextTickPlayerId)
              : undefined;

            return (
              <div className="active-modifier" key={effect.id}>
                {effect.sourceCardName}: {effect.effectType === "DAMAGE_OVER_TIME" ? "DOT" : "HOT"}{" "}
                {effect.amount} HP, {effect.remainingTicks} tick(s) left
                {nextTickPlayerName
                  ? `  -  next tick: ${nextTickPlayerName} Combat Phase end${
                      effect.nextTickTurnStartCount !== undefined
                        ? ` (turn start #${effect.nextTickTurnStartCount})`
                        : ""
                    }`
                  : ""}
              </div>
            );
          })}
        </div>
      )}
      <div className="attached-equip-list">
        <span className="label">Attached Equip Magic</span>

        {attachedEquipItems.length === 0 ? (
          <div className="empty-zone">No attached Equip Magic.</div>
        ) : (
          attachedEquipItems.map(item => (
            <div className="attached-equip" key={item.magicCard.instanceId}>
              {getCardName(match, item.magicCard)} from {item.fieldOwner.displayName}
            </div>
          ))
        )}
      </div>
    </>
  );
}

