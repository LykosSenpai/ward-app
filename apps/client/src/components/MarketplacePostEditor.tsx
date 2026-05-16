import { useEffect, useMemo, useState } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import type { MarketplacePostStatus, MarketplacePostLineItem } from "../marketplaceHelpers";
import { getMarketplaceVariantLabel } from "../marketplaceHelpers";
import type { CardArtKey } from "./CardImagePreview";
import { CardImageThumbnail, normalizeCardArtKey } from "./CardImagePreview";

export type MarketplacePostDraft = {
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
  initialDraft?: MarketplacePostDraft;
  mode?: "create" | "edit";
  onCancelEdit?: () => void;
  onSave: (draft: MarketplacePostDraft) => void;
};

const MARKETPLACE_VARIANTS: Array<{ key: CardArtKey; label: string }> = [
  { key: "default", label: "Default" },
  { key: "holo", label: "Holo" },
  { key: "zero-art", label: "Zero" },
  { key: "zero-art-holo", label: "Zero Holo" }
];

const INITIAL_DRAFT: MarketplacePostDraft = {
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

function makeLineItem(card: CardLibraryCardSummary, variant: CardArtKey, quantity: number, defaults: { trade: boolean; sale: boolean; price: string }): MarketplacePostLineItem {
  return {
    cardId: card.id,
    name: card.name,
    variant,
    quantity,
    trade: defaults.trade,
    sale: defaults.sale,
    price: defaults.sale && defaults.price.trim() ? defaults.price.trim() : undefined
  };
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
  onSetQuantity,
  onUpdateItem,
  onRemove
}: {
  title: string;
  items: MarketplacePostLineItem[];
  cardById: Map<string, CardLibraryCardSummary>;
  onSetQuantity: (index: number, quantity: number) => void;
  onUpdateItem: (index: number, patch: Partial<MarketplacePostLineItem>) => void;
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
                <span>
                  <strong>{card?.name ?? item.name ?? item.cardId}</strong>
                  <small>{getMarketplaceVariantLabel(item.variant)} x{item.quantity}</small>
                </span>
                {card ? <CardImageThumbnail card={card} artKey={normalizeCardArtKey(item.variant)} className="marketplace-line-thumb" /> : <span className="marketplace-line-thumb missing">{item.name?.slice(0, 1) ?? "?"}</span>}
                <div className="marketplace-line-quantity-controls" aria-label={`${card?.name ?? item.cardId} quantity controls`}>
                  <button
                    type="button"
                    onClick={() => onSetQuantity(index, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    aria-label={`Remove one ${card?.name ?? item.cardId}`}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={event => onSetQuantity(index, Number.parseInt(event.target.value || "1", 10))}
                    aria-label={`${card?.name ?? item.cardId} quantity`}
                  />
                  <button
                    type="button"
                    onClick={() => onSetQuantity(index, item.quantity + 1)}
                    aria-label={`Add one ${card?.name ?? item.cardId}`}
                  >
                    +
                  </button>
                  <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${card?.name ?? item.cardId}`}>
                    Remove
                  </button>
                </div>
                <div className="marketplace-line-mode-controls" aria-label={`${card?.name ?? item.cardId} listing controls`}>
                  <label><input type="checkbox" checked={item.trade !== false} onChange={event => onUpdateItem(index, { trade: event.target.checked })} /> Trade</label>
                  <label><input type="checkbox" checked={!!item.sale} onChange={event => onUpdateItem(index, { sale: event.target.checked })} /> Sale</label>
                  {item.sale ? (
                    <input
                      value={item.price ?? ""}
                      onChange={event => onUpdateItem(index, { price: event.target.value })}
                      placeholder="Price"
                      aria-label={`${card?.name ?? item.cardId} sale price`}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MarketplacePostEditor({ cardLibrary, initialDraft, mode = "create", onCancelEdit, onSave }: Props) {
  const [draft, setDraft] = useState<MarketplacePostDraft>(initialDraft ?? INITIAL_DRAFT);
  const [searchText, setSearchText] = useState("");
  const [generationFilter, setGenerationFilter] = useState("ALL");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<CardArtKey>("default");
  const [quantity, setQuantity] = useState(1);

  const cardById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const generations = useMemo(() => {
    return Array.from(new Set(cardLibrary.map(card => `${card.generation ?? ""}`).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [cardLibrary]);
  const selectedCard = selectedCardId ? cardById.get(selectedCardId) : undefined;
  const searchResults = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    const generationCards = generationFilter === "ALL"
      ? cardLibrary
      : cardLibrary.filter(card => `${card.generation ?? ""}` === generationFilter);
    const source = needle
      ? generationCards.filter(card =>
          card.name.toLowerCase().includes(needle) ||
          card.id.toLowerCase().includes(needle) ||
          `${card.cardNumber ?? ""}`.toLowerCase().includes(needle)
        )
      : generationCards;
    return source;
  }, [cardLibrary, generationFilter, searchText]);

  const isValid = useMemo(() => {
    const allItems = [...draft.haveItems, ...draft.needItems];
    if (!draft.title.trim()) return false;
    if (!allItems.length) return false;
    if (allItems.some(item => item.trade === false && !item.sale)) return false;
    if (draft.saleEnabled && draft.salePrice.trim() && Number.isNaN(Number(draft.salePrice))) return false;
    if (allItems.some(item => item.sale && item.price?.trim() && Number.isNaN(Number(item.price)))) return false;
    return true;
  }, [draft]);

  useEffect(() => {
    setDraft(initialDraft ?? INITIAL_DRAFT);
    setSearchText("");
    setGenerationFilter("ALL");
    setSelectedCardId("");
    setQuantity(1);
    setSelectedVariant("default");
  }, [initialDraft, mode]);

  function addSelectedCard(side: "have" | "need") {
    if (!selectedCard) return;
    const nextItem = makeLineItem(selectedCard, selectedVariant, quantity, {
      trade: draft.tradeEnabled,
      sale: draft.saleEnabled,
      price: draft.salePrice
    });
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

  function setLineQuantity(side: "have" | "need", indexToUpdate: number, nextQuantity: number) {
    const quantity = Math.max(1, Number.isFinite(nextQuantity) ? Math.floor(nextQuantity) : 1);
    setDraft(prev => side === "have"
      ? { ...prev, haveItems: prev.haveItems.map((item, index) => index === indexToUpdate ? { ...item, quantity } : item) }
      : { ...prev, needItems: prev.needItems.map((item, index) => index === indexToUpdate ? { ...item, quantity } : item) }
    );
  }

  function updateLineItem(side: "have" | "need", indexToUpdate: number, patch: Partial<MarketplacePostLineItem>) {
    setDraft(prev => {
      const updateItem = (item: MarketplacePostLineItem, index: number) => {
        if (index !== indexToUpdate) return item;
        const next = { ...item, ...patch };
        if (!next.sale) delete next.price;
        return next;
      };

      return side === "have"
        ? { ...prev, haveItems: prev.haveItems.map(updateItem) }
        : { ...prev, needItems: prev.needItems.map(updateItem) };
    });
  }

  function handleSave() {
    onSave({
      ...draft,
      description: draft.description.trim() || "Card marketplace post."
    });
    if (mode === "create") setDraft(INITIAL_DRAFT);
    setSearchText("");
    setGenerationFilter("ALL");
    setSelectedCardId("");
    setQuantity(1);
    setSelectedVariant("default");
  }

  return (
    <section className="marketplace-card marketplace-builder-card">
      <div className="marketplace-builder-heading">
        <div>
          <h3>{mode === "edit" ? "Edit Post" : "Create Post"}</h3>
          <p className="muted">Search your loaded cards, choose a variant, then add it to Have or Need.</p>
        </div>
        <div className="marketplace-builder-top-actions">
          <div className="marketplace-mode-toggles" role="group" aria-label="Marketplace post mode">
            <label><input type="checkbox" checked={draft.tradeEnabled} onChange={e => setDraft(prev => ({ ...prev, tradeEnabled: e.target.checked }))} /> Trade</label>
            <label><input type="checkbox" checked={draft.saleEnabled} onChange={e => setDraft(prev => ({ ...prev, saleEnabled: e.target.checked }))} /> Sale</label>
          </div>
          <div className="marketplace-builder-save-row">
            {mode === "edit" && onCancelEdit ? <button type="button" onClick={onCancelEdit}>Cancel Edit</button> : null}
            <button className="marketplace-builder-save" onClick={handleSave} disabled={!isValid}>
              {mode === "edit" ? "Save Changes" : "Publish Post"}
            </button>
          </div>
        </div>
      </div>

      <div className="marketplace-builder-layout">
        <div className="marketplace-card-picker">
          <div className="marketplace-picker-filters">
            <label>
              Generation
              <select value={generationFilter} onChange={e => setGenerationFilter(e.target.value)}>
                <option value="ALL">All generations</option>
                {generations.map(generation => <option value={generation} key={generation}>Gen {generation}</option>)}
              </select>
            </label>
            <label>
              Find card
              <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search name, id, or number" />
            </label>
          </div>
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
            <button type="button" onClick={() => addSelectedCard("have")} disabled={!selectedCard || (!draft.tradeEnabled && !draft.saleEnabled)}>+ Have</button>
            <button type="button" onClick={() => addSelectedCard("need")} disabled={!selectedCard || (!draft.tradeEnabled && !draft.saleEnabled)}>+ Need</button>
          </div>
        </div>
      </div>

      <div className="marketplace-builder-summary">
        <MarketplaceItemList title="Have" items={draft.haveItems} cardById={cardById} onSetQuantity={(index, quantity) => setLineQuantity("have", index, quantity)} onUpdateItem={(index, patch) => updateLineItem("have", index, patch)} onRemove={index => removeLine("have", index)} />
        <MarketplaceItemList title="Need" items={draft.needItems} cardById={cardById} onSetQuantity={(index, quantity) => setLineQuantity("need", index, quantity)} onUpdateItem={(index, patch) => updateLineItem("need", index, patch)} onRemove={index => removeLine("need", index)} />
      </div>
    </section>
  );
}
