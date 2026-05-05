import type { MatchState as BaseMatchState, WardEngineEffect } from "@ward/shared";

export type ServerWelcome = {
  message: string;
  socketId: string;
};

export type SavedMatchSummary = {
  matchId: string;
  format: string;
  turnNumber: number;
  turnCycleNumber: number;
  activePlayerId: string;
  phase: string;
  updatedAt: string;
};

export type CardPackSummary = {
  id: string;
  name: string;
  version: string;
  cardCount: number;
};

export type DeckSummary = {
  id: string;
  name: string;
  cardCount: number;
};

export type DeckDetail = {
  id: string;
  name: string;
  cardIds: string[];
};

export type SetupOptions = {
  cardPacks: CardPackSummary[];
  decks: DeckSummary[];
};

export type CardLibraryCardSummary = {
  id: string;
  name: string;
  packId: string;
  cardType: "CREATURE" | "MAGIC";

  generation?: string;
  edition?: string;
  rarity?: string;
  cardNumber?: string;
  effectCount?: number;
  effectTypes?: string[];

  artworkEffect?: string;
  artworkTags?: string[];
  effects?: WardEngineEffect[];

  deckLimit: number;
  deckLimitReason?: string;

  creatureType?: string;
  armorLevel?: number;
  speed?: number;
  hp?: number;
  attackDice?: number;
  modifier?: number;

  magicType?: "STANDARD" | "INFINITE" | "LIGHTNING" | "BATTLE_LIGHTNING";
  magicSubType?: "FIELD" | "EQUIP" | "NONE";
  text?: string;
};

export type CardOwnershipMap = Record<string, number>;

export type CardDefinitionWithClientFields = BaseMatchState["cardCatalog"][string] & {
  text?: string;
  effects?: unknown[];
};

export type AppMatchState = Omit<BaseMatchState, "cardCatalog"> & {
  cardCatalog: Record<string, CardDefinitionWithClientFields>;
};

export type ManualEffectStatKey = "armorLevel" | "speed" | "attackDice" | "modifier";

export type ManualEffectDurationType =
  | "TARGET_PLAYER_TURN_STARTS"
  | "PERMANENT_UNTIL_SOURCE_REMOVED";

export type RuntimeSupportLevel = "SUPPORTED" | "PARTIAL" | "MANUAL" | "UNSUPPORTED";

export type EffectRuntimeTestStatus =
  | "UNTESTED"
  | "WORKING"
  | "PARTIAL"
  | "BROKEN"
  | "BLOCKED_RUNTIME"
  | "BLOCKED_DATA"
  | "NEEDS_RULES_REVIEW";

export type EffectRuntimeIssueType =
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

export type EffectRuntimeTestStatusRecord = {
  key: string;
  packId: string;
  cardId: string;
  cardName: string;
  effectId: string;
  trigger?: string;
  actionType: string;
  status: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
  notes: string;
  lastTestedAt?: string;
  testedBy?: string;
};

export type EffectCoverageRow = {
  packId: string;
  cardId: string;
  cardName: string;
  cardType: string;
  generation?: string;
  cardNumber?: string;
  effectId: string;
  trigger?: string;
  actionType: string;
  reusableFunction?: string;
  effectGroup?: string;
  supportLevel: RuntimeSupportLevel;
  runtimeRoute: string;
  supportNotes: string;
  needsReview?: boolean;
  effectNotes?: string;
  testStatus?: EffectRuntimeTestStatus;
  testIssueType?: EffectRuntimeIssueType;
  testNotes?: string;
  lastTestedAt?: string;
  testedBy?: string;
};

export type LlmMode = "LLM" | "LOCAL_FALLBACK";

export type LlmServiceStatus = {
  configured: boolean;
  mode: "openai-compatible" | "local-fallback";
  model: string;
  baseUrl: string;
  message: string;
};

export type LlmForcedRollPlan = {
  kind: "HIT_ROLL" | "ATTACK_DAMAGE_ROLL" | "EFFECT_ROLL" | "SPEED_TIE_ROLL" | "SELF_DAMAGE_ROLL" | "GENERIC_ROLL";
  dice: number[];
  label?: string;
};

export type LlmExpectedAssertion = {
  label: string;
  path: string;
  operator: "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan" | "exists" | "notExists";
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
    status: EffectRuntimeTestStatus;
    issueType: EffectRuntimeIssueType;
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
  passFailSuggestion: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
  evidence: string[];
  suspectedIssues: string[];
  suggestedNextSteps: string[];
  coverageSuggestion: {
    status: EffectRuntimeTestStatus;
    issueType: EffectRuntimeIssueType;
    notes: string;
  };
};

export type LlmBatchProgress = {
  stage: "started" | "chunk" | "provider" | "fallback" | "done";
  completed: number;
  total: number;
  message: string;
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
  operator: "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan" | "exists" | "notExists";
  expected?: unknown;
  actual?: unknown;
  status: "PASS" | "FAIL" | "SKIPPED";
};

export type LlmHeadlessVariantResult = {
  name: string;
  status: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
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
  status: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
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

export type LlmPhase4ReportSummary = {
  fileName: string;
  jsonFileName: string;
  relativePath: string;
  jsonRelativePath: string;
  outputDir: string;
  generatedAt: string;
  totalPlans: number;
  coverageRecordCount: number;
  needsFixCount: number;
};

