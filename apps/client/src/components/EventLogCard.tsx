import type { AppMatchState } from "../clientTypes";
import { getPlayerName } from "../gameViewHelpers";

type EventLogCardProps = {
  match: AppMatchState;
};

export function EventLogCard({ match }: EventLogCardProps) {
  return (
    <section className="card event-log-card">
      <h2>Event Log</h2>

      {match.eventLog.length === 0 ? (
        <p className="empty-zone">No events yet.</p>
      ) : (
        <div className="event-log-list">
          {match.eventLog
            .slice(-12)
            .reverse()
            .map(event => (
              <div className="event-log-entry" key={event.id}>
                <div>
                  <strong>#{event.sequenceNumber}</strong> <span>{event.type}</span>
                </div>

                {event.playerId && (
                  <div className="event-meta">
                    Player: {getPlayerName(match, event.playerId)}
                  </div>
                )}

                {event.payload !== undefined && (
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
