import { useEffect, useMemo, useState } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { MarketplacePostCard, type MarketplacePost, type MarketplacePostMatchLine, type MarketplacePostMatchSummary } from "./MarketplacePostCard";
import { MarketplacePostEditor, type MarketplacePostDraft } from "./MarketplacePostEditor";
import { ModalPanel } from "./ui/ModalPanel";
import { getMarketplaceVariantLabel, type MarketplacePostLineItem, type MarketplacePostStatus } from "../marketplaceHelpers";
import { socket } from "../socket";

type Props = {
  authUser: AuthUser;
  cardLibrary: CardLibraryCardSummary[];
};

type MarketplaceFeedSort = "UPDATED" | "GEN_ASC" | "GEN_DESC";
type MarketplaceServerMatchType = "THEY_HAVE_WHAT_I_NEED" | "I_HAVE_WHAT_THEY_NEED" | "MUTUAL_TRADE_MATCH";
type MarketplaceServerMatch = {
  type: MarketplaceServerMatchType;
  postId: string;
  matchedItems: Array<{ cardId: string; variant?: string; matchedQuantity: number }>;
  reciprocalMatchedItems?: Array<{ cardId: string; variant?: string; matchedQuantity: number }>;
};
type MarketplaceServerMatchGroup = {
  postId: string;
  matches: MarketplaceServerMatch[];
};

function lineItem(card: CardLibraryCardSummary | undefined, variant: string, quantity: number): MarketplacePostLineItem {
  return {
    cardId: card?.id ?? `sample-${variant}`,
    name: card?.name ?? "Sample Card",
    variant,
    quantity,
    trade: true
  };
}

function buildTestMarketplacePosts(cardLibrary: CardLibraryCardSummary[]): MarketplacePost[] {
  const cards = cardLibrary.slice(0, 9);
  if (cards.length === 0) return [];

  return [
    {
      id: "test-marketplace-trade-kit",
      userId: "__test_marketplace__1",
      displayName: "Test Trader",
      isTestPost: true,
      discordHandle: "test-trader",
      title: "Gen starter trade bundle",
      description: "A sample post with several available cards and a short want list.",
      status: "OPEN",
      haveItems: [lineItem(cards[0], "default", 2), lineItem(cards[1], "holo", 1), lineItem(cards[2], "zero-art", 1)],
      needItems: [lineItem(cards[3], "default", 1), lineItem(cards[4], "zero-art-holo", 1)],
      listingKinds: ["TRADE"],
      note: "Preview data for layout testing."
    },
    {
      id: "test-marketplace-sale-holo",
      userId: "__test_marketplace__2",
      displayName: "Preview Seller",
      isTestPost: true,
      discordHandle: "preview-seller",
      title: "Holo singles available",
      description: "A sample sale/trade post to exercise price and mixed card grids.",
      status: "OPEN",
      haveItems: [lineItem(cards[5], "holo", 1), lineItem(cards[6], "zero-art-holo", 1), lineItem(cards[7], "default", 3)],
      needItems: [],
      listingKinds: ["TRADE", "SALE"],
      salePrice: 18,
      note: "Can trade or sell."
    },
    {
      id: "test-marketplace-needs",
      userId: "__test_marketplace__3",
      displayName: "Completion Tester",
      isTestPost: true,
      discordHandle: "completion-test",
      title: "Trying to finish Zero variants",
      description: "A sample need-heavy post for checking larger Need grids.",
      status: "PENDING",
      haveItems: [lineItem(cards[8], "default", 1)],
      needItems: [lineItem(cards[0], "zero-art", 1), lineItem(cards[1], "zero-art", 1), lineItem(cards[2], "zero-art-holo", 1), lineItem(cards[3], "holo", 2)],
      listingKinds: ["TRADE"],
      note: "Pending badge preview."
    }
  ];
}

function parseGeneration(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function getLineItemCard(item: string | MarketplacePostLineItem, cardById: Map<string, CardLibraryCardSummary>): CardLibraryCardSummary | undefined {
  if (typeof item === "string") return undefined;
  return cardById.get(item.cardId);
}

function getPostGeneration(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): number | undefined {
  const generations = [...post.haveItems, ...post.needItems]
    .map(item => getLineItemCard(item, cardById))
    .map(card => parseGeneration(card?.generation))
    .filter((generation): generation is number => typeof generation === "number" && Number.isFinite(generation));

  return generations.length > 0 ? Math.min(...generations) : undefined;
}

function getPostSearchText(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): string {
  const itemText = [...post.haveItems, ...post.needItems].flatMap(item => {
    if (typeof item === "string") return [item];

    const card = cardById.get(item.cardId);
    return [
      item.cardId,
      item.name,
      item.variant,
      getMarketplaceVariantLabel(item.variant),
      card?.id,
      card?.name,
      card?.cardNumber,
      card?.generation ? `gen ${card.generation}` : undefined,
      card?.generation ? `generation ${card.generation}` : undefined,
      card?.rarity,
      card?.cardType
    ];
  });

  return [
    post.title,
    post.description,
    post.displayName,
    post.discord?.globalName,
    post.discord?.username,
    post.discordHandle,
    post.note,
    post.status,
    ...post.listingKinds,
    ...itemText
  ].filter(Boolean).join(" ").toLowerCase();
}

function sortMarketplacePosts(posts: MarketplacePost[], sort: MarketplaceFeedSort, cardById: Map<string, CardLibraryCardSummary>): MarketplacePost[] {
  const sorted = [...posts];
  if (sort === "UPDATED") {
    return sorted.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  return sorted.sort((a, b) => {
    const aGeneration = getPostGeneration(a, cardById);
    const bGeneration = getPostGeneration(b, cardById);
    const aRank = aGeneration ?? Number.POSITIVE_INFINITY;
    const bRank = bGeneration ?? Number.POSITIVE_INFINITY;
    const generationOrder = sort === "GEN_ASC" ? aRank - bRank : bRank - aRank;

    if (generationOrder !== 0) return generationOrder;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

function getMatchLineFromServer(
  item: { cardId: string; variant?: string; matchedQuantity: number },
  cardById: Map<string, CardLibraryCardSummary>
): MarketplacePostMatchLine {
  return {
    cardId: item.cardId,
    variant: item.variant,
    quantity: item.matchedQuantity,
    name: cardById.get(item.cardId)?.name ?? item.cardId
  };
}

function buildMatchSummaries(
  groups: MarketplaceServerMatchGroup[],
  posts: MarketplacePost[],
  cardById: Map<string, CardLibraryCardSummary>
): Map<string, MarketplacePostMatchSummary[]> {
  const postById = new Map(posts.map(post => [post.id, post]));

  return new Map(groups.map(group => [
    group.postId,
    group.matches.map(match => {
      const linkedPost = postById.get(match.postId);
      const matchedLines = match.matchedItems.map(item => getMatchLineFromServer(item, cardById));
      const reciprocalLines = (match.reciprocalMatchedItems ?? []).map(item => getMatchLineFromServer(item, cardById));
      return {
        postId: match.postId,
        displayName: linkedPost?.displayName ?? "Player",
        theyHave: match.type === "THEY_HAVE_WHAT_I_NEED" || match.type === "MUTUAL_TRADE_MATCH" ? matchedLines : [],
        theyNeed: match.type === "I_HAVE_WHAT_THEY_NEED" ? matchedLines : reciprocalLines
      };
    })
  ]));
}

export function MarketplacePage({ authUser, cardLibrary }: Props) {
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const [matchGroups, setMatchGroups] = useState<MarketplaceServerMatchGroup[]>([]);
  const [editingPost, setEditingPost] = useState<MarketplacePost | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [feedSearch, setFeedSearch] = useState("");
  const [feedSort, setFeedSort] = useState<MarketplaceFeedSort>("UPDATED");
  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const testPosts = useMemo(() => import.meta.env.DEV ? buildTestMarketplacePosts(cardLibrary) : [], [cardLibrary]);
  const canPost = !!authUser.discord?.userId;
  const myPosts = useMemo(() => posts.filter(post => post.userId === authUser.id), [authUser.id, posts]);
  const otherPosts = useMemo(() => [...posts.filter(post => post.userId !== authUser.id), ...testPosts], [authUser.id, posts, testPosts]);
  const visibleOtherPosts = useMemo(() => otherPosts.filter(post => post.status !== "CLOSED"), [otherPosts]);
  const filteredOtherPosts = useMemo(() => {
    const normalizedSearch = feedSearch.trim().toLowerCase();
    const filtered = normalizedSearch
      ? visibleOtherPosts.filter(post => getPostSearchText(post, cardById).includes(normalizedSearch))
      : visibleOtherPosts;

    return sortMarketplacePosts(filtered, feedSort, cardById);
  }, [cardById, feedSearch, feedSort, visibleOtherPosts]);
  const matchesByPostId = useMemo(() => {
    return buildMatchSummaries(matchGroups, [...myPosts, ...visibleOtherPosts], cardById);
  }, [cardById, matchGroups, myPosts, visibleOtherPosts]);

  useEffect(() => {
    const onPosts = (incoming: MarketplacePost[]) => setPosts(incoming);
    const onMatches = (incoming: MarketplaceServerMatchGroup[]) => setMatchGroups(incoming);
    socket.on("marketplace:posts", onPosts);
    socket.on("marketplace:matches", onMatches);
    socket.emit("marketplace:listPosts");
    socket.emit("marketplace:listMatches");
    return () => {
      socket.off("marketplace:posts", onPosts);
      socket.off("marketplace:matches", onMatches);
    };
  }, []);

  const saveDraft = (draft: MarketplacePostDraft) => {
    const allItems = [...draft.haveItems, ...draft.needItems];
    const listingKinds = [
      allItems.some(item => item.trade !== false) ? "TRADE" : null,
      allItems.some(item => item.sale) ? "SALE" : null
    ].filter(Boolean) as ("TRADE"|"SALE")[];
    const next: MarketplacePost = {
      id: editingPost?.id ?? `${Date.now()}`,
      title: draft.title.trim(),
      description: draft.description.trim(),
      status: draft.status,
      haveItems: draft.haveItems,
      needItems: draft.needItems,
      listingKinds,
      salePrice: draft.salePrice.trim() ? Number(draft.salePrice) : undefined,
      note: draft.note.trim() || undefined
    };
    if (editingPost) {
      socket.emit("marketplace:updatePost", next);
      setEditingPost(null);
    } else {
      socket.emit("marketplace:createPost", next);
    }
    setEditorOpen(false);
  };

  const editingDraft = useMemo<MarketplacePostDraft | undefined>(() => {
    if (!editingPost) return undefined;
    const normalizeItems = (items: MarketplacePost["haveItems"]): MarketplacePostLineItem[] => items
      .filter((item): item is MarketplacePostLineItem => typeof item === "object" && item !== null && "cardId" in item)
      .map(item => ({
        ...item,
        quantity: Math.max(1, Math.floor(item.quantity ?? 1)),
        trade: item.trade ?? editingPost.listingKinds.includes("TRADE"),
        sale: item.sale ?? false
      }));

    return {
      title: editingPost.title,
      description: editingPost.description,
      status: editingPost.status,
      haveItems: normalizeItems(editingPost.haveItems),
      needItems: normalizeItems(editingPost.needItems),
      tradeEnabled: editingPost.listingKinds.includes("TRADE"),
      saleEnabled: editingPost.listingKinds.includes("SALE"),
      salePrice: typeof editingPost.salePrice === "number" ? `${editingPost.salePrice}` : "",
      note: editingPost.note ?? ""
    };
  }, [editingPost]);

  function startEditingPost(post: MarketplacePost) {
    if (!canPost) return;
    setEditingPost(post);
    setEditorOpen(true);
  }

  function startCreatingPost() {
    if (!canPost) return;
    setEditingPost(null);
    setEditorOpen(true);
  }

  function changePostStatus(post: MarketplacePost, status: MarketplacePostStatus) {
    socket.emit("marketplace:updatePost", { ...post, status });
  }

  return (
    <section className="marketplace-page">
      <header className="marketplace-header marketplace-card">
        <div className="marketplace-header-row">
          <div>
            <h2>Marketplace</h2>
            <p>Post the cards you have, the cards you need, or both. Payments, shipping, postage, addresses, and final trade terms are handled outside the website.</p>
            <p>Signed in as <strong>{authUser.displayName}</strong>.</p>
          </div>
          <button type="button" className="marketplace-create-post-button" onClick={startCreatingPost} disabled={!canPost}>
            Create Post
          </button>
        </div>
        {!canPost ? <p className="subtitle">Connect Discord from your profile to create or edit marketplace posts.</p> : null}
      </header>

      {editorOpen ? (
        <ModalPanel title={editingPost ? "Edit Marketplace Post" : "Create Marketplace Post"} onClose={() => { setEditorOpen(false); setEditingPost(null); }} wide>
          <div className="marketplace-editor-modal-body">
            <MarketplacePostEditor
              key={editingPost?.id ?? "create"}
              cardLibrary={cardLibrary}
              initialDraft={editingDraft}
              mode={editingPost ? "edit" : "create"}
              onCancelEdit={() => { setEditorOpen(false); setEditingPost(null); }}
              onSave={saveDraft}
            />
          </div>
        </ModalPanel>
      ) : null}

      <details className="marketplace-list marketplace-collapsible-list" open>
        <summary className="marketplace-list-heading">
          <h3>My Posts</h3>
          <span>{myPosts.length}</span>
        </summary>
        {myPosts.length === 0 ? <p className="subtitle">You have no marketplace posts yet.</p> : (
          <div className="marketplace-post-grid">
            {myPosts.map(post => <MarketplacePostCard key={post.id} post={post} cardById={cardById} isMine onEdit={startEditingPost} onStatusChange={changePostStatus} matches={matchesByPostId.get(post.id)} />)}
          </div>
        )}
      </details>
      <details className="marketplace-list marketplace-collapsible-list" open>
        <summary className="marketplace-list-heading">
          <h3>Marketplace Feed</h3>
          <span>{filteredOtherPosts.length === visibleOtherPosts.length ? visibleOtherPosts.length : `${filteredOtherPosts.length}/${visibleOtherPosts.length}`}</span>
        </summary>
        <div className="marketplace-feed-controls">
          <label htmlFor="marketplace-feed-search">
            Search cards
            <input
              id="marketplace-feed-search"
              type="search"
              value={feedSearch}
              onChange={event => setFeedSearch(event.target.value)}
              placeholder="Card name, id, variant, or gen"
            />
          </label>
          <label htmlFor="marketplace-feed-sort">
            Sort
            <select id="marketplace-feed-sort" value={feedSort} onChange={event => setFeedSort(event.target.value as MarketplaceFeedSort)}>
              <option value="UPDATED">Newest activity</option>
              <option value="GEN_ASC">Generation low to high</option>
              <option value="GEN_DESC">Generation high to low</option>
            </select>
          </label>
        </div>
        {visibleOtherPosts.length === 0 ? <p className="subtitle">No public listings from other players yet.</p> : filteredOtherPosts.length === 0 ? <p className="subtitle">No marketplace posts match that search.</p> : (
          <div className="marketplace-post-grid">
            {filteredOtherPosts.map(post => <MarketplacePostCard key={post.id} post={post} cardById={cardById} matches={matchesByPostId.get(post.id)} />)}
          </div>
        )}
      </details>
    </section>
  );
}
