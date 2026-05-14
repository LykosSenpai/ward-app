import { useEffect, useState } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { AddCardToMarketplaceModal } from "./AddCardToMarketplaceModal";
import { MarketplacePostCard, type MarketplacePost } from "./MarketplacePostCard";
import { MarketplacePostEditor, type MarketplacePostDraft } from "./MarketplacePostEditor";
import { splitManualItems } from "../marketplaceHelpers";

type Props = {
  authUser: AuthUser;
  cardLibrary: CardLibraryCardSummary[];
};

const STORAGE_KEY = "ward_marketplace_posts_v1";

export function MarketplacePage({ authUser, cardLibrary }: Props) {
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const [selectedCard, setSelectedCard] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as MarketplacePost[];
      setPosts(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  }, [posts]);

  const saveDraft = (draft: MarketplacePostDraft) => {
    const listingKinds = [draft.tradeEnabled ? "TRADE" : null, draft.saleEnabled ? "SALE" : null].filter(Boolean) as ("TRADE"|"SALE")[];
    const next: MarketplacePost = {
      id: `${Date.now()}`,
      discordHandle: draft.discordHandle.trim(),
      title: selectedCard ? `${draft.title.trim()} • ${selectedCard}` : draft.title.trim(),
      description: draft.description.trim(),
      status: draft.status,
      haveItems: splitManualItems(draft.haveItemsText),
      needItems: splitManualItems(draft.needItemsText),
      listingKinds,
      salePrice: draft.salePrice.trim() ? Number(draft.salePrice) : undefined,
      note: draft.note.trim() || undefined
    };
    setPosts(prev => [next, ...prev]);
    setSelectedCard("");
  };

  return (
    <section className="marketplace-page">
      <header className="marketplace-header marketplace-card">
        <h2>Marketplace</h2>
        <p>Rollout disclaimer: marketplace posts are community-managed, manually verified, and should be finalized in Discord before exchange.</p>
        <p>Signed in as <strong>{authUser.displayName}</strong>.</p>
      </header>
      <MarketplacePostEditor onSave={saveDraft} />
      <AddCardToMarketplaceModal cards={cardLibrary} onAdd={setSelectedCard} />
      {selectedCard && <p className="marketplace-selected-card">Selected card for next listing: <strong>{selectedCard}</strong></p>}
      <section className="marketplace-list">
        {posts.length === 0 ? <p className="subtitle">No listings yet.</p> : posts.map(post => <MarketplacePostCard key={post.id} post={post} />)}
      </section>
    </section>
  );
}
