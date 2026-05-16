import { useEffect, useMemo, useState } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { MarketplacePostCard, type MarketplacePost, type MarketplacePostMatchLine, type MarketplacePostMatchSummary } from "./MarketplacePostCard";
import { MarketplacePostEditor, type MarketplacePostDraft } from "./MarketplacePostEditor";
import { CardImageThumbnail, normalizeCardArtKey } from "./CardImagePreview";
import { ModalPanel } from "./ui/ModalPanel";
import { getMarketplaceVariantLabel, type MarketplacePostLineItem, type MarketplacePostStatus } from "../marketplaceHelpers";
import { socket } from "../socket";

type Props = {
  authUser: AuthUser;
  cardLibrary: CardLibraryCardSummary[];
};

type MarketplaceFeedSort = "UPDATED" | "BEST_MATCH" | "GEN_ASC" | "GEN_DESC" | "PRICE_ASC" | "PRICE_DESC";
type ListingTypeFilter = "ALL" | "TRADE" | "SALE" | "TRADE_OR_SALE";
type AvailabilityFilter = "ACTIVE_ONLY" | "INCLUDING_PENDING" | "ALL";
type MatchPanelTab = "ALL" | "NEED_YOUR_CARDS" | "YOU_NEED" | "MUTUAL";
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

type MatchPanelItem = {
  key: string;
  type: "YOU_NEED_THEIR_CARD" | "THEY_NEED_YOUR_CARD" | "MUTUAL_TRADE";
  badge: string;
  displayName: string;
  explanation: string;
  cards: MarketplacePostMatchLine[];
  actionLabel: string;
  score: number;
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

function getPostCards(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): CardLibraryCardSummary[] {
  const seen = new Set<string>();
  const cards: CardLibraryCardSummary[] = [];
  for (const item of [...post.haveItems, ...post.needItems]) {
    const card = getLineItemCard(item, cardById);
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      cards.push(card);
    }
  }
  return cards;
}

function getPostCardEntries(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): Array<{ card: CardLibraryCardSummary; variant?: string }> {
  const seen = new Set<string>();
  const entries: Array<{ card: CardLibraryCardSummary; variant?: string }> = [];

  for (const item of [...post.haveItems, ...post.needItems]) {
    if (typeof item === "string") continue;
    const card = cardById.get(item.cardId);
    const key = `${item.cardId}:${item.variant ?? "default"}`;

    if (card && !seen.has(key)) {
      seen.add(key);
      entries.push({ card, variant: item.variant });
    }
  }

  return entries;
}

function getPostGeneration(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): number | undefined {
  const generations = getPostCards(post, cardById)
    .map(card => parseGeneration(card.generation))
    .filter((generation): generation is number => typeof generation === "number" && Number.isFinite(generation));

  return generations.length > 0 ? Math.min(...generations) : undefined;
}

function getPostGenerationLabel(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): string {
  const generations = Array.from(new Set(
    getPostCards(post, cardById)
      .map(card => card.generation)
      .filter((generation): generation is string => !!generation)
  ));
  return generations.length ? generations.map(generation => `Gen ${generation}`).join(" / ") : "Mixed";
}

function getPostRarityLabel(post: MarketplacePost, cardById: Map<string, CardLibraryCardSummary>): string {
  const rarities = Array.from(new Set(
    getPostCards(post, cardById)
      .map(card => card.rarity)
      .filter((rarity): rarity is string => !!rarity)
  ));
  if (rarities.length === 0) return "Mixed";
  if (rarities.length > 2) return `${rarities.length} rarities`;
  return rarities.join(" / ");
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

function getListingType(post: MarketplacePost): "FOR_TRADE" | "FOR_SALE_INQUIRY_ONLY" | "FOR_TRADE_OR_SALE_INQUIRY_ONLY" {
  const hasTrade = post.listingKinds.includes("TRADE");
  const hasSale = post.listingKinds.includes("SALE");
  if (hasTrade && hasSale) return "FOR_TRADE_OR_SALE_INQUIRY_ONLY";
  if (hasSale) return "FOR_SALE_INQUIRY_ONLY";
  return "FOR_TRADE";
}

function getListingTypeLabel(post: MarketplacePost): string {
  switch (getListingType(post)) {
    case "FOR_TRADE_OR_SALE_INQUIRY_ONLY":
      return "Trade or Sale Inquiry";
    case "FOR_SALE_INQUIRY_ONLY":
      return "Sale Inquiry";
    default:
      return "Trade First";
  }
}

function getPrimaryActionLabel(post: MarketplacePost): string {
  return getListingType(post) === "FOR_SALE_INQUIRY_ONLY" ? "Message Seller" : "Offer Trade";
}

function getPostReferencePrice(post: MarketplacePost): number | undefined {
  if (typeof post.salePrice === "number" && Number.isFinite(post.salePrice)) return post.salePrice;
  const linePrice = post.haveItems
    .filter((item): item is MarketplacePostLineItem => typeof item === "object" && item !== null)
    .map(item => item.price ? Number(item.price) : Number.NaN)
    .find(price => Number.isFinite(price));
  return linePrice;
}

function matchesListingType(post: MarketplacePost, filter: ListingTypeFilter): boolean {
  if (filter === "ALL") return true;
  const hasTrade = post.listingKinds.includes("TRADE");
  const hasSale = post.listingKinds.includes("SALE");
  if (filter === "TRADE") return hasTrade && !hasSale;
  if (filter === "SALE") return hasSale && !hasTrade;
  return hasTrade && hasSale;
}

function matchesAvailability(post: MarketplacePost, filter: AvailabilityFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "INCLUDING_PENDING") return post.status !== "CLOSED";
  return post.status === "OPEN";
}

function matchesGeneration(post: MarketplacePost, generationFilter: string, cardById: Map<string, CardLibraryCardSummary>): boolean {
  if (generationFilter === "ALL") return true;
  return getPostCards(post, cardById).some(card => `${card.generation ?? ""}` === generationFilter);
}

function matchesRarity(post: MarketplacePost, rarityFilter: string, cardById: Map<string, CardLibraryCardSummary>): boolean {
  if (rarityFilter === "ALL") return true;
  return getPostCards(post, cardById).some(card => `${card.rarity ?? ""}` === rarityFilter);
}

function sortMarketplacePosts(
  posts: MarketplacePost[],
  sort: MarketplaceFeedSort,
  cardById: Map<string, CardLibraryCardSummary>,
  matchesByPostId: Map<string, MarketplacePostMatchSummary[]>
): MarketplacePost[] {
  const sorted = [...posts];
  if (sort === "BEST_MATCH") {
    return sorted.sort((a, b) => (matchesByPostId.get(b.id)?.length ?? 0) - (matchesByPostId.get(a.id)?.length ?? 0) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  if (sort === "PRICE_ASC" || sort === "PRICE_DESC") {
    return sorted.sort((a, b) => {
      const aPrice = getPostReferencePrice(a) ?? Number.POSITIVE_INFINITY;
      const bPrice = getPostReferencePrice(b) ?? Number.POSITIVE_INFINITY;
      const priceOrder = sort === "PRICE_ASC" ? aPrice - bPrice : bPrice - aPrice;
      if (priceOrder !== 0) return priceOrder;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
  }
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

function buildMatchPanelItems(myPosts: MarketplacePost[], matchesByPostId: Map<string, MarketplacePostMatchSummary[]>): MatchPanelItem[] {
  const items: MatchPanelItem[] = [];

  for (const myPost of myPosts) {
    for (const match of matchesByPostId.get(myPost.id) ?? []) {
      const hasTheyHave = match.theyHave.length > 0;
      const hasTheyNeed = match.theyNeed.length > 0;
      const type = hasTheyHave && hasTheyNeed
        ? "MUTUAL_TRADE"
        : hasTheyHave
          ? "YOU_NEED_THEIR_CARD"
          : "THEY_NEED_YOUR_CARD";
      const cards = hasTheyHave ? match.theyHave : match.theyNeed;
      items.push({
        key: `${myPost.id}:${match.postId}:${type}`,
        type,
        badge: type === "MUTUAL_TRADE" ? "Mutual Trade" : type === "YOU_NEED_THEIR_CARD" ? "You Need" : "Needs Your Card",
        displayName: match.displayName,
        explanation: type === "MUTUAL_TRADE"
          ? `${match.displayName} has cards you need and needs cards you posted.`
          : type === "YOU_NEED_THEIR_CARD"
            ? `${match.displayName} has a card on your want list.`
            : `${match.displayName} needs a card you posted.`,
        cards,
        actionLabel: type === "THEY_NEED_YOUR_CARD" ? "Message Trader" : "View Match",
        score: type === "MUTUAL_TRADE" ? 75 : type === "YOU_NEED_THEIR_CARD" ? 50 : 40
      });
    }
  }

  return items.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
}

function filterMatchPanelItems(items: MatchPanelItem[], activeTab: MatchPanelTab): MatchPanelItem[] {
  if (activeTab === "ALL") return items;
  if (activeTab === "MUTUAL") return items.filter(item => item.type === "MUTUAL_TRADE");
  if (activeTab === "YOU_NEED") return items.filter(item => item.type === "YOU_NEED_THEIR_CARD");
  return items.filter(item => item.type === "THEY_NEED_YOUR_CARD");
}

function MatchPanel({
  items,
  activeTab,
  setActiveTab,
  cardById
}: {
  items: MatchPanelItem[];
  activeTab: MatchPanelTab;
  setActiveTab: (tab: MatchPanelTab) => void;
  cardById: Map<string, CardLibraryCardSummary>;
}) {
  const tabs: Array<{ tab: MatchPanelTab; label: string }> = [
    { tab: "ALL", label: "All Matches" },
    { tab: "NEED_YOUR_CARDS", label: "Need Your Cards" },
    { tab: "YOU_NEED", label: "You Need" },
    { tab: "MUTUAL", label: "Mutual Trades" }
  ];

  const visibleItems = filterMatchPanelItems(items, activeTab).slice(0, 8);

  return (
    <aside className="marketplace-dashboard-side marketplace-card marketplace-match-panel">
      <div className="marketplace-section-kicker">Match Discovery</div>
      <h3>People Who Have / Need Your Cards</h3>
      <div className="marketplace-match-tabs" role="tablist" aria-label="Marketplace match filters">
        {tabs.map(tab => (
          <button key={tab.tab} type="button" className={activeTab === tab.tab ? "active" : ""} onClick={() => setActiveTab(tab.tab)}>
            {tab.label}
          </button>
        ))}
      </div>
      {visibleItems.length === 0 ? (
        <div className="marketplace-empty-state">
          <strong>No matches yet.</strong>
          <span>Post cards you have or add cards to your want list to unlock match suggestions.</span>
        </div>
      ) : (
        <div className="marketplace-match-card-list">
          {visibleItems.map(item => (
            <article key={item.key} className={`marketplace-match-card ${item.type.toLowerCase().replace(/_/g, "-")}`}>
              <div className="marketplace-match-card-top">
                <span className="marketplace-match-badge">{item.badge}</span>
                <small>Score {item.score}</small>
              </div>
              <strong>{item.displayName}</strong>
              <p>{item.explanation}</p>
              <div className="marketplace-match-thumbs">
                {item.cards.slice(0, 4).map(line => {
                  const card = cardById.get(line.cardId);
                  return card ? <CardImageThumbnail key={`${line.cardId}:${line.variant}`} card={card} artKey={normalizeCardArtKey(line.variant)} className="marketplace-match-thumb" /> : <span key={`${line.cardId}:${line.variant}`} className="marketplace-match-thumb missing">?</span>;
                })}
              </div>
              <button type="button" className="marketplace-mini-action">{item.actionLabel}</button>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

function MyPostedCardsTable({
  posts,
  cardById,
  matchesByPostId,
  onEdit,
  onStatusChange
}: {
  posts: MarketplacePost[];
  cardById: Map<string, CardLibraryCardSummary>;
  matchesByPostId: Map<string, MarketplacePostMatchSummary[]>;
  onEdit: (post: MarketplacePost) => void;
  onStatusChange: (post: MarketplacePost, status: MarketplacePostStatus) => void;
}) {
  return (
    <section className="marketplace-my-posted-cards marketplace-card">
      <div className="marketplace-list-heading-row">
        <div>
          <div className="marketplace-section-kicker">My Posted Cards</div>
          <h3>Current User's Posted Cards</h3>
        </div>
        <span>{posts.length} post{posts.length === 1 ? "" : "s"}</span>
      </div>
      {posts.length === 0 ? (
        <p className="subtitle">You have no marketplace posts yet.</p>
      ) : (
        <div className="marketplace-table-scroll">
          <table className="marketplace-posted-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Have</th>
                <th>Need</th>
                <th>Type</th>
                <th>Value</th>
                <th>Matches</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(post => {
                const firstEntry = getPostCardEntries(post, cardById)[0];
                const matchCount = matchesByPostId.get(post.id)?.length ?? 0;
                const value = getPostReferencePrice(post);
                return (
                  <tr key={post.id}>
                    <td>
                      <div className="marketplace-table-card-cell">
                        {firstEntry ? <CardImageThumbnail card={firstEntry.card} artKey={normalizeCardArtKey(firstEntry.variant)} className="marketplace-table-thumb" /> : <span className="marketplace-table-thumb missing">?</span>}
                        <span>
                          <strong>{post.title}</strong>
                          <small>{getPostGenerationLabel(post, cardById)} - {getPostRarityLabel(post, cardById)}</small>
                        </span>
                      </div>
                    </td>
                    <td>{post.haveItems.length}</td>
                    <td>{post.needItems.length}</td>
                    <td>{getListingTypeLabel(post)}</td>
                    <td>{typeof value === "number" ? `$${value.toFixed(2)}` : "Trade"}</td>
                    <td>{matchCount}</td>
                    <td>{post.status}</td>
                    <td>
                      <div className="marketplace-table-actions">
                        <button type="button" onClick={() => onEdit(post)}>Edit</button>
                        <button type="button" disabled={post.status === "PENDING"} onClick={() => onStatusChange(post, "PENDING")}>Pause</button>
                        <button type="button" disabled={post.status === "CLOSED"} onClick={() => onStatusChange(post, "CLOSED")}>Close</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function MarketplacePage({ authUser, cardLibrary }: Props) {
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const [matchGroups, setMatchGroups] = useState<MarketplaceServerMatchGroup[]>([]);
  const [editingPost, setEditingPost] = useState<MarketplacePost | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [feedSearch, setFeedSearch] = useState("");
  const [feedSort, setFeedSort] = useState<MarketplaceFeedSort>("UPDATED");
  const [listingTypeFilter, setListingTypeFilter] = useState<ListingTypeFilter>("ALL");
  const [generationFilter, setGenerationFilter] = useState("ALL");
  const [rarityFilter, setRarityFilter] = useState("ALL");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("ACTIVE_ONLY");
  const [matchTab, setMatchTab] = useState<MatchPanelTab>("ALL");
  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const generations = useMemo(() => Array.from(new Set(cardLibrary.map(card => `${card.generation ?? ""}`).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [cardLibrary]);
  const rarities = useMemo(() => Array.from(new Set(cardLibrary.map(card => `${card.rarity ?? ""}`).filter(Boolean))).sort(), [cardLibrary]);
  const testPosts = useMemo(() => import.meta.env.DEV ? buildTestMarketplacePosts(cardLibrary) : [], [cardLibrary]);
  const canPost = !!authUser.discord?.userId;
  const myPosts = useMemo(() => posts.filter(post => post.userId === authUser.id), [authUser.id, posts]);
  const otherPosts = useMemo(() => [...posts.filter(post => post.userId !== authUser.id), ...testPosts], [authUser.id, posts, testPosts]);
  const visibleOtherPosts = useMemo(() => otherPosts.filter(post => post.status !== "CLOSED"), [otherPosts]);
  const matchesByPostId = useMemo(() => {
    return buildMatchSummaries(matchGroups, [...myPosts, ...visibleOtherPosts], cardById);
  }, [cardById, matchGroups, myPosts, visibleOtherPosts]);
  const filteredOtherPosts = useMemo(() => {
    const normalizedSearch = feedSearch.trim().toLowerCase();
    const filtered = visibleOtherPosts.filter(post => {
      if (normalizedSearch && !getPostSearchText(post, cardById).includes(normalizedSearch)) return false;
      if (!matchesListingType(post, listingTypeFilter)) return false;
      if (!matchesAvailability(post, availabilityFilter)) return false;
      if (!matchesGeneration(post, generationFilter, cardById)) return false;
      if (!matchesRarity(post, rarityFilter, cardById)) return false;
      return true;
    });

    return sortMarketplacePosts(filtered, feedSort, cardById, matchesByPostId);
  }, [availabilityFilter, cardById, feedSearch, feedSort, generationFilter, listingTypeFilter, matchesByPostId, rarityFilter, visibleOtherPosts]);
  const matchPanelItems = useMemo(() => buildMatchPanelItems(myPosts, matchesByPostId), [matchesByPostId, myPosts]);

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

  async function handleLineItemContact(post: MarketplacePost, item: MarketplacePostLineItem) {
    const seller = post.discord?.globalName || post.discord?.username || post.discordHandle || post.displayName || "seller";
    const message = `Hi ${seller}, I'm interested in ${item.quantity}x ${item.name} (${getMarketplaceVariantLabel(item.variant)}) from your post "${post.title}".`;
    try {
      await navigator.clipboard?.writeText(message);
    } catch {
      // noop: clipboard unavailable in some browser contexts
    }
  }

  return (
    <section className="marketplace-page marketplace-dashboard-page">
      <header className="marketplace-dashboard-topnav marketplace-card">
        <div className="marketplace-brand-block">
          <span className="marketplace-logo-mark">W</span>
          <div>
            <strong>WARD Marketplace</strong>
            <small>Trading hub beta</small>
          </div>
        </div>
        <label className="marketplace-top-search" htmlFor="marketplace-global-search">
          <span>Search</span>
          <input
            id="marketplace-global-search"
            type="search"
            value={feedSearch}
            onChange={event => setFeedSearch(event.target.value)}
            placeholder="Search cards, sets, usernames, variants"
          />
        </label>
        <nav className="marketplace-top-tabs" aria-label="Marketplace navigation">
          <button type="button" className={listingTypeFilter === "ALL" ? "active" : ""} onClick={() => setListingTypeFilter("ALL")}>Marketplace</button>
          <button type="button" className={listingTypeFilter === "TRADE" ? "active" : ""} onClick={() => setListingTypeFilter("TRADE")}>Trade Listings</button>
          <button type="button" onClick={() => setMatchTab("YOU_NEED")}>Wants</button>
          <button type="button" onClick={() => setAvailabilityFilter("ALL")}>My Posts</button>
          <button type="button" onClick={() => setMatchTab("ALL")}>Matches</button>
        </nav>
        <div className="marketplace-profile-block">
          <span className="marketplace-notification-dot" aria-label="Marketplace notifications">New</span>
          <span>{authUser.displayName}</span>
        </div>
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

      <section className="marketplace-dashboard-hero marketplace-card">
        <div>
          <div className="marketplace-section-kicker">Discovery - Trade - Coordinate</div>
          <h2>Live Trade Listings</h2>
          <p>Browse cards, match wants against posted cards, and coordinate through Discord. Sale posts are inquiry-only in this release.</p>
        </div>
        <div className="marketplace-hero-actions">
          <button type="button" className="marketplace-create-post-button" onClick={startCreatingPost} disabled={!canPost}>Create Post</button>
          <button type="button" className="marketplace-disabled-action" disabled title="Checkout is not available in this beta. Use messaging to coordinate with the seller directly.">Checkout Disabled</button>
          <button type="button" className="marketplace-disabled-action" disabled title="Shipping tools are planned, but trades are currently coordinated manually.">Shipping Coming Soon</button>
        </div>
        {!canPost ? <p className="subtitle">Connect Discord from your profile to create or edit marketplace posts.</p> : null}
      </section>

      <div className="marketplace-dashboard-grid">
        <aside className="marketplace-dashboard-side marketplace-card marketplace-filter-sidebar">
          <div className="marketplace-section-kicker">Filters</div>
          <h3>Find Listings</h3>
          <label>
            Listing type
            <select value={listingTypeFilter} onChange={event => setListingTypeFilter(event.target.value as ListingTypeFilter)}>
              <option value="ALL">All listing types</option>
              <option value="TRADE">Trade first</option>
              <option value="SALE">Sale inquiry only</option>
              <option value="TRADE_OR_SALE">Trade or sale inquiry</option>
            </select>
          </label>
          <label>
            Game
            <select disabled>
              <option>WARD TCG</option>
            </select>
          </label>
          <label>
            Generation / Set
            <select value={generationFilter} onChange={event => setGenerationFilter(event.target.value)}>
              <option value="ALL">All generations</option>
              {generations.map(generation => <option value={generation} key={generation}>Gen {generation}</option>)}
            </select>
          </label>
          <label>
            Rarity
            <select value={rarityFilter} onChange={event => setRarityFilter(event.target.value)}>
              <option value="ALL">All rarities</option>
              {rarities.map(rarity => <option value={rarity} key={rarity}>{rarity}</option>)}
            </select>
          </label>
          <label>
            Availability
            <select value={availabilityFilter} onChange={event => setAvailabilityFilter(event.target.value as AvailabilityFilter)}>
              <option value="ACTIVE_ONLY">Active only</option>
              <option value="INCLUDING_PENDING">Active + pending</option>
              <option value="ALL">All statuses</option>
            </select>
          </label>
          <label>
            Sort
            <select value={feedSort} onChange={event => setFeedSort(event.target.value as MarketplaceFeedSort)}>
              <option value="UPDATED">Newest activity</option>
              <option value="BEST_MATCH">Best match</option>
              <option value="GEN_ASC">Generation low to high</option>
              <option value="GEN_DESC">Generation high to low</option>
              <option value="PRICE_ASC">Reference value low to high</option>
              <option value="PRICE_DESC">Reference value high to low</option>
            </select>
          </label>
          <div className="marketplace-filter-note">
            <strong>Beta safety</strong>
            <span>No checkout, payment collection, shipping address collection, or label generation is active.</span>
          </div>
        </aside>

        <main className="marketplace-live-listings">
          <div className="marketplace-list-heading-row">
            <div>
              <div className="marketplace-section-kicker">Public Posts</div>
              <h3>Live Trade & Marketplace Listings</h3>
            </div>
            <span>{filteredOtherPosts.length === visibleOtherPosts.length ? visibleOtherPosts.length : `${filteredOtherPosts.length}/${visibleOtherPosts.length}`}</span>
          </div>
          {visibleOtherPosts.length === 0 ? (
            <div className="marketplace-empty-state marketplace-card">
              <strong>No listings found.</strong>
              <span>Post cards you have or add cards to your want list to unlock match suggestions.</span>
            </div>
          ) : filteredOtherPosts.length === 0 ? (
            <div className="marketplace-empty-state marketplace-card">
              <strong>No marketplace posts match those filters.</strong>
              <span>Try adjusting listing type, rarity, generation, or search text.</span>
            </div>
          ) : (
            <div className="marketplace-listing-grid">
              {filteredOtherPosts.map(post => (
                <div className="marketplace-listing-shell" key={post.id}>
                  <div className="marketplace-listing-accent-row">
                    <span className={`marketplace-listing-type ${getListingType(post).toLowerCase().replace(/_/g, "-")}`}>{getListingTypeLabel(post)}</span>
                    <span>{getPostGenerationLabel(post, cardById)} - {getPostRarityLabel(post, cardById)}</span>
                  </div>
                  <MarketplacePostCard
                    post={post}
                    cardById={cardById}
                    matches={matchesByPostId.get(post.id)}
                    onLineItemContact={item => handleLineItemContact(post, item)}
                  />
                  <div className="marketplace-listing-action-strip">
                    <button type="button">{getPrimaryActionLabel(post)}</button>
                    <button type="button">Add to Wants</button>
                    <button type="button" className="marketplace-disabled-action" disabled title="Integrated payments are not available in this beta. Message the seller to coordinate.">Checkout Disabled</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        <MatchPanel items={matchPanelItems} activeTab={matchTab} setActiveTab={setMatchTab} cardById={cardById} />
      </div>

      <MyPostedCardsTable posts={myPosts} cardById={cardById} matchesByPostId={matchesByPostId} onEdit={startEditingPost} onStatusChange={changePostStatus} />
    </section>
  );
}
