import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import type { CardDefinition, CardInstance, MatchState, PlayerState, WardEngineEffect, WardEffectStatChange } from "@ward/shared";
import { getCardEngineEffects } from "./effectResolver.js";

export type ModifierLayerStat =
  | "armorLevel"
  | "speed"
  | "attackDice"
  | "modifier"
  | "hitFlatBonus"
  | "attackFlatBonus"
  | "hitDiceDelta"
  | "hitRollMultiplier"
  | "attackDamageMultiplier";

export type ModifierLayerOperation = "ADD" | "SUBTRACT" | "SET" | "MULTIPLY" | "LOCK_MAX" | "LOCK_MIN" | "SUPPRESS_POSITIVE";

export type RuntimeModifierLayer = {
  id: string;
  sourceCardInstanceId: string;
  sourceCardName: string;
  sourcePlayerId: string;
  effectId: string;
  actionType: string;
  stat: ModifierLayerStat;
  operation: ModifierLayerOperation;
  value: number;
  order: number;
  note?: string;
};

type FieldSource = {
  player: PlayerState;
  card: CardInstance;
  definition: CardDefinition;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON" | "MAGIC_SLOT";
};

type CreatureLocation = {
  player: PlayerState;
  card: CardInstance;
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
};

export function normalizeModifierStatName(stat: string): ModifierLayerStat | undefined {
  const value = stat.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["AL", "ARMOR", "ARMOR_LEVEL"].includes(value)) return "armorLevel";
  if (["SPD", "SPEED"].includes(value)) return "speed";
  if (["ATK_DICE_ROLLS", "ATTACK_DICE_ROLLS", "ATK_DICE", "ATTACK_DICE"].includes(value)) return "attackDice";
  if (["MOD", "MODIFIER", "BASE_MODIFIER"].includes(value)) return "modifier";
  if (["HIT", "HIT_BONUS", "HIT_ROLL"].includes(value)) return "hitFlatBonus";
  if (["ATK", "ATK_BONUS", "ATTACK", "ATTACK_BONUS", "ATK_DAMAGE", "ATTACK_DAMAGE", "ATK_DAMAGE_BONUS", "ATTACK_DAMAGE_BONUS", "DAMAGE_BONUS"].includes(value)) return "attackFlatBonus";
  if (["HIT_DICE", "HIT_DICE_ROLLS"].includes(value)) return "hitDiceDelta";
  if (["HIT_ROLL_RESULT_MULTIPLIER"].includes(value)) return "hitRollMultiplier";
  if (["ATTACK_DAMAGE_MULTIPLIER", "ATK_DAMAGE_MULTIPLIER"].includes(value)) return "attackDamageMultiplier";
  return undefined;
}

function normalizeOperation(operation: string): ModifierLayerOperation | undefined {
  const value = operation.trim().toUpperCase();
  if (["ADD", "SUBTRACT", "SET", "MULTIPLY", "LOCK_MAX", "LOCK_MIN", "SUPPRESS_POSITIVE"].includes(value)) return value as ModifierLayerOperation;
  return undefined;
}

function effectText(effect: WardEngineEffect): string {
  return [
    effect.trigger,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.notes,
    effect.condition && typeof effect.condition === "object" ? JSON.stringify(effect.condition) : undefined,
    effect.params?.condition && typeof effect.params.condition === "object" ? JSON.stringify(effect.params.condition) : undefined
  ].filter(Boolean).join(" ").toLowerCase();
}

function isStaticEffect(effect: WardEngineEffect): boolean {
  const trigger = (effect.trigger ?? "").trim().toUpperCase();
  const actionType = effect.actionType.trim().toUpperCase();
  const text = effectText(effect);
  if (effect.params?.statChanges?.length) {
    const durationType = (effect.duration?.type ?? effect.params.duration?.type ?? "").trim().toUpperCase();
    return [
      "WHILE_EQUIPPED",
      "STATIC_WHILE_EQUIPPED",
      "WHILE_FIELD_ACTIVE",
      "STATIC_WHILE_ON_FIELD",
      "WHILE_ON_FIELD",
      "ON_SUMMON",
      "ON_EQUIP",
      "ON_EQUIP_OR_PLAY",
      "DURING_BATTLE",
      "DURING_DAMAGE_CALC_OR_STATIC",
      "DURING_DAMAGE_CALC_OR_WHILE_IN_HAND_COUNT"
    ].includes(trigger) || (trigger === "ON_PLAY" && durationType === "WHILE_EQUIPPED");
  }
  if (
    text.includes("reduced to 1") ||
    text.includes("cannot be increased") ||
    text.includes("changed to 0") ||
    text.includes("modifier to 0")
  ) return true;
  return [
    "APPLY_STAT_SET_AURA",
    "APPLY_STAT_MODIFIER",
    "APPLY_DYNAMIC_STAT_MODIFIER",
    "APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT",
    "APPLY_FIELD_AURA_MODIFIERS",
    "APPLY_MULTI_MODIFIER",
    "APPLY_ATTACK_DAMAGE_MULTIPLIER",
    "APPLY_DAMAGE_MULTIPLIER_AURA",
    "SUPPRESS_MODIFIER_LAYER",
    "APPLY_STAT_AND_DICE_MULTIPLIER",
    "UNAFFECTED_BY_MAGIC",
    "APPLY_IMMUNITY",
    "REPLACE_ATTACK_PROFILE",
    "APPLY_TEMPORARY_STAT_SET",
    "APPLY_SOURCE_LINKED_STAT_SET_AURA",
    "APPLY_CEMETERY_SEND_COUNTER_MODIFIER"
  ].includes(actionType);
}

function collectSources(state: MatchState): FieldSource[] {
  const sources: FieldSource[] = [];
  for (const player of state.players) {
    const add = (card: CardInstance | undefined, zone: FieldSource["zone"]) => {
      if (!card) return;
      const definition = state.cardCatalog[card.cardId];
      if (!definition) return;
      if (definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, card)) return;
      sources.push({ player, card, definition, zone });
    };
    add(player.field.primaryCreature, "PRIMARY_CREATURE");
    for (const limited of player.field.limitedSummons) add(limited, "LIMITED_SUMMON");
    for (const magic of player.field.magicSlots) add(magic, "MAGIC_SLOT");
  }
  return sources;
}

function sourceAppliesToCreature(source: FieldSource, effect: WardEngineEffect, target: CreatureLocation): boolean {
  const text = effectText(effect);
  const actionType = effect.actionType.trim().toUpperCase();
  if (source.card.attachedToInstanceId) return source.card.attachedToInstanceId === target.card.instanceId;
  if (text.includes("equipped creature")) return source.card.attachedToInstanceId === target.card.instanceId;
  if (text.includes("your primary creature") || text.includes("controller's primary creature")) return source.player.id === target.player.id && target.zone === "PRIMARY_CREATURE";
  if (text.includes("your creature") || text.includes("you control") || text.includes("your side")) return source.player.id === target.player.id;
  if (text.includes("this card's modifier") && text.includes("opponent") && text.includes("base spd")) return source.card.instanceId === target.card.instanceId;
  if (
    actionType === "APPLY_SOURCE_LINKED_STAT_SET_AURA" &&
    (text.includes("opponent") || text.includes("opposing"))
  ) return source.player.id !== target.player.id;
  if (text.includes("opponents' creatures") || text.includes("opponent's creatures")) return source.player.id !== target.player.id;
  if (text.includes("this creature") || (text.includes("this card") && !text.includes("this card only affects"))) return source.card.instanceId === target.card.instanceId;
  if (text.includes("opponent") || text.includes("opposing")) return source.player.id !== target.player.id;
  if (text.includes("non-effect creature") || text.includes("non effect creature")) return !target.definition.effects?.length;
  if (text.includes("\"were\"") || text.includes("with were in") || text.includes("name contains \"were\"")) return target.definition.name.toLowerCase().includes("were");
  if (text.includes("\"orc\"") || text.includes("with orc in") || text.includes("name contains \"orc\"")) return target.definition.name.toLowerCase().includes("orc");
  if (text.includes("bug-type") || text.includes("bug type")) return target.definition.creatureType.toLowerCase().includes("bug");
  if (text.includes("dragon-type") || text.includes("dragon type")) return target.definition.creatureType.toLowerCase().includes("dragon") || target.definition.name.toLowerCase().includes("dragon");
  if (text.includes("demon-type") || text.includes("demon type")) return target.definition.creatureType.toLowerCase().includes("demon") || target.definition.name.toLowerCase().includes("demon");
  if (text.includes("undead-type") || text.includes("undead type")) return target.definition.creatureType.toLowerCase().includes("undead");
  if (text.includes("humanoid-type") || text.includes("humanoid type")) return target.definition.creatureType.toLowerCase().includes("humanoid");
  if (text.includes("mechanical-type") || text.includes("mechanical type")) return target.definition.creatureType.toLowerCase().includes("mechanical");
  if (text.includes("all creatures") || text.includes("each creature") || text.includes("both creatures")) return true;
  return source.card.instanceId === target.card.instanceId;
}

function layerOrder(operation: ModifierLayerOperation, stat: ModifierLayerStat): number {
  if (operation === "SET") return 20;
  if (operation === "SUPPRESS_POSITIVE") return 30;
  if (stat === "armorLevel" || stat === "speed" || stat === "attackDice" || stat === "modifier") return 50;
  if (operation === "MULTIPLY") return 80;
  return 60;
}

function makeLayer(source: FieldSource, effect: WardEngineEffect, suffix: string, stat: ModifierLayerStat, operation: ModifierLayerOperation, value: number, note?: string): RuntimeModifierLayer {
  return {
    id: `${source.card.instanceId}:${effect.id}:${suffix}`,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourcePlayerId: source.player.id,
    effectId: effect.id,
    actionType: effect.actionType,
    stat,
    operation,
    value,
    order: layerOrder(operation, stat),
    note: note ?? effect.actionText ?? effect.value ?? effect.notes
  };
}

function layerFromStatChange(
  source: FieldSource,
  effect: WardEngineEffect,
  change: WardEffectStatChange,
  index: number
): RuntimeModifierLayer | undefined {
  const stat = normalizeModifierStatName(change.stat);
  const operation = normalizeOperation(change.operation);
  const value = Number(change.value);
  if (!stat || !operation || !Number.isFinite(value)) return undefined;
  return makeLayer(source, effect, `${index}`, stat, operation, value);
}

function getOpponent(state: MatchState, playerId: string): PlayerState | undefined {
  return state.players.find(player => player.id !== playerId);
}

function cardNameIncludes(card: CardInstance, state: MatchState, text: string): boolean {
  const definition = state.cardCatalog[card.cardId];
  return Boolean(definition?.name.toLowerCase().includes(text.toLowerCase()));
}

function activeLinkedLimitedSummonCount(state: MatchState, sourceCardInstanceId: string): number {
  return state.players.reduce((count, player) => {
    return count + player.field.limitedSummons.filter(card => card.anchorSourceInstanceId === sourceCardInstanceId).length;
  }, 0);
}

function parseReplacementAttackProfile(text: string): { dice?: number; modifier?: number } {
  const dice = Number(text.match(/(\d+)\s*(?:atk\s*)?(?:dice|die)/i)?.[1]);
  const modifier = Number(text.match(/(?:modifier|mod|,|\s)\s*\+\s*(\d+)/i)?.[1]);
  return {
    dice: Number.isFinite(dice) && dice > 0 ? Math.trunc(dice) : undefined,
    modifier: Number.isFinite(modifier) ? Math.trunc(modifier) : undefined
  };
}

function opponentPrimaryBaseStatValue(
  opponentDefinition: Extract<CardDefinition, { cardType: "CREATURE" }>,
  source: unknown
): number | undefined {
  const value = String(source ?? "").trim().toUpperCase();
  if (!value.startsWith("OPPONENT_PRIMARY_CREATURE.BASE_")) return undefined;
  if (value.endsWith("BASE_AL") || value.endsWith("BASE_ARMOR_LEVEL")) return opponentDefinition.armorLevel;
  if (value.endsWith("BASE_SPD") || value.endsWith("BASE_SPEED")) return opponentDefinition.speed;
  if (value.endsWith("BASE_ATK_DICE_ROLLS") || value.endsWith("BASE_ATTACK_DICE_ROLLS")) return opponentDefinition.attackDice;
  if (value.endsWith("BASE_MODIFIER")) return opponentDefinition.modifier;
  return undefined;
}

function currentSpeedForDynamicFormula(
  state: MatchState,
  target: CreatureLocation,
  skippedSource: FieldSource,
  skippedEffect: WardEngineEffect
): number {
  const speedLayers: RuntimeModifierLayer[] = [];

  for (const source of collectSources(state)) {
    for (const effect of getCardEngineEffects(source.definition).filter(isStaticEffect)) {
      if (source.card.instanceId === skippedSource.card.instanceId && effect.id === skippedEffect.id) continue;
      if (!sourceAppliesToCreature(source, effect, target)) continue;

      for (let index = 0; index < (effect.params?.statChanges ?? []).length; index++) {
        const layer = layerFromStatChange(source, effect, effect.params!.statChanges![index], index);
        if (layer?.stat === "speed") speedLayers.push(layer);
      }
    }
  }

  return applyBaseStatModifierLayers(target.definition.speed, "speed", speedLayers);
}

function dynamicLayersForEffect(state: MatchState, source: FieldSource, effect: WardEngineEffect, target: CreatureLocation): RuntimeModifierLayer[] {
  const actionType = effect.actionType.trim().toUpperCase();
  const text = effectText(effect);
  const layers: RuntimeModifierLayer[] = [];
  const opponentPrimary = getOpponent(state, source.player.id)?.field.primaryCreature;
  const opponentDefinition = opponentPrimary ? state.cardCatalog[opponentPrimary.cardId] : undefined;
  let usedStructuredOpponentPrimaryBaseStats = false;

  if (actionType === "APPLY_DYNAMIC_STAT_MODIFIER" && opponentDefinition?.cardType === "CREATURE") {
    for (const [index, change] of (effect.params?.statChanges ?? []).entries()) {
      const stat = normalizeModifierStatName(change.stat);
      const operation = String(change.operation ?? "").trim().toUpperCase();
      const copiedValue = opponentPrimaryBaseStatValue(opponentDefinition, (change as { source?: unknown }).source);
      if (!stat || copiedValue === undefined) continue;
      if (operation === "COPY") {
        layers.push(makeLayer(source, effect, `structured-copy-${index}`, stat, "SET", copiedValue));
        usedStructuredOpponentPrimaryBaseStats = true;
      } else if (operation === "ADD_DYNAMIC") {
        layers.push(makeLayer(source, effect, `structured-add-${index}`, stat, "ADD", copiedValue));
        usedStructuredOpponentPrimaryBaseStats = true;
      }
    }
  }

  if (actionType === "APPLY_DYNAMIC_STAT_MODIFIER" || actionType === "APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT" || text.includes("for every card") || text.includes("for each card")) {
    let count = 0;
    const opponent = getOpponent(state, source.player.id);

    if (text.includes("opponent") && text.includes("hand")) {
      count = opponent?.hand.length ?? 0;
    } else if (text.includes("gnome") && text.includes("hand")) {
      count = source.player.hand.filter(card => cardNameIncludes(card, state, "Gnome")).length;
    } else if (text.includes("creatures in opponents cemetery") || text.includes("opponents cemetery")) {
      count = opponent?.cemetery.filter(card => state.cardCatalog[card.cardId]?.cardType === "CREATURE").length ?? 0;
    } else if (text.includes("linked limited summon")) {
      count = activeLinkedLimitedSummonCount(state, source.card.instanceId);
    }

    if (count > 0 && (text.includes("atk dice") || text.includes("attack dice"))) {
      layers.push(makeLayer(source, effect, "dynamic-attack-dice", "attackDice", "ADD", count, `Dynamic count ${count}`));
    }
    if (count > 0 && text.includes("modifier")) {
      layers.push(makeLayer(source, effect, "dynamic-modifier", "modifier", "ADD", count, `Dynamic count ${count}`));
    }
  }

  if ((actionType === "APPLY_DYNAMIC_STAT_MODIFIER" || actionType === "APPLY_STAT_MODIFIER") && text.includes("spd") && text.includes("over 12") && text.includes("modifier")) {
    const currentSpeed = currentSpeedForDynamicFormula(state, target, source, effect);
    const over = Math.max(0, currentSpeed - 12);
    if (over > 0) layers.push(makeLayer(source, effect, "spd-over-12-modifier", "modifier", "ADD", over, `Current SPD over 12: ${over}`));
  }

  if (!usedStructuredOpponentPrimaryBaseStats && (actionType === "APPLY_DYNAMIC_STAT_MODIFIER" || actionType === "APPLY_STAT_MODIFIER") && text.includes("opponent") && text.includes("primary") && text.includes("base")) {
    if (opponentDefinition?.cardType === "CREATURE") {
      if (text.includes("copy") && text.includes("base al")) layers.push(makeLayer(source, effect, "copy-base-al", "armorLevel", "SET", opponentDefinition.armorLevel));
      if (text.includes("copy") && text.includes("base spd")) layers.push(makeLayer(source, effect, "copy-base-spd", "speed", "SET", opponentDefinition.speed));
      if (text.includes("modifier") && text.includes("equal") && text.includes("base spd")) layers.push(makeLayer(source, effect, "modifier-equals-base-spd", "modifier", "SET", opponentDefinition.speed));
      if ((text.includes("copy") || text.includes("add")) && text.includes("base atk dice")) layers.push(makeLayer(source, effect, "copy-base-attack-dice", text.includes("add") ? "attackDice" : "attackDice", text.includes("add") ? "ADD" : "SET", opponentDefinition.attackDice));
      if ((text.includes("copy") || text.includes("add")) && text.includes("base modifier")) layers.push(makeLayer(source, effect, "copy-base-modifier", "modifier", text.includes("add") ? "ADD" : "SET", opponentDefinition.modifier));
    }
  }

  if (
    actionType === "SUPPRESS_MODIFIER_LAYER" ||
    actionType === "UNAFFECTED_BY_MAGIC" ||
    actionType === "APPLY_IMMUNITY" ||
    text.includes("ignore positive") ||
    text.includes("negate other") ||
    text.includes("unaffected by other") ||
    text.includes("modifier increases") ||
    text.includes("cannot be increased")
  ) {
    if (text.includes("spd") || text.includes("speed")) layers.push(makeLayer(source, effect, "suppress-positive-speed", "speed", "SUPPRESS_POSITIVE", 0));
    if (text.includes("al") || text.includes("armor")) layers.push(makeLayer(source, effect, "suppress-positive-al", "armorLevel", "SUPPRESS_POSITIVE", 0));
    if (text.includes("modifier")) layers.push(makeLayer(source, effect, "suppress-positive-modifier", "modifier", "SUPPRESS_POSITIVE", 0));
    if (text.includes("hit")) layers.push(makeLayer(source, effect, "suppress-positive-hit", "hitFlatBonus", "SUPPRESS_POSITIVE", 0));
    if (text.includes("hit dice") || text.includes("hit dice roll")) layers.push(makeLayer(source, effect, "suppress-positive-hit-dice", "hitDiceDelta", "SUPPRESS_POSITIVE", 0));
  }

  if (actionType === "APPLY_STAT_AND_DICE_MULTIPLIER" || text.includes("x 1/2") || text.includes("× 1/2")) {
    const multiplier = text.includes("1/2") ? 0.5 : 1;
    if (multiplier !== 1) {
      for (const stat of ["armorLevel", "speed", "attackDice", "modifier"] as const) {
        if (text.includes("al") && stat !== "armorLevel") continue;
        layers.push(makeLayer(source, effect, `multiply-${stat}`, stat, "MULTIPLY", multiplier));
      }
    }
  }

  if (actionType === "REPLACE_ATTACK_PROFILE") {
    const replacement = parseReplacementAttackProfile(text);
    if (replacement.dice !== undefined) layers.push(makeLayer(source, effect, "replace-attack-dice", "attackDice", "SET", replacement.dice));
    if (replacement.modifier !== undefined) layers.push(makeLayer(source, effect, "replace-modifier", "modifier", "SET", replacement.modifier));
  }

  if (text.includes("changed to 0") || text.includes("modifier to 0")) {
    if (text.includes("spd") || text.includes("speed")) layers.push(makeLayer(source, effect, "set-spd-0", "speed", "SET", 0));
    if (text.includes("modifier")) layers.push(makeLayer(source, effect, "set-modifier-0", "modifier", "SET", 0));
  }

  if (actionType === "APPLY_TEMPORARY_STAT_SET" || actionType === "APPLY_SOURCE_LINKED_STAT_SET_AURA" || actionType === "APPLY_STAT_SET_AURA" || text.includes("al = 1") || text.includes("al to 1") || text.includes("al reduced to 1")) {
    if (text.includes("al") || text.includes("armor")) layers.push(makeLayer(source, effect, "set-al-1", "armorLevel", "SET", 1));
  }

  if (actionType === "APPLY_STAT_MODIFIER" && (text.includes("al to 12") || text.includes("al set to 12") || text.includes("increase al to 12"))) {
    layers.push(makeLayer(source, effect, "set-al-12", "armorLevel", "SET", 12));
  }

  return layers;
}

export function collectRuntimeModifierLayers(state: MatchState, target: CreatureLocation): RuntimeModifierLayer[] {
  const layers: RuntimeModifierLayer[] = [];

  for (const source of collectSources(state)) {
    for (const effect of getCardEngineEffects(source.definition).filter(isStaticEffect)) {
      if (!sourceAppliesToCreature(source, effect, target)) continue;
      const text = effectText(effect);

      const alreadyMaterializedOnTarget = (target.card.activeStatModifiers ?? []).some(
        modifier => modifier.sourceCardInstanceId === source.card.instanceId && modifier.sourceEffectId === effect.id
      );
      const usesCurrentSpeedOverTwelveFormula =
        (effect.actionType === "APPLY_DYNAMIC_STAT_MODIFIER" || effect.actionType === "APPLY_STAT_MODIFIER") &&
        text.includes("spd") &&
        text.includes("over 12") &&
        text.includes("modifier");

      if (
        !alreadyMaterializedOnTarget &&
        effect.actionType !== "APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT" &&
        !usesCurrentSpeedOverTwelveFormula
      ) {
        for (let index = 0; index < (effect.params?.statChanges ?? []).length; index++) {
          const layer = layerFromStatChange(source, effect, effect.params!.statChanges![index], index);
          if (layer) layers.push(layer);
        }
      }

      layers.push(...dynamicLayersForEffect(state, source, effect, target));

      if ((effect.actionType === "APPLY_STAT_SET_AURA" || text.includes("reduced to 1")) && (text.includes("al") || text.includes("armor"))) {
        layers.push(makeLayer(source, effect, "set-al-1-legacy", "armorLevel", "SET", 1, effect.actionText ?? effect.value));
      }
      if ((effect.actionType === "APPLY_STAT_SET_AURA" || text.includes("reduced to 1")) && (text.includes("spd") || text.includes("speed"))) {
        layers.push(makeLayer(source, effect, "set-spd-1-legacy", "speed", "SET", 1, effect.actionText ?? effect.value));
      }
    }
  }

  layers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return layers;
}

export function applyBaseStatModifierLayers(baseValue: number, stat: ModifierLayerStat, layers: RuntimeModifierLayer[]): number {
  let value = baseValue;
  const relevant = layers.filter(layer => layer.stat === stat).sort((a, b) => a.order - b.order);
  const suppressPositive = relevant.some(layer => layer.operation === "SUPPRESS_POSITIVE");

  for (const layer of relevant) {
    if (layer.operation === "SET") value = layer.value;
    if (layer.operation === "ADD" && !(suppressPositive && layer.value > 0)) value += layer.value;
    if (layer.operation === "SUBTRACT") value -= layer.value;
    if (layer.operation === "MULTIPLY") value = Math.ceil(value * layer.value);
    if (layer.operation === "LOCK_MAX") value = Math.min(value, layer.value);
    if (layer.operation === "LOCK_MIN") value = Math.max(value, layer.value);
  }

  return value;
}
