import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { getCardName, getPlayerName } from "../gameViewHelpers";

type FieldDebugItem = {
  playerId: string;
  playerName: string;
  zone: "Primary" | "Limited";
  card: CardInstance;
};

function getFieldDebugItems(match: AppMatchState): FieldDebugItem[] {
  return match.players.flatMap(player => {
    const items: FieldDebugItem[] = [];

    if (player.field.primaryCreature) {
      items.push({
        playerId: player.id,
        playerName: player.displayName,
        zone: "Primary",
        card: player.field.primaryCreature
      });
    }

    for (const limited of player.field.limitedSummons) {
      items.push({
        playerId: player.id,
        playerName: player.displayName,
        zone: "Limited",
        card: limited
      });
    }

    return items;
  });
}

function getRelevantEvents(match: AppMatchState) {
  return match.eventLog
    .filter(event => /EFFECT|RECURRING|STATUS|MODIFIER|DOT|HOT|DEV_FORCED|DEV_RANDOM/i.test(event.type))
    .slice(-30)
    .reverse();
}

export function EffectDebugPanel({ match }: { match: AppMatchState }) {
  const fieldItems = getFieldDebugItems(match);
  const relevantEvents = getRelevantEvents(match);

  return (
    <section className="effect-debug-panel">
      <section className="card effect-debug-card">
        <h2>Effect Debug Inspector</h2>
        <p>
          Use this panel to verify target routing, duration ownership, active statuses, recurring effects, and recent effect traces.
        </p>

        <div className="effect-debug-turn-grid">
          <span>Active Player: <strong>{getPlayerName(match, match.turn.activePlayerId)}</strong></span>
          <span>Phase: <strong>{match.turn.phase}</strong></span>
          <span>Turn: <strong>{match.turn.turnNumber}</strong></span>
          <span>Cycle: <strong>{match.turn.turnCycleNumber}</strong></span>
        </div>
      </section>

      <section className="card effect-debug-card">
        <h3>Active Runtime State</h3>

        {fieldItems.length === 0 ? (
          <p className="empty-zone">No creatures are on the field.</p>
        ) : (
          <div className="effect-debug-source-list">
            {fieldItems.map(item => {
              const statuses = item.card.activeStatuses ?? [];
              const recurringEffects = item.card.activeRecurringEffects ?? [];
              const statModifiers = item.card.activeStatModifiers ?? [];
              const activeInstances = item.card.activeEffectInstances ?? [];

              return (
                <details className="effect-debug-source" key={item.card.instanceId} open={statuses.length + recurringEffects.length + statModifiers.length + activeInstances.length > 0}>
                  <summary>
                    <strong>{getCardName(match, item.card)}</strong>
                    <span>{item.playerName}  -  {item.zone}</span>
                    <span className="zone-details-badge">
                      {activeInstances.length} active / {statuses.length} status / {recurringEffects.length} recurring / {statModifiers.length} modifier
                    </span>
                  </summary>

                  <div className="effect-debug-section-grid">
                    <div>
                      <h4>Active Effect Instances</h4>
                      {activeInstances.length === 0 ? <p className="empty-zone">None</p> : activeInstances.map(instance => (
                        <pre key={instance.id}>{JSON.stringify(instance, null, 2)}</pre>
                      ))}
                    </div>

                    <div>
                      <h4>Statuses</h4>
                      {statuses.length === 0 ? <p className="empty-zone">None</p> : statuses.map(status => (
                        <pre key={status.id}>{JSON.stringify(status, null, 2)}</pre>
                      ))}
                    </div>

                    <div>
                      <h4>Recurring Effects</h4>
                      {recurringEffects.length === 0 ? <p className="empty-zone">None</p> : recurringEffects.map(effect => (
                        <pre key={effect.id}>{JSON.stringify(effect, null, 2)}</pre>
                      ))}
                    </div>

                    <div>
                      <h4>Stat Modifiers</h4>
                      {statModifiers.length === 0 ? <p className="empty-zone">None</p> : statModifiers.map(modifier => (
                        <pre key={modifier.id}>{JSON.stringify(modifier, null, 2)}</pre>
                      ))}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="card effect-debug-card">
        <h3>Recent Runtime Events</h3>

        {relevantEvents.length === 0 ? (
          <p className="empty-zone">No runtime effect events found yet.</p>
        ) : (
          <div className="event-log-list">
            {relevantEvents.map(event => (
              <div className="event-log-entry" key={event.id}>
                <div>
                  <strong>#{event.sequenceNumber}</strong> <span>{event.type}</span>
                </div>

                {event.playerId && (
                  <div className="event-meta">Player: {getPlayerName(match, event.playerId)}</div>
                )}

                {event.payload !== undefined && <pre>{JSON.stringify(event.payload, null, 2)}</pre>}
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

