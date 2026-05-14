import type { ServerFeatureFlag } from "../clientTypes";

type Props = {
  features: ServerFeatureFlag[];
  onToggleFeature: (key: ServerFeatureFlag["key"], enabledForPlayers: boolean) => Promise<void>;
};

export function AdminControlsPage({ features, onToggleFeature }: Props) {
  return (
    <section className="panel">
      <h2>Admin Controls</h2>
      <p>Feature Rollout</p>
      <div style={{ display: "grid", gap: 10 }}>
        {features.map(feature => (
          <label key={feature.key} style={{ border: "1px solid #2d3748", borderRadius: 8, padding: 10 }}>
            <div><strong>{feature.label}</strong></div>
            <div style={{ opacity: 0.8 }}>{feature.description}</div>
            <div style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={feature.enabledForPlayers}
                disabled={feature.adminOnly}
                onChange={event => { void onToggleFeature(feature.key, event.currentTarget.checked); }}
              />
              {" "}Enabled for players
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
