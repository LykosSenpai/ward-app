import { useState } from "react";
import { MARKETPLACE_LISTING_VARIANT_LABELS, MARKETPLACE_STATUS_LABELS, formatCurrencyUsd, getMarketplaceVariantLabel, type MarketplaceListingKind, type MarketplacePostLineItem, type MarketplacePostStatus } from "../marketplaceHelpers";
import type { CardLibraryCardSummary } from "../clientTypes";
import { CardImageThumbnail, normalizeCardArtKey } from "./CardImagePreview";
import { ModalPanel } from "./ui/ModalPanel";

export type MarketplacePost = {
  id: string;
  userId?: string;
  displayName?: string;
  isTestPost?: boolean;
  discordHandle?: string;
  discord?: {
    userId: string;
    username: string;
    globalName?: string;
    avatar?: string;
    linkedAt?: string;
  };
  title: string;
  description: string;
  status: MarketplacePostStatus;
  haveItems: Array<string | MarketplacePostLineItem>;
  needItems: Array<string | MarketplacePostLineItem>;
  listingKinds: MarketplaceListingKind[];
  salePrice?: number;
  note?: string;
  updatedAt?: string;
};

export type MarketplacePostMatchLine = {
  cardId: string;
  variant?: string;
  quantity: number;
  name: string;
};

export type MarketplacePostMatchSummary = {
  postId: string;
  displayName: string;
  theyHave: MarketplacePostMatchLine[];
  theyNeed: MarketplacePostMatchLine[];
};

type Props = {
  post: MarketplacePost;
  cardById?: Map<string, CardLibraryCardSummary>;
  isMine?: boolean;
  onEdit?: (post: MarketplacePost) => void;
  onStatusChange?: (post: MarketplacePost, status: MarketplacePostStatus) => void;
  matches?: MarketplacePostMatchSummary[];
  onLineItemContact?: (item: MarketplacePostLineItem) => void;
};

function getLineItemKey(item: string | MarketplacePostLineItem): string {
  if (typeof item === "string") return item;
  return `${item.cardId}:${item.variant ?? "default"}:${item.quantity}`;
}

function getItemQuantity(items: Array<string | MarketplacePostLineItem>): number {
  return items.reduce((total, item) => total + (typeof item === "string" ? 1 : Math.max(1, item.quantity ?? 1)), 0);
}

function MarketplacePostStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <strong>{label}</strong>
      {value}
    </span>
  );
}

function MarketplaceMatchLineList({ title, lines }: { title: string; lines: MarketplacePostMatchLine[] }) {
  if (lines.length === 0) return null;

  return (
    <div className="marketplace-match-line-list">
      <strong>{title}</strong>
      <ul>
        {lines.map(line => (
          <li key={`${line.cardId}:${line.variant ?? "default"}`}>
            {line.name} <span>{getMarketplaceVariantLabel(line.variant)} x{line.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarketplaceLineItem({ item, cardById, onContact }: { item: string | MarketplacePostLineItem; cardById?: Map<string, CardLibraryCardSummary>; onContact?: (item: MarketplacePostLineItem) => void }) {
  if (typeof item === "string") {
    return <li className="marketplace-item-card text-only"><strong>{item}</strong></li>;
  }

  const card = cardById?.get(item.cardId);
  return (
    <li className="marketplace-item-card">
      <span className="marketplace-item-copy">
        <strong>{card?.name ?? item.name ?? item.cardId}</strong>
        <small>{getMarketplaceVariantLabel(item.variant)}</small>
      </span>
      {card ? <CardImageThumbnail card={card} artKey={normalizeCardArtKey(item.variant)} className="marketplace-line-thumb" /> : <span className="marketplace-line-thumb missing">{item.name?.slice(0, 1) ?? "?"}</span>}
      <div className="marketplace-item-bottom-row">
        <span className="marketplace-item-qty">x{item.quantity}</span>
        <span className="marketplace-item-mode">
          {item.trade !== false ? "Trade" : null}
          {item.trade !== false && item.sale ? " / " : null}
          {item.sale ? `Sale${item.price ? ` $${item.price}` : ""}` : null}
          {item.trade === false && !item.sale ? "Unavailable" : null}
        </span>
        {onContact ? <button type="button" className="marketplace-item-inquire-button" onClick={() => onContact(item)}>Ask</button> : null}
      </div>
    </li>
  );
}

function MarketplaceItemSection({
  title,
  items,
  cardById,
  onContact
}: {
  title: string;
  items: Array<string | MarketplacePostLineItem>;
  cardById?: Map<string, CardLibraryCardSummary>;
  onContact?: (item: MarketplacePostLineItem) => void;
}) {
  return (
    <div className="marketplace-item-section">
      <div className="marketplace-item-section-heading">
        <strong>{title}</strong>
        <span>{getItemQuantity(items)}</span>
      </div>
      <ul className="marketplace-item-grid">
        {items.length ? (
          items.map(item => (
            <MarketplaceLineItem
              key={getLineItemKey(item)}
              item={item}
              cardById={cardById}
              onContact={onContact}
            />
          ))
        ) : (
          <li className="muted">Nothing listed.</li>
        )}
      </ul>
    </div>
  );
}

export function MarketplacePostCard({ post, cardById, isMine = false, onEdit, onStatusChange, matches = [], onLineItemContact }: Props) {
  const [contactCopied, setContactCopied] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const haveCount = getItemQuantity(post.haveItems);
  const needCount = getItemQuantity(post.needItems);
  const visibleMatches = matches.slice(0, 3);
  const contactLabel = contactCopied ? "Copied" : "Contact";
  const discordName = post.discord?.globalName || post.discord?.username || post.discordHandle || "";
  const discordProfileUrl = post.discord?.userId ? `https://discord.com/users/${post.discord.userId}` : undefined;

  async function copyContact() {
    const handle = discordName.trim();
    if (!handle) return;

    try {
      await navigator.clipboard?.writeText(handle);
      setContactCopied(true);
      window.setTimeout(() => setContactCopied(false), 1600);
    } catch {
      setContactCopied(false);
    }
  }

  return (
    <article className="marketplace-card marketplace-post-card">
      <div className="marketplace-post-header">
        <h3>{post.title}</h3>
        <div className="marketplace-post-pills">
          {isMine ? <span className="marketplace-status-pill mine">Your post</span> : null}
          {post.isTestPost ? <span className="marketplace-status-pill test">Test post</span> : null}
          <span className="marketplace-status-pill">{MARKETPLACE_STATUS_LABELS[post.status]}</span>
          {isMine && onEdit ? (
            <button type="button" className="marketplace-post-edit-button" onClick={() => onEdit(post)}>
              Edit
            </button>
          ) : null}
        </div>
      </div>
      <p className="marketplace-post-description">{post.description}</p>
      <div className="marketplace-post-meta marketplace-post-short-details">
        <MarketplacePostStat label="Have" value={`${haveCount}`} />
        <MarketplacePostStat label="Need" value={`${needCount}`} />
        <MarketplacePostStat label="Player" value={post.displayName ?? "Player"} />
        <MarketplacePostStat label="Discord" value={discordName ? `Verified: ${discordName}` : "Not linked"} />
        <MarketplacePostStat label="Mode" value={post.listingKinds.map(kind => MARKETPLACE_LISTING_VARIANT_LABELS[kind]).join(" / ")} />
        {typeof post.salePrice === "number" ? <MarketplacePostStat label="Price" value={formatCurrencyUsd(post.salePrice)} /> : null}
      </div>
      <div className="marketplace-post-actions">
        <button
          type="button"
          className="marketplace-contact-button marketplace-view-cards-button"
          aria-haspopup="dialog"
          onClick={() => setCardsOpen(true)}
        >
          View cards
        </button>
        {isMine ? (
          <div className="marketplace-status-controls" aria-label={`${post.title} post status controls`}>
            <span>Status</span>
            {(["OPEN", "PENDING", "CLOSED"] as MarketplacePostStatus[]).map(status => (
              <button
                key={status}
                type="button"
                className={post.status === status ? "active" : ""}
                disabled={!onStatusChange || post.status === status}
                onClick={() => onStatusChange?.(post, status)}
              >
                {MARKETPLACE_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        ) : (
          <div className="marketplace-contact-actions">
            {discordProfileUrl ? <a className="marketplace-contact-button" href={discordProfileUrl} target="_blank" rel="noreferrer">Open Discord</a> : null}
            <button type="button" className="marketplace-contact-button" onClick={copyContact} disabled={!discordName.trim()}>
              {contactLabel}
            </button>
          </div>
        )}
      </div>
      {!!post.note && <p><strong>Note:</strong> {post.note}</p>}
      {visibleMatches.length > 0 ? (
        <div className="marketplace-linked-matches">
          <strong>Auto matches</strong>
          {visibleMatches.map(match => (
            <article key={match.postId}>
              <div className="marketplace-linked-match-heading">
                <span>{match.displayName}</span>
                <small>{match.theyHave.length > 0 && match.theyNeed.length > 0 ? "Mutual trade" : match.theyHave.length > 0 ? "Has cards you need" : "Needs cards you have"}</small>
              </div>
              <MarketplaceMatchLineList title="They have" lines={match.theyHave} />
              <MarketplaceMatchLineList title="They need" lines={match.theyNeed} />
            </article>
          ))}
          {matches.length > visibleMatches.length ? <small>+{matches.length - visibleMatches.length} more linked post{matches.length - visibleMatches.length === 1 ? "" : "s"}</small> : null}
        </div>
      ) : null}
      {cardsOpen ? (
        <ModalPanel title={`Cards in ${post.title}`} onClose={() => setCardsOpen(false)} wide>
          <div className="marketplace-cards-modal-layout">
            <MarketplaceItemSection title="Have" items={post.haveItems} cardById={cardById} onContact={!isMine ? onLineItemContact : undefined} />
            <MarketplaceItemSection title="Need" items={post.needItems} cardById={cardById} />
          </div>
        </ModalPanel>
      ) : null}
    </article>
  );
}
