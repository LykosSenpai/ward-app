import type { ManualBattleStrikeModifiers, WardEffectDuration, WardEffectStatChange, WardEngineEffect } from "@ward/shared";

export type RuntimeEffectBlockKind =
  | "TRIGGER"
  | "CONDITION"
  | "TARGET"
  | "ACTION"
  | "VALUE"
  | "DURATION"
  | "CLEANUP"
  | "VISUAL_CUE";

export type RuntimeEffectBlock = {
  id?: string;
  kind?: RuntimeEffectBlockKind | string;
  label?: string;
  summary?: string;
  status?: string;
  handler?: string;
  data?: Record<string, unknown>;
  notes?: string;
};

export type RuntimeBattleBlockPlan = {
  actionType: string;
  searchText: string;
  forceFirstStrike: boolean;
  forceHit: boolean;
  forceMiss: boolean;
  ignoreCriticalMiss: boolean;
  damageMultiplier?: number;
  preventAttackDamage: boolean;
  hitDiceDelta?: number;
  hitDiceLimit?: number;
  hitFlatBonus?: number;
  damageDiceDelta?: number;
  damageFlatBonus?: number;
  speedDelta?: number;
  visualCue?: string;
  runtimeNotes: string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function unknownToSearchText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(unknownToSearchText).filter(Boolean).join(" ");

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(unknownToSearchText)
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

export function getRuntimeEffectBlocks(effect: WardEngineEffect): RuntimeEffectBlock[] {
  const blocks = effect.params?.blockChain;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map(block => asRecord(block))
    .filter((block): block is Record<string, unknown> => Boolean(block))
    .map(block => ({
      id: asString(block.id),
      kind: asString(block.kind),
      label: asString(block.label),
      summary: asString(block.summary),
      status: asString(block.status),
      handler: asString(block.handler),
      data: asRecord(block.data),
      notes: asString(block.notes)
    }));
}

export function getRuntimeBlockByKind(effect: WardEngineEffect, kind: RuntimeEffectBlockKind): RuntimeEffectBlock | undefined {
  return getRuntimeEffectBlocks(effect).find(block => normalize(block.kind) === kind);
}

function actionTypeFromActionBlock(block: RuntimeEffectBlock | undefined): string | undefined {
  const dataActionType = asString(block?.data?.actionType);
  if (dataActionType) return dataActionType;

  const summary = block?.summary;
  if (!summary) return undefined;

  const [firstToken] = summary.split(/\s*(?:→|->|:)\s*/);
  return firstToken?.trim() || undefined;
}

export function getRuntimeBlockActionType(effect: WardEngineEffect): string {
  return actionTypeFromActionBlock(getRuntimeBlockByKind(effect, "ACTION")) ?? effect.actionType;
}

export function getRuntimeBlockTrigger(effect: WardEngineEffect): string | undefined {
  const triggerBlock = getRuntimeBlockByKind(effect, "TRIGGER");
  return triggerBlock?.summary ?? effect.trigger;
}

export function getRuntimeBlockVisualCue(effect: WardEngineEffect): string | undefined {
  return asString(effect.params?.visualCue) ?? getRuntimeBlockByKind(effect, "VISUAL_CUE")?.summary;
}

export function getRuntimeBlockValueText(effect: WardEngineEffect): string | undefined {
  return getRuntimeBlockByKind(effect, "VALUE")?.summary ?? effect.value ?? effect.params?.valueText;
}

export function getRuntimeBlockTargetText(effect: WardEngineEffect): string | undefined {
  return getRuntimeBlockByKind(effect, "TARGET")?.summary ?? effect.target ?? effect.params?.target;
}

export function getRuntimeBlockConditionText(effect: WardEngineEffect): string | undefined {
  const block = getRuntimeBlockByKind(effect, "CONDITION");
  return block?.summary ?? (unknownToSearchText(effect.condition || effect.params?.condition) || undefined);
}

function asNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function getRuntimeBlockDurationData(effect: WardEngineEffect): WardEffectDuration | undefined {
  const durationBlock = getRuntimeBlockByKind(effect, "DURATION");
  const data = durationBlock?.data;

  if (data && (data.text || data.type || data.amount || data.unit || data.starts || data.expires || data.tickTiming || data.stackRule)) {
    const amount = asNumber(data.amount);
    const duration: WardEffectDuration = {};
    const text = asString(data.text) ?? durationBlock?.summary;
    const type = asString(data.type);
    const unit = asString(data.unit);
    const starts = asString(data.starts);
    const expires = asString(data.expires);
    const tickTiming = asString(data.tickTiming);
    const stackRule = asString(data.stackRule);

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

  const summary = durationBlock?.summary;
  if (!summary) return undefined;

  const turnCycleMatch = summary.match(/(?:next\s+)?(\d+)\s*turn cycles?/i);
  if (turnCycleMatch) {
    return {
      text: summary,
      type: "TURN_CYCLES",
      amount: Math.max(1, Math.trunc(Number(turnCycleMatch[1]))),
      unit: "TURN_CYCLE"
    };
  }

  if (/while\s+equipped/i.test(summary)) return { text: summary, type: "WHILE_EQUIPPED" };
  if (/current\s+battle/i.test(summary)) return { text: summary, type: "CURRENT_BATTLE" };

  return { text: summary };
}

export function getRuntimeBlockDurationText(effect: WardEngineEffect): string | undefined {
  return getRuntimeBlockDurationData(effect)?.text ?? effect.duration?.text ?? effect.params?.duration?.text;
}

export function getRuntimeBlockText(effect: WardEngineEffect): string {
  const blocks = getRuntimeEffectBlocks(effect);
  return [
    effect.trigger,
    effect.condition,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.duration,
    effect.reusableFunction,
    effect.params,
    effect.notes,
    ...blocks.flatMap(block => [block.kind, block.label, block.summary, block.handler, block.data, block.notes])
  ]
    .map(unknownToSearchText)
    .filter(Boolean)
    .join(" ");
}

export function getRuntimeBlockStatChanges(effect: WardEngineEffect): WardEffectStatChange[] {
  const direct = effect.params?.statChanges;
  if (Array.isArray(direct)) return direct;

  const valueBlock = getRuntimeBlockByKind(effect, "VALUE");
  const blockChanges = valueBlock?.data?.statChanges;
  if (!Array.isArray(blockChanges)) return [];

  return blockChanges
    .map(change => asRecord(change))
    .filter((change): change is Record<string, unknown> => Boolean(change))
    .map(change => ({
      stat: String(change.stat ?? ""),
      operation: String(change.operation ?? "ADD"),
      value: Number(change.value ?? 0),
      rounding: change.rounding === undefined ? undefined : String(change.rounding)
    }))
    .filter(change => change.stat && Number.isFinite(change.value));
}

export function getRuntimeBlockMultiplier(effect: WardEngineEffect, fallback?: number): number | undefined {
  const candidates = [
    effect.params?.multiplier,
    getRuntimeBlockByKind(effect, "VALUE")?.data?.multiplier,
    getRuntimeBlockValueText(effect),
    effect.actionText,
    effect.notes,
    getRuntimeBlockText(effect)
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate;
    if (typeof candidate !== "string") continue;
    const match = candidate.match(/(?:x|×)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:x|×)/i);
    const value = Number(match?.[1] ?? match?.[2]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return fallback;
}

function firstSignedNumber(text: string): number | undefined {
  const match = text.match(/([+-])\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return undefined;
  return match[1] === "-" ? -value : value;
}

function parseDiceLimit(text: string): number | undefined {
  const match = text.match(/(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(?:roll\s*)?(\d+)\s*hit\s*di(?:e|ce)|hit\s*di(?:e|ce).*?(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(\d+)/i);
  const value = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : undefined;
}

export function getRuntimeBattleBlockPlan(effect: WardEngineEffect): RuntimeBattleBlockPlan {
  const actionType = normalize(getRuntimeBlockActionType(effect));
  const searchText = getRuntimeBlockText(effect).toLowerCase();
  const multiplier = getRuntimeBlockMultiplier(effect);
  const signedNumber = firstSignedNumber(searchText);
  const visualCue = getRuntimeBlockVisualCue(effect);
  const runtimeNotes: string[] = [];

  const forcedFirstAutoHit = actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER" ||
    (searchText.includes("attack first") && searchText.includes("auto") && searchText.includes("hit"));

  if (forcedFirstAutoHit) {
    runtimeNotes.push("Block runtime: force first strike, force hit success, keep hit dice roll for critical hit checks, ignore critical miss.");
  }

  const forceHit = forcedFirstAutoHit ||
    actionType.includes("HIT_OUTCOME_OVERRIDE") ||
    actionType.includes("TEMPORARY_HIT_OVERRIDE") ||
    searchText.includes("automatically hit") ||
    searchText.includes("auto-hit") ||
    searchText.includes("auto hit");

  const forceMiss = actionType.includes("FORCE_MISS") || searchText.includes("automatically miss") || searchText.includes("auto miss");

  const forceFirstStrike = forcedFirstAutoHit ||
    actionType.includes("ATTACK_PRIORITY_OVERRIDE") ||
    actionType.includes("CHANGE_BATTLE_ORDER") ||
    actionType.includes("FORCE_ATTACK_FIRST") ||
    searchText.includes("attack first") ||
    searchText.includes("attacks first") ||
    searchText.includes("goes first");

  const preventAttackDamage = actionType.includes("NEGATE_ATTACK") ||
    actionType.includes("PREVENT_ATTACK_DAMAGE") ||
    actionType.includes("NEGATE_ATTACK_DAMAGE") ||
    actionType.includes("PREVENT_DAMAGE") ||
    actionType.includes("DAMAGE_IMMUNITY") ||
    searchText.includes("cannot inflict atk damage") ||
    searchText.includes("cannot inflict attack damage");

  const hitDiceLimit = parseDiceLimit(searchText);

  let hitDiceDelta: number | undefined;
  let hitFlatBonus: number | undefined;
  let damageDiceDelta: number | undefined;
  let damageFlatBonus: number | undefined;
  let speedDelta: number | undefined;

  if (actionType.includes("DICE_MODIFIER") || searchText.includes("dice rolls") || searchText.includes("dice roll")) {
    if (searchText.includes("hit dice")) hitDiceDelta = signedNumber;
    if (searchText.includes("atk dice") || searchText.includes("attack dice")) damageDiceDelta = signedNumber;
  }

  if (actionType.includes("STAT_MODIFIER") || searchText.includes("stat")) {
    for (const change of getRuntimeBlockStatChanges(effect)) {
      const op = normalize(change.operation);
      const delta = op === "SUBTRACT" ? -Number(change.value) : op === "ADD" ? Number(change.value) : undefined;
      if (!Number.isFinite(delta)) continue;
      const stat = normalize(change.stat);
      if (stat === "SPD" || stat === "SPEED") speedDelta = Number(speedDelta ?? 0) + Number(delta);
      if (stat === "MOD" || stat === "MODIFIER") {
        hitFlatBonus = Number(hitFlatBonus ?? 0) + Number(delta);
        damageFlatBonus = Number(damageFlatBonus ?? 0) + Number(delta);
      }
      if (["ATK", "ATTACK", "ATK_DAMAGE", "ATTACK_DAMAGE", "ATK_BONUS"].includes(stat)) {
        damageFlatBonus = Number(damageFlatBonus ?? 0) + Number(delta);
      }
      if (["HIT", "HIT_ROLL", "HIT_BONUS"].includes(stat)) hitFlatBonus = Number(hitFlatBonus ?? 0) + Number(delta);
      if (["ATK_DICE", "ATTACK_DICE", "ATK_DICE_ROLLS", "ATTACK_DICE_ROLLS"].includes(stat)) damageDiceDelta = Number(damageDiceDelta ?? 0) + Number(delta);
      if (["HIT_DICE", "HIT_DICE_ROLLS"].includes(stat)) hitDiceDelta = Number(hitDiceDelta ?? 0) + Number(delta);
    }
  }

  if (!damageFlatBonus && (searchText.includes("atk damage") || searchText.includes("attack damage")) && signedNumber !== undefined && !searchText.includes("x") && !searchText.includes("×")) {
    damageFlatBonus = signedNumber;
  }

  return {
    actionType,
    searchText,
    forceFirstStrike,
    forceHit: forceHit && !forceMiss,
    forceMiss,
    ignoreCriticalMiss: forceHit && !forceMiss,
    damageMultiplier: forcedFirstAutoHit ? (multiplier ?? 3) : multiplier,
    preventAttackDamage,
    hitDiceDelta,
    hitDiceLimit,
    hitFlatBonus,
    damageDiceDelta,
    damageFlatBonus,
    speedDelta,
    visualCue,
    runtimeNotes
  };
}

export function runtimeBattlePlanToStrikeModifiers(plan: RuntimeBattleBlockPlan): Partial<ManualBattleStrikeModifiers> {
  const modifiers: Partial<ManualBattleStrikeModifiers> = {};

  if (plan.forceHit) modifiers.forceHitResult = "FORCE_HIT";
  if (plan.forceMiss) modifiers.forceHitResult = "FORCE_MISS";
  if (plan.damageMultiplier !== undefined && plan.damageMultiplier !== 1) modifiers.damageMultiplier = plan.damageMultiplier;
  if (plan.preventAttackDamage) modifiers.preventAttackDamage = true;
  if (plan.hitDiceDelta !== undefined) modifiers.hitDiceDelta = plan.hitDiceDelta;
  if (plan.hitDiceLimit !== undefined) modifiers.hitDiceLimit = plan.hitDiceLimit;
  if (plan.hitFlatBonus !== undefined) modifiers.hitFlatBonus = plan.hitFlatBonus;
  if (plan.damageDiceDelta !== undefined) modifiers.damageDiceDelta = plan.damageDiceDelta;
  if (plan.damageFlatBonus !== undefined) modifiers.damageFlatBonus = plan.damageFlatBonus;

  return modifiers;
}
