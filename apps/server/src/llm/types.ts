import type { DevRollKind } from "@ward/shared";

export type LlmMode = "LLM" | "LOCAL_FALLBACK";

export type LlmServiceStatus = {
  configured: boolean;
  mode: "openai-compatible" | "local-fallback";
  model: string;
  baseUrl: string;
  message: string;
};

export type LlmCoverageSuggestionStatus =
  | "UNTESTED"
  | "WORKING"
  | "PARTIAL"
  | "BROKEN"
  | "BLOCKED_RUNTIME"
  | "BLOCKED_DATA"
  | "NEEDS_RULES_REVIEW";

export type LlmCoverageIssueType =
  | "NONE"
  | "WRONG_TARGET"
  | "WRONG_TIMING"
  | "WRONG_DURATION"
  | "WRONG_COUNTER"
  | "WRONG_DAMAGE"
  | "WRONG_STAT_MODIFIER"
  | "MISSING_BUTTON"
  | "MISSING_PROMPT"
  | "MISSING_CHAIN_WINDOW"
  | "MISSING_CLEANUP"
  | "UNSUPPORTED_ACTION_TYPE";

export type LlmForcedRollPlan = {
  kind: DevRollKind;
  dice: number[];
  label?: string;
};

export type LlmExpectedAssertion = {
  label: string;
  path: string;
  operator: "equals" | "notEquals" | "contains" | "notContains" | "greaterThan" | "lessThan" | "exists" | "notExists";
  value?: unknown;
};

export type LlmEffectTestPlan = {
  schemaVersion: 1;
  generatedAt: string;
  mode: LlmMode;
  providerWarning?: string;

  card: {
    packId: string;
    cardId: string;
    cardName: string;
    cardType: string;
    cardNumber?: string;
    generation?: string;
    rawText?: string;
  };

  effect?: {
    effectId: string;
    trigger?: string;
    actionType: string;
    effectGroup?: string;
    target?: string;
    value?: string;
    durationText?: string;
    reusableFunction?: string;
  };

  title: string;
  summary: string;

  setup: {
    phase?: "DRAW" | "SUMMON_MAGIC" | "COMBAT" | "SECOND_MAGIC" | "END";
    activePlayerId?: "player_1" | "player_2";
    player1Cards?: string[];
    player2Cards?: string[];
    forcedRolls?: LlmForcedRollPlan[];
    notes?: string[];
  };

  steps: string[];
  expectedAssertions: LlmExpectedAssertion[];
  manualVerification: string[];
  riskNotes: string[];

  coverageSuggestion: {
    status: LlmCoverageSuggestionStatus;
    issueType: LlmCoverageIssueType;
    notes: string;
  };

  regression: {
    fixtureName: string;
    tags: string[];
  };
};

export type LlmEffectResultReview = {
  schemaVersion: 1;
  generatedAt: string;
  mode: LlmMode;
  providerWarning?: string;

  cardId: string;
  effectId?: string;
  matchId?: string;

  summary: string;
  passFailSuggestion: LlmCoverageSuggestionStatus;
  issueType: LlmCoverageIssueType;
  evidence: string[];
  suspectedIssues: string[];
  suggestedNextSteps: string[];

  coverageSuggestion: {
    status: LlmCoverageSuggestionStatus;
    issueType: LlmCoverageIssueType;
    notes: string;
  };
};

export type LlmRegressionScenarioSummary = {
  fileName: string;
  cardId: string;
  effectId?: string;
  title: string;
  updatedAt: string;
};


export type LlmHeadlessAssertionResult = {
  label: string;
  path: string;
  operator: "equals" | "notEquals" | "contains" | "notContains" | "greaterThan" | "lessThan" | "exists" | "notExists";
  expected?: unknown;
  actual?: unknown;
  status: "PASS" | "FAIL" | "SKIPPED";
};

export type LlmHeadlessVariantResult = {
  name: string;
  status: LlmCoverageSuggestionStatus;
  issueType: LlmCoverageIssueType;
  summary: string;
  evidence: string[];
  eventTypes: string[];
  assertionResults: LlmHeadlessAssertionResult[];
  beforeSummary: string;
  afterSummary: string;
  pendingPrompt?: string;
  pendingEffectTargetPrompt?: string;
  manualEffectQueueCount: number;
};

export type LlmDirectEffectSmokeTestResult = {
  schemaVersion: 1;
  generatedAt: string;
  key: string;
  matchId: string;
  cardId: string;
  cardName: string;
  effectId?: string;
  status: LlmCoverageSuggestionStatus;
  issueType: LlmCoverageIssueType;
  summary: string;
  evidence: string[];
  eventTypes: string[];
  pendingPrompt?: string;
  pendingEffectTargetPrompt?: string;
  manualEffectQueueCount: number;
  runMode?: "DIRECT_SMOKE" | "HEADLESS_ENGINE";
  variantResults?: LlmHeadlessVariantResult[];
  assertionResults?: LlmHeadlessAssertionResult[];
  beforeSummary?: string;
  afterSummary?: string;
};
