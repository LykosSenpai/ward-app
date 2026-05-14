import type { MarketplaceMatch, MarketplaceMyMatchesGroup } from "../clientTypes";

type MarketplaceMatchesPanelProps = {
  groups: MarketplaceMyMatchesGroup[];
  onRefresh: () => void;
  onOpenLinkedPost: (postId: string) => void;
};

export function MarketplaceMatchesPanel({ groups, onRefresh, onOpenLinkedPost }: MarketplaceMatchesPanelProps) {
  return (
    <section className="panel-card">
      <header className="panel-card-header">
        <h2>Marketplace Matches</h2>
        <button type="button" className="secondary" onClick={onRefresh}>Refresh Matches</button>
      </header>
      <div className="panel-card-body">
        {groups.length === 0 ? <p>No matches yet.</p> : groups.map(group => (
          <article key={group.postId}>
            <h3>My Post: {group.postId}</h3>
            {group.matches.length === 0 ? <p>No active matches for this post.</p> : group.matches.map((match: MarketplaceMatch) => (
              <div key={`${group.postId}-${match.postId}-${match.type}`}>
                <strong>{match.type}</strong> with <code>{match.postId}</code>
                <ul>
                  {match.matchedItems.map(item => <li key={`${item.cardId}-${item.variant}`}>{item.cardId} ({item.variant}) × {item.matchedQuantity}</li>)}
                </ul>
                {match.linkedPostId ? (
                  <button type="button" className="secondary" onClick={() => onOpenLinkedPost(match.linkedPostId!)}>Open Linked Post</button>
                ) : null}
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
