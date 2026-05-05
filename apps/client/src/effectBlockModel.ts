import type { EffectTargetKind, WardEffectProgram, WardEffectProgramStep, WardEngineEffect } from "@ward/shared";
import type { CardLibraryCardSummary } from "./clientTypes";

export type EffectBlockKind =
  | "TRIGGER"
  | "CONDITION"
  | "TARGET"
  | "ACTION"
  | "VALUE"
  | "DURATION"
  | "CLEANUP"
  | "VISUAL_CUE";

export type EffectBlockStatus = "READY" | "PARTIAL" | "MISSING" | "REVIEW";

export type EffectBlockSupportOverride = {
  overallStatus?: EffectBlockStatus;
  blockStatuses?: Record<string, EffectBlockStatus>;
  tested?: boolean;
  testedNotes?: string;
  updatedAt?: string;
  source?: string;
};

export type EffectBlockVisualOrder = string[];

export type EffectBlockTemplate = {
  id: string;
  kind: EffectBlockKind;
  label: string;
  description: string;
  patch?: Partial<WardEngineEffect>;
  paramsPatch?: Record<string, unknown>;
  clearFields?: Array<"condition" | "duration" | "target" | "value" | "reusableFunction">;
  supportStatus?: EffectBlockStatus;
};

export type EffectLogicBlock = {
  id: string;
  kind: EffectBlockKind;
  label: string;
  summary: string;
  status: EffectBlockStatus;
  handler?: string;
  data?: Record<string, unknown>;
  notes?: string;
};

export type EffectBlockChain = {
  effectId: string;
  actionType: string;
  trigger?: string;
  reusableFunction?: string;
  overallStatus: EffectBlockStatus;
  blocks: EffectLogicBlock[];
  missingHandlers: string[];
  reviewNotes: string[];
};

export type EffectBlockSummary = Record<EffectBlockStatus, number> & {
  total: number;
};

export type LibraryBlockCoverageEffectItem = {
  cardLabel: string;
  cardId: string;
  packId: string;
  effectId: string;
  trigger?: string;
  actionType: string;
  actionText?: string;
  target?: string;
  value?: string;
  conditionText?: string;
  durationText?: string;
  reusableFunction?: string;
  notes?: string;
  status: EffectBlockStatus;
  missingHandlers: string[];
  reviewNotes: string[];
};

export type LibraryBlockCoverageItem = {
  actionType: string;
  count: number;
  status: EffectBlockStatus;
  handler: string;
  cards: string[];
  effects: LibraryBlockCoverageEffectItem[];
};

export type LibraryBlockCoverage = {
  cardCount: number;
  effectCount: number;
  summary: EffectBlockSummary;
  actionTypes: LibraryBlockCoverageItem[];
  missingActionTypes: LibraryBlockCoverageItem[];
};

type HandlerCatalogEntry = {
  status: EffectBlockStatus;
  handler: string;
  notes: string;
  requiresTarget?: boolean;
  requiresValue?: boolean;
  requiresDuration?: boolean;
  battleAspect?: boolean;
  cleanupAspect?: boolean;
  visualCue: string;
};


export const EFFECT_BLOCK_STATUS_VALUES: EffectBlockStatus[] = ["READY", "PARTIAL", "REVIEW", "MISSING"];

function isEffectBlockStatus(value: unknown): value is EffectBlockStatus {
  return value === "READY" || value === "PARTIAL" || value === "REVIEW" || value === "MISSING";
}

function nowIso(): string {
  return new Date().toISOString();
}

function readBlockSupportOverride(effect: WardEngineEffect): EffectBlockSupportOverride {
  const raw = effect.params?.blockSupportOverride;
  if (!raw || typeof raw !== "object") return {};

  const candidate = raw as Record<string, unknown>;
  const blockStatuses: Record<string, EffectBlockStatus> = {};
  const rawBlockStatuses = candidate.blockStatuses;

  if (rawBlockStatuses && typeof rawBlockStatuses === "object") {
    for (const [key, value] of Object.entries(rawBlockStatuses as Record<string, unknown>)) {
      if (isEffectBlockStatus(value)) {
        blockStatuses[key] = value;
      }
    }
  }

  return {
    overallStatus: isEffectBlockStatus(candidate.overallStatus) ? candidate.overallStatus : undefined,
    blockStatuses,
    tested: typeof candidate.tested === "boolean" ? candidate.tested : undefined,
    testedNotes: typeof candidate.testedNotes === "string" ? candidate.testedNotes : undefined,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined,
    source: typeof candidate.source === "string" ? candidate.source : undefined
  };
}

function readBlockVisualOrder(effect: WardEngineEffect): EffectBlockVisualOrder {
  const raw = effect.params?.blockChainOrder;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function readHiddenBlockIds(effect: WardEngineEffect): Set<string> {
  const raw = effect.params?.blockChainHidden;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0));
}

function applyHiddenBlocks(effect: WardEngineEffect, blocks: EffectLogicBlock[]): EffectLogicBlock[] {
  const hidden = readHiddenBlockIds(effect);
  if (hidden.size === 0) return blocks;
  return blocks.filter(block => !hidden.has(block.id));
}

function applyBlockVisualOrder(effect: WardEngineEffect, blocks: EffectLogicBlock[]): EffectLogicBlock[] {
  const order = readBlockVisualOrder(effect);
  if (order.length === 0) return blocks;

  const sourceIndex = new Map(blocks.map((block, index) => [block.id, index]));
  const orderedIds = new Map(order.map((blockId, index) => [blockId, index]));

  return [...blocks].sort((a, b) => {
    const aOrder = orderedIds.has(a.id) ? orderedIds.get(a.id)! : Number.MAX_SAFE_INTEGER + (sourceIndex.get(a.id) ?? 0);
    const bOrder = orderedIds.has(b.id) ? orderedIds.get(b.id)! : Number.MAX_SAFE_INTEGER + (sourceIndex.get(b.id) ?? 0);
    return aOrder - bOrder;
  });
}

export function setEffectBlockVisualOrder(effect: WardEngineEffect, orderedBlockIds: string[]): WardEngineEffect {
  const cleanedOrder = Array.from(new Set(orderedBlockIds.filter(blockId => typeof blockId === "string" && blockId.trim().length > 0)));

  return {
    ...effect,
    params: {
      ...effect.params,
      blockChainOrder: cleanedOrder,
      blockChainOrderUpdatedAt: nowIso(),
      blockChainOrderSource: "Effect Dev Tool"
    }
  };
}

export function clearEffectBlockVisualOrder(effect: WardEngineEffect): WardEngineEffect {
  const params = { ...(effect.params ?? {}) };
  delete params.blockChainOrder;
  delete params.blockChainOrderUpdatedAt;
  delete params.blockChainOrderSource;

  return {
    ...effect,
    params
  };
}

export function clearEffectBlockChainLayout(effect: WardEngineEffect): WardEngineEffect {
  const params = { ...(effect.params ?? {}) };
  delete params.blockChainOrder;
  delete params.blockChainOrderUpdatedAt;
  delete params.blockChainOrderSource;
  delete params.blockChainHidden;
  delete params.blockChainHiddenUpdatedAt;
  delete params.blockChainHiddenSource;

  return {
    ...effect,
    params
  };
}

export function hideEffectBlockFromChain(effect: WardEngineEffect, blockId: string): WardEngineEffect {
  const hidden = Array.from(readHiddenBlockIds(effect));
  if (!hidden.includes(blockId)) hidden.push(blockId);

  return {
    ...effect,
    params: {
      ...effect.params,
      blockChainHidden: hidden,
      blockChainHiddenUpdatedAt: nowIso(),
      blockChainHiddenSource: "Effect Dev Tool"
    }
  };
}

export function removeEffectBlockFromEffect(effect: WardEngineEffect, blockId: string, kind: EffectBlockKind): WardEngineEffect {
  const params = { ...(effect.params ?? {}) } as NonNullable<WardEngineEffect["params"]>;
  let next: WardEngineEffect = { ...effect, params };

  switch (kind) {
    case "TRIGGER":
      next = { ...next, trigger: "ON_PLAY" };
      break;
    case "CONDITION":
      delete (next as unknown as Record<string, unknown>).condition;
      delete params.condition;
      break;
    case "TARGET":
      delete (next as unknown as Record<string, unknown>).target;
      delete params.target;
      delete params.targetKind;
      delete params.sourceZone;
      delete params.destinationZone;
      break;
    case "VALUE":
      delete (next as unknown as Record<string, unknown>).value;
      delete params.valueText;
      delete params.amount;
      delete params.damageAmount;
      delete params.healAmount;
      delete params.multiplier;
      delete params.statChanges;
      delete params.rollTable;
      delete params.table;
      delete params.diceLimitValue;
      break;
    case "DURATION":
      delete (next as unknown as Record<string, unknown>).duration;
      delete params.duration;
      break;
    case "CLEANUP":
      delete params.sourceLinked;
      delete params.usesAnchoring;
      delete params.expiresWhenSourceLeaves;
      if (next.duration && typeof next.duration === "object") {
        const duration = { ...next.duration } as Record<string, unknown>;
        delete duration.sourceLinked;
        next = { ...next, duration: duration as WardEngineEffect["duration"] };
      }
      break;
    case "VISUAL_CUE":
      delete params.visualCue;
      break;
    case "ACTION":
      return next;
  }

  return hideEffectBlockFromChain(next, blockId);
}

export function getEffectBlockStatusOverride(effect: WardEngineEffect, blockId: string, kind?: EffectBlockKind): EffectBlockStatus | undefined {
  const override = readBlockSupportOverride(effect);
  return override.blockStatuses?.[blockId] ?? (kind ? override.blockStatuses?.[kind] : undefined);
}

export function getEffectOverallBlockStatusOverride(effect: WardEngineEffect): EffectBlockStatus | undefined {
  return readBlockSupportOverride(effect).overallStatus;
}

export function setEffectBlockStatusOverride(effect: WardEngineEffect, blockId: string, status: EffectBlockStatus | "AUTO"): WardEngineEffect {
  const override = readBlockSupportOverride(effect);
  const blockStatuses = { ...(override.blockStatuses ?? {}) };

  if (status === "AUTO") {
    delete blockStatuses[blockId];
  } else {
    blockStatuses[blockId] = status;
  }

  const nextOverride: EffectBlockSupportOverride = {
    ...override,
    blockStatuses,
    tested: true,
    updatedAt: nowIso(),
    source: "Effect Dev Tool"
  };

  return {
    ...effect,
    params: {
      ...effect.params,
      blockSupportOverride: nextOverride
    }
  };
}

export function setEffectOverallBlockStatusOverride(effect: WardEngineEffect, status: EffectBlockStatus | "AUTO"): WardEngineEffect {
  const override = readBlockSupportOverride(effect);
  const nextOverride: EffectBlockSupportOverride = {
    ...override,
    overallStatus: status === "AUTO" ? undefined : status,
    tested: status === "AUTO" ? override.tested : true,
    updatedAt: nowIso(),
    source: "Effect Dev Tool"
  };

  return {
    ...effect,
    params: {
      ...effect.params,
      blockSupportOverride: nextOverride
    }
  };
}

export function clearEffectBlockStatusOverrides(effect: WardEngineEffect): WardEngineEffect {
  const params = { ...(effect.params ?? {}) };
  delete params.blockSupportOverride;

  return {
    ...effect,
    params
  };
}

const KNOWN_TRIGGERS = new Set([
  "ON_PLAY",
  "ON_PLAY_FIELD",
  "ON_EQUIP",
  "ON_SUMMON",
  "SUMMON_REQUIREMENT",
  "DURING_YOUR_TURN",
  "DURING_YOUR_TURN_ACTIVATED",
  "BEGINNING_OF_YOUR_TURN",
  "END_OF_YOUR_TURN",
  "DURING_BATTLE_FROM_HAND",
  "WHEN_OPPONENT_PLAYS_MAGIC",
  "WHEN_OPPONENT_PLAYS_LIGHTNING",
  "WHEN_OPPONENT_LANDS_HIT",
  "WHEN_OPPONENT_FINISHES_ATTACK",
  "ON_HIT",
  "ON_HIT_FIRST",
  "DURING_DAMAGE_CALC",
  "WHEN_THIS_CREATURE_KILLED",
  "WHEN_THIS_CARD_LEAVES_FIELD",
  "WHEN_CARD_REMOVED_FROM_FIELD",
  "STATIC_RULE",
  "STATIC_WHILE_ON_FIELD",
  "STATIC_WHILE_EQUIPPED",
  "WHILE_ON_FIELD",
  "WHILE_EQUIPPED",
  "ON_DRAW",
  "ON_DISCARD",
  "ON_TURN_START_ROLL"
]);

const KNOWN_DURATION_TYPES = new Set([
  "CURRENT_BATTLE",
  "BATTLE",
  "TURN_CYCLES",
  "WHILE_EQUIPPED",
  "WHILE_ON_FIELD",
  "PERMANENT",
  "UNTIL_SOURCE_REMOVED",
  "TARGET_PLAYER_TURN_STARTS"
]);

export const EFFECT_BLOCK_PALETTE: EffectBlockTemplate[] = [
  { id: "trigger-on-play", kind: "TRIGGER", label: "When played", description: "Effect starts when the card is played/resolved.", patch: { trigger: "ON_PLAY" } },
  { id: "trigger-during-your-turn", kind: "TRIGGER", label: "During your turn", description: "Effect is available during the controller's turn before a later action.", patch: { trigger: "DURING_YOUR_TURN" } },
  { id: "trigger-on-hit", kind: "TRIGGER", label: "On hit", description: "Effect checks after this creature lands a hit.", patch: { trigger: "ON_HIT" } },
  { id: "trigger-on-hit-first", kind: "TRIGGER", label: "On hit first", description: "Effect checks when this creature hits before the opposing creature.", patch: { trigger: "ON_HIT_FIRST" } },
  { id: "trigger-damage-calc", kind: "TRIGGER", label: "During damage calculation", description: "Effect checks while attack damage is being calculated.", patch: { trigger: "DURING_DAMAGE_CALC" } },

  { id: "condition-none", kind: "CONDITION", label: "No condition", description: "Clears the effect condition block.", clearFields: ["condition"], paramsPatch: { condition: undefined } },
  { id: "condition-hit-lands", kind: "CONDITION", label: "Hit lands", description: "Requires the attacker to successfully hit the target.", patch: { condition: { type: "HIT_LANDS", text: "Hit lands" } } },
  { id: "condition-hits-first", kind: "CONDITION", label: "Hits first", description: "Requires this creature to hit before the opposing creature in battle.", patch: { condition: { type: "HITS_FIRST", text: "This creature hits first during battle" } }, supportStatus: "READY" },
  { id: "condition-damage-die-any-six", kind: "CONDITION", label: "Any attack damage die is 6", description: "Requires at least one attack damage die to roll a 6.", patch: { condition: { type: "DAMAGE_DIE_ANY", dieValue: 6, text: "At least 1 Atk Dice Roll is 6" } }, supportStatus: "READY" },
  { id: "condition-played-before-attack", kind: "CONDITION", label: "Played before attack", description: "Marks effects like Backstab that must be played before declaring the attack.", patch: { condition: { type: "CARD_PLAYED_BEFORE_ATTACK", text: "Card played before attack" } }, supportStatus: "READY" },

  { id: "target-your-primary", kind: "TARGET", label: "Your primary creature", description: "Targets the controller's primary creature.", patch: { target: "Your primary creature" }, paramsPatch: { target: "Your primary creature", targetKind: "SELF_PRIMARY_CREATURE" } },
  { id: "target-this-attack-damage", kind: "TARGET", label: "This creature attack damage", description: "Targets this creature's current attack damage calculation.", patch: { target: "This creature attack damage" }, paramsPatch: { target: "This creature attack damage", targetKind: "THIS_ATTACK_DAMAGE" } },
  { id: "target-opponent-primary", kind: "TARGET", label: "Opponent primary creature", description: "Targets the opposing primary creature.", patch: { target: "Opponent primary creature" }, paramsPatch: { target: "Opponent primary creature", targetKind: "OPPONENT_PRIMARY_CREATURE" } },
  { id: "target-magic-slot", kind: "TARGET", label: "Magic slot card", description: "Targets a card in a magic slot.", patch: { target: "Magic card on the field" }, paramsPatch: { target: "Magic card on the field", targetKind: "MAGIC_SLOT_CARD" } },

  { id: "action-damage-multiplier", kind: "ACTION", label: "Multiply attack damage", description: "Uses the battle damage multiplier route.", patch: { actionType: "APPLY_ATTACK_DAMAGE_MULTIPLIER", effectGroup: "Damage Multiplier", actionText: "Multiply Atk damage", reusableFunction: "applyConditionalDamageMultiplier" }, paramsPatch: { damageType: "ATTACK_DAMAGE" } },
  { id: "action-backstab", kind: "ACTION", label: "Attack first + auto-hit + multiplier", description: "Backstab-style current-battle override.", patch: { actionType: "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER", effectGroup: "Battle Override", actionText: "Primary creature attacks first and automatically hits", reusableFunction: "applyForcedFirstAutoHitMultiplier" }, paramsPatch: { forceFirst: true, forceHit: true, forcedHitStillRollsHitDice: true, criticalMissIgnoredWhenForcedHit: true, damageType: "ATTACK_DAMAGE" } },
  { id: "action-roll-for-effect", kind: "ACTION", label: "Roll for effect", description: "Prompts an effect roll after the trigger is reached.", patch: { actionType: "ROLL_FOR_EFFECT", effectGroup: "Effect Roll", actionText: "Roll for effect success" } },
  { id: "action-apply-status", kind: "ACTION", label: "Apply status", description: "Adds a status badge/flags to the target creature.", patch: { actionType: "APPLY_STATUS", effectGroup: "Status", actionText: "Apply status" } },
  { id: "action-dot", kind: "ACTION", label: "Damage over time", description: "Adds a recurring DOT ticker to the target creature.", patch: { actionType: "APPLY_DAMAGE_OVER_TIME", effectGroup: "Damage Over Time", actionText: "Apply recurring damage" }, paramsPatch: { damageType: "DAMAGE_OVER_TIME", stackRule: "DO_NOT_STACK", tickTiming: "END_OF_COMBAT_PHASE" } },
  { id: "action-destroy-magic", kind: "ACTION", label: "Destroy magic card", description: "Prompts for a magic slot card and sends it to cemetery.", patch: { actionType: "DESTROY_MAGIC_CARDS", effectGroup: "Destroy Magic", actionText: "Destroy magic card" } },

  { id: "value-2x-attack-damage", kind: "VALUE", label: "2x attack damage", description: "Sets attack damage multiplier to 2x.", patch: { value: "2x Attack Damage" }, paramsPatch: { valueText: "2x Attack Damage", multiplier: 2, damageType: "ATTACK_DAMAGE" } },
  { id: "value-3x-attack-damage", kind: "VALUE", label: "3x attack damage", description: "Sets attack damage multiplier to 3x.", patch: { value: "3x Attack Damage" }, paramsPatch: { valueText: "3x Attack Damage", multiplier: 3, damageType: "ATTACK_DAMAGE" } },
  { id: "value-backstab", kind: "VALUE", label: "Attack first; auto-hit; 3x", description: "Sets the standard Backstab value text and multiplier.", patch: { value: "Attack first; auto-hit; 3x Atk damage" }, paramsPatch: { valueText: "Attack first; auto-hit; 3x Atk damage", multiplier: 3, forceFirst: true, forceHit: true, damageType: "ATTACK_DAMAGE" } },
  { id: "value-effect-roll-4-6", kind: "VALUE", label: "1D6 success on 4-6", description: "Common effect roll success range.", patch: { value: "1D6; success on 4-6" }, paramsPatch: { valueText: "1D6; success on 4-6", rollKind: "EFFECT_ROLL", successRange: [4, 5, 6] } },
  { id: "value-frozen-status", kind: "VALUE", label: "Frozen flags", description: "Frozen-style cannot attack damage/cannot sacrifice flags.", patch: { value: "Frozen" }, paramsPatch: { valueText: "Frozen", status: "FROZEN", flags: { canInflictAtkDamage: false, canBeSacrificed: false } } },

  { id: "duration-current-battle", kind: "DURATION", label: "Current battle", description: "Expires when the current battle ends.", patch: { duration: { text: "Current battle", type: "CURRENT_BATTLE" } } },
  { id: "duration-one-turn-cycle", kind: "DURATION", label: "1 turn cycle", description: "Expires after one turn cycle.", patch: { duration: { text: "1 turn cycle", type: "TURN_CYCLES", amount: 1, unit: "TURN_CYCLE" } } },
  { id: "duration-two-turn-cycles", kind: "DURATION", label: "2 turn cycles", description: "Expires after two turn cycles.", patch: { duration: { text: "2 turn cycles", type: "TURN_CYCLES", amount: 2, unit: "TURN_CYCLE" } } },

  { id: "cleanup-source-linked", kind: "CLEANUP", label: "Source-linked cleanup", description: "Marks the effect as anchored/source-linked.", paramsPatch: { sourceLinked: true, usesAnchoring: true } },
  { id: "cleanup-none", kind: "CLEANUP", label: "No source cleanup", description: "Clears common source-linked cleanup flags.", paramsPatch: { sourceLinked: false, usesAnchoring: false } },

  { id: "visual-battle-multiplier", kind: "VISUAL_CUE", label: "Battle multiplier cue", description: "Shows a multiplier chip in the battle damage trace.", paramsPatch: { visualCue: "Show multiplier chip in damage calculation trace." } },
  { id: "visual-status-badge", kind: "VISUAL_CUE", label: "Status badge cue", description: "Shows a status badge on the affected creature.", paramsPatch: { visualCue: "Show status badge on the affected creature." } },
  { id: "visual-first-auto-hit", kind: "VISUAL_CUE", label: "First + auto-hit cue", description: "Shows first-strike, auto-hit, and multiplier chips on battle resolver.", paramsPatch: { visualCue: "Show first-strike, auto-hit, and multiplier chips on the battle resolver." } }
];

const HANDLER_CATALOG: Record<string, HandlerCatalogEntry> = {
  DESTROY_MAGIC_CARDS: {
    status: "READY",
    handler: "effectPrompts.resolveMagicSlotTarget -> cardMovement.sendMagicToCemetery",
    notes: "Prompts for a Magic Slot card and destroys it.",
    requiresTarget: true,
    visualCue: "Highlight valid magic slots, then animate destroyed card to cemetery."
  },
  DESTROY_MAGIC: {
    status: "READY",
    handler: "effectPrompts.resolveMagicSlotTarget -> cardMovement.sendMagicToCemetery",
    notes: "Alias of single Magic destruction.",
    requiresTarget: true,
    visualCue: "Highlight valid magic slots, then animate destroyed card to cemetery."
  },
  DESTROY_ALL_MAGIC: {
    status: "PARTIAL",
    handler: "effectResolver.destroyAllMagic",
    notes: "Bulk magic removal exists, but card-specific exceptions/negation windows still need QA.",
    visualCue: "Pulse all affected magic slots, then sweep cards to cemetery."
  },
  SEARCH_DECK_TO_HAND: {
    status: "READY",
    handler: "effectPrompts.createCardSelectionPrompt -> cardMovement.moveCardToHand",
    notes: "Searches deck with filter params and moves the selected card to hand.",
    requiresTarget: true,
    visualCue: "Open deck search drawer and show selected card moving to hand."
  },
  MOVE_CARD: {
    status: "READY",
    handler: "effectPrompts.createCardZonePrompt -> cardMovement.moveCardBetweenZones",
    notes: "Common cemetery/hand/deck movement route exists.",
    requiresTarget: true,
    visualCue: "Animate selected card from source zone to destination zone."
  },
  DRAW_CARDS: {
    status: "READY",
    handler: "deckActions.drawCards",
    notes: "Draws a parsed card amount when available.",
    requiresValue: true,
    visualCue: "Draw count badge and deck-to-hand animation."
  },
  DISCARD_CARD: {
    status: "READY",
    handler: "effectPrompts.createDiscardPrompt -> handActions.discardCard",
    notes: "Prompts the player to discard a card.",
    requiresTarget: true,
    visualCue: "Highlight selectable hand cards and move selected card to cemetery."
  },
  DISCARD_CARDS: {
    status: "READY",
    handler: "effectPrompts.createDiscardPrompt -> handActions.discardCard",
    notes: "Multi-discard prompt support exists for common discard effects.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Highlight selectable hand cards and show remaining discard count."
  },
  FORCE_DISCARD: {
    status: "READY",
    handler: "effectPrompts.createDiscardPrompt -> handActions.discardCard",
    notes: "Forces target player discard when target can be inferred.",
    requiresTarget: true,
    visualCue: "Prompt target player to discard."
  },
  PAY_DISCARD_COST: {
    status: "READY",
    handler: "effectPrompts.createDiscardPrompt -> handActions.discardCard",
    notes: "Cost discard prompt exists.",
    requiresTarget: true,
    visualCue: "Show cost badge before effect resolution."
  },
  PAY_DISCARD_MAGIC_COST: {
    status: "READY",
    handler: "effectPrompts.createDiscardPrompt -> handActions.discardCard",
    notes: "Magic-only discard cost prompt exists.",
    requiresTarget: true,
    visualCue: "Show magic-only cost badge before effect resolution."
  },
  SUMMON_LIMITED_CREATURE: {
    status: "READY",
    handler: "effectPrompts.createCardSelectionPrompt -> cardMovement.limitedSummonFromZone",
    notes: "Common limited summon routes from hand/deck/cemetery are available.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Move selected creature into a limited summon slot and show anchoring line if source-linked."
  },
  SUMMON_LIMITED_CREATURE_AND_EQUIP: {
    status: "READY",
    handler: "cardMovement.limitedSummonFromZoneAndAttachSourceMagic",
    notes: "Summons a limited creature and attaches the source magic for anchoring cleanup.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Move creature into limited slot and attach source card under/behind it."
  },
  SUMMON_LIMITED_CREATURE_FROM_HAND: {
    status: "READY",
    handler: "cardMovement.limitedSummonFromHand",
    notes: "Limited summon from hand route exists.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Move selected hand creature into a limited summon slot."
  },
  SUMMON_LIMITED_CREATURE_FROM_DECK: {
    status: "READY",
    handler: "cardMovement.limitedSummonFromDeck",
    notes: "Limited summon from deck route exists when a deck prompt/filter is available.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Open deck picker, then move creature into a limited summon slot."
  },
  SUMMON_LIMITED_CREATURE_FROM_CEMETERY: {
    status: "READY",
    handler: "cardMovement.limitedSummonFromCemetery",
    notes: "Limited summon from cemetery route exists.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Move cemetery creature into a limited summon slot."
  },
  SUMMON_FROM_CEMETERY: {
    status: "READY",
    handler: "cardMovement.summonFromCemetery",
    notes: "Cemetery summon support exists for common routes.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Move cemetery creature to the destination field slot."
  },
  SUMMON_FROM_CEMETERY_AND_EQUIP: {
    status: "READY",
    handler: "cardMovement.summonFromCemeteryAndAttachSourceMagic",
    notes: "Cemetery summon plus source attachment route exists.",
    requiresTarget: true,
    cleanupAspect: true,
    visualCue: "Move cemetery creature to field and attach source card."
  },
  FORCE_SUMMON_FROM_HAND: {
    status: "READY",
    handler: "cardMovement.forceSummonFromHand",
    notes: "Force summon from hand route exists.",
    requiresTarget: true,
    visualCue: "Prompt hand creature and move to field."
  },
  APPLY_STAT_MODIFIER: {
    status: "READY",
    handler: "modifierLayers / effectiveStats / creatureRuntimeEffects.applyTemporaryStatModifiers",
    notes: "Static, equip, field, and temporary stat modifiers use the modifier layer pipeline.",
    requiresTarget: true,
    requiresValue: true,
    requiresDuration: true,
    visualCue: "Show stat chips and changed effective stat values."
  },
  APPLY_DICE_MODIFIER: {
    status: "READY",
    handler: "battleEffectAdapter / modifierLayers",
    notes: "Hit dice, hit bonus, attack dice, and flat attack damage modifier routes exist.",
    requiresTarget: true,
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show dice modifier chip next to the relevant roll."
  },
  APPLY_CONDITIONAL_DICE_MODIFIER: {
    status: "PARTIAL",
    handler: "battleEffectAdapter condition scanner",
    notes: "Conditional dice modifier route exists, but every condition needs QA.",
    requiresTarget: true,
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show conditional dice chip when condition is detected."
  },
  APPLY_DICE_LIMIT: {
    status: "READY",
    handler: "effectPrompts.applyDiceLimitPromptEffect / battle.rollManualBattleHit",
    notes: "Hit dice caps are materialized on the creature and enforced during hit roll.",
    requiresTarget: true,
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show max dice cap badge on the hit roll panel."
  },
  APPLY_ATTACK_DAMAGE_MULTIPLIER: {
    status: "READY",
    handler: "creatureRuntimeEffects.applyBattleDamageMultiplier / battle damage pipeline",
    notes: "Attack damage multipliers are applied in the battle damage pipeline.",
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show multiplier chip in damage calculation trace."
  },
  APPLY_DAMAGE_MULTIPLIER: {
    status: "READY",
    handler: "creatureRuntimeEffects.applyBattleDamageMultiplier / battle damage pipeline",
    notes: "Damage multipliers are applied in the damage pipeline when the damage type matches.",
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show multiplier chip in damage calculation trace."
  },
  APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER: {
    status: "READY",
    handler: "magicChainActions.applyForcedFirstAutoHitMultiplier -> battleEffectAdapter -> battle damage pipeline",
    notes: "Backstab-style effects apply attack-first, forced hit, and damage multiplier markers for the current battle.",
    requiresTarget: true,
    requiresValue: true,
    requiresDuration: true,
    battleAspect: true,
    visualCue: "Show first-strike, auto-hit, and multiplier chips on the battle resolver."
  },
  APPLY_ATTACK_PRIORITY_OVERRIDE: {
    status: "PARTIAL",
    handler: "battleEffectAdapter first-strike override",
    notes: "First-strike style priority route exists, but card-specific trigger timing needs QA.",
    requiresTarget: true,
    battleAspect: true,
    visualCue: "Show first-strike chip before speed check."
  },
  ROLL_FOR_EFFECT: {
    status: "READY",
    handler: "battle.rollManualBattleHit -> EffectRollModal -> effectRollActions",
    notes: "On-hit effect rolls are prompted after a hit succeeds and before attack damage.",
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show effect roll modal with success range and linked battle strike."
  },
  APPLY_STATUS: {
    status: "READY",
    handler: "creatureRuntimeEffects.addStatusToCreature",
    notes: "Status flags and common turn-cycle expiration are automated.",
    requiresTarget: true,
    requiresDuration: true,
    visualCue: "Show status badge on the affected creature."
  },
  APPLY_STATUS_WITH_ESCAPE_ROLL: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.addStatusToCreature / escape roll pending",
    notes: "Status application exists. Escape-roll cleanup still needs card-by-card validation.",
    requiresTarget: true,
    requiresDuration: true,
    visualCue: "Show status badge with escape-roll reminder."
  },
  APPLY_DAMAGE_IMMUNITY: {
    status: "READY",
    handler: "creatureRuntimeEffects.addStatusToCreature",
    notes: "Damage prevention status flags are handled in the damage pipeline.",
    requiresTarget: true,
    requiresDuration: true,
    visualCue: "Show shield badge on the protected creature."
  },
  APPLY_DAMAGE_OVER_TIME: {
    status: "READY",
    handler: "creatureRuntimeEffects.addRecurringEffectToCreature",
    notes: "DOT registration and combat-phase ticking are automated.",
    requiresTarget: true,
    requiresValue: true,
    requiresDuration: true,
    visualCue: "Show DOT badge with remaining ticks/cycles."
  },
  APPLY_HEAL_OVER_TIME: {
    status: "READY",
    handler: "creatureRuntimeEffects.addRecurringEffectToCreature",
    notes: "HOT registration route exists for common healing-over-time cards.",
    requiresTarget: true,
    requiresValue: true,
    requiresDuration: true,
    visualCue: "Show HOT badge with remaining ticks/cycles."
  },
  APPLY_HEALING_OVER_TIME: {
    status: "READY",
    handler: "creatureRuntimeEffects.addRecurringEffectToCreature",
    notes: "HOT registration route exists for common healing-over-time cards.",
    requiresTarget: true,
    requiresValue: true,
    requiresDuration: true,
    visualCue: "Show HOT badge with remaining ticks/cycles."
  },
  DAMAGE: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyImmediateDamageOrHeal",
    notes: "Flat damage resolves when target and amount are parseable. Complex damage formulas need handlers.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show damage number over target creature."
  },
  DEAL_INSTANT_DAMAGE: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyImmediateDamageOrHeal",
    notes: "Flat damage resolves when target and amount are parseable. Complex damage formulas need handlers.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show damage number over target creature."
  },
  DAMAGE_CREATURE: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyImmediateDamageOrHeal",
    notes: "Flat damage resolves when target and amount are parseable. Complex damage formulas need handlers.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show damage number over target creature."
  },
  HEAL: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyImmediateDamageOrHeal",
    notes: "Flat healing resolves when target and amount are parseable. Percent/full healing needs QA.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show heal number over target creature."
  },
  HEAL_CREATURE: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyImmediateDamageOrHeal",
    notes: "Flat healing resolves when target and amount are parseable. Percent/full healing needs QA.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show heal number over target creature."
  },
  NEGATE_MAGIC_EFFECT: {
    status: "PARTIAL",
    handler: "magicChainActions response priority / negate route",
    notes: "Basic chain priority exists. Card-specific negate windows, cannot-be-negated, and steal routes need QA.",
    requiresTarget: true,
    visualCue: "Show chain-link negated badge."
  },
  NEGATE_ATTACK: {
    status: "PARTIAL",
    handler: "battle damage prevention / manual resolver controls",
    notes: "Attack damage prevention exists, but timing-specific attack negation needs QA.",
    battleAspect: true,
    visualCue: "Show attack prevented badge in battle resolver."
  },
  NEGATE_CARD_EFFECT: {
    status: "PARTIAL",
    handler: "magicChainActions / effect activation windows pending",
    notes: "Generic card-effect negation needs more exact activation-window support.",
    requiresTarget: true,
    visualCue: "Show effect negated badge on source card."
  },
  NEGATE_CREATURE_EFFECTS: {
    status: "PARTIAL",
    handler: "summon activation window / creature effect suppression pending",
    notes: "Creature effect suppression is modeled but timing windows need QA.",
    requiresTarget: true,
    visualCue: "Show creature effect disabled badge."
  },
  PREVENT_DAMAGE: {
    status: "PARTIAL",
    handler: "battle damage prevention / status flags",
    notes: "Damage prevention status route exists, but condition-specific prevention needs QA.",
    requiresTarget: true,
    visualCue: "Show damage prevented shield."
  },
  PREVENT_ATTACK_DAMAGE: {
    status: "PARTIAL",
    handler: "battle damage prevention / status flags",
    notes: "Attack damage prevention route exists, but condition-specific prevention needs QA.",
    requiresTarget: true,
    battleAspect: true,
    visualCue: "Show attack damage prevented shield."
  },
  CANNOT_BE_NEGATED: {
    status: "PARTIAL",
    handler: "magicChainActions cannot-be-negated guard pending",
    notes: "Data block exists, but chain resolver still needs complete cannot-be-negated enforcement.",
    visualCue: "Show cannot-be-negated lock badge on chain link."
  },
  UNAFFECTED_BY_MAGIC: {
    status: "PARTIAL",
    handler: "target/effect immunity guards pending",
    notes: "Immunity is represented, but all target/damage/stat guard routes need QA.",
    requiresTarget: true,
    visualCue: "Show magic immunity badge."
  },
  UNAFFECTED_BY_CREATURE_EFFECTS: {
    status: "PARTIAL",
    handler: "target/effect immunity guards pending",
    notes: "Creature-effect immunity is represented, but all guard routes need QA.",
    requiresTarget: true,
    visualCue: "Show creature-effect immunity badge."
  },
  VALIDATE_SUMMON_REQUIREMENT: {
    status: "PARTIAL",
    handler: "summonRules custom requirement extension",
    notes: "Normal AL sacrifices work. Named/material/custom requirements need data-driven blocks.",
    requiresTarget: true,
    visualCue: "Show summon requirement checklist."
  },
  APPLY_SUMMON_REQUIREMENT_OVERRIDE: {
    status: "PARTIAL",
    handler: "summonRules custom requirement extension",
    notes: "Normal AL sacrifices work. Requirement overrides need exact card tests.",
    visualCue: "Show requirement override badge."
  },
  ROLL_TABLE: {
    status: "PARTIAL",
    handler: "effectPrompts roll-table resolver",
    notes: "D6 table rolls work for simple damage/heal outcomes. Branch actions need additional blocks.",
    requiresValue: true,
    visualCue: "Show rolled table result and branch."
  },
  ROLL_DAMAGE_TABLE: {
    status: "PARTIAL",
    handler: "effectPrompts roll-table resolver",
    notes: "D6 damage table rolls work for simple outcomes. Branch actions need additional blocks.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show rolled table result and damage."
  },
  ROLL_AND_DAMAGE: {
    status: "PARTIAL",
    handler: "effectPrompts roll-table resolver",
    notes: "Roll and flat damage is partially automated when table data is available.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show roll result and damage number."
  },
  ROLL_AND_HEAL: {
    status: "PARTIAL",
    handler: "effectPrompts roll-table resolver",
    notes: "Roll and flat healing is partially automated when table data is available.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show roll result and heal number."
  },
  HEAL_BY_ROLL: {
    status: "PARTIAL",
    handler: "effectPrompts roll-table resolver",
    notes: "Roll-based healing is partially automated when table data is available.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show roll result and heal number."
  },
  APPLY_PLAY_RESTRICTION: {
    status: "PARTIAL",
    handler: "play restriction guards pending",
    notes: "Reveal-hand restrictions work in one route. General card-play prevention needs action guards.",
    requiresTarget: true,
    visualCue: "Show restriction badge on the blocked zone/card type."
  },
  REVEAL_HAND: {
    status: "READY",
    handler: "cardEffectActions.activateRevealOpponentHandEffect",
    notes: "Reveal opponent hand request route exists.",
    requiresTarget: true,
    visualCue: "Show revealed hand panel to allowed player."
  },

  APPLY_DYNAMIC_STAT_MODIFIER: {
    status: "PARTIAL",
    handler: "modifierLayers.collectRuntimeModifierLayers.dynamic",
    notes: "Dynamic hand-count, opponent-primary, linked-limited, Gnome-count, and SPD-over-12 stat formulas are handled by the modifier layer bridge. Unusual formulas still need testing.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show dynamic stat formula chip and live effective stat output."
  },
  APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT: {
    status: "PARTIAL",
    handler: "modifierLayers.collectRuntimeModifierLayers.dynamic zone-count",
    notes: "Counts cards in hand/cemetery for common Gnome/Heroine-style formulas.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show counted-zone badge and current count."
  },
  SEND_TO_CEMETERY: {
    status: "PARTIAL",
    handler: "effectPrompts.resolvePendingEffectTargetPrompt -> moveSelectedTargetToCemetery",
    notes: "Prompted send-to-cemetery works for magic slots, primary creatures, limited summons, and cards in hand/deck/removed. Trigger timing still needs card-by-card QA.",
    requiresTarget: true,
    visualCue: "Highlight selected target and animate it to cemetery."
  },
  SEND_TO_ORIGINAL_OWNER_CEMETERY: {
    status: "PARTIAL",
    handler: "effectPrompts.moveSelectedTargetToCemetery owner destination",
    notes: "Original-owner cemetery routes are represented; steal/branch timing still needs QA.",
    requiresTarget: true,
    visualCue: "Move card to original owner cemetery with owner badge."
  },
  SHUFFLE_DECK: {
    status: "READY",
    handler: "fringeEffectHandlers.shuffleDeck",
    notes: "Controller/opponent/all deck shuffle route is automated. Opponent cut is logged but not modeled.",
    visualCue: "Show deck shuffle animation/icon."
  },
  PAY_CARD_COST: {
    status: "PARTIAL",
    handler: "effectPrompts.PAY_CARD_COST hand card prompt",
    notes: "Hand-card costs can send selected card to cemetery or return it to deck and shuffle based on text.",
    requiresTarget: true,
    visualCue: "Show cost payment badge before continuing effect chain."
  },
  ADJUST_CEMETERY_HP: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers.cemeteryHpAdjustment",
    notes: "Cemetery HP adjustment is stored/logged and can go below zero. Persistence/summary display needs follow-up.",
    requiresValue: true,
    visualCue: "Show cemetery HP adjustment chip."
  },
  ADD_CEMETERY_HP_ADJUSTMENT: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers.cemeteryHpAdjustment",
    notes: "Cemetery HP adjustment is stored/logged and can go below zero. Persistence/summary display needs follow-up.",
    requiresValue: true,
    visualCue: "Show cemetery HP adjustment chip."
  },
  APPLY_DAMAGE_MULTIPLIER_AURA: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyBattleDamageMultiplier aura predicates",
    notes: "Battle damage pipeline supports type/name target predicates for common Dragon/Bug/Demon/Undead/Humanoid/Mechanical aura multipliers.",
    requiresValue: true,
    battleAspect: true,
    visualCue: "Show field aura multiplier chip in damage trace."
  },
  SUPPRESS_MODIFIER_LAYER: {
    status: "READY",
    handler: "modifierLayers.SUPPRESS_POSITIVE",
    notes: "Positive stat increases can be suppressed for SPD, AL, Modifier, and Hit bonus layers.",
    visualCue: "Show suppressed modifier layer badge."
  },
  DEAL_PERCENTAGE_DAMAGE: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyPercentageDamage",
    notes: "Half remaining HP damage is automated and rounded up. Other percentages need added formulas.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show percentage damage chip and rounded amount."
  },
  HEAL_BY_DAMAGE_DEALT: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects.applyHealByDamageDealt",
    notes: "Battle pipeline can heal by half of actual damage dealt after damage application. Excess-heal overflow variants need follow-up.",
    battleAspect: true,
    visualCue: "Show lifesteal heal number after damage."
  },
  APPLY_MULTI_MODIFIER: {
    status: "READY",
    handler: "modifierLayers statChanges / effectResolver.applyWhileEquippedStatModifiers",
    notes: "Multi-stat equip modifiers use the same statChanges layer route as normal stat modifiers.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show multiple stat chips."
  },
  APPLY_FIELD_AURA_MODIFIERS: {
    status: "PARTIAL",
    handler: "modifierLayers.collectRuntimeModifierLayers field aura",
    notes: "Owner/all/opponent scoped field stat auras are represented by live modifier layers. Complex rarity/material filters need testing.",
    requiresValue: true,
    visualCue: "Show field aura stat chips on affected creatures."
  },
  APPLY_STAT_SET_AURA: {
    status: "PARTIAL",
    handler: "modifierLayers.SET aura",
    notes: "AL/SPD set-style auras are supported by set layers. Other set formulas need card tests.",
    requiresValue: true,
    visualCue: "Show stat set badge."
  },
  APPLY_TEMPORARY_STAT_SET: {
    status: "PARTIAL",
    handler: "modifierLayers.SET + duration metadata",
    notes: "Temporary set layers are recognized; expiration timing still needs runtime QA.",
    requiresTarget: true,
    requiresDuration: true,
    visualCue: "Show temporary stat set badge."
  },
  APPLY_STAT_AND_DICE_MULTIPLIER: {
    status: "PARTIAL",
    handler: "modifierLayers.MULTIPLY with ceil rounding",
    notes: "Half stat/dice modifiers are handled with ceiling rounding.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show stat multiplier badge."
  },
  REPLACE_ATTACK_PROFILE: {
    status: "PARTIAL",
    handler: "modifierLayers.REPLACE_ATTACK_PROFILE set attack dice/modifier",
    notes: "Attack dice and Modifier replacement is live in effective stats. Attack name/effect suppression still needs UI/runtime support.",
    requiresTarget: true,
    requiresValue: true,
    visualCue: "Show replaced attack profile badge."
  },
  APPLY_DAMAGE_REDUCTION: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects damage reduction multiplier",
    notes: "Half damage reduction feeds into the battle damage multiplier pipeline. Complex conditions need QA.",
    battleAspect: true,
    visualCue: "Show damage reduction chip."
  },
  APPLY_CONDITIONAL_DAMAGE_REDUCTION: {
    status: "PARTIAL",
    handler: "creatureRuntimeEffects conditional damage reduction multiplier",
    notes: "Half damage reduction feeds into the battle damage multiplier pipeline. Complex conditions need QA.",
    battleAspect: true,
    visualCue: "Show conditional damage reduction chip."
  },
  HEAL_TO_FULL: {
    status: "READY",
    handler: "effectPrompts.healCreatureTarget / effectResolver.applyOnEquipImmediateEffects",
    notes: "Full heal works for on-equip and prompted creature targets.",
    requiresTarget: true,
    visualCue: "Show full-heal pulse on creature HP."
  },
  SEARCH_DECK_TO_EQUIP: {
    status: "REVIEW",
    handler: "targets deck equip prompt scaffold",
    notes: "Deck-to-equip target filtering exists, but auto-attach sequencing still needs a focused handler.",
    requiresTarget: true,
    visualCue: "Show deck equip search flow."
  },
  APPLY_BATTLE_LOCK: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers active marker / battle lock scanner pending",
    notes: "Effect marker is created. Full battle declaration guard integration is next.",
    requiresDuration: true,
    visualCue: "Show global no-battle field badge."
  },
  APPLY_TEMPORARY_HIT_OVERRIDE: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers marker + battleEffectAdapter hit override",
    notes: "Hit override is represented and battle suggestions can force hit. Duration QA needed.",
    battleAspect: true,
    requiresDuration: true,
    visualCue: "Show temporary auto-hit badge."
  },
  APPLY_EFFECT_IMMUNITY: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers immunity marker / target guards pending",
    notes: "Immunity marker is represented; all target/effect guard routes still need test cases.",
    visualCue: "Show unaffected creature badge."
  },
  APPLY_IMMUNITY: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers immunity marker / target guards pending",
    notes: "Immunity marker is represented; all target/effect guard routes still need test cases.",
    visualCue: "Show immunity badge."
  },
  APPLY_MAGIC_IMMUNITY: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers magic immunity marker / target guards pending",
    notes: "Magic immunity marker is represented; target guards still need follow-up.",
    visualCue: "Show magic immunity badge."
  },
  APPLY_ZONE_RETURN_RESTRICTION: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers zone restriction marker",
    notes: "Zone return restriction is represented for prompt guards; cemetery movement guards need follow-up.",
    visualCue: "Show zone restriction lock."
  },
  APPLY_ZONE_RESTRICTION: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers zone restriction marker",
    notes: "Zone restriction is represented for prompt guards; full cemetery-removal guards need follow-up.",
    visualCue: "Show zone restriction lock."
  },
  APPLY_ZONE_LOCK: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers zone lock marker",
    notes: "Zone lock is represented; full movement prevention guards need follow-up.",
    visualCue: "Show locked card badge."
  },
  APPLY_SKIP_TURN: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers skipNextTurn flag",
    notes: "Skip-turn flag is stored/logged. Turn advancement consumption should be verified next.",
    visualCue: "Show skip next turn badge."
  },
  DESTROY_SELF: {
    status: "PARTIAL",
    handler: "fringeEffectHandlers destroy-self marker",
    notes: "Destroy-self condition is represented. Exact trigger windows still need per-card hooks.",
    visualCue: "Show self-destroy countdown/condition badge."
  },
  MANUAL_REVIEW: {
    status: "REVIEW",
    handler: "none",
    notes: "Builder could not map this sentence to a reusable block yet.",
    visualCue: "Show manual review badge in Effect Dev Tool."
  },
  MANUAL_FALLBACK: {
    status: "REVIEW",
    handler: "manualMagicEffectActions",
    notes: "Intentional manual fallback.",
    visualCue: "Show manual effect queue card."
  }
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function hasMeaningfulValue(effect: WardEngineEffect): boolean {
  const params = effect.params ?? {};
  return Boolean(
    effect.value ||
    params.valueText ||
    params.multiplier ||
    params.amount ||
    params.damageAmount ||
    params.healAmount ||
    params.statChanges ||
    params.table ||
    params.rollTable ||
    params.diceLimitValue
  );
}

function hasMeaningfulTarget(effect: WardEngineEffect): boolean {
  const params = effect.params ?? {};
  return Boolean(effect.target || params.target || params.targetKind || params.sourceZone || params.destinationZone);
}

function durationStatus(effect: WardEngineEffect, handler?: HandlerCatalogEntry): EffectLogicBlock {
  const duration = effect.duration ?? effect.params?.duration;
  const durationText = typeof duration === "object" && duration ? (duration.text ?? duration.type ?? "Duration object") : undefined;
  const durationType = typeof duration === "object" && duration ? normalize(duration.type) : "";

  if (!duration && handler?.requiresDuration) {
    return {
      id: `${effect.id}-duration`,
      kind: "DURATION",
      label: "Duration",
      summary: "Missing duration block",
      status: "MISSING",
      notes: "This handler expects a duration/current battle/window so cleanup timing can be controlled."
    };
  }

  if (!duration) {
    return {
      id: `${effect.id}-duration`,
      kind: "DURATION",
      label: "Duration",
      summary: "Immediate / one-shot",
      status: "READY"
    };
  }

  return {
    id: `${effect.id}-duration`,
    kind: "DURATION",
    label: "Duration",
    summary: durationText ?? "Duration object",
    status: durationType && !KNOWN_DURATION_TYPES.has(durationType) ? "REVIEW" : "READY",
    data: duration as Record<string, unknown>,
    notes: durationType && !KNOWN_DURATION_TYPES.has(durationType) ? "Duration type is not in the current block-model catalog." : undefined
  };
}

function mergeStatus(current: EffectBlockStatus, next: EffectBlockStatus): EffectBlockStatus {
  const weight: Record<EffectBlockStatus, number> = {
    READY: 0,
    PARTIAL: 1,
    REVIEW: 2,
    MISSING: 3
  };

  return weight[next] > weight[current] ? next : current;
}


function updateParams(current: WardEngineEffect["params"], patch?: Record<string, unknown>): WardEngineEffect["params"] {
  const next = { ...(current ?? {}) } as NonNullable<WardEngineEffect["params"]>;
  if (!patch) return next;

  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "undefined") {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return next;
}

export function applyEffectBlockTemplate(effect: WardEngineEffect, template: EffectBlockTemplate): WardEngineEffect {
  const next: WardEngineEffect = {
    ...effect,
    ...(template.patch ?? {}),
    params: updateParams(effect.params, template.paramsPatch)
  };

  for (const field of template.clearFields ?? []) {
    delete (next as unknown as Record<string, unknown>)[field];
    if (field === "condition" || field === "duration") {
      const params = { ...(next.params ?? {}) };
      delete params[field];
      next.params = params;
    }
  }

  if (template.supportStatus) {
    return setEffectBlockStatusOverride(next, `${effect.id}-${template.kind.toLowerCase()}`, template.supportStatus);
  }

  return next;
}

function applyEffectBlockOverrides(effect: WardEngineEffect, chain: EffectBlockChain): EffectBlockChain {
  const override = readBlockSupportOverride(effect);
  const blockStatuses = override.blockStatuses ?? {};

  const blocks = chain.blocks.map(block => {
    const statusOverride = blockStatuses[block.id] ?? blockStatuses[block.kind];
    if (!statusOverride) return block;

    return {
      ...block,
      status: statusOverride,
      notes: [
        block.notes,
        `Manual/tested support override: ${statusOverride}.`
      ].filter(Boolean).join(" ")
    };
  });

  const missingHandlers = blocks
    .filter(block => block.status === "MISSING")
    .map(block => `${block.label}: ${block.summary}`);

  const reviewNotes = blocks
    .filter(block => block.status === "REVIEW" || block.status === "PARTIAL")
    .map(block => `${block.label}: ${block.notes ?? block.summary}`);

  const generatedStatus = blocks.reduce<EffectBlockStatus>((status, block) => mergeStatus(status, block.status), "READY");
  const overallStatus = override.overallStatus ?? generatedStatus;

  return {
    ...chain,
    overallStatus,
    blocks,
    missingHandlers,
    reviewNotes: override.overallStatus
      ? [`Effect support manually marked ${override.overallStatus}${override.updatedAt ? ` on ${override.updatedAt}` : ""}.`, ...reviewNotes]
      : reviewNotes
  };
}

function handlerForEffect(effect: WardEngineEffect): HandlerCatalogEntry {
  const actionType = normalize(effect.actionType);
  const direct = HANDLER_CATALOG[actionType];
  if (direct) return direct;

  if (actionType.includes("LIMITED_SUMMON") || actionType.includes("SUMMON_FROM")) {
    return HANDLER_CATALOG.SUMMON_LIMITED_CREATURE;
  }

  if (actionType.includes("DAMAGE_OVER_TIME")) {
    return HANDLER_CATALOG.APPLY_DAMAGE_OVER_TIME;
  }

  if (actionType.includes("HEAL_OVER_TIME") || actionType.includes("HEALING_OVER_TIME")) {
    return HANDLER_CATALOG.APPLY_HEAL_OVER_TIME;
  }

  if (actionType.includes("NEGATE")) {
    return HANDLER_CATALOG.NEGATE_CARD_EFFECT;
  }

  if (actionType.includes("PREVENT")) {
    return HANDLER_CATALOG.PREVENT_DAMAGE;
  }

  if (actionType.includes("TAKE_CONTROL") || actionType.includes("STEAL")) {
    return {
      status: "MISSING",
      handler: "none",
      notes: "Control-change/steal effects still need a controller/ownership movement block.",
      requiresTarget: true,
      visualCue: "Show control arrow from old controller to new controller."
    };
  }

  return {
    status: "MISSING",
    handler: "none",
    notes: "No handler catalog entry exists for this action type yet.",
    visualCue: "Show missing handler badge."
  };
}

export function buildEffectBlockChain(effect: WardEngineEffect): EffectBlockChain {
  const handler = handlerForEffect(effect);
  const trigger = normalize(effect.trigger || "ON_PLAY");
  const blocks: EffectLogicBlock[] = [];

  blocks.push({
    id: `${effect.id}-trigger`,
    kind: "TRIGGER",
    label: "When",
    summary: effect.trigger || "ON_PLAY",
    status: KNOWN_TRIGGERS.has(trigger) ? "READY" : "REVIEW",
    notes: KNOWN_TRIGGERS.has(trigger) ? undefined : "Trigger is not in the current block-model trigger catalog."
  });

  const conditionText = effect.condition
    ? typeof effect.condition === "object"
      ? JSON.stringify(effect.condition)
      : String(effect.condition)
    : "No condition";

  blocks.push({
    id: `${effect.id}-condition`,
    kind: "CONDITION",
    label: "If",
    summary: conditionText,
    status: effect.condition ? "PARTIAL" : "READY",
    data: effect.condition && typeof effect.condition === "object" ? effect.condition as Record<string, unknown> : undefined,
    notes: effect.condition ? "Condition exists. Complex text conditions may need an explicit condition block before full automation." : undefined
  });

  blocks.push({
    id: `${effect.id}-target`,
    kind: "TARGET",
    label: "Target",
    summary: effect.target ?? (effect.params?.target as string | undefined) ?? "No target",
    status: handler.requiresTarget && !hasMeaningfulTarget(effect) ? "MISSING" : "READY",
    data: {
      target: effect.target,
      paramsTarget: effect.params?.target,
      sourceZone: effect.params?.sourceZone,
      destinationZone: effect.params?.destinationZone
    },
    notes: handler.requiresTarget && !hasMeaningfulTarget(effect) ? "This handler needs a target/source selection block." : undefined
  });

  blocks.push({
    id: `${effect.id}-action`,
    kind: "ACTION",
    label: "Do",
    summary: `${effect.actionType} -> ${handler.handler}`,
    status: handler.status,
    handler: handler.handler,
    data: {
      actionType: effect.actionType,
      reusableFunction: effect.reusableFunction
    },
    notes: handler.notes
  });

  blocks.push({
    id: `${effect.id}-value`,
    kind: "VALUE",
    label: "Value",
    summary: effect.value ?? (effect.params?.valueText as string | undefined) ?? "No value",
    status: handler.requiresValue && !hasMeaningfulValue(effect) ? "MISSING" : "READY",
    data: {
      value: effect.value,
      valueText: effect.params?.valueText,
      multiplier: effect.params?.multiplier,
      statChanges: effect.params?.statChanges,
      rollTable: effect.params?.rollTable ?? effect.params?.table
    },
    notes: handler.requiresValue && !hasMeaningfulValue(effect) ? "This handler needs a numeric/value/stat/multiplier block." : undefined
  });

  blocks.push(durationStatus(effect, handler));

  const sourceLinked = Boolean(effect.params?.sourceLinked || effect.params?.usesAnchoring || effect.duration?.sourceLinked);
  const cleanupStatus: EffectBlockStatus = handler.cleanupAspect || sourceLinked
    ? sourceLinked ? "PARTIAL" : "REVIEW"
    : "READY";

  blocks.push({
    id: `${effect.id}-cleanup`,
    kind: "CLEANUP",
    label: "Cleanup",
    summary: sourceLinked ? "Source-linked / anchoring cleanup" : handler.cleanupAspect ? "Cleanup expected" : "No cleanup needed",
    status: cleanupStatus,
    data: {
      sourceLinked,
      usesAnchoring: effect.params?.usesAnchoring,
      expires: effect.duration?.expires
    },
    notes: cleanupStatus === "PARTIAL" ? "Cleanup route exists for common source-linked cases. Verify card-specific timing." : cleanupStatus === "REVIEW" ? "This kind of effect may need explicit cleanup blocks." : undefined
  });

  blocks.push({
    id: `${effect.id}-visual`,
    kind: "VISUAL_CUE",
    label: "Show",
    summary: handler.visualCue,
    status: handler.status === "MISSING" ? "MISSING" : handler.status === "REVIEW" ? "REVIEW" : "READY",
    notes: "This is the future tabletop/online-match presentation cue for this block chain."
  });

  const visualBlocks = applyBlockVisualOrder(effect, applyHiddenBlocks(effect, blocks));

  const missingHandlers = visualBlocks
    .filter(block => block.status === "MISSING")
    .map(block => `${block.label}: ${block.summary}`);

  const reviewNotes = visualBlocks
    .filter(block => block.status === "REVIEW" || block.status === "PARTIAL")
    .map(block => `${block.label}: ${block.notes ?? block.summary}`);

  const overallStatus = visualBlocks.reduce<EffectBlockStatus>((status, block) => mergeStatus(status, block.status), "READY");

  return applyEffectBlockOverrides(effect, {
    effectId: effect.id,
    actionType: effect.actionType,
    trigger: effect.trigger,
    reusableFunction: effect.reusableFunction,
    overallStatus,
    blocks: visualBlocks,
    missingHandlers,
    reviewNotes
  });
}

export function summarizeEffectBlockChains(chains: EffectBlockChain[]): EffectBlockSummary {
  const summary: EffectBlockSummary = {
    READY: 0,
    PARTIAL: 0,
    MISSING: 0,
    REVIEW: 0,
    total: chains.length
  };

  for (const chain of chains) {
    summary[chain.overallStatus] += 1;
  }

  return summary;
}

function blockString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function blockNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function blockRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseActionTypeFromBlockSummary(summary: string | undefined): string | undefined {
  if (!summary) return undefined;
  const [firstToken] = summary.split(/\s*(?:->|->|:)\s*/);
  const normalized = firstToken?.trim().toUpperCase();
  return normalized || undefined;
}

function parseDurationFromBlock(block: EffectLogicBlock): WardEngineEffect["duration"] | undefined {
  const data = blockRecord(block.data);
  const summary = block.summary;

  if (data && (data.text || data.type || data.amount || data.unit || data.starts || data.expires)) {
    const duration: NonNullable<WardEngineEffect["duration"]> = {};
    const text = blockString(data.text) ?? blockString(summary);
    const type = blockString(data.type);
    const amount = blockNumber(data.amount);
    const unit = blockString(data.unit);
    const starts = blockString(data.starts);
    const expires = blockString(data.expires);
    const tickTiming = blockString(data.tickTiming);
    const stackRule = blockString(data.stackRule);

    if (text) duration.text = text;
    if (type) duration.type = type;
    if (amount !== undefined) duration.amount = Math.trunc(amount);
    if (unit) duration.unit = unit;
    if (starts) duration.starts = starts;
    if (expires) duration.expires = expires;
    if (tickTiming) duration.tickTiming = tickTiming;
    if (stackRule) duration.stackRule = stackRule;
    if (typeof data.sourceLinked === "boolean") duration.sourceLinked = data.sourceLinked;

    return duration;
  }

  const text = blockString(summary);
  if (!text || text.toLowerCase() === "no duration") return undefined;

  const turnCycleMatch = text.match(/(?:next\s+)?(\d+)\s*turn cycles?/i);
  if (turnCycleMatch) {
    const amount = Math.max(1, Math.trunc(Number(turnCycleMatch[1])));
    return {
      text,
      type: "TURN_CYCLES",
      amount,
      unit: "TURN_CYCLE"
    };
  }

  if (/while\s+equipped/i.test(text)) {
    return { text, type: "WHILE_EQUIPPED" };
  }

  if (/current\s+battle/i.test(text)) {
    return { text, type: "CURRENT_BATTLE" };
  }

  return { text };
}

function copyBlockDataToParams(params: NonNullable<WardEngineEffect["params"]>, data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof data[key] !== "undefined") {
      params[key] = data[key];
    }
  }
}

const PROGRAM_TARGET_KINDS = new Set<EffectTargetKind>([
  "MAGIC_SLOT_CARD",
  "PRIMARY_CREATURE",
  "LIMITED_SUMMON",
  "ANY_CREATURE",
  "PLAYER",
  "CARD_IN_HAND",
  "CARD_IN_DECK",
  "CARD_IN_CEMETERY",
  "CARD_IN_REMOVED_FROM_GAME"
]);

const DICE_LIMIT_ACTION_TYPES = new Set([
  "APPLY_DICE_LIMIT"
]);

const STAT_MODIFIER_ACTION_TYPES = new Set([
  "APPLY_STAT_MODIFIER"
]);

const FIXED_DAMAGE_ACTION_TYPES = new Set([
  "DAMAGE",
  "DEAL_DAMAGE",
  "DEAL_INSTANT_DAMAGE",
  "DAMAGE_CREATURE",
  "INFLICT_DAMAGE",
  "APPLY_DAMAGE"
]);

const FIXED_HEAL_ACTION_TYPES = new Set([
  "HEAL",
  "HEAL_CREATURE",
  "APPLY_HEAL",
  "RESTORE_HP"
]);

const DOT_ACTION_TYPES = new Set([
  "APPLY_DAMAGE_OVER_TIME",
  "DAMAGE_OVER_TIME",
  "REGISTER_DOT",
  "DOT"
]);

const HOT_ACTION_TYPES = new Set([
  "APPLY_HEAL_OVER_TIME",
  "APPLY_HEALING_OVER_TIME",
  "HEAL_OVER_TIME",
  "HEALING_OVER_TIME",
  "REGISTER_HOT",
  "HOT"
]);

const LIMITED_SUMMON_ACTION_TYPES = new Set([
  "LIMITED_SUMMON",
  "SUMMON_LIMITED",
  "SUMMON_LIMITED_CREATURE",
  "SUMMON_LIMITED_CREATURE_FROM_HAND",
  "SUMMON_LIMITED_CREATURE_FROM_DECK",
  "SUMMON_LIMITED_CREATURE_FROM_CEMETERY",
  "FORCE_SUMMON_FROM_HAND"
]);

const CARD_MOVE_ACTION_TYPES = new Set([
  "MOVE_CARD",
  "SEND_TO_CEMETERY",
  "SEND_TO_ORIGINAL_OWNER_CEMETERY",
  "DISCARD_CARD",
  "DISCARD_CARDS",
  "FORCE_DISCARD",
  "PAY_DISCARD_COST",
  "PAY_DISCARD_MAGIC_COST",
  "DESTROY_MAGIC",
  "DESTROY_MAGIC_CARD",
  "DESTROY_MAGIC_CARDS",
  "DESTROY_CARD",
  "RETURN_TO_HAND",
  "SEARCH_DECK_TO_HAND"
]);

const SOURCE_ATTACH_ACTION_TYPES = new Set([
  "ATTACH_CARD",
  "ATTACH_SOURCE_TO_TARGET",
  "SOURCE_ATTACH_TO_TARGET",
  "EQUIP_SOURCE",
  "EQUIP_TO_TARGET"
]);

function isProgramTargetKind(value: unknown): value is EffectTargetKind {
  return typeof value === "string" && PROGRAM_TARGET_KINDS.has(value as EffectTargetKind);
}

function normalizeProgramToken(value: unknown): string {
  return blockString(value)?.toUpperCase().replace(/[\s-]+/g, "_") ?? "";
}

function getBlockData(block: EffectLogicBlock): Record<string, unknown> {
  return blockRecord(block.data) ?? {};
}

function findFirstBlock(blocks: EffectLogicBlock[], kind: EffectBlockKind): EffectLogicBlock | undefined {
  return blocks.find(block => block.kind === kind);
}

function getEffectValueText(effect: WardEngineEffect, block?: EffectLogicBlock): string | undefined {
  const data = block ? getBlockData(block) : {};

  return blockString(data.valueText) ??
    blockString(data.value) ??
    blockString(effect.params?.valueText) ??
    blockString(effect.value) ??
    blockString(block?.summary) ??
    blockString(effect.actionText);
}

function inferPositiveAmountFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;

  const match = text.match(/(\d+)/);
  const parsed = Number(match?.[1]);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function inferCompiledAmount(effect: WardEngineEffect, block?: EffectLogicBlock): number | undefined {
  const data = block ? getBlockData(block) : {};

  const directValues = [
    data.amount,
    data.damageAmount,
    data.healAmount,
    effect.params?.amount,
    effect.params?.damageAmount,
    effect.params?.healAmount
  ];

  for (const value of directValues) {
    const numeric = Number(value);

    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.trunc(numeric);
    }
  }

  return inferPositiveAmountFromText(getEffectValueText(effect, block));
}

function inferCompiledDiceLimitValue(effect: WardEngineEffect): number | undefined {
  const direct = Number(effect.params?.diceLimitValue);

  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  const text = [
    effect.value,
    effect.params?.valueText,
    effect.actionText
  ]
    .filter(Boolean)
    .join(" ");

  const match = text.match(/(?:only|maximum|max|limit(?:ed)?(?: to)?|limited to)\D*(\d+)/i);
  const parsed = Number(match?.[1]);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function getCompiledDuration(effect: WardEngineEffect): WardEngineEffect["duration"] | undefined {
  return effect.duration ?? effect.params?.duration;
}

function getCompiledStatChanges(effect: WardEngineEffect): NonNullable<WardEngineEffect["params"]>["statChanges"] {
  return Array.isArray(effect.params?.statChanges) ? effect.params.statChanges : [];
}

function getTargetText(effect: WardEngineEffect, targetBlock: EffectLogicBlock | undefined): string | undefined {
  const targetData = targetBlock ? getBlockData(targetBlock) : {};

  return blockString(targetData.target) ??
    blockString(targetData.paramsTarget) ??
    blockString(targetBlock?.summary) ??
    blockString(effect.target) ??
    blockString(effect.params?.target);
}

function inferProgramControllerScope(targetText: string | undefined): WardEffectProgramStep["controllerScope"] {
  const text = (targetText ?? "").toLowerCase();

  if (text.includes("opponent")) return "OPPONENT";
  if (text.includes("your ") || text.includes("yourself") || text.includes("controller")) return "CONTROLLER";

  return "ANY_PLAYER";
}

function targetKindFromSourceZone(sourceZone: unknown): EffectTargetKind | undefined {
  const zone = normalizeProgramToken(sourceZone);

  if (zone === "HAND") return "CARD_IN_HAND";
  if (zone === "DECK") return "CARD_IN_DECK";
  if (zone === "CEMETERY" || zone === "GRAVEYARD") return "CARD_IN_CEMETERY";
  if (zone === "REMOVED_FROM_GAME") return "CARD_IN_REMOVED_FROM_GAME";
  if (zone === "MAGIC_SLOT") return "MAGIC_SLOT_CARD";
  if (zone === "PRIMARY_CREATURE") return "PRIMARY_CREATURE";
  if (zone === "LIMITED_SUMMON") return "LIMITED_SUMMON";

  return undefined;
}

function inferProgramTargetKindFromText(targetText: string | undefined): EffectTargetKind | undefined {
  const text = (targetText ?? "").toLowerCase();

  if (!text) return undefined;

  if (text.includes("magic slot") || text.includes("magic card on the field") || text.includes("magic on the field")) {
    return "MAGIC_SLOT_CARD";
  }

  if (text.includes("from your hand") || text.includes("from hand") || text.includes("card in hand") || text.includes("hand card")) {
    return "CARD_IN_HAND";
  }

  if (text.includes("from your deck") || text.includes("from deck") || text.includes("card in deck") || text.includes("deck card")) {
    return "CARD_IN_DECK";
  }

  if (text.includes("from your cemetery") || text.includes("from cemetery") || text.includes("from graveyard") || text.includes("cemetery card")) {
    return "CARD_IN_CEMETERY";
  }

  if (text.includes("removed from game")) {
    return "CARD_IN_REMOVED_FROM_GAME";
  }

  if (text.includes("primary creature")) {
    return "PRIMARY_CREATURE";
  }

  if (text.includes("limited summon")) {
    return "LIMITED_SUMMON";
  }

  if (text.includes("creature") || text.includes("equipped creature") || text.includes("target")) {
    return "ANY_CREATURE";
  }

  if (text.includes("player") || text.includes("opponent") || text.includes("yourself")) {
    return "PLAYER";
  }

  return undefined;
}

function inferCardMoveDestination(actionType: string, effect: WardEngineEffect, block?: EffectLogicBlock): WardEffectProgramStep["destinationZone"] | undefined {
  const data = block ? getBlockData(block) : {};
  const explicitDestination =
    blockString(data.destinationZone) ??
    blockString(effect.params?.destinationZone);

  if (explicitDestination) {
    return explicitDestination;
  }

  if (
    actionType === "SEARCH_DECK_TO_HAND" ||
    actionType === "RETURN_TO_HAND"
  ) {
    return "HAND";
  }

  if (
    actionType === "SEND_TO_CEMETERY" ||
    actionType === "SEND_TO_ORIGINAL_OWNER_CEMETERY" ||
    actionType === "DISCARD_CARD" ||
    actionType === "DISCARD_CARDS" ||
    actionType === "FORCE_DISCARD" ||
    actionType === "PAY_DISCARD_COST" ||
    actionType === "PAY_DISCARD_MAGIC_COST" ||
    actionType === "DESTROY_MAGIC" ||
    actionType === "DESTROY_MAGIC_CARD" ||
    actionType === "DESTROY_MAGIC_CARDS" ||
    actionType === "DESTROY_CARD"
  ) {
    return "CEMETERY";
  }

  const text = getEffectValueText(effect, block)?.toLowerCase() ?? "";
  if (text.includes("to your hand") || text.includes("to hand")) return "HAND";
  if (text.includes("to cemetery") || text.includes("to graveyard")) return "CEMETERY";

  return undefined;
}

function isSupportedCardMoveDestination(destination: WardEffectProgramStep["destinationZone"] | undefined): boolean {
  const normalized = normalizeProgramToken(destination);

  // V2 runner currently supports HAND and CEMETERY destinations.
  return normalized === "HAND" || normalized === "CEMETERY" || normalized === "OWNER_CEMETERY";
}

function inferProgramTargetKindForAction(args: {
  actionType: string;
  effect: WardEngineEffect;
  targetText?: string;
  targetBlock?: EffectLogicBlock;
  actionBlock?: EffectLogicBlock;
}): EffectTargetKind | undefined {
  const targetData = args.targetBlock ? getBlockData(args.targetBlock) : {};
  const actionData = args.actionBlock ? getBlockData(args.actionBlock) : {};

  const explicitTargetKind =
    targetData.targetKind ??
    actionData.targetKind ??
    args.effect.params?.targetKind;

  if (isProgramTargetKind(explicitTargetKind)) {
    return explicitTargetKind;
  }

  const sourceZoneTarget =
    targetKindFromSourceZone(actionData.sourceZone) ??
    targetKindFromSourceZone(targetData.sourceZone) ??
    targetKindFromSourceZone(args.effect.params?.sourceZone);

  if (LIMITED_SUMMON_ACTION_TYPES.has(args.actionType)) {
    return sourceZoneTarget ??
      inferProgramTargetKindFromText(args.targetText) ??
      "CARD_IN_HAND";
  }

  if (CARD_MOVE_ACTION_TYPES.has(args.actionType)) {
    if (args.actionType === "SEARCH_DECK_TO_HAND") return "CARD_IN_DECK";
    if (args.actionType.includes("DISCARD") || args.actionType.includes("PAY_DISCARD")) return "CARD_IN_HAND";
    if (args.actionType.includes("DESTROY_MAGIC")) return "MAGIC_SLOT_CARD";

    return sourceZoneTarget ??
      inferProgramTargetKindFromText(args.targetText);
  }

  if (
    DICE_LIMIT_ACTION_TYPES.has(args.actionType) ||
    STAT_MODIFIER_ACTION_TYPES.has(args.actionType) ||
    FIXED_DAMAGE_ACTION_TYPES.has(args.actionType) ||
    FIXED_HEAL_ACTION_TYPES.has(args.actionType) ||
    DOT_ACTION_TYPES.has(args.actionType) ||
    HOT_ACTION_TYPES.has(args.actionType) ||
    SOURCE_ATTACH_ACTION_TYPES.has(args.actionType)
  ) {
    return inferProgramTargetKindFromText(args.targetText) ?? "ANY_CREATURE";
  }

  return inferProgramTargetKindFromText(args.targetText);
}

function compileProgramActionSteps(args: {
  effect: WardEngineEffect;
  actionBlock: EffectLogicBlock;
  actionType: string;
  duration?: WardEngineEffect["duration"];
}): WardEffectProgramStep[] {
  const steps: WardEffectProgramStep[] = [];
  const { effect, actionBlock, actionType, duration } = args;
  const valueText = getEffectValueText(effect, actionBlock);

  if (DICE_LIMIT_ACTION_TYPES.has(actionType)) {
    const diceLimitValue = inferCompiledDiceLimitValue(effect);

    if (diceLimitValue) {
      steps.push({
        id: `${effect.id}-program-dice-limit`,
        op: "MODIFIER.APPLY_DICE_LIMIT",
        label: "Apply dice limit",
        summary: valueText,
        targetRef: "target",
        rollKind: blockString(effect.params?.rollKind) ?? "HIT_ROLL",
        diceLimitMode: blockString(effect.params?.diceLimitMode) ?? "MAX",
        diceLimitValue,
        valueText,
        duration
      });
    }

    return steps;
  }

  if (STAT_MODIFIER_ACTION_TYPES.has(actionType)) {
    const statChanges = getCompiledStatChanges(effect);

    if (statChanges.length > 0) {
      steps.push({
        id: `${effect.id}-program-stat-modifier`,
        op: "MODIFIER.APPLY_STAT",
        label: "Apply stat modifier",
        summary: valueText,
        targetRef: "target",
        valueText,
        statChanges,
        duration
      });
    }

    return steps;
  }

  if (FIXED_DAMAGE_ACTION_TYPES.has(actionType)) {
    const amount = inferCompiledAmount(effect, actionBlock);

    if (amount) {
      steps.push({
        id: `${effect.id}-program-damage`,
        op: "DAMAGE.APPLY",
        label: "Apply damage",
        summary: valueText,
        targetRef: "target",
        amount,
        damageAmount: amount,
        valueText
      });
    }

    return steps;
  }

  if (FIXED_HEAL_ACTION_TYPES.has(actionType)) {
    const amount = inferCompiledAmount(effect, actionBlock);

    if (amount) {
      steps.push({
        id: `${effect.id}-program-heal`,
        op: "HEAL.APPLY",
        label: "Apply healing",
        summary: valueText,
        targetRef: "target",
        amount,
        healAmount: amount,
        valueText
      });
    }

    return steps;
  }

  if (DOT_ACTION_TYPES.has(actionType)) {
    const amount = inferCompiledAmount(effect, actionBlock);

    if (amount) {
      steps.push({
        id: `${effect.id}-program-dot`,
        op: "DOT.REGISTER",
        label: "Register damage over time",
        summary: valueText,
        targetRef: "target",
        amount,
        damageAmount: amount,
        valueText,
        effectType: "DAMAGE_OVER_TIME",
        tickTiming: blockString(effect.params?.tickTiming) ?? duration?.tickTiming ?? "END_OF_COMBAT_PHASE",
        stackRule: blockString(effect.params?.stackRule) ?? duration?.stackRule ?? "DO_NOT_STACK",
        duration
      });
    }

    return steps;
  }

  if (HOT_ACTION_TYPES.has(actionType)) {
    const amount = inferCompiledAmount(effect, actionBlock);

    if (amount) {
      steps.push({
        id: `${effect.id}-program-hot`,
        op: "HOT.REGISTER",
        label: "Register healing over time",
        summary: valueText,
        targetRef: "target",
        amount,
        healAmount: amount,
        valueText,
        effectType: "HEAL_OVER_TIME",
        tickTiming: blockString(effect.params?.tickTiming) ?? duration?.tickTiming ?? "BEGINNING_OF_TURN",
        stackRule: blockString(effect.params?.stackRule) ?? duration?.stackRule ?? "DO_NOT_STACK",
        duration
      });
    }

    return steps;
  }

  if (LIMITED_SUMMON_ACTION_TYPES.has(actionType)) {
    steps.push({
      id: `${effect.id}-program-limited-summon`,
      op: "SUMMON.LIMITED",
      label: "Limited summon",
      summary: valueText ?? actionBlock.summary,
      targetRef: "target",
      valueText
    });

    return steps;
  }

  if (CARD_MOVE_ACTION_TYPES.has(actionType)) {
    const destinationZone = inferCardMoveDestination(actionType, effect, actionBlock);

    if (isSupportedCardMoveDestination(destinationZone)) {
      steps.push({
        id: `${effect.id}-program-card-move`,
        op: "CARD.MOVE",
        label: "Move card",
        summary: valueText ?? actionBlock.summary,
        targetRef: "target",
        valueText,
        destinationZone
      });
    }

    return steps;
  }

  if (SOURCE_ATTACH_ACTION_TYPES.has(actionType)) {
    const sourcePlacement =
      blockString(effect.params?.sourcePlacement) ??
      blockString(getBlockData(actionBlock).sourcePlacement) ??
      "MAGIC_SLOT";

    steps.push({
      id: `${effect.id}-program-source-attach`,
      op: "SOURCE.ATTACH_TO_TARGET",
      label: "Attach source",
      summary: valueText ?? actionBlock.summary,
      targetRef: "target",
      valueText,
      sourcePlacement
    });

    return steps;
  }

  return steps;
}

function compileProgramCleanupSteps(effect: WardEngineEffect, blocks: EffectLogicBlock[]): WardEffectProgramStep[] {
  const cleanupSteps: WardEffectProgramStep[] = [];

  for (const block of blocks) {
    if (block.kind !== "CLEANUP") continue;

    const data = getBlockData(block);
    const summary = block.summary.toLowerCase();

    const sendSourceToCemetery =
      data.sendSourceToCemetery === true ||
      data.destinationZone === "CEMETERY" ||
      /send\s+source.*cemetery/.test(summary) ||
      /source.*send.*cemetery/.test(summary);

    if (sendSourceToCemetery) {
      cleanupSteps.push({
        id: `${effect.id}-program-source-send-cemetery`,
        op: "SOURCE.SEND_TO_CEMETERY",
        label: "Send source to cemetery",
        summary: block.summary,
        destinationZone: "CEMETERY"
      });
    }
  }

  return cleanupSteps;
}

function compileProgramPresentationSteps(effect: WardEngineEffect): WardEffectProgramStep[] {
  const visualCue = blockString(effect.params?.visualCue);

  if (!visualCue) return [];

  return [
    {
      id: `${effect.id}-program-visual`,
      op: "VISUAL.SHOW",
      label: "Show",
      summary: visualCue,
      valueText: visualCue
    }
  ];
}

function normalizeProgramConditionToken(value: unknown): string {
  return blockString(value)?.toUpperCase().replace(/[\s-]+/g, "_") ?? "";
}

function conditionObjectFromUnknown(value: unknown): Record<string, unknown> | undefined {
  const record = blockRecord(value);
  return record ?? undefined;
}

function normalizeMetadataCondition(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const trait = normalizeProgramConditionToken(
    raw.trait ??
    raw.type ??
    raw.kind ??
    raw.metadataType
  );

  const isMetadataTrait =
    trait === "ARTWORK_TAG" ||
    trait === "ARTWORK" ||
    trait === "ARTWORK_EFFECT" ||
    trait === "CREATURE_TYPE" ||
    trait === "TYPE" ||
    trait === "RARITY";

  if (!isMetadataTrait) {
    return undefined;
  }

  const expected =
    raw.expected ??
    raw.value ??
    raw.values ??
    raw.artworkTag ??
    raw.creatureType ??
    raw.rarity;

  if (expected === undefined || expected === null || expected === "") {
    return undefined;
  }

  return {
    type:
      trait === "ARTWORK" || trait === "ARTWORK_EFFECT"
        ? "ARTWORK_TAG"
        : trait === "TYPE"
          ? "CREATURE_TYPE"
          : trait,
    subjectRef: raw.subjectRef ?? raw.subject ?? raw.cardRef ?? "TARGET",
    operator: raw.operator ?? "HAS",
    expected,
    text: raw.text ?? raw.summary,
    data: raw
  };
}

function compileProgramConditions(effect: WardEngineEffect, blocks: EffectLogicBlock[]): WardEffectProgram["conditions"] {
  const compiled: WardEffectProgram["conditions"] = [];

  const rawConditions: Record<string, unknown>[] = [];

  const effectCondition = conditionObjectFromUnknown(effect.condition);
  if (effectCondition) rawConditions.push(effectCondition);

  const paramsCondition = conditionObjectFromUnknown(effect.params?.condition);
  if (paramsCondition) rawConditions.push(paramsCondition);

  for (const block of blocks) {
    if (block.kind !== "CONDITION") continue;

    const data = getBlockData(block);

    rawConditions.push({
      ...data,
      text: block.summary,
      summary: block.summary
    });
  }

  for (const raw of rawConditions) {
    const normalized = normalizeMetadataCondition(raw);

    if (normalized) {
      compiled.push(normalized);
      continue;
    }

    const conditionText = blockString(raw.text) ?? blockString(raw.summary);

    if (conditionText && conditionText.toLowerCase() !== "no condition") {
      compiled.push({
        type: blockString(raw.type) ?? "TEXT",
        text: conditionText,
        data: raw
      });
    }
  }

  return compiled;
}

function compileEffectProgramFromBlocks(effect: WardEngineEffect, blocks: EffectLogicBlock[]): WardEffectProgram | undefined {
  const duration = getCompiledDuration(effect);
  const steps: WardEffectProgramStep[] = [];

  const targetBlock = findFirstBlock(blocks, "TARGET");
  const targetText = getTargetText(effect, targetBlock);

  const actionBlocks = blocks.filter(block => block.kind === "ACTION");
  const primaryActionBlock = actionBlocks[0];
  const primaryActionType = normalizeProgramToken(
    primaryActionBlock
      ? blockString(getBlockData(primaryActionBlock).actionType) ?? parseActionTypeFromBlockSummary(primaryActionBlock.summary)
      : effect.actionType
  );

  const targetKind = inferProgramTargetKindForAction({
    actionType: primaryActionType,
    effect,
    targetText,
    targetBlock,
    actionBlock: primaryActionBlock
  });

  if (!targetKind) {
    return undefined;
  }

  steps.push({
    id: `${effect.id}-program-target`,
    op: "TARGET.SELECT",
    label: "Target",
    summary: targetText ?? "Select target",
    targetKind,
    controllerScope: inferProgramControllerScope(targetText),
    targetRef: "target"
  });

  for (const block of blocks) {
    if (block.kind === "DURATION" && duration) {
      steps.push({
        id: `${effect.id}-program-duration`,
        op: "DURATION.REGISTER",
        label: "Duration",
        summary: duration.text ?? block.summary,
        duration
      });
      continue;
    }

    if (block.kind !== "ACTION") {
      continue;
    }

    const data = getBlockData(block);
    const actionType = normalizeProgramToken(
      blockString(data.actionType) ??
        parseActionTypeFromBlockSummary(block.summary) ??
        effect.actionType
    );

    steps.push(...compileProgramActionSteps({
      effect,
      actionBlock: block,
      actionType,
      duration
    }));
  }

  steps.push(...compileProgramCleanupSteps(effect, blocks));

  const executableStepCount = steps.filter(step =>
    step.op !== "TARGET.SELECT" &&
    step.op !== "DURATION.REGISTER" &&
    step.op !== "VISUAL.SHOW"
  ).length;

  if (executableStepCount === 0) {
    return undefined;
  }

  return {
    version: 1,
    trigger: {
      type: effect.trigger,
      text: effect.trigger
    },
    conditions: compileProgramConditions(effect, blocks),
    steps,
    cleanup: [],
    presentation: compileProgramPresentationSteps(effect),
    compiledAt: nowIso(),
    compiledSource: "Effect Dev Tool Block Logic V2"
  };
}

export function compileEffectFromBlockChain(effect: WardEngineEffect): WardEngineEffect {
  const chain = buildEffectBlockChain(effect);
  const params = { ...(effect.params ?? {}) } as NonNullable<WardEngineEffect["params"]>;
  const next: WardEngineEffect = {
    ...effect,
    params
  };

  const visibleKinds = new Set(chain.blocks.map(block => block.kind));

  if (!visibleKinds.has("CONDITION")) {
    delete (next as unknown as Record<string, unknown>).condition;
    delete params.condition;
  }
  if (!visibleKinds.has("TARGET")) {
    delete (next as unknown as Record<string, unknown>).target;
    delete params.target;
    delete params.targetKind;
    delete params.sourceZone;
    delete params.destinationZone;
  }
  if (!visibleKinds.has("VALUE")) {
    delete (next as unknown as Record<string, unknown>).value;
    delete params.valueText;
    delete params.amount;
    delete params.damageAmount;
    delete params.healAmount;
    delete params.multiplier;
    delete params.statChanges;
    delete params.rollTable;
    delete params.table;
    delete params.diceLimitMode;
    delete params.diceLimitValue;
    delete params.rollKind;
  }
  if (!visibleKinds.has("DURATION")) {
    delete (next as unknown as Record<string, unknown>).duration;
    delete params.duration;
  }
  if (!visibleKinds.has("CLEANUP")) {
    delete params.sourceLinked;
    delete params.usesAnchoring;
    delete params.expiresWhenSourceLeaves;
  }
  if (!visibleKinds.has("VISUAL_CUE")) {
    delete params.visualCue;
  }

  for (const block of chain.blocks) {
    const data = blockRecord(block.data) ?? {};

    switch (block.kind) {
      case "TRIGGER": {
        const trigger = blockString(data.trigger) ?? blockString(block.summary);
        if (trigger) next.trigger = trigger;
        break;
      }
      case "CONDITION": {
        const summary = blockString(block.summary);
        if (!summary || summary.toLowerCase() === "no condition") {
          delete (next as unknown as Record<string, unknown>).condition;
          delete params.condition;
        } else {
          const condition = data.condition ?? next.condition ?? params.condition ?? summary;
          next.condition = condition;
          params.condition = condition;
        }
        break;
      }
      case "TARGET": {
        const target = blockString(data.target) ?? blockString(data.paramsTarget) ?? blockString(block.summary);
        if (target) {
          next.target = target;
          params.target = target;
        }
        copyBlockDataToParams(params, data, ["targetKind", "sourceZone", "destinationZone", "cardType", "creatureType", "magicType", "magicSubtype", "nameContains"]);
        break;
      }
      case "ACTION": {
        const actionType = blockString(data.actionType) ?? parseActionTypeFromBlockSummary(block.summary);
        if (actionType) next.actionType = actionType;
        const reusableFunction = blockString(data.reusableFunction);
        if (reusableFunction) next.reusableFunction = reusableFunction;
        break;
      }
      case "VALUE": {
        const value = blockString(data.value) ?? blockString(data.valueText) ?? blockString(block.summary);
        if (value && value.toLowerCase() !== "no value") {
          next.value = value;
          params.valueText = blockString(data.valueText) ?? value;
        }
        copyBlockDataToParams(params, data, [
          "amount",
          "damageAmount",
          "healAmount",
          "multiplier",
          "damageType",
          "statChanges",
          "rollTable",
          "table",
          "rollKind",
          "successRange",
          "diceLimitMode",
          "diceLimitValue",
          "status",
          "flags",
          "forceFirst",
          "forceHit",
          "forcedHitStillRollsHitDice",
          "criticalMissIgnoredWhenForcedHit"
        ]);
        break;
      }
      case "DURATION": {
        const duration = parseDurationFromBlock(block);
        if (duration) {
          next.duration = duration;
          params.duration = duration;
        }
        break;
      }
      case "CLEANUP": {
        if (typeof data.sourceLinked === "boolean") params.sourceLinked = data.sourceLinked;
        if (typeof data.usesAnchoring === "boolean") params.usesAnchoring = data.usesAnchoring;
        if (typeof data.expiresWhenSourceLeaves === "boolean") params.expiresWhenSourceLeaves = data.expiresWhenSourceLeaves;
        break;
      }
      case "VISUAL_CUE": {
        const visualCue = blockString(data.visualCue) ?? blockString(block.summary);
        if (visualCue) params.visualCue = visualCue;
        break;
      }
    }
  }

  const compiledProgram = compileEffectProgramFromBlocks(next, chain.blocks);

  if (compiledProgram) {
    next.program = compiledProgram;
  } else {
    delete (next as unknown as Record<string, unknown>).program;
  }

  params.blockCompilerVersion = 2;
  params.blockCompiledAt = nowIso();
  params.blockCompiledSource = "Effect Dev Tool";

  return next;
}

export function writeEffectBlocksToEffects(effects: WardEngineEffect[]): WardEngineEffect[] {
  return effects.map(effect => {
    const compiledEffect = compileEffectFromBlockChain(effect);
    const chain = buildEffectBlockChain(compiledEffect);

    return {
      ...compiledEffect,
      params: {
        ...compiledEffect.params,
        blockChain: chain.blocks,
        blockStatus: chain.overallStatus,
        visualCue: chain.blocks.find(block => block.kind === "VISUAL_CUE")?.summary,
        missingHandlers: chain.missingHandlers
      },
      notes: [
        compiledEffect.notes,
        chain.missingHandlers.length > 0 ? `Block missing handlers: ${chain.missingHandlers.join("; ")}` : "",
        chain.reviewNotes.length > 0 ? `Block review notes: ${chain.reviewNotes.join("; ")}` : ""
      ].filter(Boolean).join("\n")
    };
  });
}

export function stringifyEffectBlocks(chains: EffectBlockChain[]): string {
  return JSON.stringify(chains, null, 2);
}

function formatMaybeObject(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function effectDurationText(effect: WardEngineEffect): string | undefined {
  const duration = effect.duration ?? effect.params?.duration;
  if (!duration) return undefined;
  if (typeof duration === "string") return duration;
  if (typeof duration === "object") {
    const candidate = duration as Record<string, unknown>;
    return formatMaybeObject(candidate.text ?? candidate.type ?? duration);
  }
  return String(duration);
}

function effectConditionText(effect: WardEngineEffect): string | undefined {
  return formatMaybeObject(effect.condition ?? effect.params?.condition);
}

function effectTargetText(effect: WardEngineEffect): string | undefined {
  return formatMaybeObject(effect.target ?? effect.params?.target ?? effect.params?.targetKind);
}

function effectValueText(effect: WardEngineEffect): string | undefined {
  return formatMaybeObject(
    effect.value ??
    effect.params?.valueText ??
    effect.params?.amount ??
    effect.params?.damageAmount ??
    effect.params?.healAmount ??
    effect.params?.multiplier ??
    effect.params?.statChanges
  );
}

export function formatLibraryBlockCoverageItemReport(item: LibraryBlockCoverageItem): string {
  const lines = [
    `${item.actionType}`,
    `Status: ${item.status}`,
    `Handler: ${item.handler}`,
    `Effects: ${item.count}`,
    "",
    "Affected effects:"
  ];

  for (const effect of item.effects) {
    lines.push(`- ${effect.cardLabel} | ${effect.effectId} | ${effect.trigger ?? "ON_PLAY"} | ${effect.actionType}`);
    if (effect.actionText) lines.push(`  Action: ${effect.actionText}`);
    if (effect.target) lines.push(`  Target: ${effect.target}`);
    if (effect.value) lines.push(`  Value: ${effect.value}`);
    if (effect.conditionText) lines.push(`  Condition: ${effect.conditionText}`);
    if (effect.durationText) lines.push(`  Duration: ${effect.durationText}`);
    if (effect.reusableFunction) lines.push(`  Reusable Function: ${effect.reusableFunction}`);
    if (effect.notes) lines.push(`  Notes: ${effect.notes}`);
    if (effect.missingHandlers.length > 0) lines.push(`  Missing: ${effect.missingHandlers.join("; ")}`);
    if (effect.reviewNotes.length > 0) lines.push(`  Review: ${effect.reviewNotes.join("; ")}`);
  }

  return lines.join("\n");
}

export function formatLibraryBlockCoverageReport(items: LibraryBlockCoverageItem[]): string {
  return items.map(formatLibraryBlockCoverageItemReport).join("\n\n---\n\n");
}

export function summarizeLibraryBlockCoverage(cardLibrary: CardLibraryCardSummary[]): LibraryBlockCoverage {
  const actionMap = new Map<string, LibraryBlockCoverageItem>();
  let effectCount = 0;
  const allChains: EffectBlockChain[] = [];

  for (const card of cardLibrary) {
    for (const effect of card.effects ?? []) {
      effectCount += 1;
      const chain = buildEffectBlockChain(effect);
      allChains.push(chain);
      const actionType = effect.actionType || "UNKNOWN";
      const handler = handlerForEffect(effect);
      const existing = actionMap.get(actionType);
      const cardLabel = `${card.generation ? `Gen ${card.generation} ` : ""}${card.cardNumber ? `#${card.cardNumber} ` : ""}${card.name}`;
      const effectItem: LibraryBlockCoverageEffectItem = {
        cardLabel,
        cardId: card.id,
        packId: card.packId,
        effectId: effect.id,
        trigger: effect.trigger,
        actionType,
        actionText: effect.actionText,
        target: effectTargetText(effect),
        value: effectValueText(effect),
        conditionText: effectConditionText(effect),
        durationText: effectDurationText(effect),
        reusableFunction: effect.reusableFunction,
        notes: effect.notes,
        status: chain.overallStatus,
        missingHandlers: chain.missingHandlers,
        reviewNotes: chain.reviewNotes
      };

      if (existing) {
        existing.count += 1;
        if (!existing.cards.includes(cardLabel)) {
          existing.cards.push(cardLabel);
        }
        existing.effects.push(effectItem);
        existing.status = mergeStatus(existing.status, chain.overallStatus);
      } else {
        actionMap.set(actionType, {
          actionType,
          count: 1,
          status: chain.overallStatus,
          handler: handler.handler,
          cards: [cardLabel],
          effects: [effectItem]
        });
      }
    }
  }

  const actionTypes = [...actionMap.values()].sort((a, b) => {
    const statusSort = statusWeight(b.status) - statusWeight(a.status);
    if (statusSort !== 0) return statusSort;
    return b.count - a.count;
  });

  return {
    cardCount: cardLibrary.length,
    effectCount,
    summary: summarizeEffectBlockChains(allChains),
    actionTypes,
    missingActionTypes: actionTypes.filter(item => item.status === "MISSING" || item.status === "REVIEW")
  };
}

export function statusWeight(status: EffectBlockStatus): number {
  switch (status) {
    case "MISSING": return 4;
    case "REVIEW": return 3;
    case "PARTIAL": return 2;
    case "READY": return 1;
  }
}

export type EffectBlockRuntimePreview = {
  route: string;
  executable: boolean;
  runtimeAspects: string[];
  missingRuntimeAspects: string[];
};

export function getEffectBlockRuntimePreview(effect: WardEngineEffect): EffectBlockRuntimePreview {
  const chain = buildEffectBlockChain(effect);
  const actionType = normalize(effect.actionType);
  const text = [
    effect.trigger,
    effect.actionType,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.notes,
    ...chain.blocks.map(block => `${block.kind} ${block.summary} ${block.handler ?? ""} ${block.notes ?? ""}`)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const runtimeAspects: string[] = [];
  const missingRuntimeAspects: string[] = [];

  if (actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER" || (text.includes("attack first") && text.includes("auto") && text.includes("hit"))) {
    runtimeAspects.push("battle order override", "forced hit", "damage multiplier", "critical-compatible hit roll");
  }

  if (actionType.includes("DAMAGE_MULTIPLIER") || text.includes("x atk damage") || text.includes("x atk damage") || text.includes("double attack damage")) {
    runtimeAspects.push("damage multiplier");
  }

  if (actionType.includes("DICE_MODIFIER") || text.includes("hit dice") || text.includes("attack dice")) {
    runtimeAspects.push("dice modifier");
  }

  if (actionType.includes("STAT_MODIFIER")) {
    runtimeAspects.push("stat modifier layer");
  }

  if (actionType === "APPLY_STATUS" || actionType === "APPLY_STATUS_WITH_ESCAPE_ROLL") {
    runtimeAspects.push("creature status badge/flags");
  }

  if (actionType.includes("DAMAGE_OVER_TIME") || actionType.includes("HEAL_OVER_TIME") || actionType.includes("HEALING_OVER_TIME")) {
    runtimeAspects.push("recurring DOT/HOT ticker");
  }

  if (actionType === "DRAW_CARDS") runtimeAspects.push("draw cards");
  if (actionType === "DESTROY_ALL_MAGIC") runtimeAspects.push("destroy all magic");
  if (actionType.includes("SUMMON") || actionType.includes("MOVE_CARD") || actionType.includes("SEARCH_DECK")) runtimeAspects.push("prompt/card movement route");

  if (chain.missingHandlers.length > 0) {
    missingRuntimeAspects.push(...chain.missingHandlers);
  }

  if (chain.reviewNotes.length > 0) {
    missingRuntimeAspects.push(...chain.reviewNotes.filter(note => note.toLowerCase().includes("needs") || note.toLowerCase().includes("pending")));
  }

  const executable = runtimeAspects.length > 0 && chain.overallStatus !== "MISSING";

  return {
    route: executable ? "Block Runtime Bridge" : "Manual/review route",
    executable,
    runtimeAspects: [...new Set(runtimeAspects)],
    missingRuntimeAspects: [...new Set(missingRuntimeAspects)]
  };
}




