import { useEffect, useState } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { AddCardToMarketplaceModal } from "./AddCardToMarketplaceModal";
import { MarketplacePostCard, type MarketplacePost } from "./MarketplacePostCard";
import { MarketplacePostEditor, type MarketplacePostDraft } from "./MarketplacePostEditor";
import { splitManualItems } from "../marketplaceHelpers";
import { socket } from "../socket";

type Props = {
  authUser: AuthUser;
  cardLibrary: CardLibraryCardSummary[];
};

export function MarketplacePage({ authUser, cardLibrary }: Props) {
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const [selectedCard, setSelectedCard] = useState("");

  useEffect(() => {
    const onPosts = (incoming: MarketplacePost[]) => setPosts(incoming);
    socket.on("marketplace:posts", onPosts);
    socket.emit("marketplace:listPosts");
    return () => {
      socket.off("marketplace:posts", onPosts);
    };
  }, []);

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
    socket.emit("marketplace:createPost", next);
    setSelectedCard("");
  };

  return (
    <section className="marketplace-page">
      <header className="marketplace-header marketplace-card">
        <h2>Marketplace</h2>
        <p>WARD Marketplace helps players find trade and sale matches. Payments, shipping, postage, addresses, and final trade terms are handled outside the website. Use Discord to contact the other user and work out the details directly.</p>
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
