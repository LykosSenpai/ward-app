import type { WardEngineEffect } from "@ward/shared";
import type {
  CardLibraryCardSummary,
  CardPackSummary,
  EffectCoverageRow,
  EffectRuntimeIssueType,
  EffectRuntimeTestStatus
} from "../clientTypes";
import { EffectCoveragePage } from "./EffectCoveragePage";
import { EffectDevToolPage } from "./EffectDevToolPage";

type EffectToolsPageProps = {
  cardPacks: CardPackSummary[];
  selectedPackIds: string[];
  cardLibrary: CardLibraryCardSummary[];
  coverageRows: EffectCoverageRow[];
  onToggleSelectedPack: (packId: string) => void;
  onRefreshCardLibrary: () => void;
  onRefreshCoverage: () => void;
  onSaveCardEffects: (data: {
    packId: string;
    cardId: string;
    text: string;
    effects: WardEngineEffect[];
  }) => void;
  onCreateTestMatch: (data: {
    packIds: string[];
    player1CardIds: string[];
    player2CardIds: string[];
    player1StartingHandSize?: number;
    player2StartingHandSize?: number;
  }) => void;
  onCreateScenarioMatch: (row: EffectCoverageRow) => void;
  onSaveTestStatus: (
    row: EffectCoverageRow,
    status: EffectRuntimeTestStatus,
    issueType: EffectRuntimeIssueType,
    notes: string
  ) => void;
};

export function EffectToolsPage({
  cardPacks,
  selectedPackIds,
  cardLibrary,
  coverageRows,
  onToggleSelectedPack,
  onRefreshCardLibrary,
  onRefreshCoverage,
  onSaveCardEffects,
  onCreateTestMatch,
  onCreateScenarioMatch,
  onSaveTestStatus
}: EffectToolsPageProps) {
  return (
    <section className="effect-tools-combined-page">
      <section className="card effect-tools-combined-header">
        <div>
          <h2>Effect Tools</h2>
          <p>
            Combined card effect editor, runtime coverage tracker, and test match tools. The original Dev Tool and Coverage views are preserved below so nothing is removed.
          </p>
        </div>

        <div className="actions small-actions">
          <a className="app-page-nav-button" href="#effect-dev-tool-panel">Effect Editor</a>
          <a className="app-page-nav-button" href="#effect-coverage-panel">Coverage Tracker</a>
        </div>
      </section>

      <section id="effect-dev-tool-panel" className="effect-tools-combined-section">
        <EffectDevToolPage
          cardPacks={cardPacks}
          selectedPackIds={selectedPackIds}
          cardLibrary={cardLibrary}
          onToggleSelectedPack={onToggleSelectedPack}
          onRefreshCardLibrary={() => {
            onRefreshCardLibrary();
            onRefreshCoverage();
          }}
          onSaveCardEffects={onSaveCardEffects}
          onCreateTestMatch={onCreateTestMatch}
        />
      </section>

      <section id="effect-coverage-panel" className="effect-tools-combined-section">
        <EffectCoveragePage
          cardPacks={cardPacks}
          selectedPackIds={selectedPackIds}
          rows={coverageRows}
          onToggleSelectedPack={onToggleSelectedPack}
          onRefreshCoverage={onRefreshCoverage}
          onCreateScenarioMatch={onCreateScenarioMatch}
          onSaveTestStatus={onSaveTestStatus}
        />
      </section>
    </section>
  );
}
