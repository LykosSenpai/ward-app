import { useState } from "react";

type AddCardToMarketplaceModalProps = {
  title: string;
  onClose: () => void;
  onSubmit: (args: {
    quantity: number;
    mergeWithExisting: boolean;
    onlyFocusedMissingCards: boolean;
    variant: string;
    trade: boolean;
    sale: boolean;
    price: string;
    note: string;
  }) => void;
};

export function AddCardToMarketplaceModal({ title, onClose, onSubmit }: AddCardToMarketplaceModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [mergeWithExisting, setMergeWithExisting] = useState(true);
  const [onlyFocusedMissingCards, setOnlyFocusedMissingCards] = useState(false);
  const [variant, setVariant] = useState("default");
  const [trade, setTrade] = useState(true);
  const [sale, setSale] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="card" style={{ maxWidth: 460, margin: "8vh auto" }}>
        <h3>{title}</h3>
        <label>Quantity per missing card<input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1))} /></label>
        <label><input type="checkbox" checked={mergeWithExisting} onChange={e => setMergeWithExisting(e.target.checked)} /> Merge with existing needs</label>
        <label><input type="checkbox" checked={onlyFocusedMissingCards} onChange={e => setOnlyFocusedMissingCards(e.target.checked)} /> Only focused missing cards</label>
        <label>Variant<input value={variant} onChange={e => setVariant(e.target.value)} /></label>
        <label><input type="checkbox" checked={trade} onChange={e => setTrade(e.target.checked)} /> Trade</label>
        <label><input type="checkbox" checked={sale} onChange={e => setSale(e.target.checked)} /> Sale</label>
        <label>Price<input value={price} onChange={e => setPrice(e.target.value)} placeholder="Optional" /></label>
        <label>Note<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onSubmit({ quantity, mergeWithExisting, onlyFocusedMissingCards, variant, trade, sale, price, note })}>Add</button>
        </div>
      </section>
    </div>
  );
}
