import type {
  ActiveEffectInstance,
  BattleEffectSuggestion,
  CardDefinition,
  CardInstance,
  ManualBattleSpeedModifiers,
  ManualBattleStrikeModifiers,
  MatchState,
  PendingBattleSession,
  WardEngineEffect,
  WardEffectStatChange
} from "@ward/shared";
import { getCardEngineEffects } from "./effectResolver.js";
import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import { getRuntimeBattleBlockPlan, getRuntimeBlockActionType, getRuntimeBlockStatChanges, getRuntimeBlockText, runtimeBattlePlanToStrikeModifiers } from "./effectBlockRuntime.js";

const BATTLE_RELEVANT_TRIGGERS = new Set([
  "STATIC_WHILE_ON_FIELD",
  "WHILE_ON_FIELD",
  "WHILE_FIELD_ACTIVE",
  "WHILE_EQUIPPED",
  "ON_EQUIP",
  "DURING_BATTLE",
  "PRIOR_TO_BATTLE",
  "PRIOR_TO_EACH_BATTLE",
  "PRIOR_TO_EACH_BATTLE_WITH_THIS_CREATURE",
  "WHEN_BATTLE_DECLARED",
  "WHEN_OPPONENT_DECLARES_BATTLE",
  "BEFORE_SPEED_CHECK",
  "BEFORE_HIT_ROLL",
  "DURING_HIT_ROLL",
  "AFTER_HIT_ROLL",
  "ON_HIT",
  "ON_HIT_FIRST",
  "ON_HIT_FROM_HAND",
  "WHEN_OPPONENT_LANDS_HIT",
  "ON_MISS",
  "BEFORE_DAMAGE_ROLL",
  "DURING_DAMAGE_CALC",
  "DURING_DAMAGE_CALC_OR_STATIC",
  "DAMAGE_CALC_ON_THIS_CARD",
  "AFTER_DAMAGE_APPLIED",
  "WHEN_CREATURE_KILLED_IN_BATTLE",
  "WHEN_THIS_CREATURE_KILLED",
  "IF_KILLED_IN_BATTLE",
  "AT_END_OF_BATTLE",
  "END_OF_COMBAT_PHASE"
]);

type ActiveBattleSource = {
  card: CardInstance;
  definition: CardDefinition;
  playerId: string;
  zone: BattleEffectSuggestion["sourceZone"];
};

type BattleCreatureRef = {
  playerId: string;
  creatureInstanceId: string;
  role: "DECLARED_ATTACKER" | "DECLARED_DEFENDER";
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function effectSearchText(effect: WardEngineEffect): string {
  return getRuntimeBlockText(effect).toLowerCase();
}

function effectHasDeferredEffectRoll(effect: WardEngineEffect): boolean {
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
  const reusableFunction = normalizeText(effect.reusableFunction).trim().toUpperCase();
  const params = effect.params as Record<string, unknown> | undefined;

  return actionType === "ROLL_FOR_EFFECT" ||
    reusableFunction === "ROLLFOREFFECT" ||
    Boolean(params?.roll);
}

function parseDiceLimit(effect: WardEngineEffect): number | undefined {
  const text = [effect.value, effect.params?.valueText, effect.actionText, effect.notes]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(?:roll\s*)?(\d+)\s*hit\s*di(?:e|ce)|hit\s*di(?:e|ce).*?(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(\d+)/i);

  if (!match) {
    return undefined;
  }

  const value = Number(match[1] ?? match[2]);
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : undefined;
}

function parseMultiplier(effect: WardEngineEffect): number | undefined {
  const text = [effect.value, effect.params?.valueText, effect.actionText]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/(?:x|×)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:x|×)/i);

  if (!match) {
    return undefined;
  }

  const value = Number(match[1] ?? match[2]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeStatName(stat: string):
  | "armorLevel"
  | "speed"
  | "attackDice"
  | "modifier"
  | "hitDice"
  | "hitFlat"
  | "attackFlat"
  | undefined {
  const value = stat.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (["AL", "ARMOR", "ARMOR_LEVEL"].includes(value)) return "armorLevel";
  if (["SPD", "SPEED"].includes(value)) return "speed";
  if (["ATTACK_DICE", "ATK_DICE", "ATK_DICE_ROLLS", "ATTACK_DICE_ROLLS"].includes(value)) return "attackDice";
  if (["ATK", "ATTACK", "ATK_BONUS", "ATTACK_BONUS", "ATK_DAMAGE", "ATTACK_DAMAGE", "ATK_DAMAGE_BONUS", "ATTACK_DAMAGE_BONUS", "DAMAGE_BONUS"].includes(value)) return "attackFlat";
  if (["MOD", "MODIFIER"].includes(value)) return "modifier";
  if (["HIT_DICE", "HIT_DICE_ROLLS"].includes(value)) return "hitDice";
  if (["HIT", "HIT_ROLL", "HIT_BONUS"].includes(value)) return "hitFlat";

  return undefined;
}

function statDelta(change: WardEffectStatChange): number | undefined {
  if (!Number.isFinite(change.value)) return undefined;

  const operation = change.operation.trim().toUpperCase();
  if (operation === "ADD") return Number(change.value);
  if (operation === "SUBTRACT") return -Number(change.value);

  // SET / ADD_DYNAMIC need a richer modifier layer. Surface as detected text only for now.
  return undefined;
}

function collectActiveBattleSources(state: MatchState): ActiveBattleSource[] {
  const sources: ActiveBattleSource[] = [];

  for (const player of state.players) {
    const maybeAdd = (card: CardInstance | undefined, zone: ActiveBattleSource["zone"]) => {
      if (!card) return;
      const definition = state.cardCatalog[card.cardId];
      if (!definition) return;
      sources.push({ card, definition, playerId: player.id, zone });
    };

    maybeAdd(player.field.primaryCreature, "PRIMARY_CREATURE");

    for (const limitedSummon of player.field.limitedSummons) {
      maybeAdd(limitedSummon, "LIMITED_SUMMON");
    }

    for (const magicSlot of player.field.magicSlots) {
      maybeAdd(magicSlot, "MAGIC_SLOT");
    }
  }

  return sources;
}

function getBattleCreatures(session: PendingBattleSession): BattleCreatureRef[] {
  return [
    {
      playerId: session.declaredAttacker.playerId,
      creatureInstanceId: session.declaredAttacker.creatureInstanceId,
      role: "DECLARED_ATTACKER"
    },
    {
      playerId: session.declaredDefender.playerId,
      creatureInstanceId: session.declaredDefender.creatureInstanceId,
      role: "DECLARED_DEFENDER"
    }
  ];
}

function sourceAppliesToCreature(
  state: MatchState,
  source: ActiveBattleSource,
  effect: WardEngineEffect,
  creature: BattleCreatureRef
): boolean {
  const text = effectSearchText(effect);
  const creatureCard = state.players
    .flatMap(player => [
      player.field.primaryCreature,
      ...player.field.limitedSummons
    ])
    .find(card => card?.instanceId === creature.creatureInstanceId);
  const creatureDefinition = creatureCard ? state.cardCatalog[creatureCard.cardId] : undefined;

  if (source.card.attachedToInstanceId) {
    return source.card.attachedToInstanceId === creature.creatureInstanceId;
  }

  if (source.card.instanceId === creature.creatureInstanceId) {
    return true;
  }

  if (text.includes("equipped creature")) {
    return source.card.attachedToInstanceId === creature.creatureInstanceId;
  }

  if (text.includes("your creature") || text.includes("your primary") || text.includes("your limited")) {
    return source.playerId === creature.playerId;
  }

  if (text.includes("opponent") || text.includes("opponents")) {
    return source.playerId !== creature.playerId;
  }

  if (text.includes("all creature") || text.includes("both creature") || text.includes("each creature")) {
    return true;
  }

  if (text.includes("non-effect creature") || text.includes("non effect creature")) {
    if (creatureDefinition?.cardType !== "CREATURE") return false;
    if (creatureDefinition.effects?.length) return false;

    const alLimitMatch = text.match(/al\s*(?:<=|=|of|under|or less|less than or equal to)?\s*(\d+)/i);
    const baseAlLimitMatch = text.match(/base\s+al\s*(?:<=|=|of|under|or less|less than or equal to)?\s*(\d+)/i);
    const limit = Number(baseAlLimitMatch?.[1] ?? alLimitMatch?.[1]);

    if (Number.isFinite(limit) && creatureDefinition.armorLevel > limit) {
      return false;
    }

    return true;
  }

  return false;
}

function isBattleRelevantEffect(effect: WardEngineEffect): boolean {
  const trigger = normalizeText(effect.trigger).trim().toUpperCase();

  if (BATTLE_RELEVANT_TRIGGERS.has(trigger)) return true;

  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
  return actionType.includes("ATTACK") ||
    actionType.includes("BATTLE") ||
    actionType.includes("DAMAGE") ||
    actionType.includes("HIT") ||
    actionType.includes("DICE") ||
    actionType.includes("STAT") ||
    actionType.includes("STATUS") ||
    actionType.includes("NEGATE") ||
    actionType.includes("PREVENT") ||
    actionType.includes("IMMUNITY");
}

function mergeStrikeModifier(
  target: Partial<ManualBattleStrikeModifiers>,
  patch: Partial<ManualBattleStrikeModifiers>
): void {
  target.hitDiceDelta = Number(target.hitDiceDelta ?? 0) + Number(patch.hitDiceDelta ?? 0);
  if (patch.hitDiceLimit !== undefined) {
    target.hitDiceLimit = target.hitDiceLimit === undefined
      ? patch.hitDiceLimit
      : Math.min(target.hitDiceLimit, patch.hitDiceLimit);
  }
  target.hitFlatBonus = Number(target.hitFlatBonus ?? 0) + Number(patch.hitFlatBonus ?? 0);
  target.damageDiceDelta = Number(target.damageDiceDelta ?? 0) + Number(patch.damageDiceDelta ?? 0);
  target.damageFlatBonus = Number(target.damageFlatBonus ?? 0) + Number(patch.damageFlatBonus ?? 0);
  target.damageMultiplier = Number(target.damageMultiplier ?? 1) * Number(patch.damageMultiplier ?? 1);
  target.preventAttackDamage = Boolean(target.preventAttackDamage || patch.preventAttackDamage);
  target.forceHitResult = patch.forceHitResult ?? target.forceHitResult;
}

function suggestionFromStatChange(
  source: ActiveBattleSource,
  effect: WardEngineEffect,
  creature: BattleCreatureRef,
  change: WardEffectStatChange,
  index: number
): BattleEffectSuggestion | undefined {
  const stat = normalizeStatName(change.stat);
  const delta = statDelta(change);

  if (!stat || delta === undefined || delta === 0) return undefined;

  const base = {
    id: `${source.card.instanceId}:${effect.id}:stat:${index}:${creature.creatureInstanceId}`,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardId: source.card.cardId,
    sourceCardName: source.definition.name,
    sourcePlayerId: source.playerId,
    sourceZone: source.zone,
    trigger: effect.trigger,
    actionType: effect.actionType,
    effectId: effect.id,
    appliesToPlayerId: creature.playerId,
    appliesToCreatureInstanceId: creature.creatureInstanceId,
    appliesToRole: creature.role,
    label: `${source.definition.name}: ${change.stat} ${delta > 0 ? "+" : ""}${delta}`,
    note: effect.actionText ?? effect.value ?? effect.notes
  } satisfies Omit<BattleEffectSuggestion, "kind">;

  if (stat === "speed") {
    const speedModifiers: Partial<ManualBattleSpeedModifiers> = creature.role === "DECLARED_ATTACKER"
      ? { attackingSpeedDelta: delta }
      : { defendingSpeedDelta: delta };
    return { ...base, kind: "SPEED", speedModifiers };
  }

  const strikeModifiers: Partial<ManualBattleStrikeModifiers> = {};

  if (stat === "attackDice") strikeModifiers.damageDiceDelta = delta;
  if (stat === "modifier") {
    strikeModifiers.hitFlatBonus = delta;
    strikeModifiers.damageFlatBonus = delta;
  }
  if (stat === "hitDice") strikeModifiers.hitDiceDelta = delta;
  if (stat === "hitFlat") strikeModifiers.hitFlatBonus = delta;
  if (stat === "attackFlat") strikeModifiers.damageFlatBonus = delta;

  if (Object.keys(strikeModifiers).length === 0) {
    return { ...base, kind: "INFO" };
  }

  return { ...base, kind: "STRIKE", strikeModifiers };
}

function isForcedFirstAutoHitMultiplierAction(actionType: string, text: string): boolean {
  return actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER" ||
    (text.includes("attack first") && text.includes("auto") && text.includes("hit") && (text.includes("x atk") || text.includes("× atk")));
}

function isTemporaryHitOverrideAction(actionType: string, text: string): boolean {
  return actionType === "APPLY_TEMPORARY_HIT_OVERRIDE" ||
    (text.includes("auto") && text.includes("hit") && !text.includes("x atk"));
}

function forcedFirstAutoHitMultiplierSuggestions(
  base: Omit<BattleEffectSuggestion, "kind">,
  creature: BattleCreatureRef,
  multiplier: number
): BattleEffectSuggestion[] {
  const speedOverride: ManualBattleSpeedModifiers["override"] = creature.role === "DECLARED_ATTACKER"
    ? "ATTACKER_FIRST"
    : "DEFENDER_FIRST";

  return [
    {
      ...base,
      id: `${base.id}:speed`,
      kind: "SPEED",
      speedModifiers: { override: speedOverride }
    },
    {
      ...base,
      id: `${base.id}:strike`,
      kind: "STRIKE",
      strikeModifiers: {
        forceHitResult: "FORCE_HIT",
        damageMultiplier: multiplier
      }
    }
  ];
}

function suggestionsFromActiveEffectInstance(
  source: ActiveBattleSource,
  instance: ActiveEffectInstance,
  creature: BattleCreatureRef,
  index: number
): BattleEffectSuggestion[] {
  if (source.card.instanceId !== creature.creatureInstanceId) return [];

  const actionType = normalizeText(instance.actionType).trim().toUpperCase();
  const text = [instance.actionType, instance.label, instance.status, instance.durationText, ...(instance.debug ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!isTemporaryHitOverrideAction(actionType, text) && !isForcedFirstAutoHitMultiplierAction(actionType, text)) {
    return [];
  }

  const base = {
    id: `${instance.id}:active:${index}:${creature.creatureInstanceId}`,
    sourceCardInstanceId: instance.sourceCardInstanceId,
    sourceCardId: source.card.cardId,
    sourceCardName: instance.sourceCardName,
    sourcePlayerId: instance.sourcePlayerId,
    sourceZone: source.zone,
    trigger: "CURRENT_BATTLE",
    actionType: instance.actionType,
    effectId: instance.sourceEffectId,
    appliesToPlayerId: creature.playerId,
    appliesToCreatureInstanceId: creature.creatureInstanceId,
    appliesToRole: creature.role,
    label: `${instance.sourceCardName}: ${instance.label}`,
    note: [
      instance.durationText,
      ...(instance.debug ?? [])
    ].filter(Boolean).join(" ")
  } satisfies Omit<BattleEffectSuggestion, "kind">;

  if (isTemporaryHitOverrideAction(actionType, text)) {
    return [{
      ...base,
      id: `${base.id}:strike`,
      kind: "STRIKE",
      strikeModifiers: {
        forceHitResult: "FORCE_HIT"
      }
    }];
  }

  const multiplier = Number.isFinite(instance.amount) && Number(instance.amount) > 0
    ? Number(instance.amount)
    : parseMultiplier({
        id: instance.sourceEffectId,
        trigger: "CURRENT_BATTLE",
        actionType: instance.actionType,
        actionText: instance.label,
        value: instance.label,
        params: { valueText: instance.label }
      }) ?? 3;

  return forcedFirstAutoHitMultiplierSuggestions(base, creature, multiplier);
}

function suggestionFromEffect(
  state: MatchState,
  source: ActiveBattleSource,
  effect: WardEngineEffect,
  creature: BattleCreatureRef,
  index: number
): BattleEffectSuggestion | BattleEffectSuggestion[] | undefined {
  if (!sourceAppliesToCreature(state, source, effect, creature)) return undefined;

  const text = effectSearchText(effect);
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
  const runtimeBattlePlan = getRuntimeBattleBlockPlan(effect);
  const statChanges = getRuntimeBlockStatChanges(effect);

  const statChangeSuggestions = statChanges
    .map((change, statIndex) => suggestionFromStatChange(source, effect, creature, change, statIndex))
    .filter((suggestion): suggestion is BattleEffectSuggestion => Boolean(suggestion));

  if (statChangeSuggestions.length === 1) return statChangeSuggestions[0];
  if (statChangeSuggestions.length > 1) return statChangeSuggestions;

  const base = {
    id: `${source.card.instanceId}:${effect.id}:effect:${index}:${creature.creatureInstanceId}`,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardId: source.card.cardId,
    sourceCardName: source.definition.name,
    sourcePlayerId: source.playerId,
    sourceZone: source.zone,
    trigger: effect.trigger,
    actionType: effect.actionType,
    effectId: effect.id,
    appliesToPlayerId: creature.playerId,
    appliesToCreatureInstanceId: creature.creatureInstanceId,
    appliesToRole: creature.role,
    label: `${source.definition.name}: ${effect.actionText ?? effect.value ?? effect.actionType}`,
    note: effect.notes || effect.value || effect.params?.valueText || effect.actionText
  } satisfies Omit<BattleEffectSuggestion, "kind">;

  // Deferred effect-roll cards such as Blue Dragon should not become
  // immediate strike modifiers. Blue Dragon text includes the words
  // "cannot inflict Atk damage" because that is the Frozen status applied
  // after a successful effect roll. The battle adapter was reading that
  // text as an immediate prevent-attack-damage modifier and defaulting the
  // current strike to 0 damage. Keep these effects as battle triggers only;
  // effectRollActions resolves the roll and applies the status later.
  if (effectHasDeferredEffectRoll(effect)) {
    return {
      ...base,
      kind: "BATTLE_TRIGGER",
      note: [
        base.note,
        "Deferred effect roll: no hit, damage, or prevention modifier is applied until the effect roll succeeds."
      ]
        .filter(Boolean)
        .join(" ")
    };
  }

  const trigger = normalizeText(effect.trigger).trim().toUpperCase();
  if (
    (
      actionType.includes("DAMAGE_MULTIPLIER") ||
      actionType.includes("ATTACK_DAMAGE_MULTIPLIER") ||
      text.includes("x atk damage") ||
      text.includes("Ã— atk damage") ||
      text.includes("double attack damage")
    ) &&
    ["ON_HIT", "ON_HIT_FIRST", "DURING_DAMAGE_CALC", "BEFORE_DAMAGE_ROLL", "AFTER_HIT_ROLL"].includes(trigger)
  ) {
    return { ...base, kind: "BATTLE_TRIGGER" };
  }

  if (runtimeBattlePlan.forceFirstStrike && runtimeBattlePlan.forceHit) {
    const damageMultiplier = runtimeBattlePlan.damageMultiplier ?? parseMultiplier(effect) ?? 3;
    return forcedFirstAutoHitMultiplierSuggestions(
      {
        ...base,
        label: `${base.label} · Block Runtime`,
        note: [base.note, runtimeBattlePlan.visualCue, ...runtimeBattlePlan.runtimeNotes].filter(Boolean).join(" ")
      },
      creature,
      damageMultiplier
    );
  }

  const blockStrikeModifiers = runtimeBattlePlanToStrikeModifiers(runtimeBattlePlan);
  if (Object.keys(blockStrikeModifiers).length > 0) {
    return {
      ...base,
      kind: "STRIKE",
      label: `${base.label} · Block Runtime`,
      note: [base.note, runtimeBattlePlan.visualCue, ...runtimeBattlePlan.runtimeNotes].filter(Boolean).join(" "),
      strikeModifiers: blockStrikeModifiers
    };
  }

  if (runtimeBattlePlan.forceFirstStrike) {
    return {
      ...base,
      kind: "SPEED",
      label: `${base.label} · Block Runtime`,
      note: [base.note, runtimeBattlePlan.visualCue, ...runtimeBattlePlan.runtimeNotes].filter(Boolean).join(" "),
      speedModifiers: creature.role === "DECLARED_ATTACKER"
        ? { override: "ATTACKER_FIRST" }
        : { override: "DEFENDER_FIRST" }
    };
  }

  if (runtimeBattlePlan.speedDelta !== undefined && runtimeBattlePlan.speedDelta !== 0) {
    return {
      ...base,
      kind: "SPEED",
      label: `${base.label} · Block Runtime`,
      note: [base.note, runtimeBattlePlan.visualCue].filter(Boolean).join(" "),
      speedModifiers: creature.role === "DECLARED_ATTACKER"
        ? { attackingSpeedDelta: runtimeBattlePlan.speedDelta }
        : { defendingSpeedDelta: runtimeBattlePlan.speedDelta }
    };
  }

  if (isForcedFirstAutoHitMultiplierAction(actionType, text)) {
    const damageMultiplier = parseMultiplier(effect) ?? 3;
    return forcedFirstAutoHitMultiplierSuggestions(base, creature, damageMultiplier);
  }

  if (
    actionType.includes("DAMAGE_MULTIPLIER") ||
    actionType.includes("ATTACK_DAMAGE_MULTIPLIER") ||
    text.includes("x atk damage") ||
    text.includes("× atk damage") ||
    text.includes("double attack damage")
  ) {
    const damageMultiplier = parseMultiplier(effect) ?? (text.includes("double") ? 2 : undefined);

    // Triggered damage multipliers are now applied by the runtime during the
    // battle damage pipeline. Do not pre-apply them as manual suggestions or
    // they can be counted twice.
    if (["ON_HIT", "ON_HIT_FIRST", "DURING_DAMAGE_CALC", "BEFORE_DAMAGE_ROLL", "AFTER_HIT_ROLL"].includes(trigger)) {
      return { ...base, kind: "BATTLE_TRIGGER" };
    }

    if (damageMultiplier !== undefined) {
      return {
        ...base,
        kind: "STRIKE",
        strikeModifiers: { damageMultiplier }
      };
    }
  }

  if (
    actionType.includes("NEGATE_ATTACK") ||
    actionType.includes("PREVENT_ATTACK_DAMAGE") ||
    actionType.includes("NEGATE_ATTACK_DAMAGE") ||
    actionType.includes("PREVENT_DAMAGE") ||
    actionType.includes("DAMAGE_IMMUNITY") ||
    text.includes("cannot inflict atk damage") ||
    text.includes("cannot inflict attack damage")
  ) {
    return {
      ...base,
      kind: "STRIKE",
      strikeModifiers: { preventAttackDamage: true }
    };
  }

  if (actionType.includes("DICE_LIMIT") || text.includes("only roll 1 hit die") || text.includes("only roll one hit die")) {
    const hitDiceLimit = parseDiceLimit(effect) ?? (text.includes("one hit die") ? 1 : undefined);

    if (hitDiceLimit !== undefined) {
      return {
        ...base,
        kind: "STRIKE",
        strikeModifiers: { hitDiceLimit }
      };
    }
  }

  if (actionType.includes("HIT_OUTCOME_OVERRIDE") || actionType.includes("TEMPORARY_HIT_OVERRIDE")) {
    return {
      ...base,
      kind: "STRIKE",
      strikeModifiers: { forceHitResult: text.includes("miss") ? "FORCE_MISS" : "FORCE_HIT" }
    };
  }

  if (actionType.includes("ATTACK_PRIORITY_OVERRIDE") || actionType.includes("CHANGE_BATTLE_ORDER")) {
    return {
      ...base,
      kind: "SPEED",
      speedModifiers: creature.role === "DECLARED_ATTACKER"
        ? { override: "ATTACKER_FIRST" }
        : { override: "DEFENDER_FIRST" }
    };
  }

  if (actionType.includes("DICE_MODIFIER") || text.includes("dice rolls")) {
    const numberMatch = text.match(/(?:\+|add\s+)(\d+)/i);
    const delta = numberMatch ? Number(numberMatch[1]) : undefined;

    if (delta) {
      let strikeModifiers: Partial<ManualBattleStrikeModifiers>;

      if (text.includes("hit dice") || text.includes("hit_dice") || text.includes("hit dice rolls")) {
        strikeModifiers = { hitDiceDelta: delta };
      } else if (text.includes("atk dice") || text.includes("attack dice") || text.includes("atk_dice") || text.includes("attack_dice")) {
        strikeModifiers = { damageDiceDelta: delta };
      } else if (text.includes("hit")) {
        strikeModifiers = { hitFlatBonus: delta };
      } else if (text.includes("atk damage") || text.includes("attack damage") || text.includes("atk_damage") || text.includes("attack_damage") || text.includes("atk") || text.includes("attack")) {
        strikeModifiers = { damageFlatBonus: delta };
      } else {
        strikeModifiers = { damageDiceDelta: delta };
      }

      return {
        ...base,
        kind: "STRIKE",
        strikeModifiers
      };
    }
  }

  if (actionType.includes("STATUS") && /(frozen|freeze|stun|sleep|cannot attack|cannot inflict)/i.test(text)) {
    return {
      ...base,
      kind: "BATTLE_TRIGGER"
    };
  }

  return {
    ...base,
    kind: "INFO"
  };
}

export function collectBattleEffectSuggestions(
  state: MatchState,
  session: PendingBattleSession
): BattleEffectSuggestion[] {
  const suggestions: BattleEffectSuggestion[] = [];
  const sources = collectActiveBattleSources(state);
  const battleCreatures = getBattleCreatures(session);

  for (const source of sources) {
    if (source.definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, source.card)) {
      continue;
    }

    const effects = getCardEngineEffects(source.definition).filter(isBattleRelevantEffect);

    for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
      const effect = effects[effectIndex];

      for (const creature of battleCreatures) {
        const suggestion = suggestionFromEffect(state, source, effect, creature, effectIndex);
        if (Array.isArray(suggestion)) {
          suggestions.push(...suggestion);
        } else if (suggestion) {
          suggestions.push(suggestion);
        }
      }
    }

    for (let instanceIndex = 0; instanceIndex < (source.card.activeEffectInstances ?? []).length; instanceIndex++) {
      const instance = source.card.activeEffectInstances?.[instanceIndex];
      if (!instance) continue;

      for (const creature of battleCreatures) {
        suggestions.push(...suggestionsFromActiveEffectInstance(source, instance, creature, instanceIndex));
      }
    }

    for (const modifier of source.card.activeStatModifiers ?? []) {
      const creature = battleCreatures.find(candidate => candidate.creatureInstanceId === source.card.instanceId);
      if (!creature) continue;

      const statChange: WardEffectStatChange = {
        stat: modifier.stat,
        operation: modifier.delta >= 0 ? "ADD" : "SUBTRACT",
        value: Math.abs(modifier.delta)
      };

      const suggestion = suggestionFromStatChange(source, {
        id: modifier.sourceEffectId,
        trigger: "ACTIVE_STAT_MODIFIER",
        actionType: "APPLY_STAT_MODIFIER",
        actionText: `${modifier.sourceCardName} active ${modifier.stat} modifier`,
        value: `${modifier.stat} ${modifier.delta > 0 ? "+" : ""}${modifier.delta}`,
        params: { statChanges: [statChange] }
      }, creature, statChange, 0);

      if (suggestion) suggestions.push({
        ...suggestion,
        sourceCardInstanceId: modifier.sourceCardInstanceId,
        sourceCardName: modifier.sourceCardName,
        label: `${modifier.sourceCardName}: ${modifier.stat} ${modifier.delta > 0 ? "+" : ""}${modifier.delta}`
      });
    }
  }

  const unique = new Map<string, BattleEffectSuggestion>();
  for (const suggestion of suggestions) {
    unique.set(suggestion.id, suggestion);
  }

  return [...unique.values()];
}

export function getSuggestedSpeedModifiers(
  suggestions: BattleEffectSuggestion[]
): Partial<ManualBattleSpeedModifiers> {
  const result: Partial<ManualBattleSpeedModifiers> = {
    attackingSpeedDelta: 0,
    defendingSpeedDelta: 0,
    override: "AUTO"
  };
  const notes: string[] = [];

  for (const suggestion of suggestions.filter(item => item.kind === "SPEED")) {
    const modifiers = suggestion.speedModifiers;
    if (!modifiers) continue;

    result.attackingSpeedDelta = Number(result.attackingSpeedDelta ?? 0) + Number(modifiers.attackingSpeedDelta ?? 0);
    result.defendingSpeedDelta = Number(result.defendingSpeedDelta ?? 0) + Number(modifiers.defendingSpeedDelta ?? 0);

    if (modifiers.override && modifiers.override !== "AUTO") {
      result.override = modifiers.override;
    }

    notes.push(suggestion.label);
  }

  if (notes.length > 0) {
    result.note = notes.join("; ").slice(0, 500);
  }

  return result;
}

export function getSuggestedStrikeModifiers(
  suggestions: BattleEffectSuggestion[],
  attackerCreatureInstanceId: string,
  defenderCreatureInstanceId: string
): Partial<ManualBattleStrikeModifiers> {
  const result: Partial<ManualBattleStrikeModifiers> = {
    hitDiceDelta: 0,
    hitDiceLimit: undefined,
    hitFlatBonus: 0,
    forceHitResult: "AUTO",
    damageDiceDelta: 0,
    damageFlatBonus: 0,
    damageMultiplier: 1,
    preventAttackDamage: false
  };
  const notes: string[] = [];

  for (const suggestion of suggestions.filter(item => item.kind === "STRIKE")) {
    const appliesToAttacker = suggestion.appliesToCreatureInstanceId === attackerCreatureInstanceId;
    const appliesToDefender = suggestion.appliesToCreatureInstanceId === defenderCreatureInstanceId;

    if (!appliesToAttacker && !appliesToDefender) continue;

    const patch = suggestion.strikeModifiers ?? {};

    if (appliesToAttacker) {
      mergeStrikeModifier(result, patch);
      notes.push(suggestion.label);
    } else if (appliesToDefender && patch.preventAttackDamage) {
      result.preventAttackDamage = true;
      notes.push(suggestion.label);
    }
  }

  if (notes.length > 0) {
    result.note = notes.join("; ").slice(0, 500);
  }

  return result;
}
