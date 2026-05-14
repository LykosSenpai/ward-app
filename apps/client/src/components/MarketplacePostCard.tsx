import { MARKETPLACE_LISTING_VARIANT_LABELS, MARKETPLACE_STATUS_LABELS, formatCurrencyUsd, getMarketplaceVariantLabel, type MarketplaceListingKind, type MarketplacePostLineItem, type MarketplacePostStatus } from "../marketplaceHelpers";
import type { CardLibraryCardSummary } from "../clientTypes";
import { CardImageThumbnail } from "./CardImagePreview";

export type MarketplacePost = {
  id: string;
  userId?: string;
  displayName?: string;
  discordHandle: string;
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

type Props = {
  post: MarketplacePost;
  cardById?: Map<string, CardLibraryCardSummary>;
  isMine?: boolean;
};

function getLineItemKey(item: string | MarketplacePostLineItem): string {
  if (typeof item === "string") return item;
  return `${item.cardId}:${item.variant ?? "default"}:${item.quantity}`;
}

function MarketplaceLineItem({ item, cardById }: { item: string | MarketplacePostLineItem; cardById?: Map<string, CardLibraryCardSummary> }) {
  if (typeof item === "string") {
    return <li>{item}</li>;
  }

  const card = cardById?.get(item.cardId);
  return (
    <li className="marketplace-line-card">
      {card ? <CardImageThumbnail card={card} className="marketplace-line-thumb" /> : <span className="marketplace-line-thumb missing">{item.name?.slice(0, 1) ?? "?"}</span>}
      <span>
        <strong>{card?.name ?? item.name ?? item.cardId}</strong>
        <small>{getMarketplaceVariantLabel(item.variant)} x{item.quantity}</small>
      </span>
    </li>
  );
}

export function MarketplacePostCard({ post, cardById, isMine = false }: Props) {
  return (
    <article className="marketplace-card">
      <div className="marketplace-post-header">
        <h3>{post.title}</h3>
        <div className="marketplace-post-pills">
          {isMine ? <span className="marketplace-status-pill mine">Your post</span> : null}
          <span className="marketplace-status-pill">{MARKETPLACE_STATUS_LABELS[post.status]}</span>
        </div>
      </div>
      <p>{post.description}</p>
      <p><strong>Posted by:</strong> {post.displayName ?? "Player"} · <strong>Discord:</strong> {post.discordHandle}</p>
      <p><strong>Mode:</strong> {post.listingKinds.map(kind => MARKETPLACE_LISTING_VARIANT_LABELS[kind]).join(" / ")}</p>
      {typeof post.salePrice === "number" && <p><strong>Price:</strong> {formatCurrencyUsd(post.salePrice)}</p>}
      {!!post.note && <p><strong>Note:</strong> {post.note}</p>}
      <div className="marketplace-columns">
        <div><strong>Have</strong><ul>{post.haveItems.length ? post.haveItems.map(item => <MarketplaceLineItem key={getLineItemKey(item)} item={item} cardById={cardById} />) : <li className="muted">Nothing listed.</li>}</ul></div>
        <div><strong>Need</strong><ul>{post.needItems.length ? post.needItems.map(item => <MarketplaceLineItem key={getLineItemKey(item)} item={item} cardById={cardById} />) : <li className="muted">Nothing listed.</li>}</ul></div>
      </div>
    </article>
  );
}
