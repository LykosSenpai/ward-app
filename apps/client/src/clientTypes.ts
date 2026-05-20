import type {
  CardImageSet,
  MatchState as BaseMatchState,
  MarketplaceMatch,
  WardEngineEffect,
} from "@ward/shared";

export type {
  MarketplaceAutoListingSettings,
  MarketplaceAutoNeedRule,
  MarketplaceCardVariant,
  MarketplaceMatch,
  MarketplacePost,
  MarketplaceRetainOverride,
  MarketplaceTransaction,
  WardEngineEffect,
} from "@ward/shared";

export type ServerWelcome = {
  message: string;
  authenticated?: boolean;
  socketId: string;
  serverBootId?: string;
  serverStartedAt?: string;
};

export type AuthUser = {
  id: string;
  username: string;
  email?: string;
  emailVerifiedAt?: string;
  displayName: string;
  role: "PLAYER" | "HOST" | "DEVELOPER" | "ADMIN";
  canAccessDevTools: boolean;
  devToolsEnabled: boolean;
  discord?: {
    userId: string;
    username: string;
    globalName?: string;
    avatar?: string;
    linkedAt?: string;
  };
};

export type SupportTicketSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";
export type SupportTicketStatus = "OPEN" | "TRIAGED" | "RESOLVED" | "DISMISSED";
export type SupportTicketCategory = "BOARD_REPORT" | "SITE_REPORT";

export type SupportTicketSummary = {
  id: string;
  reporterUserId?: string;
  reporterUsername?: string;
  reporterDisplayName?: string;
  matchId?: string;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketDetail = SupportTicketSummary & {
  matchSnapshot: unknown;
  clientContext: Record<string, unknown>;
};

export type UserProfile = AuthUser & {
  email: string;
  emailVerifiedAt?: string;
  twoFactorEnabled: boolean;
  twoFactorEnabledAt?: string;
  ownedUniqueCards: number;
  ownedTotalCopies: number;
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

export type MatchDeltaOperation =
  | { op: "add" | "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

export type MatchDeltaPayload = {
  matchId: string;
  operations: MatchDeltaOperation[];
};

export type CardPackSummary = {
  id: string;
  name: string;
  version: string;
  cardCount: number;
  updatedAt: string;
};

export type DeckSummary = {
  id: string;
  name: string;
  cardCount: number;
};

export type DeckFormat = "FREE_PLAY" | "TOURNAMENT";

export type DeckDetail = {
  id: string;
  name: string;
  cardIds: string[];
  cardArtKeys?: string[];
  format?: DeckFormat;
  ownerUserId?: string;
  ownerDisplayName?: string;
  tournamentProofPhotos?: TournamentDeckProofPhoto[];
  tournamentVerification?: TournamentDeckVerification;
};

export type TournamentDeckProofPhoto = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByUserId: string;
  url?: string;
};

export type TournamentDeckVerification = {
  status: "UNSUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";
  submittedAt?: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  notes?: string;
};

export type MatchLobbyStatus = "OPEN" | "IN_MATCH" | "CLOSED";

export type MatchLobbyPlayer = {
  userId: string;
  displayName: string;
  seat: number;
  selectedDeckId?: string;
  ready: boolean;
  isClone?: boolean;
  ownerUserId?: string;
};

export type MatchLobby = {
  id: string;
  name: string;
  status: MatchLobbyStatus;
  format?: "FREE_PLAY" | "TOURNAMENT";
  mode?: "MULTIPLAYER" | "SOLO";
  hostUserId: string;
  selectedPackIds: string[];
  matchId?: string;
  players: MatchLobbyPlayer[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  closedAt?: string;
  closeReason?: "EMPTY" | "MATCH_COMPLETE" | "IDLE_TIMEOUT" | "SAVED_AND_EXITED";
  ageMs?: number;
  idleMs?: number;
  staleAfterMs?: number;
  autoCloseAt?: string;
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
  hasZeroArtVariant?: boolean;

  generation?: string;
  edition?: string;
  rarity?: string;
  cardNumber?: string;
  effectCount?: number;
  effectTypes?: string[];

  artworkEffect?: string;
  artworkTags?: string[];
  effects?: WardEngineEffect[];
  image?: CardImageSet;

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
export type CardOwnershipVariant = "DEFAULT" | "HOLO" | "ZERO" | "ZERO_HOLO";

export type CardOwnershipRecord = Record<CardOwnershipVariant, number>;

export type CollectionCompletionCardRequest = {
  cardId: string;
  requiredQuantity: number;
  ownership?: Partial<CardOwnershipRecord>;
};

export type CollectionCompletionSummary = {
  cardId: string;
  requiredQuantity: number;
  ownedQuantity: number;
  missingQuantity: number;
  ownership: CardOwnershipRecord;
};

export type MarketplaceMyMatchesGroup = {
  postId: string;
  matches: MarketplaceMatch[];
};

export type VariantCompletionSummary = {
  variant: CardOwnershipVariant;
  ownedCompleteCards: number;
  totalCards: number;
  missingCards: number;
  percentComplete: number;
};

export type MissingCollectionItem = {
  cardId: string;
  cardName: string;
  generation: string;
  cardNumber: string;
  variant: CardOwnershipVariant;
  ownedQuantity: number;
  requiredQuantity: number;
  missingQuantity: number;
};

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
  | "BLOCKED"
  | "MANUAL";

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
  status?: EffectRuntimeTestStatus;
  engineStatus: EffectRuntimeTestStatus;
  boardAffordanceStatus: EffectRuntimeTestStatus;
  boardAnimationStatus: EffectRuntimeTestStatus;
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
  engineStatus?: EffectRuntimeTestStatus;
  boardAffordanceStatus?: EffectRuntimeTestStatus;
  boardAnimationStatus?: EffectRuntimeTestStatus;
  testIssueType?: EffectRuntimeIssueType;
  testNotes?: string;
  lastTestedAt?: string;
  testedBy?: string;
};

export type LlmMode = "LLM" | "LOCAL_FALLBACK";

export type FeatureKey =
  | "card-library"
  | "deck-builder"
  | "marketplace"
  | "saved-matches"
  | "play-table"
  | "match-lobby"
  | "online-gameplay"
  | "discord-auth"
  | "effect-tools"
  | "admin-tools";

export type ServerFeatureFlag = {
  key: FeatureKey;
  label: string;
  description: string;
  enabledForPlayers: boolean;
  adminCanPreview: boolean;
  adminOnly: boolean;
  sortOrder: number;
  updatedAt: string;
};

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
