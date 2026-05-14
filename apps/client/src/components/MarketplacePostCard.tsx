import { MARKETPLACE_LISTING_VARIANT_LABELS, MARKETPLACE_STATUS_LABELS, formatCurrencyUsd, type MarketplaceListingKind, type MarketplacePostStatus } from "../marketplaceHelpers";

export type MarketplacePost = {
  id: string;
  discordHandle: string;
  title: string;
  description: string;
  status: MarketplacePostStatus;
  haveItems: string[];
  needItems: string[];
  listingKinds: MarketplaceListingKind[];
  salePrice?: number;
  note?: string;
};

export function MarketplacePostCard({ post }: { post: MarketplacePost }) {
  return (
    <article className="marketplace-card">
      <div className="marketplace-post-header">
        <h3>{post.title}</h3>
        <span className="marketplace-status-pill">{MARKETPLACE_STATUS_LABELS[post.status]}</span>
      </div>
      <p>{post.description}</p>
      <p><strong>Discord:</strong> {post.discordHandle}</p>
      <p><strong>Mode:</strong> {post.listingKinds.map(kind => MARKETPLACE_LISTING_VARIANT_LABELS[kind]).join(" / ")}</p>
      {typeof post.salePrice === "number" && <p><strong>Price:</strong> {formatCurrencyUsd(post.salePrice)}</p>}
      {!!post.note && <p><strong>Note:</strong> {post.note}</p>}
      <div className="marketplace-columns">
        <div><strong>Have</strong><ul>{post.haveItems.map(item => <li key={item}>{item}</li>)}</ul></div>
        <div><strong>Need</strong><ul>{post.needItems.map(item => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </article>
  );
}
