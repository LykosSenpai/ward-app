import { useEffect, useMemo, useState } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { MarketplacePostCard, type MarketplacePost } from "./MarketplacePostCard";
import { MarketplacePostEditor, type MarketplacePostDraft } from "./MarketplacePostEditor";
import { socket } from "../socket";

type Props = {
  authUser: AuthUser;
  cardLibrary: CardLibraryCardSummary[];
};

export function MarketplacePage({ authUser, cardLibrary }: Props) {
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const myPosts = useMemo(() => posts.filter(post => post.userId === authUser.id), [authUser.id, posts]);
  const otherPosts = useMemo(() => posts.filter(post => post.userId !== authUser.id), [authUser.id, posts]);

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
      title: draft.title.trim(),
      description: draft.description.trim(),
      status: draft.status,
      haveItems: draft.haveItems,
      needItems: draft.needItems,
      listingKinds,
      salePrice: draft.salePrice.trim() ? Number(draft.salePrice) : undefined,
      note: draft.note.trim() || undefined
    };
    socket.emit("marketplace:createPost", next);
  };

  return (
    <section className="marketplace-page">
      <header className="marketplace-header marketplace-card">
        <h2>Marketplace</h2>
        <p>Post the cards you have, the cards you need, or both. Payments, shipping, postage, addresses, and final trade terms are handled outside the website.</p>
        <p>Signed in as <strong>{authUser.displayName}</strong>.</p>
      </header>
      <MarketplacePostEditor cardLibrary={cardLibrary} onSave={saveDraft} />
      <section className="marketplace-list marketplace-my-posts">
        <div className="marketplace-list-heading">
          <h3>My Posts</h3>
          <span>{myPosts.length}</span>
        </div>
        {myPosts.length === 0 ? <p className="subtitle">You have no marketplace posts yet.</p> : myPosts.map(post => <MarketplacePostCard key={post.id} post={post} cardById={cardById} isMine />)}
      </section>
      <section className="marketplace-list">
        <div className="marketplace-list-heading">
          <h3>Marketplace Feed</h3>
          <span>{otherPosts.length}</span>
        </div>
        {otherPosts.length === 0 ? <p className="subtitle">No public listings from other players yet.</p> : otherPosts.map(post => <MarketplacePostCard key={post.id} post={post} cardById={cardById} />)}
      </section>
    </section>
  );
}
