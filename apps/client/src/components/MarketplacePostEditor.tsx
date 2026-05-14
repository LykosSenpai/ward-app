import { useMemo, useState } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import type { MarketplacePostStatus, MarketplacePostLineItem } from "../marketplaceHelpers";
import { getMarketplaceVariantLabel } from "../marketplaceHelpers";
import type { CardArtKey } from "./CardImagePreview";
import { CardImageThumbnail } from "./CardImagePreview";

export type MarketplacePostDraft = {
  discordHandle: string;
  title: string;
  description: string;
  status: MarketplacePostStatus;
  haveItems: MarketplacePostLineItem[];
  needItems: MarketplacePostLineItem[];
  tradeEnabled: boolean;
  saleEnabled: boolean;
  salePrice: string;
  note: string;
};

type Props = {
  cardLibrary: CardLibraryCardSummary[];
  onSave: (draft: MarketplacePostDraft) => void;
};

const MARKETPLACE_VARIANTS: Array<{ key: CardArtKey; label: string }> = [
  { key: "default", label: "Default" },
  { key: "holo", label: "Holo" },
  { key: "zero-art", label: "Zero" },
  { key: "zero-art-holo", label: "Zero Holo" }
];

const INITIAL_DRAFT: MarketplacePostDraft = {
  discordHandle: "",
  title: "",
  description: "",
  status: "OPEN",
  haveItems: [],
  needItems: [],
  tradeEnabled: true,
  saleEnabled: false,
  salePrice: "",
  note: ""
};

function makeLineItem(card: CardLibraryCardSummary, variant: CardArtKey, quantity: number): MarketplacePostLineItem {
  return { cardId: card.id, name: card.name, variant, quantity };
}

function mergeLineItem(items: MarketplacePostLineItem[], next: MarketplacePostLineItem): MarketplacePostLineItem[] {
  const existingIndex = items.findIndex(item => item.cardId === next.cardId && (item.variant ?? "default") === (next.variant ?? "default"));
  if (existingIndex < 0) return [...items, next];
  return items.map((item, index) => index === existingIndex ? { ...item, quantity: item.quantity + next.quantity } : item);
}

function MarketplaceItemList({
  title,
  items,
  cardById,
  onRemove
}: {
  title: string;
  items: MarketplacePostLineItem[];
  cardById: Map<string, CardLibraryCardSummary>;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="marketplace-builder-list">
      <strong>{title}</strong>
      {items.length === 0 ? (
        <p className="muted">No cards added.</p>
      ) : (
        <ul>
          {items.map((item, index) => {
            const card = cardById.get(item.cardId);
            return (
              <li key={`${item.cardId}:${item.variant}:${index}`}>
                {card ? <CardImageThumbnail card={card} className="marketplace-line-thumb" /> : <span className="marketplace-line-thumb missing">{item.name?.slice(0, 1) ?? "?"}</span>}
                <span>
                  <strong>{card?.name ?? item.name ?? item.cardId}</strong>
                  <small>{getMarketplaceVariantLabel(item.variant)} x{item.quantity}</small>
                </span>
                <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${card?.name ?? item.cardId}`}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MarketplacePostEditor({ cardLibrary, onSave }: Props) {
  const [draft, setDraft] = useState<MarketplacePostDraft>(INITIAL_DRAFT);
  const [searchText, setSearchText] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<CardArtKey>("default");
  const [quantity, setQuantity] = useState(1);

  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const selectedCard = selectedCardId ? cardById.get(selectedCardId) : undefined;
  const searchResults = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    const source = needle
      ? cardLibrary.filter(card =>
          card.name.toLowerCase().includes(needle) ||
          card.id.toLowerCase().includes(needle) ||
          `${card.cardNumber ?? ""}`.toLowerCase().includes(needle)
        )
      : cardLibrary;
    return source.slice(0, 8);
  }, [cardLibrary, searchText]);

  const isValid = useMemo(() => {
    if (!draft.discordHandle.trim() || !draft.title.trim()) return false;
    if (!draft.haveItems.length && !draft.needItems.length) return false;
    if (!draft.tradeEnabled && !draft.saleEnabled) return false;
    if (draft.saleEnabled && draft.salePrice.trim() && Number.isNaN(Number(draft.salePrice))) return false;
    return true;
  }, [draft]);

  function addSelectedCard(side: "have" | "need") {
    if (!selectedCard) return;
    const nextItem = makeLineItem(selectedCard, selectedVariant, quantity);
    setDraft(prev => side === "have"
      ? { ...prev, haveItems: mergeLineItem(prev.haveItems, nextItem) }
      : { ...prev, needItems: mergeLineItem(prev.needItems, nextItem) }
    );
  }

  function removeLine(side: "have" | "need", indexToRemove: number) {
    setDraft(prev => side === "have"
      ? { ...prev, haveItems: prev.haveItems.filter((_, index) => index !== indexToRemove) }
      : { ...prev, needItems: prev.needItems.filter((_, index) => index !== indexToRemove) }
    );
  }

  function handleSave() {
    onSave({
      ...draft,
      description: draft.description.trim() || "Card marketplace post."
    });
    setDraft(INITIAL_DRAFT);
    setSearchText("");
    setSelectedCardId("");
    setQuantity(1);
    setSelectedVariant("default");
  }

  return (
    <section className="marketplace-card marketplace-builder-card">
      <div className="marketplace-builder-heading">
        <div>
          <h3>Create Post</h3>
          <p className="muted">Search your loaded cards, choose a variant, then add it to Have or Need.</p>
        </div>
        <div className="marketplace-mode-toggles" role="group" aria-label="Marketplace post mode">
          <label><input type="checkbox" checked={draft.tradeEnabled} onChange={e => setDraft(prev => ({ ...prev, tradeEnabled: e.target.checked }))} /> Trade</label>
          <label><input type="checkbox" checked={draft.saleEnabled} onChange={e => setDraft(prev => ({ ...prev, saleEnabled: e.target.checked }))} /> Sale</label>
        </div>
      </div>

      <div className="marketplace-builder-layout">
        <div className="marketplace-card-picker">
          <label>
            Find card
            <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search name, id, or number" />
          </label>
          <div className="marketplace-card-results">
            {searchResults.map(card => (
              <button
                type="button"
                className={card.id === selectedCardId ? "selected" : ""}
                key={card.id}
                onClick={() => setSelectedCardId(card.id)}
              >
                <CardImageThumbnail card={card} className="marketplace-line-thumb" />
                <span>
                  <strong>{card.name}</strong>
                  <small>{card.generation ? `Gen ${card.generation}` : card.packId} {card.cardNumber ? `#${card.cardNumber}` : ""}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="marketplace-builder-controls">
          <div className="marketplace-form-grid">
            <label>Discord Handle<input value={draft.discordHandle} onChange={e => setDraft(prev => ({ ...prev, discordHandle: e.target.value }))} placeholder="@your-handle" /></label>
            <label>Title<input value={draft.title} onChange={e => setDraft(prev => ({ ...prev, title: e.target.value }))} placeholder="Trading Gen 1 extras for missing cards" /></label>
            <label>Description<textarea value={draft.description} onChange={e => setDraft(prev => ({ ...prev, description: e.target.value }))} rows={2} placeholder="Optional context for this post" /></label>
            <label>Status
              <select value={draft.status} onChange={e => setDraft(prev => ({ ...prev, status: e.target.value as MarketplacePostStatus }))}>
                <option value="OPEN">Open</option>
                <option value="PENDING">Pending</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
            <label>Variant
              <select value={selectedVariant} onChange={e => setSelectedVariant(e.target.value as CardArtKey)}>
                {MARKETPLACE_VARIANTS.map(option => <option value={option.key} key={option.key}>{option.label}</option>)}
              </select>
            </label>
            <label>Quantity<input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1))} /></label>
            {draft.saleEnabled ? <label>Price (optional)<input value={draft.salePrice} onChange={e => setDraft(prev => ({ ...prev, salePrice: e.target.value }))} placeholder="25" /></label> : null}
            <label>Note (optional)<textarea value={draft.note} onChange={e => setDraft(prev => ({ ...prev, note: e.target.value }))} rows={2} /></label>
          </div>
          <div className="marketplace-builder-add-row">
            <button type="button" onClick={() => addSelectedCard("have")} disabled={!selectedCard}>+ Have</button>
            <button type="button" onClick={() => addSelectedCard("need")} disabled={!selectedCard}>+ Need</button>
          </div>
        </div>
      </div>

      <div className="marketplace-builder-summary">
        <MarketplaceItemList title="Have" items={draft.haveItems} cardById={cardById} onRemove={index => removeLine("have", index)} />
        <MarketplaceItemList title="Need" items={draft.needItems} cardById={cardById} onRemove={index => removeLine("need", index)} />
      </div>
      <button className="marketplace-builder-save" onClick={handleSave} disabled={!isValid}>Publish Post</button>
    </section>
  );
}
