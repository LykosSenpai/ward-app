import type { CardInstance, GameEvent, PlayerState, WardEngineEffect } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { getCardName } from "../gameViewHelpers";

type AvailableEffectsPanelProps = {
  match: AppMatchState;
  player: PlayerState;
  onActivateEffect: (sourceInstanceId: string, effectId: string) => void;
};

type EffectSource = {
  card: CardInstance;
  sourceZone: "PRIMARY_CREATURE" | "MAGIC_SLOT";
  sourceName: string;
  effects: WardEngineEffect[];
};

type RevealedCard = {
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  cardType: "CREATURE" | "MAGIC";
};

type RevealPayload = {
  sourceCardName?: string;
  sourceCardInstanceId?: string;
  effectId?: string;
  viewerPlayerId?: string;
  viewerPlayerName?: string;
  revealedPlayerId?: string;
  revealedPlayerName?: string;
  revealedCards?: RevealedCard[];
};

function getEffectText(effect: WardEngineEffect): string {
  return [
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isRevealOpponentHandEffect(effect: WardEngineEffect): boolean {
  const text = getEffectText(effect);

  return (
    effect.actionType === "APPLY_PLAY_RESTRICTION" &&
    text.includes("opponent") &&
    text.includes("hand") &&
    (text.includes("reveal") || text.includes("show"))
  );
}

function isActivatedRollEffect(effect: WardEngineEffect): boolean {
  return (effect.trigger ?? "").trim().toUpperCase() === "DURING_YOUR_TURN_ACTIVATED";
}

function isSupportedEffect(effect: WardEngineEffect): boolean {
  return isRevealOpponentHandEffect(effect) || isActivatedRollEffect(effect);
}

function getEffectLabel(effect: WardEngineEffect): string {
  if (isRevealOpponentHandEffect(effect)) {
    return "Reveal opponent hand";
  }

  return effect.actionText ?? effect.value ?? effect.actionType;
}

function getEffectDisabledReason(
  match: AppMatchState,
  player: PlayerState,
  source: EffectSource,
  effect: WardEngineEffect
): string | undefined {
  if ((match.status ?? "ACTIVE") === "COMPLETE") {
    return "Match is complete.";
  }

  if (source.card.controllerPlayerId !== player.id) {
    return "You do not control this card.";
  }

  if (source.card.effectsSuppressed) {
    return "This card's effects are suppressed.";
  }

  if (match.pendingPrompt) {
    return "Resolve the pending reveal/redraw prompt first.";
  }

  if (match.pendingEffectTargetPrompt) {
    return "Resolve the pending effect target first.";
  }

  if (match.pendingChain) {
    return "Resolve the Magic Chain first.";
  }

  if (match.pendingBattle && match.pendingBattle.status !== "COMPLETE") {
    return "Finish the pending battle first.";
  }

  if (isActivatedRollEffect(effect) && match.turn.activePlayerId !== player.id) {
    return "Only usable during this player's turn.";
  }

  return undefined;
}

function getFieldEffectSources(match: AppMatchState, player: PlayerState): EffectSource[] {
  const sources: EffectSource[] = [];

  const addSource = (
    card: CardInstance | undefined,
    sourceZone: "PRIMARY_CREATURE" | "MAGIC_SLOT"
  ) => {
    if (!card) return;

    const definition = match.cardCatalog[card.cardId];
    const effects = definition?.effects as WardEngineEffect[] | undefined;

    if (!effects || effects.length === 0) {
      return;
    }

    sources.push({
      card,
      sourceZone,
      sourceName: getCardName(match, card),
      effects
    });
  };

  addSource(player.field.primaryCreature, "PRIMARY_CREATURE");

  for (const magic of player.field.magicSlots) {
    addSource(magic, "MAGIC_SLOT");
  }

  return sources;
}

function isRevealPayload(value: unknown): value is RevealPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as RevealPayload;
  return Array.isArray(payload.revealedCards);
}

function getLatestRevealForPlayer(
  match: AppMatchState,
  playerId: string
): { event: GameEvent; payload: RevealPayload } | undefined {
  for (let index = match.eventLog.length - 1; index >= 0; index--) {
    const event = match.eventLog[index];

    if (event.type !== "CARD_EFFECT_REVEAL_HAND_RESOLVED") {
      continue;
    }

    if (!isRevealPayload(event.payload)) {
      continue;
    }

    if (event.payload.viewerPlayerId === playerId) {
      return { event, payload: event.payload };
    }
  }

  return undefined;
}

export function AvailableEffectsPanel({
  match,
  player,
  onActivateEffect
}: AvailableEffectsPanelProps) {
  const sources = getFieldEffectSources(match, player);
  const availableEffects = sources.flatMap(source =>
    source.effects
      .filter(isSupportedEffect)
      .map(effect => ({
        source,
        effect,
        disabledReason: getEffectDisabledReason(match, player, source, effect)
      }))
  );
  const latestReveal = getLatestRevealForPlayer(match, player.id);

  if (availableEffects.length === 0 && !latestReveal) {
    return null;
  }

  return (
    <section className="zone-box available-effects-panel">
      <h3>Available Effects</h3>

      {availableEffects.length === 0 ? (
        <p className="empty-zone">No engine-enabled field effects available.</p>
      ) : (
        <div className="available-effect-list">
          {availableEffects.map(({ source, effect, disabledReason }) => (
            <div className="available-effect-row" key={`${source.card.instanceId}:${effect.id}`}>
              <div className="available-effect-copy">
                <strong>{source.sourceName}</strong>
                <span>
                  {source.sourceZone.replaceAll("_", " ")} | {effect.trigger ?? "Effect"} | {effect.actionType}
                </span>
                {(effect.actionText || effect.value) && (
                  <small>{effect.actionText ?? effect.value}</small>
                )}
                {disabledReason && <small className="effect-disabled-reason">{disabledReason}</small>}
              </div>

              <button
                type="button"
                onClick={() => onActivateEffect(source.card.instanceId, effect.id)}
                disabled={!!disabledReason}
              >
                {getEffectLabel(effect)}
              </button>
            </div>
          ))}
        </div>
      )}

      {latestReveal && (
        <div className="revealed-hand-panel">
          <div className="revealed-hand-header">
            <strong>{latestReveal.payload.revealedPlayerName ?? "Opponent"} revealed hand</strong>
            <span>
              Source: {latestReveal.payload.sourceCardName ?? "Card effect"} | Event #{latestReveal.event.sequenceNumber}
            </span>
          </div>

          {latestReveal.payload.revealedCards && latestReveal.payload.revealedCards.length > 0 ? (
            <div className="revealed-card-list">
              {latestReveal.payload.revealedCards.map(card => (
                <div className="revealed-card-pill" key={card.cardInstanceId}>
                  {card.cardName} <span>{card.cardType}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-zone">No cards in revealed hand.</p>
          )}
        </div>
      )}
    </section>
  );
}
