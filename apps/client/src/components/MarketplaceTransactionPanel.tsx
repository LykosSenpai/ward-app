import type { MarketplaceTransaction } from "../clientTypes";

type Props = {
  transactions: MarketplaceTransaction[];
  onConfirm: (id: string) => void;
  onDeny: (id: string) => void;
  onCancel: (id: string) => void;
  onRefresh: () => void;
};

export function MarketplaceTransactionPanel({ transactions, onConfirm, onDeny, onCancel, onRefresh }: Props) {
  return (
    <section className="panel-card" style={{ marginTop: 16 }}>
      <h3>Marketplace Transactions</h3>
      <button onClick={onRefresh}>Refresh</button>
      {transactions.map(tx => (
        <div key={tx.id} style={{ borderTop: "1px solid #333", paddingTop: 8, marginTop: 8 }}>
          <div><strong>{tx.status}</strong> · expires {new Date(tx.expiresAt).toLocaleString()}</div>
          <div>Offer: {tx.offered.map(line => `${line.cardId} x${line.quantity}`).join(", ") || "-"}</div>
          <div>Request: {tx.requested.map(line => `${line.cardId} x${line.quantity}`).join(", ") || "-"}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={() => onConfirm(tx.id)} disabled={!(tx.status === "PENDING_CONFIRMATION" || tx.status === "CONFIRMED_BY_ONE_PARTY")}>Confirm</button>
            <button onClick={() => onDeny(tx.id)} disabled={tx.status === "COMPLETED"}>Deny</button>
            <button onClick={() => onCancel(tx.id)} disabled={tx.status === "COMPLETED"}>Cancel</button>
          </div>
        </div>
      ))}
    </section>
  );
}
