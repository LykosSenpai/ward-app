import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  getCardName,
  getCreatureStatsLine,
  getPlayerName,
  isCreature
} from "../gameViewHelpers";
import { MatchCardImage } from "./MatchCardImage";

type ForcedAlSummonPromptCardProps = {
  match: AppMatchState;
  controlledPlayerId?: string;
  compact?: boolean;
  onSummon?: (cardInstanceId: string) => void;
  onMulligan?: () => void;
};

export function ForcedAlSummonPromptCard({
  match,
  controlledPlayerId,
  compact = false,
  onSummon,
  onMulligan
}: ForcedAlSummonPromptCardProps) {
  const prompt = match.pendingPrompt;
  if (!prompt || prompt.type !== "FORCED_AL_SUMMON") {
    return null;
  }

  const promptedPlayer = match.players.find(player => player.id === prompt.targetPlayerId);
  if (!promptedPlayer) {
    return null;
  }

  const canAct = !controlledPlayerId || controlledPlayerId === prompt.controllerPlayerId;
  const validCards = promptedPlayer.hand.filter(card => {
    const definition = match.cardCatalog[card.cardId];
    return isCreature(match, card) && definition?.cardType === "CREATURE" && definition.armorLevel <= prompt.maxArmorLevel;
  });
  const title = `${getPlayerName(match, prompt.targetPlayerId)} must summon AL ${prompt.maxArmorLevel} or lower`;
  const classes = compact
    ? "forced-summon-prompt forced-summon-prompt-compact"
    : "card prompt-card forced-summon-prompt";

  return (
    <section className={classes}>
      <div className="forced-summon-prompt-header">
        <div>
          <span className="label">Foolish Tricks</span>
          <h2>{title}</h2>
        </div>
        {prompt.mulliganCount > 0 ? (
          <span className="match-chip">Mulligan {prompt.mulliganCount}</span>
        ) : null}
      </div>

      {prompt.returnedCardNames.length > 0 ? (
        <p>
          Returned: {prompt.returnedCardNames.slice(0, 4).join(", ")}
          {prompt.returnedCardNames.length > 4 ? ` +${prompt.returnedCardNames.length - 4}` : ""}
        </p>
      ) : null}

      {validCards.length > 0 ? (
        <div className="forced-summon-options">
          {validCards.map((card: CardInstance) => (
            <button
              type="button"
              className="forced-summon-option"
              key={card.instanceId}
              onClick={() => onSummon?.(card.instanceId)}
              disabled={!canAct || !onSummon}
            >
              <MatchCardImage match={match} card={card} />
              <span>
                <strong>{getCardName(match, card)}</strong>
                <small>{getCreatureStatsLine(match, card)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="forced-summon-empty">
          <strong>No valid AL {prompt.maxArmorLevel} or lower creature in hand.</strong>
          <button type="button" onClick={onMulligan} disabled={!canAct || !onMulligan}>
            Mulligan Hand
          </button>
        </div>
      )}

      {!canAct ? (
        <p className="event-meta">
          Waiting for {getPlayerName(match, prompt.controllerPlayerId)}.
        </p>
      ) : null}
    </section>
  );
}
