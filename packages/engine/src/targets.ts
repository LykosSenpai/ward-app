import type {
  CardDefinition,
  CardInstance,
  EffectTargetKind,
  EffectTargetOption,
  MatchState,
  PlayerState,
  WardEngineEffect,
  ZoneType
} from "@ward/shared";
import { getCardDefinition } from "./engineRuntime.js";
import { getProgramTargetQuery } from "./effectProgramRunner.js";

export type TargetControllerScope =
  | "ANY_PLAYER"
  | "CONTROLLER"
  | "OPPONENT";

export type TargetQuery = {
  kind: EffectTargetKind;
  controllerScope?: TargetControllerScope;
  requireCreature?: boolean;
  requireMagic?: boolean;

  cardNameIncludes?: string[];
  creatureTypeIncludes?: string[];
  magicTypeIncludes?: string[];
  magicSubTypeIncludes?: string[];
  rarityIncludes?: string[];

  armorLevelMin?: number;
  armorLevelMax?: number;
};

function isAllowedByControllerScope(
  player: PlayerState,
  controllerPlayerId: string,
  scope: TargetControllerScope = "ANY_PLAYER"
): boolean {
  if (scope === "ANY_PLAYER") return true;
  if (scope === "CONTROLLER") return player.id === controllerPlayerId;
  if (scope === "OPPONENT") return player.id !== controllerPlayerId;

  return false;
}

function inferControllerScope(text: string): TargetControllerScope {
  if (
    text.includes("opponent") ||
    text.includes("enemy") ||
    text.includes("their ")
  ) {
    return "OPPONENT";
  }

  if (
    text.includes("your ") ||
    text.includes("own ") ||
    text.includes("controller") ||
    text.includes("you control")
  ) {
    return "CONTROLLER";
  }

  return "ANY_PLAYER";
}

function normalizeFilterValue(value: string): string {
  return value.trim().toLowerCase();
}

function includesAnyFilter(value: string | undefined, filters?: string[]): boolean {
  if (!value || !filters || filters.length === 0) {
    return false;
  }

  const normalizedValue = value.toLowerCase();

  return filters.some(filter =>
    normalizedValue.includes(normalizeFilterValue(filter))
  );
}

function getDefinitionRarity(definition: CardDefinition): string | undefined {
  const withRarity = definition as CardDefinition & { rarity?: string };
  return withRarity.rarity;
}

function cardMatchesQuery(
  definition: CardDefinition,
  query: TargetQuery
): boolean {
  if (query.requireCreature && definition.cardType !== "CREATURE") {
    return false;
  }

  if (query.requireMagic && definition.cardType !== "MAGIC") {
    return false;
  }

  if (query.magicTypeIncludes?.length) {
    if (definition.cardType !== "MAGIC") {
      return false;
    }

    if (!includesAnyFilter(definition.magicType, query.magicTypeIncludes)) {
      return false;
    }
  }

  if (query.magicSubTypeIncludes?.length) {
    if (definition.cardType !== "MAGIC") {
      return false;
    }

    if (!includesAnyFilter(definition.magicSubType, query.magicSubTypeIncludes)) {
      return false;
    }
  }

  if (query.armorLevelMin !== undefined || query.armorLevelMax !== undefined) {
    if (definition.cardType !== "CREATURE") {
      return false;
    }

    if (
      query.armorLevelMin !== undefined &&
      definition.armorLevel < query.armorLevelMin
    ) {
      return false;
    }

    if (
      query.armorLevelMax !== undefined &&
      definition.armorLevel > query.armorLevelMax
    ) {
      return false;
    }
  }

  if (query.rarityIncludes?.length) {
    if (!includesAnyFilter(getDefinitionRarity(definition), query.rarityIncludes)) {
      return false;
    }
  }

  const hasDefinitionFilters =
    !!query.cardNameIncludes?.length || !!query.creatureTypeIncludes?.length;

  if (!hasDefinitionFilters) {
    return true;
  }

  if (includesAnyFilter(definition.name, query.cardNameIncludes)) {
    return true;
  }

  if (
    definition.cardType === "CREATURE" &&
    includesAnyFilter(definition.creatureType, query.creatureTypeIncludes)
  ) {
    return true;
  }

  return false;
}

function cardZoneLabel(zone: ZoneType): string {
  if (zone === "REMOVED_FROM_GAME") return "Removed";
  return zone.charAt(0) + zone.slice(1).toLowerCase().split("_").join(" ");
}

function createCardZoneOption(
  player: PlayerState,
  card: CardInstance,
  definition: CardDefinition,
  targetKind: EffectTargetKind,
  zone: EffectTargetOption["zone"]
): EffectTargetOption {
  return {
    id: `${player.id}:${zone}:${card.instanceId}`,
    label: `${player.displayName} ${cardZoneLabel(card.zone)}: ${definition.name}`,
    targetKind,
    playerId: player.id,
    cardInstanceId: card.instanceId,
    cardId: card.cardId,
    cardName: definition.name,
    zone
  };
}

export function getMagicSlotTargetOptions(
  state: MatchState,
  controllerPlayerId: string,
  scope: TargetControllerScope = "ANY_PLAYER"
): EffectTargetOption[] {
  return state.players
    .filter(player => isAllowedByControllerScope(player, controllerPlayerId, scope))
    .flatMap(player =>
      player.field.magicSlots.map(card => {
        const definition = getCardDefinition(state, card);

        return {
          id: `${player.id}:${card.instanceId}`,
          label: `${player.displayName}: ${definition.name}`,
          targetKind: "MAGIC_SLOT_CARD",
          playerId: player.id,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          cardName: definition.name,
          zone: "MAGIC_SLOT"
        } satisfies EffectTargetOption;
      })
    );
}

export function getPrimaryCreatureTargetOptions(
  state: MatchState,
  controllerPlayerId: string,
  scope: TargetControllerScope = "ANY_PLAYER"
): EffectTargetOption[] {
  return state.players
    .filter(player => isAllowedByControllerScope(player, controllerPlayerId, scope))
    .flatMap(player => {
      const card = player.field.primaryCreature;

      if (!card) {
        return [];
      }

      const definition = getCardDefinition(state, card);

      return [
        {
          id: `${player.id}:${card.instanceId}`,
          label: `${player.displayName}: ${definition.name}`,
          targetKind: "PRIMARY_CREATURE",
          playerId: player.id,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          cardName: definition.name,
          zone: "PRIMARY_CREATURE"
        } satisfies EffectTargetOption
      ];
    });
}

export function getLimitedSummonTargetOptions(
  state: MatchState,
  controllerPlayerId: string,
  scope: TargetControllerScope = "ANY_PLAYER"
): EffectTargetOption[] {
  return state.players
    .filter(player => isAllowedByControllerScope(player, controllerPlayerId, scope))
    .flatMap(player =>
      player.field.limitedSummons.map(card => {
        const definition = getCardDefinition(state, card);

        return {
          id: `${player.id}:${card.instanceId}`,
          label: `${player.displayName}: ${definition.name}`,
          targetKind: "LIMITED_SUMMON",
          playerId: player.id,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          cardName: definition.name,
          zone: "LIMITED_SUMMON"
        } satisfies EffectTargetOption;
      })
    );
}

export function getAnyCreatureTargetOptions(
  state: MatchState,
  controllerPlayerId: string,
  scope: TargetControllerScope = "ANY_PLAYER"
): EffectTargetOption[] {
  return [
    ...getPrimaryCreatureTargetOptions(state, controllerPlayerId, scope),
    ...getLimitedSummonTargetOptions(state, controllerPlayerId, scope)
  ];
}

export function getPlayerTargetOptions(
  state: MatchState,
  controllerPlayerId: string,
  scope: TargetControllerScope = "ANY_PLAYER"
): EffectTargetOption[] {
  return state.players
    .filter(player => isAllowedByControllerScope(player, controllerPlayerId, scope))
    .map(player => ({
      id: player.id,
      label: player.displayName,
      targetKind: "PLAYER",
      playerId: player.id,
      zone: "PLAYER"
    }));
}

export function getCardOptionsFromPlayerZone(
  state: MatchState,
  controllerPlayerId: string,
  query: TargetQuery,
  targetKind: EffectTargetKind,
  zone: "HAND" | "DECK" | "CEMETERY" | "REMOVED_FROM_GAME"
): EffectTargetOption[] {
  return state.players
    .filter(player =>
      isAllowedByControllerScope(
        player,
        controllerPlayerId,
        query.controllerScope ?? "CONTROLLER"
      )
    )
    .flatMap(player => {
      const cards =
        zone === "HAND"
          ? player.hand
          : zone === "DECK"
            ? player.deck
            : zone === "CEMETERY"
              ? player.cemetery
              : player.removedFromGame;

      return cards.flatMap(card => {
        const definition = getCardDefinition(state, card);

        if (!cardMatchesQuery(definition, query)) {
          return [];
        }

        return [createCardZoneOption(player, card, definition, targetKind, zone)];
      });
    });
}

export function getTargetOptionsForQuery(
  state: MatchState,
  controllerPlayerId: string,
  query: TargetQuery
): EffectTargetOption[] {
  switch (query.kind) {
    case "MAGIC_SLOT_CARD":
      return getMagicSlotTargetOptions(state, controllerPlayerId, query.controllerScope);

    case "PRIMARY_CREATURE":
      return getPrimaryCreatureTargetOptions(state, controllerPlayerId, query.controllerScope);

    case "LIMITED_SUMMON":
      return getLimitedSummonTargetOptions(state, controllerPlayerId, query.controllerScope);

    case "ANY_CREATURE":
      return getAnyCreatureTargetOptions(state, controllerPlayerId, query.controllerScope);

    case "PLAYER":
      return getPlayerTargetOptions(state, controllerPlayerId, query.controllerScope);

    case "CARD_IN_HAND":
      return getCardOptionsFromPlayerZone(state, controllerPlayerId, query, query.kind, "HAND");

    case "CARD_IN_DECK":
      return getCardOptionsFromPlayerZone(state, controllerPlayerId, query, query.kind, "DECK");

    case "CARD_IN_CEMETERY":
      return getCardOptionsFromPlayerZone(state, controllerPlayerId, query, query.kind, "CEMETERY");

    case "CARD_IN_REMOVED_FROM_GAME":
      return getCardOptionsFromPlayerZone(state, controllerPlayerId, query, query.kind, "REMOVED_FROM_GAME");

    default:
      return [];
  }
}

function effectText(effect: WardEngineEffect): string {
  return [
    effect.target,
    effect.params?.target,
    effect.value,
    effect.params?.valueText,
    effect.actionText,
    effect.params?.condition && typeof effect.params.condition === "object"
      ? JSON.stringify(effect.params.condition)
      : undefined
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferCardZoneTargetKind(text: string):
  | "CARD_IN_HAND"
  | "CARD_IN_DECK"
  | "CARD_IN_CEMETERY"
  | "CARD_IN_REMOVED_FROM_GAME" {
  if (text.includes("cemetery") || text.includes("graveyard")) {
    return "CARD_IN_CEMETERY";
  }

  if (text.includes("deck")) {
    return "CARD_IN_DECK";
  }

  if (text.includes("removed")) {
    return "CARD_IN_REMOVED_FROM_GAME";
  }

  return "CARD_IN_HAND";
}

function inferLimitedSummonSourceKind(
  effect: WardEngineEffect,
  text: string
): "CARD_IN_HAND" | "CARD_IN_DECK" | "CARD_IN_CEMETERY" | "CARD_IN_REMOVED_FROM_GAME" {
  const fromZone = String(effect.params?.fromZone ?? "").toUpperCase();

  if (fromZone.includes("CEMETERY") || fromZone.includes("GRAVEYARD")) {
    return "CARD_IN_CEMETERY";
  }

  if (fromZone.includes("DECK")) {
    return "CARD_IN_DECK";
  }

  if (fromZone.includes("REMOVED")) {
    return "CARD_IN_REMOVED_FROM_GAME";
  }

  if (fromZone.includes("HAND")) {
    return "CARD_IN_HAND";
  }

  if (
    effect.actionType === "SUMMON_LIMITED_CREATURE_FROM_HAND" ||
    effect.actionType === "FORCE_SUMMON_FROM_HAND"
  ) {
    return "CARD_IN_HAND";
  }

  if (effect.actionType === "SUMMON_FROM_CEMETERY_AND_EQUIP" || effect.actionType === "SUMMON_FROM_CEMETERY" || effect.actionType === "SUMMON_LIMITED_CREATURE_FROM_CEMETERY") {
    return "CARD_IN_CEMETERY";
  }

  if (effect.actionType === "SUMMON_FROM_DECK" || effect.actionType === "SUMMON_LIMITED_CREATURE_FROM_DECK") {
    return "CARD_IN_DECK";
  }

  if (effect.actionType === "SUMMON_FROM_HAND") {
    return "CARD_IN_HAND";
  }

  return inferCardZoneTargetKind(text);
}

function isLimitedSummonCardSelectionEffect(
  effect: WardEngineEffect,
  text: string
): boolean {
  if (
    [
      "SUMMON_LIMITED_CREATURE",
      "SUMMON_LIMITED_CREATURE_FROM_HAND",
      "SUMMON_LIMITED_CREATURE_AND_EQUIP",
      "SUMMON_FROM_CEMETERY_AND_EQUIP",
      "FORCE_SUMMON_FROM_HAND",
      "LIMITED_SUMMON",
      "SUMMON_FROM_HAND",
      "SUMMON_FROM_DECK",
      "SUMMON_FROM_CEMETERY",
      "SUMMON_LIMITED_CREATURE_FROM_DECK",
      "SUMMON_LIMITED_CREATURE_FROM_CEMETERY"
    ].includes(effect.actionType)
  ) {
    return true;
  }

  if (effect.actionType !== "LIMITED_SUMMON") {
    return false;
  }

  if (!/\bsummon(?:s|ed|ing)?\b/i.test(text)) {
    return false;
  }

  return (
    text.includes("from your hand") ||
    text.includes("from hand") ||
    text.includes("from your deck") ||
    text.includes("from deck") ||
    text.includes("from your cemetery") ||
    text.includes("from cemetery") ||
    text.includes("from your graveyard") ||
    text.includes("from graveyard")
  );
}

function getCreatureSearchFilters(text: string): Pick<
  TargetQuery,
  "cardNameIncludes" | "creatureTypeIncludes"
> {
  if (text.includes("dragon")) {
    return {
      cardNameIncludes: ["dragon"],
      creatureTypeIncludes: ["dragon"]
    };
  }

  if (text.includes("undead")) {
    return {
      cardNameIncludes: ["undead"],
      creatureTypeIncludes: ["undead"]
    };
  }

  return {};
}

function getMagicSearchFilters(text: string): Pick<
  TargetQuery,
  "magicTypeIncludes" | "magicSubTypeIncludes"
> {
  const filters: Pick<TargetQuery, "magicTypeIncludes" | "magicSubTypeIncludes"> = {};

  if (text.includes("infinite magic") || text.includes("infinite card")) {
    filters.magicTypeIncludes = ["INFINITE"];
  }

  if (text.includes("standard magic") || text.includes("standard card")) {
    filters.magicTypeIncludes = ["STANDARD"];
  }

  if (text.includes("lightning magic") || text.includes("lightning card")) {
    filters.magicTypeIncludes = ["LIGHTNING"];
  }

  if (text.includes("equip")) {
    filters.magicSubTypeIncludes = ["EQUIP"];
  }

  if (text.includes("field")) {
    filters.magicSubTypeIncludes = ["FIELD"];
  }

  return filters;
}

function getArmorLevelFilters(text: string): Pick<
  TargetQuery,
  "armorLevelMin" | "armorLevelMax"
> {
  const maxMatch =
    text.match(/(?:al|armor level)\s*(?:<=|â‰¤|under|below|less than or equal to|or lower|or less)?\s*(\d+)/i) ??
    text.match(/(\d+)\s*(?:or lower|or less)\s*(?:al|armor level)?/i);

  if (
    maxMatch &&
    /<=|â‰¤|under|below|less than|or lower|or less/.test(maxMatch[0].toLowerCase())
  ) {
    return { armorLevelMax: Number(maxMatch[1]) };
  }

  const exactMatch = text.match(/(?:al|armor level)\s*(\d+)/i);

  if (exactMatch) {
    const value = Number(exactMatch[1]);
    return {
      armorLevelMin: value,
      armorLevelMax: value
    };
  }

  return {};
}

function getRarityFilters(text: string): Pick<TargetQuery, "rarityIncludes"> {
  const rarityIncludes: string[] = [];

  if (/\bcommon\b/.test(text)) {
    rarityIncludes.push("Common");
  }

  if (/\buncommon\b|\bun-common\b/.test(text)) {
    rarityIncludes.push("Uncommon");
  }

  if (/\brare\b/.test(text)) {
    rarityIncludes.push("Rare");
  }

  if (/\bepic\b/.test(text)) {
    rarityIncludes.push("Epic");
  }

  if (/\blegendary\b/.test(text)) {
    rarityIncludes.push("Legendary");
  }

  return rarityIncludes.length > 0 ? { rarityIncludes } : {};
}

function getCommonCardFilters(text: string): Pick<
  TargetQuery,
  | "cardNameIncludes"
  | "creatureTypeIncludes"
  | "magicTypeIncludes"
  | "magicSubTypeIncludes"
  | "rarityIncludes"
  | "armorLevelMin"
  | "armorLevelMax"
> {
  return {
    ...getCreatureSearchFilters(text),
    ...getMagicSearchFilters(text),
    ...getRarityFilters(text),
    ...getArmorLevelFilters(text)
  };
}

function getLimitedSummonCardFilters(text: string): Pick<
  TargetQuery,
  | "cardNameIncludes"
  | "creatureTypeIncludes"
  | "rarityIncludes"
  | "armorLevelMin"
  | "armorLevelMax"
> {
  return {
    ...getCreatureSearchFilters(text),
    ...getRarityFilters(text),
    ...getArmorLevelFilters(text)
  };
}

export function inferTargetQueryForEffect(
  effect: WardEngineEffect
): TargetQuery | undefined {
  const programTargetQuery = getProgramTargetQuery(effect);

  if (programTargetQuery) {
    return programTargetQuery;
  }

  const text = effectText(effect);
  const controllerScope = inferControllerScope(text);

  if (effect.actionType === "APPLY_CREATURE_EFFECT_NEGATION") {
    return {
      kind: text.includes("undead king") ? "PRIMARY_CREATURE" : "ANY_CREATURE",
      controllerScope: text.includes("opponent") ? "OPPONENT" : controllerScope
    };
  }

  if (text.includes("equipped creature")) {
    return undefined;
  }

  if (
    (effect.actionType === "DESTROY_MAGIC_CARDS" || effect.actionType === "DESTROY_MAGIC") &&
    text.includes("magic") &&
    !text.includes("all magic") &&
    !text.includes("destroy all")
  ) {
    return { kind: "MAGIC_SLOT_CARD", controllerScope };
  }

  if (effect.actionType === "DESTROY_ALL_MAGIC") {
    return { kind: "PLAYER", controllerScope };
  }

  if (
    [
      "ROLL_DAMAGE_TABLE",
      "ROLL_TABLE",
      "ROLL_AND_DAMAGE",
      "ROLL_AND_HEAL",
      "HEAL_BY_ROLL"
    ].includes(effect.actionType)
  ) {
    if (text.includes("primary creature") || text.includes("opponent primary")) {
      return { kind: "PRIMARY_CREATURE", controllerScope };
    }

    if (text.includes("limited summon")) {
      return { kind: "LIMITED_SUMMON", controllerScope };
    }

    if (text.includes("creature") || text.includes("target")) {
      return { kind: "ANY_CREATURE", controllerScope };
    }
  }

  if (
    [
      "DEAL_INSTANT_DAMAGE",
      "DAMAGE_CREATURE",
      "DAMAGE",
      "PAY_DAMAGE_COST",
      "HEAL_CREATURE",
      "HEAL",
      "HEAL_TO_FULL",
      "APPLY_STAT_MODIFIER",
      "APPLY_STATUS",
      "APPLY_STATUS_WITH_ESCAPE_ROLL",
      "APPLY_DAMAGE_IMMUNITY",
      "APPLY_DICE_LIMIT",
      "APPLY_DAMAGE_OVER_TIME",
      "APPLY_HEALING_OVER_TIME",
      "APPLY_HEAL_OVER_TIME",
      "DEAL_PERCENTAGE_DAMAGE"
    ].includes(effect.actionType)
  ) {
    if (text.includes("primary creature") || text.includes("opponent primary")) {
      return { kind: "PRIMARY_CREATURE", controllerScope };
    }

    if (text.includes("limited summon")) {
      return { kind: "LIMITED_SUMMON", controllerScope };
    }

    if (text.includes("creature")) {
      return { kind: "ANY_CREATURE", controllerScope };
    }
  }


  if (effect.actionType === "SEND_TO_CEMETERY" || effect.actionType === "SEND_TO_ORIGINAL_OWNER_CEMETERY" || effect.actionType === "DESTROY_SELF") {
    if (text.includes("magic") || text.includes("this card")) {
      return { kind: "MAGIC_SLOT_CARD", controllerScope };
    }

    if (text.includes("primary creature")) {
      return { kind: "PRIMARY_CREATURE", controllerScope };
    }

    if (text.includes("limited summon")) {
      return { kind: "LIMITED_SUMMON", controllerScope };
    }

    if (text.includes("creature")) {
      return { kind: "ANY_CREATURE", controllerScope };
    }
  }

  if (effect.actionType === "SEARCH_DECK_TO_EQUIP") {
    return {
      kind: "CARD_IN_DECK",
      controllerScope: "CONTROLLER",
      requireMagic: true,
      magicSubTypeIncludes: ["EQUIP"]
    };
  }

  if (effect.actionType === "PAY_CARD_COST") {
    return {
      kind: "CARD_IN_HAND",
      controllerScope: "CONTROLLER",
      requireCreature: text.includes("creature"),
      requireMagic: text.includes("magic"),
      ...getCommonCardFilters(text)
    };
  }

  if (
    [
      "PAY_DISCARD_MAGIC_COST",
      "PAY_DISCARD_COST",
      "DISCARD_CARD",
      "DISCARD_CARDS",
      "FORCE_DISCARD"
    ].includes(effect.actionType)
  ) {
    return {
      kind: "CARD_IN_HAND",
      controllerScope,
      requireMagic: effect.actionType === "PAY_DISCARD_MAGIC_COST" || text.includes("magic"),
      requireCreature: text.includes("creature"),
      ...getCommonCardFilters(text)
    };
  }

  if (effect.actionType === "SEARCH_DECK_TO_HAND") {
    return {
      kind: "CARD_IN_DECK",
      controllerScope: "CONTROLLER",
      requireCreature: text.includes("creature"),
      requireMagic: text.includes("magic"),
      ...getCommonCardFilters(text)
    };
  }

  if (
    effect.actionType === "MOVE_CARD" &&
    text.includes("hand") &&
    (text.includes("cemetery") || text.includes("graveyard"))
  ) {
    return {
      kind: "CARD_IN_CEMETERY",
      controllerScope: "CONTROLLER",
      requireCreature: text.includes("creature"),
      requireMagic: text.includes("magic"),
      ...getCommonCardFilters(text)
    };
  }

  if (
    effect.actionType === "MOVE_CARD" &&
    text.includes("hand") &&
    text.includes("creature")
  ) {
    return {
      kind: "ANY_CREATURE",
      controllerScope,
      requireCreature: true,
      ...getCommonCardFilters(text)
    };
  }

  if (isLimitedSummonCardSelectionEffect(effect, text)) {
    return {
      kind: inferLimitedSummonSourceKind(effect, text),
      controllerScope,
      requireCreature: true,
      ...getLimitedSummonCardFilters(text)
    };
  }

  return undefined;
}

