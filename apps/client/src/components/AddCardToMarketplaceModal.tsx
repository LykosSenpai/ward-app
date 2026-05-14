import { useState } from "react";
import type { CardArtKey } from "./CardImagePreview";

type AddCardToMarketplaceModalProps = {
  title: string;
  mode: "need" | "have";
  defaultVariant: CardArtKey;
  onClose: () => void;
  onSubmit: (args: {
    quantity: number;
    variant: string;
    trade: boolean;
    sale: boolean;
    price: string;
    note: string;
  }) => void;
};

const MARKETPLACE_VARIANTS: Array<{ key: CardArtKey; label: string }> = [
  { key: "default", label: "Default" },
  { key: "holo", label: "Holo" },
  { key: "zero-art", label: "Zero" },
  { key: "zero-art-holo", label: "Zero Holo" }
];

export function AddCardToMarketplaceModal({ title, mode, defaultVariant, onClose, onSubmit }: AddCardToMarketplaceModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [variant, setVariant] = useState<CardArtKey>(
    MARKETPLACE_VARIANTS.some(option => option.key === defaultVariant) ? defaultVariant : "default"
  );
  const [trade, setTrade] = useState(true);
  const [sale, setSale] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="card marketplace-quick-post-modal">
        <div>
          <h3>{title}</h3>
          <p className="muted">{mode === "need" ? "Create a visible marketplace post looking for this card." : "Create a visible marketplace post offering this card."}</p>
        </div>

        <div className="marketplace-form-grid">
          <label>Quantity<input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1))} /></label>
          <label>Variant
            <select value={variant} onChange={e => setVariant(e.target.value as CardArtKey)}>
              {MARKETPLACE_VARIANTS.map(option => <option value={option.key} key={option.key}>{option.label}</option>)}
            </select>
          </label>
          <div className="marketplace-mode-toggles" role="group" aria-label="Marketplace post mode">
            <label><input type="checkbox" checked={trade} onChange={e => setTrade(e.target.checked)} /> Trade</label>
            <label><input type="checkbox" checked={sale} onChange={e => setSale(e.target.checked)} /> Sale</label>
          </div>
          {sale ? <label>Price<input value={price} onChange={e => setPrice(e.target.value)} placeholder="Optional" /></label> : null}
          <label>Note<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Optional" /></label>
        </div>

        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            onClick={() => onSubmit({ quantity, variant, trade, sale, price, note })}
            disabled={!trade && !sale}
          >
            Publish
          </button>
        </div>
      </section>
    </div>
  );
}
