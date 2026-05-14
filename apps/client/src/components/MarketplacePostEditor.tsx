import { useMemo, useState } from "react";
import type { MarketplacePostStatus } from "../marketplaceHelpers";
import { splitManualItems } from "../marketplaceHelpers";

export type MarketplacePostDraft = {
  discordHandle: string;
  title: string;
  description: string;
  status: MarketplacePostStatus;
  haveItemsText: string;
  needItemsText: string;
  tradeEnabled: boolean;
  saleEnabled: boolean;
  salePrice: string;
  note: string;
};

type Props = {
  onSave: (draft: MarketplacePostDraft) => void;
};

const INITIAL_DRAFT: MarketplacePostDraft = {
  discordHandle: "",
  title: "",
  description: "",
  status: "OPEN",
  haveItemsText: "",
  needItemsText: "",
  tradeEnabled: true,
  saleEnabled: false,
  salePrice: "",
  note: ""
};

export function MarketplacePostEditor({ onSave }: Props) {
  const [draft, setDraft] = useState<MarketplacePostDraft>(INITIAL_DRAFT);
  const saleEnabled = draft.saleEnabled;
  const isValid = useMemo(() => {
    if (!draft.discordHandle.trim() || !draft.title.trim() || !draft.description.trim()) return false;
    if (!splitManualItems(draft.haveItemsText).length && !splitManualItems(draft.needItemsText).length) return false;
    if (!draft.tradeEnabled && !draft.saleEnabled) return false;
    if (draft.saleEnabled && draft.salePrice.trim() && Number.isNaN(Number(draft.salePrice))) return false;
    return true;
  }, [draft]);

  return (
    <section className="marketplace-card">
      <h3>Create Post</h3>
      <div className="marketplace-form-grid">
        <label>Discord Handle<input value={draft.discordHandle} onChange={e => setDraft(prev => ({ ...prev, discordHandle: e.target.value }))} placeholder="@your-handle" /></label>
        <label>Status
          <select value={draft.status} onChange={e => setDraft(prev => ({ ...prev, status: e.target.value as MarketplacePostStatus }))}>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>Title<input value={draft.title} onChange={e => setDraft(prev => ({ ...prev, title: e.target.value }))} /></label>
        <label>Description<textarea value={draft.description} onChange={e => setDraft(prev => ({ ...prev, description: e.target.value }))} rows={3} /></label>
        <label>Have (one per line)<textarea value={draft.haveItemsText} onChange={e => setDraft(prev => ({ ...prev, haveItemsText: e.target.value }))} rows={3} /></label>
        <label>Need (one per line)<textarea value={draft.needItemsText} onChange={e => setDraft(prev => ({ ...prev, needItemsText: e.target.value }))} rows={3} /></label>
        <label className="marketplace-inline-check"><input type="checkbox" checked={draft.tradeEnabled} onChange={e => setDraft(prev => ({ ...prev, tradeEnabled: e.target.checked }))} />Trade</label>
        <label className="marketplace-inline-check"><input type="checkbox" checked={draft.saleEnabled} onChange={e => setDraft(prev => ({ ...prev, saleEnabled: e.target.checked }))} />Sale</label>
        {saleEnabled && <label>Price (optional)<input value={draft.salePrice} onChange={e => setDraft(prev => ({ ...prev, salePrice: e.target.value }))} placeholder="25" /></label>}
        <label>Note (optional)<textarea value={draft.note} onChange={e => setDraft(prev => ({ ...prev, note: e.target.value }))} rows={2} /></label>
      </div>
      <button onClick={() => onSave(draft)} disabled={!isValid}>Add Listing</button>
    </section>
  );
}
