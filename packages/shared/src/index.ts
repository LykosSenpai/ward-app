export type CardType = "CREATURE" | "MAGIC";

export type MagicType = "STANDARD" | "INFINITE" | "LIGHTNING" | "BATTLE_LIGHTNING";

export type MagicSubType = "FIELD" | "EQUIP" | "NONE";

export type CardRarity =
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Epic"
  | "Legendary"
  | "Mythic"
  | "Promo"
  | string;

export type WardCreatureType =
  | "Beast"
  | "Bug"
  | "Cosmic"
  | "Demon"
  | "Dragon"
  | "Elemental"
  | "Humanoid"
  | "Dinosaur"
  | "Undead"
  | "Mechanical"
  | string;

export type WardArtworkTrait =
  | "WATER"
  | "FIRE"
  | "ICE"
  | "LIGHTNING"
  | "EARTH"
  | "FOREST"
  | "WINGS"
  | "WEAPON"
  | "SWORD"
  | "AXE"
  | "BOW"
  | "ARMOR"
  | "FLYING"
  | "UNDERWATER"
  | "SKY"
  | "CAVE"
  | "CASTLE"
  | "TREE"
  | "MOON"
  | "SUN"
  | "DARKNESS"
  | "LIGHT"
  | string;

export type ZoneType =
  | "DECK"
  | "HAND"
  | "PRIMARY_CREATURE"
  | "LIMITED_SUMMON"
  | "MAGIC_SLOT"
  | "CEMETERY"
  | "CHAIN"
  | "REMOVED_FROM_GAME";

export type TurnPhase =
  | "DRAW"
  | "SUMMON_MAGIC"
  | "COMBAT"
  | "SECOND_MAGIC"
  | "END";

export type MatchFormat = "1v1" | "2v2" | "3v3" | "raid";
export type BattleCreatureKind = "PRIMARY_CREATURE" | "LIMITED_SUMMON";
export type MatchStatus = "ACTIVE" | "COMPLETE";

export type CannotInflictAttackDamageBattlePolicy = "DAMAGE_ONLY" | "SKIP_BATTLE";

export type CreatureCardDefinition = {
  id: string;
  name: string;
  cardType: "CREATURE";
  creatureType: WardCreatureType;
  armorLevel: number;
  speed: number;
  hp: number;
  attackDice: number;
  modifier: number;

  generation?: string;
  edition?: string;
  rarity?: CardRarity;
  cardNumber?: string;

  /**
   * Human-readable artwork condition notes, such as:
   * "Artwork has water in the background and the creature has wings."
   */
  artworkEffect?: string;

  /**
   * Runtime-readable artwork tags used by effect conditions.
   * Examples: WATER, WINGS, WEAPON, SKY.
   */
  artworkTags?: WardArtworkTrait[];

  text?: string;
  effects?: WardEngineEffect[];
};

export type MagicCardDefinition = {
  id: string;
  name: string;
  cardType: "MAGIC";
  magicType: MagicType;
  magicSubType: MagicSubType;

  generation?: string;
  edition?: string;
  rarity?: CardRarity;
  cardNumber?: string;

  /**
   * Human-readable artwork condition notes.
   */
  artworkEffect?: string;

  /**
   * Runtime-readable artwork tags used by effect conditions.
   */
  artworkTags?: WardArtworkTrait[];

  text?: string;
  effects?: WardEngineEffect[];
};

export type CardDefinition = CreatureCardDefinition | MagicCardDefinition;

export type StatModifierKey =
  | "armorLevel"
  | "speed"
  | "attackDice"
  | "modifier";

export type StatModifierDurationType =
  | "TARGET_PLAYER_TURN_STARTS"
  | "PERMANENT_UNTIL_SOURCE_REMOVED";

export type ActiveStatModifier = {
  id: string;

  sourceEffectId: string;
  sourceCardInstanceId: string;
  sourceCardName: string;

  stat: StatModifierKey;
  delta: number;

  durationType: StatModifierDurationType;

  appliedTurnNumber: number;
  appliedTurnCycle: number;

  expiresOnPlayerId?: string;
  expiresAtPlayerTurnStartCount?: number;
};


export type ActiveCreatureStatusFlag =
  | "canInflictAtkDamage"
  | "canBeSacrificed"
  | "canInitiateBattle"
  | "canReceiveDamage"
  | "canChangeControl"
  | "canBeRemovedFromField";

export type ActiveCreatureStatus = {
  id: string;

  sourceEffectId: string;
  sourceCardInstanceId: string;
  sourceCardName: string;
  sourcePlayerId: string;

  status: string;
  label: string;
  flags: Partial<Record<ActiveCreatureStatusFlag, boolean>>;

  durationType: StatModifierDurationType;
  appliedTurnNumber: number;
  appliedTurnCycle: number;
  expiresOnPlayerId?: string;
  expiresAtPlayerTurnStartCount?: number;
};

export type ActiveRecurringCreatureEffect = {
  id: string;

  sourceEffectId: string;
  sourceCardInstanceId: string;
  sourceCardName: string;
  sourcePlayerId: string;

  effectType: "DAMAGE_OVER_TIME" | "HEAL_OVER_TIME";
  amount: number;
  label: string;
  tickTiming: "BEGINNING_OF_COMBAT_PHASE" | "END_OF_COMBAT_PHASE" | "BEGINNING_OF_TURN";
  stackRule?: "DO_NOT_STACK" | string;

  remainingTicks: number;
  lastTickTurnNumber?: number;
  lastTickTurnCycle?: number;

  /**
   * Recurring effects are registered when their trigger resolves. Damage DOT
   * ticks before the source player's eligible Combat Phase begins so creature
   * HP is accurate before battle selection, even if combat is skipped.
   * Non-damage recurring countdown/update effects can use combat-end timing.
   * The listed turn-cycle number is treated as the total number of ticks.
   */
  nextTickPlayerId?: string;
  nextTickTurnStartCount?: number;

  /**
   * Used to resolve multiple DOT/HOT effects in the order they were applied, even
   * when they are attached to different creatures.
   */
  appliedSequenceNumber?: number;

  refreshAtEndOfSourceOwnerTurn?: boolean;
  refreshAmount?: number;
  maxRefreshCounter?: number;
  expiresWhenSourceLeaves?: boolean;
  healImmediatelyOnApply?: boolean;

  durationType: StatModifierDurationType;
  appliedTurnNumber: number;
  appliedTurnCycle: number;
  expiresOnPlayerId?: string;
  expiresAtPlayerTurnStartCount?: number;
};

export type ActiveEffectInstanceKind =
  | "STATUS"
  | "DAMAGE_OVER_TIME"
  | "HEAL_OVER_TIME"
  | "REGENERATING_HEAL"
  | "STAT_MODIFIER"
  | "STATIC_MODIFIER"
  | "SOURCE_LINK"
  | "ANCHOR"
  | "OTHER";

export type ActiveEffectInstance = {
  id: string;
  kind: ActiveEffectInstanceKind;

  sourceEffectId: string;
  sourceCardInstanceId: string;
  sourceCardName: string;
  sourcePlayerId: string;

  targetCardInstanceId?: string;
  targetCardName?: string;
  targetPlayerId?: string;

  actionType: string;
  label: string;
  status?: string;
  amount?: number;
  damageAmount?: number;
  healAmount?: number;

  destinationZone?: "HAND" | "CEMETERY" | "DECK" | "REMOVED_FROM_GAME" | string;
  sourcePlacement?: "MAGIC_SLOT" | "TEMP_EQUIP" | string;

  effectType?: "DAMAGE_OVER_TIME" | "HEAL_OVER_TIME" | string;
  tickTiming?: "BEGINNING_OF_COMBAT_PHASE" | "END_OF_COMBAT_PHASE" | "BEGINNING_OF_TURN" | string;
  stackRule?: "DO_NOT_STACK" | string;

  flags?: Partial<Record<ActiveCreatureStatusFlag, boolean>>;

  durationType?: StatModifierDurationType | string;
  durationText?: string;
  turnCyclesTotal?: number;
  turnCyclesRemaining?: number;
  expiresOnPlayerId?: string;
  expiresAtPlayerTurnStartCount?: number;

  ticksTotal?: number;
  ticksRemaining?: number;
  nextTickPlayerId?: string;
  nextTickTurnStartCount?: number;
  appliedSequenceNumber?: number;

  refreshAtEndOfSourceOwnerTurn?: boolean;
  refreshAmount?: number;
  maxRefreshCounter?: number;

  preventsAttackDamage?: boolean;
  preventsSacrifice?: boolean;
  preventsBattle?: boolean;
  preventsHpDamage?: boolean;
  preventsControlChange?: boolean;
  preventsFieldRemoval?: boolean;

  rollKind?: "HIT_ROLL" | "ATTACK_DAMAGE_ROLL" | string;
  diceLimitMode?: "MAX" | "SET" | string;
  diceLimitValue?: number;

  sourceLinked?: boolean;
  expiresWhenSourceLeaves?: boolean;
  healImmediatelyOnApply?: boolean;

  lastTickTurnNumber?: number;
  lastTickTurnCycle?: number;

  appliedTurnNumber: number;
  appliedTurnCycle: number;
  debug?: string[];
};

export type CardInstance = {
  instanceId: string;
  cardId: string;

  ownerPlayerId: string;
  controllerPlayerId: string;

  zone: ZoneType;

  currentHp?: number;
  baseHp?: number;

  activeStatModifiers?: ActiveStatModifier[];
  activeStatuses?: ActiveCreatureStatus[];
  activeRecurringEffects?: ActiveRecurringCreatureEffect[];
  activeEffectInstances?: ActiveEffectInstance[];

  attachedToInstanceId?: string;
  anchorSourceInstanceId?: string;

  isLimitedSummon?: boolean;
  effectsSuppressed?: boolean;
};

export type PlayerField = {
  primaryCreature?: CardInstance;
  limitedSummons: CardInstance[];
  magicSlots: CardInstance[];
};

export type PlayerState = {
  id: string;
  displayName: string;
  teamId?: string;

  deck: CardInstance[];
  hand: CardInstance[];
  cemetery: CardInstance[];
  removedFromGame: CardInstance[];

  field: PlayerField;

  cemeteryCreatureHpTotal: number;

  hasLost: boolean;
  lossReason?: string;

  turnFlags: {
  hasTakenFirstTurn: boolean;
  drawnThisTurn: boolean;
  playedCreatureThisTurn: boolean;
  normalSummonUsed: boolean;
  killedOwnCreatureThisTurn: boolean;
  hasBattledThisCombat: boolean;
  battleUsedCreatureInstanceIds: string[];
    };
};

export type TurnState = {
  activePlayerId: string;
  turnNumber: number;
  turnCycleNumber: number;
  phase: TurnPhase;
  firstTurnCycleComplete: boolean;
  currentTurnOrder: string[];
  currentTurnIndex: number;

  turnStartCountsByPlayer: Record<string, number>;
};

export type DevRollKind =
  | "HIT_ROLL"
  | "ATTACK_DAMAGE_ROLL"
  | "EFFECT_ROLL"
  | "SPEED_TIE_ROLL"
  | "SELF_DAMAGE_ROLL"
  | "GENERIC_ROLL";

export type DevForcedRoll = {
  id: string;
  kind: DevRollKind;
  dice: number[];
  label?: string;
  createdAt: string;
};

export type DevRollState = {
  forcedRollQueue: DevForcedRoll[];
};

export type MatchDevToolsState = {
  rolls: DevRollState;
};

export type MatchState = {
  matchId: string;
  format: MatchFormat;
  rulesetIds: string[];

  status: MatchStatus;
  winnerPlayerId?: string;
  losingPlayerId?: string;
  completionReason?: string;
  completedAt?: string;

  cardCatalog: Record<string, CardDefinition>;
  setup: MatchSetupState;
  pendingPrompt?: PendingPrompt;
  pendingChain?: MagicChainState;
  pendingEffectTargetPrompt?: PendingEffectTargetPrompt;
  pendingBattle?: PendingBattleSession;
  pendingEffectRoll?: PendingEffectRollSession;
  manualEffectQueue: ManualEffectRequest[];

    players: PlayerState[];
    chainZone: CardInstance[];
    turn: TurnState;

  settings: {
    cemeteryHpLimit: number;
    eliminationMode: "called_out" | "automatic" | "judge_confirmed";
    tournamentMode: boolean;
    cannotInflictAttackDamageBattlePolicy: CannotInflictAttackDamageBattlePolicy;
  };

  lastBattle?: BattleResult;
  devTools?: MatchDevToolsState;
  eventLog: GameEvent[];
};

export type GameEvent = {
  id: string;
  sequenceNumber: number;
  timestamp: string;
  type: string;
  playerId?: string;
  payload?: unknown;
};


export type ValidationSeverity = "ERROR" | "WARNING";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
};

export type DeckValidationResult = {
  isLegal: boolean;
  deckSize: number;
  creatureCount: number;
  magicCount: number;
  cardCounts: Record<string, number>;
  issues: ValidationIssue[];
};

export type MatchSetupState = {
  decksShuffled: boolean;
  firstTurnDrawsByPlayer: Record<string, boolean>;
  primaryReplacementRequiredForPlayerId?: string;
  handDiscardRequiredForPlayerId?: string;
  deckValidation: Record<string, DeckValidationResult>;
};

export type CardPackDefinition = {
  id: string;
  name: string;
  version: string;
  cards: CardDefinition[];
};

export type DeckListDefinition = {
  id: string;
  name: string;
  cardIds: string[];
};

export type RevealedCardInfo = {
  cardInstanceId: string;
  cardId: string;
  name: string;
  cardType: CardType;
};

export type PendingPrompt =
  | {
      id: string;
      type: "NO_CREATURE_REDRAW_REVEAL";
      requestingPlayerId: string;
      approvingPlayerId: string;
      revealedCards: RevealedCardInfo[];
      redrawCount: number;
    };

export type BattleStrikeResult = {
  attackerPlayerId: string;
  defenderPlayerId: string;

  attackerCreatureInstanceId: string;
  defenderCreatureInstanceId: string;
  attackerCreatureKind: BattleCreatureKind;
  defenderCreatureKind: BattleCreatureKind;
  attackerCreatureName: string;
  defenderCreatureName: string;

  hitRollDice: number[];
  hitRollModifier: number;
  hitRollTotal: number;
  hitDiceCount?: number;
  modifiers?: ManualBattleStrikeModifiers;

  hit: boolean;
  criticalHit: boolean;
  criticalMiss: boolean;

  selfDamageDice?: number[];
  selfDamageDealt?: number;
  attackerRemainingHp?: number;
  attackerKilledByCriticalMiss?: boolean;
  selfDamagePreventedReason?: string;

  damageRollDice?: number[];
  attackDamageModifier?: number;
  damageDiceCount?: number;
  damageBeforeCritical?: number;
  damageAfterCritical?: number;
  damageAfterModifiers?: number;
  damageDealt: number;
  damagePreventedReason?: string;

  defenderRemainingHp: number;
  defenderKilled: boolean;
};

export type BattleResult = {
  id: string;
  timestamp: string;

  attackingPlayerId: string;
  defendingPlayerId: string;
  attackingCreatureInstanceId: string;
  defendingCreatureInstanceId: string;
  attackingCreatureKind: BattleCreatureKind;
  defendingCreatureKind: BattleCreatureKind;

  firstStrikePlayerId: string;
  secondStrikePlayerId?: string;

  speedTie: boolean;
  speedTieRolls?: Record<string, number[]>;

  strikes: BattleStrikeResult[];

  combatPhaseEnded: boolean;
  message: string;
};


export type BattleParticipantSnapshot = {
  playerId: string;
  creatureInstanceId: string;
  creatureKind: BattleCreatureKind;
  creatureName: string;
  armorLevel: number;
  speed: number;
  attackDice: number;
  modifier: number;
  currentHp: number;
  baseHp: number;
};

export type BattleSpeedTieRound = {
  attackingCreatureRoll: number;
  defendingCreatureRoll: number;
};

export type BattleStrikeRole = "FIRST_STRIKE" | "RETALIATION";

export type BattleStrikeStatus =
  | "AWAITING_HIT_ROLL"
  | "AWAITING_EFFECT_ROLL"
  | "AWAITING_DAMAGE_ROLL"
  | "AWAITING_DAMAGE_APPLICATION"
  | "RESOLVED";

export type BattleDamageTarget = "DEFENDER" | "ATTACKER" | "NONE";

export type ManualBattleForceHitResult = "AUTO" | "FORCE_HIT" | "FORCE_MISS";

export type ManualBattleSpeedOverride = "AUTO" | "ATTACKER_FIRST" | "DEFENDER_FIRST";

export type ManualBattleSpeedModifiers = {
  attackingSpeedDelta: number;
  defendingSpeedDelta: number;
  override: ManualBattleSpeedOverride;
  note?: string;
};

export type ManualBattleStrikeModifiers = {
  hitDiceDelta: number;
  hitDiceLimit?: number;
  hitFlatBonus: number;
  forceHitResult: ManualBattleForceHitResult;
  damageDiceDelta: number;
  damageFlatBonus: number;
  damageMultiplier: number;
  preventAttackDamage: boolean;
  note?: string;
};

export type BattleEffectSuggestionKind =
  | "SPEED"
  | "STRIKE"
  | "BATTLE_TRIGGER"
  | "INFO";

export type BattleEffectSuggestion = {
  id: string;
  kind: BattleEffectSuggestionKind;

  sourceCardInstanceId: string;
  sourceCardId: string;
  sourceCardName: string;
  sourcePlayerId: string;
  sourceZone: ZoneType | "FIELD";

  trigger?: string;
  actionType?: string;
  effectId?: string;

  appliesToPlayerId?: string;
  appliesToCreatureInstanceId?: string;
  appliesToRole?: "DECLARED_ATTACKER" | "DECLARED_DEFENDER" | "STRIKE_ATTACKER" | "STRIKE_DEFENDER" | "BOTH";

  label: string;
  note?: string;

  speedModifiers?: Partial<ManualBattleSpeedModifiers>;
  strikeModifiers?: Partial<ManualBattleStrikeModifiers>;
};

export type ManualBattleStrike = {
  id: string;
  role: BattleStrikeRole;
  status: BattleStrikeStatus;

  modifiers: ManualBattleStrikeModifiers;

  attacker: BattleParticipantSnapshot;
  defender: BattleParticipantSnapshot;

  hitRollDice?: number[];
  hitRollModifier?: number;
  hitRollTotal?: number;
  defenderArmorLevel?: number;
  hitDiceCount?: number;

  hit?: boolean;
  criticalHit?: boolean;
  criticalMiss?: boolean;

  selfDamageDice?: number[];
  selfDamageDealt?: number;
  selfDamagePreventedReason?: string;
  attackerRemainingHp?: number;
  attackerKilledByCriticalMiss?: boolean;

  damageRollDice?: number[];
  attackDamageModifier?: number;
  damageDiceCount?: number;
  damageBeforeCritical?: number;
  damageAfterCritical?: number;
  damageAfterModifiers?: number;
  damageDealt?: number;
  damageTarget: BattleDamageTarget;
  damagePreventedReason?: string;

  defenderRemainingHp?: number;
  defenderKilled?: boolean;

  message?: string;
};

export type PendingBattleStatus =
  | "AWAITING_SPEED_CHECK"
  | "AWAITING_HIT_ROLL"
  | "AWAITING_DAMAGE_ROLL"
  | "AWAITING_DAMAGE_APPLICATION"
  | "AWAITING_EFFECT_ROLL"
  | "COMPLETE";

export type PendingBattleSession = {
  id: string;
  startedAt: string;
  updatedAt: string;

  status: PendingBattleStatus;

  attackingPlayerId: string;
  defendingPlayerId: string;

  declaredAttacker: BattleParticipantSnapshot;
  declaredDefender: BattleParticipantSnapshot;

  limitedSummonNoRetaliation: boolean;

  speedModifiers: ManualBattleSpeedModifiers;
  suggestedEffects: BattleEffectSuggestion[];
  effectiveAttackingSpeed?: number;
  effectiveDefendingSpeed?: number;

  speedTie: boolean;
  speedTieRolls: BattleSpeedTieRound[];
  firstStrikeCreatureInstanceId?: string;
  secondStrikeCreatureInstanceId?: string;

  strikes: ManualBattleStrike[];
  currentStrikeIndex: number;

  combatPhaseEnded: boolean;
  message: string;
};


export type EffectRollStatus =
  | "AWAITING_ROLL"
  | "ROLLED"
  | "APPLIED"
  | "SKIPPED";

export type EffectRollSuccessRange = {
  min: number;
  max: number;
};

export type PendingEffectRollSession = {
  id: string;
  status: EffectRollStatus;

  createdAt: string;
  updatedAt: string;

  sourcePlayerId: string;
  sourceCardInstanceId: string;
  sourceCardId: string;
  sourceCardName: string;

  effectId: string;
  trigger: string;
  actionType: string;
  actionText?: string;

  linkedBattleSessionId?: string;
  linkedStrikeId?: string;

  targetPlayerId?: string;
  targetCardInstanceId?: string;
  targetCardName?: string;

  diceKind: "EFFECT_ROLL";
  diceCount: number;
  successRanges: EffectRollSuccessRange[];

  rolledDice?: number[];
  rollTotal?: number;
  success?: boolean;

  onSuccessActionType?: string;
  onSuccessStatus?: string;
  onSuccessLabel?: string;
  onSuccessFlags?: Partial<Record<ActiveCreatureStatusFlag, boolean>>;
  duration?: WardEffectDuration;

  message: string;
};

export type MagicChainLinkStatus = "PENDING" | "RESOLVED" | "NEGATED";

export type MagicChainLink = {
  id: string;
  playerId: string;
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  magicType: MagicType;
  magicSubType: MagicSubType;
  text: string;
  isLightningResponse: boolean;
  respondsToLinkId?: string;
  status: MagicChainLinkStatus;
  battleResponse?: {
    battleSessionId: string;
    strikeId: string;
    actionType: string;
    effectId?: string;
  };
};

export type MagicChainState = {
  id: string;
  startedByPlayerId: string;
  links: MagicChainLink[];

  /** Legacy/debug history; no longer blocks a player from responding again after the opponent responds. */
  respondedPlayerIds: string[];

  /** Player currently allowed to add the next Lightning response. */
  priorityPlayerId?: string;

  /** Controller of the most recent chain link. This player cannot respond to their own link. */
  lastLinkPlayerId?: string;

  /** Number of priority passes since the latest response. One pass resolves the current 1v1 chain window. */
  passesSinceLastResponse: number;
};

export type ManualEffectRequest = {
  id: string;

  sourceCardInstanceId: string;
  sourceCardId: string;
  sourceCardName: string;

  magicType: MagicType;
  magicSubType: MagicSubType;

  effectId?: string;
  actionType?: string;
  effectGroup?: string;
  actionText?: string;
  effectValue?: string;
  durationText?: string;

  controllerPlayerId: string;
  text: string;
  completed: boolean;
};

export type DeckCardLimitRule = {
  cardId: string;
  limit: number;
  reason?: string;
};

export type DeckCardLimitListDefinition = {
  id: string;
  name: string;
  version: string;
  rules: DeckCardLimitRule[];
};

export type DeckCardLimitMap = Record<
  string,
  {
    limit: number;
    reason?: string;
  }
>;

export type WardEffectDuration = {
  text?: string;
  type?: string;
  amount?: number;
  damageAmount?: number;
  healAmount?: number;

  destinationZone?: "HAND" | "CEMETERY" | "DECK" | "REMOVED_FROM_GAME" | string;
  sourcePlacement?: "MAGIC_SLOT" | "TEMP_EQUIP" | string;

  effectType?: "DAMAGE_OVER_TIME" | "HEAL_OVER_TIME" | string;
  tickTiming?: "BEGINNING_OF_COMBAT_PHASE" | "END_OF_COMBAT_PHASE" | "BEGINNING_OF_TURN" | string;
  stackRule?: "DO_NOT_STACK" | string;

  status?: string;
  flags?: Partial<Record<ActiveCreatureStatusFlag, boolean>>;
  unit?: string;
  starts?: string;
  expires?: string;
  sourceLinked?: boolean;
};

export type WardEffectStatChange = {
  stat: string;
  operation: "ADD" | "SUBTRACT" | "SET" | string;
  value: number;
  rounding?: string | null;
};

export type WardEffectProgramTrigger = {
  type?: string;
  text?: string;
};

export type WardEffectProgramCondition = {
  type?: string;
  text?: string;
  data?: Record<string, unknown>;

  /**
   * Which card the condition checks.
   * SOURCE = the card/effect source.
   * TARGET = selected target card.
   */
  subjectRef?: "SOURCE" | "TARGET" | string;

  /**
   * Metadata condition kind.
   */
  trait?: "ARTWORK_TAG" | "CREATURE_TYPE" | "RARITY" | string;

  /**
   * HAS/IS/IN pass. NOT_HAS/NOT_IS/NOT_IN invert.
   */
  operator?: "HAS" | "NOT_HAS" | "IS" | "NOT_IS" | "IN" | "NOT_IN" | string;

  /**
   * Required metadata value or values.
   */
  expected?: string | string[];
};

export type WardEffectProgramStep = {
  id: string;

  /**
   * Effect Program V1 operation.
   * Keep this open-ended so future ops can be added without changing shared
   * types every time.
   */
  op:
    | "TARGET.SELECT"
    | "DURATION.REGISTER"
    | "MODIFIER.APPLY_DICE_LIMIT"
    | "MODIFIER.APPLY_STAT"
    | "SOURCE.SEND_TO_CEMETERY"
    | "SOURCE.ATTACH_TO_TARGET"
    | "CLEANUP.REMOVE_EFFECT"
    | string;

  label?: string;
  summary?: string;

  targetKind?: EffectTargetKind;
  controllerScope?: "ANY_PLAYER" | "CONTROLLER" | "OPPONENT";
  targetRef?: string;

  rollKind?: "HIT_ROLL" | "ATTACK_DAMAGE_ROLL" | string;
  diceLimitMode?: "MAX" | "SET" | string;
  diceLimitValue?: number;

  valueText?: string;
  amount?: number;
  damageAmount?: number;
  healAmount?: number;

  destinationZone?: "HAND" | "CEMETERY" | "DECK" | "REMOVED_FROM_GAME" | string;
  sourcePlacement?: "MAGIC_SLOT" | "TEMP_EQUIP" | string;

  effectType?: "DAMAGE_OVER_TIME" | "HEAL_OVER_TIME" | string;
  tickTiming?: "BEGINNING_OF_COMBAT_PHASE" | "END_OF_COMBAT_PHASE" | "BEGINNING_OF_TURN" | string;
  stackRule?: "DO_NOT_STACK" | string;

  status?: string;
  flags?: Partial<Record<ActiveCreatureStatusFlag, boolean>>;
  statChanges?: WardEffectStatChange[];

  duration?: WardEffectDuration;

  data?: Record<string, unknown>;
};

export type WardEffectProgram = {
  version: 1;

  trigger?: WardEffectProgramTrigger;
  conditions?: WardEffectProgramCondition[];

  /**
   * Executed in visible block order.
   */
  steps: WardEffectProgramStep[];

  cleanup?: WardEffectProgramStep[];
  presentation?: WardEffectProgramStep[];

  compiledAt?: string;
  compiledSource?: string;
};
export type WardEngineEffect = {
  id: string;
  trigger?: string;
  condition?: unknown;

  actionType: string;
  effectGroup?: string;
  actionText?: string;

  target?: string;
  value?: string;

  duration?: WardEffectDuration;

  reusableFunction?: string;

  program?: WardEffectProgram;

  params?: {
    target?: string;
    valueText?: string;
    statChanges?: WardEffectStatChange[];
    condition?: unknown;
    duration?: WardEffectDuration;
    damageType?: string;
    sourceLinked?: boolean;
    usesAnchoring?: boolean;
    roundingMode?: string | null;
    stackRule?: string | null;
    tickTiming?: string | null;
    [key: string]: unknown;
  };

  notes?: string;
  needsReview?: boolean;
};

export type EffectTargetKind =
  | "MAGIC_SLOT_CARD"
  | "PRIMARY_CREATURE"
  | "LIMITED_SUMMON"
  | "ANY_CREATURE"
  | "PLAYER"
  | "CARD_IN_HAND"
  | "CARD_IN_DECK"
  | "CARD_IN_CEMETERY"
  | "CARD_IN_REMOVED_FROM_GAME";

export type EffectTargetOption = {
  id: string;
  label: string;
  targetKind: EffectTargetKind;

  playerId: string;
  cardInstanceId?: string;
  cardId?: string;
  cardName?: string;

  zone:
    | "PLAYER"
    | "HAND"
    | "DECK"
    | "CEMETERY"
    | "REMOVED_FROM_GAME"
    | "PRIMARY_CREATURE"
    | "LIMITED_SUMMON"
    | "MAGIC_SLOT";
};

export type PendingEffectTargetPrompt = {
  id: string;

  sourceCardInstanceId: string;
  sourceCardId: string;
  sourceCardName: string;

  controllerPlayerId: string;

  effectId: string;
  actionType: string;
  effectGroup?: string;
  actionText?: string;
  effectValue?: string;

  /**
   * Multi-step cards can create one target prompt at a time. After the current
   * prompt resolves, these effect ids are attempted in order so cards such as
   * Vampire Mistress can damage one creature, then heal another creature.
   */
  remainingEffectIds?: string[];

  promptText: string;
  targetKind: EffectTargetKind;
  options: EffectTargetOption[];
};
