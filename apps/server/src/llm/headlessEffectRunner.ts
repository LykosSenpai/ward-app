import type { CardDefinition, CardInstance, DevRollKind, MatchState, WardEngineEffect } from "@ward/shared";
import {
  activateCardEffect,
  applyManualBattleDamage,
  applyPendingEffectRoll,
  createDeckFromCardIds,
  createEffectTestScenarioMatch,
  finishManualBattleSession,
  forceNextDevRolls,
  passMagicChainPriority,
  playLightningResponseFromHand,
  playMagicFromHand,
  resolvePendingEffectTargetPrompt,
  rollManualBattleDamage,
  rollManualBattleHit,
  rollPendingEffectRoll,
  runManualBattleSpeedCheck,
  startManualBattleSession,
  updateManualBattleSpeedModifiers
} from "@ward/engine";
import type {
  LlmDirectEffectSmokeTestResult,
  LlmEffectTestPlan,
  LlmHeadlessAssertionResult,
  LlmHeadlessVariantResult
} from "./types.js";

type LocatedCard = {
  playerId: string;
  card: CardInstance;
  zone: string;
};

type VariantConfig = {
  name: string;
  description: string;
  forcedRolls: Array<{ kind: DevRollKind; dice: number[]; label?: string }>;
  targetStrategy: "FIRST_VALID" | "LAST_VALID";
};

type RunStep = {
  label: string;
  ok: boolean;
  detail?: string;
};

type AssertionStatus = "PASS" | "FAIL" | "SKIPPED";

const HIGH_HIT_DICE = [6, 5, 6, 5, 6, 5, 6, 5, 6, 5];
const LOW_HIT_DICE = [1, 1, 1, 1, 1, 1];
const LOW_DAMAGE_DICE = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const HIGH_DAMAGE_DICE = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
const SUCCESS_EFFECT_DICE = [6, 6, 6, 6];
const FAIL_EFFECT_DICE = [1, 1, 1, 1];

function cloneMatch(match: MatchState): MatchState {
  return JSON.parse(JSON.stringify(match)) as MatchState;
}

function normalizeText(...parts: unknown[]): string {
  return parts
    .filter(part => part !== undefined && part !== null)
    .map(part => typeof part === "string" ? part : JSON.stringify(part))
    .join(" ")
    .toLowerCase();
}

function effectText(effect?: WardEngineEffect): string {
  if (!effect) return "";
  return normalizeText(
    effect.id,
    effect.trigger,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.duration?.text,
    effect.reusableFunction,
    effect.params
  );
}

function planText(plan: LlmEffectTestPlan): string {
  return normalizeText(
    plan.title,
    plan.summary,
    plan.card.rawText,
    plan.effect,
    plan.steps,
    plan.expectedAssertions,
    plan.manualVerification,
    plan.riskNotes
  );
}

function getCardEffects(definition: CardDefinition | undefined): WardEngineEffect[] {
  return Array.isArray(definition?.effects) ? definition.effects : [];
}

function findEffect(cardCatalog: Record<string, CardDefinition>, plan: LlmEffectTestPlan): WardEngineEffect | undefined {
  const definition = cardCatalog[plan.card.cardId];
  const effects = getCardEffects(definition);
  return plan.effect?.effectId
    ? effects.find(effect => effect.id === plan.effect?.effectId)
    : effects[0];
}

function findCardByPredicate(
  match: MatchState,
  predicate: (card: CardInstance, definition: CardDefinition | undefined, playerId: string, zone: string) => boolean
): LocatedCard | undefined {
  for (const player of match.players) {
    const primary = player.field.primaryCreature;
    if (primary && predicate(primary, match.cardCatalog[primary.cardId], player.id, "PRIMARY_CREATURE")) {
      return { playerId: player.id, card: primary, zone: "PRIMARY_CREATURE" };
    }

    for (const card of player.field.limitedSummons ?? []) {
      if (predicate(card, match.cardCatalog[card.cardId], player.id, "LIMITED_SUMMON")) {
        return { playerId: player.id, card, zone: "LIMITED_SUMMON" };
      }
    }

    for (const card of player.field.magicSlots ?? []) {
      if (predicate(card, match.cardCatalog[card.cardId], player.id, "MAGIC_SLOT")) {
        return { playerId: player.id, card, zone: "MAGIC_SLOT" };
      }
    }

    for (const card of player.hand ?? []) {
      if (predicate(card, match.cardCatalog[card.cardId], player.id, "HAND")) {
        return { playerId: player.id, card, zone: "HAND" };
      }
    }

    for (const card of player.deck ?? []) {
      if (predicate(card, match.cardCatalog[card.cardId], player.id, "DECK")) {
        return { playerId: player.id, card, zone: "DECK" };
      }
    }

    for (const card of player.cemetery ?? []) {
      if (predicate(card, match.cardCatalog[card.cardId], player.id, "CEMETERY")) {
        return { playerId: player.id, card, zone: "CEMETERY" };
      }
    }
  }

  return undefined;
}

function findSource(match: MatchState, cardId: string): LocatedCard | undefined {
  return findCardByPredicate(match, card => card.cardId === cardId);
}

function findOpponentPlayerId(match: MatchState, playerId: string): string {
  return match.players.find(player => player.id !== playerId)?.id ?? playerId;
}

function getPlayer(match: MatchState, playerId: string) {
  const player = match.players.find(item => item.id === playerId);
  if (!player) throw new Error(`Player not found: ${playerId}`);
  return player;
}

function moveDeckCardToHand(match: MatchState, playerId: string, cardId: string): CardInstance | undefined {
  const player = getPlayer(match, playerId);
  const index = player.deck.findIndex(card => card.cardId === cardId);
  if (index < 0) return undefined;
  const [card] = player.deck.splice(index, 1);
  card.zone = "HAND";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  player.hand.push(card);
  return card;
}

function ensureCardInHand(match: MatchState, playerId: string, cardId: string): CardInstance | undefined {
  if (!match.cardCatalog[cardId]) return undefined;

  const player = getPlayer(match, playerId);
  const existing = player.hand.find(card => card.cardId === cardId);
  if (existing) return existing;

  const fromDeck = moveDeckCardToHand(match, playerId, cardId);
  if (fromDeck) return fromDeck;

  const [created] = createDeckFromCardIds(playerId, [cardId], match.cardCatalog);
  if (!created) return undefined;
  created.zone = "HAND";
  created.controllerPlayerId = playerId;
  created.ownerPlayerId = playerId;
  player.hand.push(created);
  return created;
}

function createScenarioCreature(match: MatchState, playerId: string, cardId: string, hpOverride?: number): CardInstance | undefined {
  const definition = match.cardCatalog[cardId];
  if (definition?.cardType !== "CREATURE") return undefined;
  const [card] = createDeckFromCardIds(playerId, [cardId], match.cardCatalog);
  if (!card) return undefined;
  card.zone = "PRIMARY_CREATURE";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = playerId;
  card.baseHp = hpOverride ?? definition.hp;
  card.currentHp = hpOverride ?? definition.hp;
  return card;
}

function setScenarioPrimaryCreature(match: MatchState, playerId: string, cardId: string, hpOverride?: number): void {
  const creature = createScenarioCreature(match, playerId, cardId, hpOverride);
  if (!creature) return;
  getPlayer(match, playerId).field.primaryCreature = creature;
}

function moveCardToMagicSlot(match: MatchState, playerId: string, card: CardInstance): void {
  const player = getPlayer(match, playerId);
  card.zone = "MAGIC_SLOT";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  player.field.magicSlots.push(card);
}

function moveHandCardToMagicSlot(match: MatchState, playerId: string, cardId: string): void {
  const player = getPlayer(match, playerId);
  const handIndex = player.hand.findIndex(card => card.cardId === cardId);
  if (handIndex < 0) return;
  const [card] = player.hand.splice(handIndex, 1);
  moveCardToMagicSlot(match, playerId, card);
}

function ensurePlanSetupCards(match: MatchState, plan: LlmEffectTestPlan): void {
  for (const cardId of plan.setup.player1Cards ?? []) {
    ensureCardInHand(match, "player_1", cardId);
  }

  for (const cardId of plan.setup.player2Cards ?? []) {
    ensureCardInHand(match, "player_2", cardId);
  }

  const notesText = normalizeText(plan.setup.notes, plan.steps);
  if (!notesText.includes("pre-place") && !notesText.includes("on field")) return;

  const placeSupportMagic = (playerId: string, cardIds: string[] | undefined, keepInHandCardIds: Set<string>) => {
    for (const cardId of cardIds ?? []) {
      if (keepInHandCardIds.has(cardId)) continue;
      const definition = match.cardCatalog[cardId];
      if (definition?.cardType !== "MAGIC") continue;
      moveHandCardToMagicSlot(match, playerId, cardId);
    }
  };

  const sourceDefinition = match.cardCatalog[plan.card.cardId];
  const player2TriggerMagic = sourceDefinition?.cardType === "MAGIC" && sourceDefinition.magicType === "LIGHTNING"
    ? new Set((plan.setup.player2Cards ?? []).filter((cardId, index) => {
      const definition = match.cardCatalog[cardId];
      return index === 0 && definition?.cardType === "MAGIC";
    }))
    : new Set<string>();

  placeSupportMagic("player_1", plan.setup.player1Cards, new Set([plan.card.cardId]));
  placeSupportMagic("player_2", plan.setup.player2Cards, player2TriggerMagic);
}

function takeFirstMagicFromZones(match: MatchState, playerId: string, avoidCardId?: string): CardInstance | undefined {
  const player = getPlayer(match, playerId);
  const fromHand = player.hand.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "MAGIC" && card.cardId !== avoidCardId;
  });

  if (fromHand >= 0) {
    const [card] = player.hand.splice(fromHand, 1);
    return card;
  }

  const fromDeck = player.deck.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "MAGIC" && card.cardId !== avoidCardId;
  });

  if (fromDeck >= 0) {
    const [card] = player.deck.splice(fromDeck, 1);
    return card;
  }

  const catalogMagic = Object.values(match.cardCatalog).find(
    definition => definition.cardType === "MAGIC" && definition.id !== avoidCardId
  );

  if (!catalogMagic) return undefined;

  const fromAnyDeck = Object.values(match.players)
    .flatMap(playerItem => playerItem.deck)
    .find(card => card.cardId === catalogMagic.id);

  return fromAnyDeck ? undefined : undefined;
}

function moveFirstCreatureToCemetery(match: MatchState, playerId: string, avoidCardId?: string): void {
  const player = getPlayer(match, playerId);
  const deckIndex = player.deck.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "CREATURE" && card.cardId !== avoidCardId;
  });

  if (deckIndex >= 0) {
    const [card] = player.deck.splice(deckIndex, 1);
    const definition = match.cardCatalog[card.cardId];
    card.zone = "CEMETERY";
    card.controllerPlayerId = playerId;
    card.ownerPlayerId = card.ownerPlayerId || playerId;
    if (definition?.cardType === "CREATURE") {
      card.baseHp = definition.hp;
      card.currentHp = 0;
    }
    player.cemetery.push(card);
  }
}

function ensureCreatureTypeInCemetery(match: MatchState, playerId: string, creatureTypeText: string, avoidCardId?: string): void {
  const player = getPlayer(match, playerId);
  const wanted = creatureTypeText.toLowerCase();
  const hasTarget = player.cemetery.some(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "CREATURE" && normalizeText(definition.name, definition.creatureType).includes(wanted);
  });

  if (hasTarget) return;

  const existingIndex = player.deck.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "CREATURE" &&
      card.cardId !== avoidCardId &&
      normalizeText(definition.name, definition.creatureType).includes(wanted);
  });

  if (existingIndex >= 0) {
    const [card] = player.deck.splice(existingIndex, 1);
    card.zone = "CEMETERY";
    card.controllerPlayerId = playerId;
    card.ownerPlayerId = card.ownerPlayerId || playerId;
    card.currentHp = 0;
    player.cemetery.push(card);
    return;
  }

  const definition = Object.values(match.cardCatalog).find(candidate =>
    candidate.cardType === "CREATURE" &&
    candidate.id !== avoidCardId &&
    normalizeText(candidate.name, candidate.creatureType).includes(wanted)
  );

  if (!definition) return;

  const [card] = createDeckFromCardIds(playerId, [definition.id], match.cardCatalog);
  if (!card) return;
  card.zone = "CEMETERY";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  card.currentHp = 0;
  player.cemetery.push(card);
}

function ensureSearchTargetInDeck(match: MatchState, playerId: string, text: string, avoidCardId?: string): void {
  if (!text.includes("search") && !text.includes("deck")) return;

  const wantsDragon = text.includes("dragon");
  const existingTarget = getPlayer(match, playerId).deck.some(card => {
    const definition = match.cardCatalog[card.cardId];
    if (!definition) return false;
    if (card.cardId === avoidCardId) return false;
    if (definition.cardType !== "CREATURE") return false;
    return !wantsDragon || normalizeText(definition.name, definition.creatureType).includes("dragon");
  });

  if (existingTarget) return;

  const targetDefinition = Object.values(match.cardCatalog).find(definition => {
    if (definition.id === avoidCardId || definition.cardType !== "CREATURE") return false;
    return !wantsDragon || normalizeText(definition.name, definition.creatureType).includes("dragon");
  });

  if (!targetDefinition) return;

  // The scenario decks are relaxed dev fixtures. Reuse the first deck instance of
  // the target card when available, otherwise leave evidence to the prompt system.
  moveDeckCardToHand(match, playerId, targetDefinition.id);
  const player = getPlayer(match, playerId);
  const handIndex = player.hand.findIndex(card => card.cardId === targetDefinition.id);
  if (handIndex >= 0) {
    const [card] = player.hand.splice(handIndex, 1);
    card.zone = "DECK";
    player.deck.unshift(card);
  }
}

function prepareScenarioTargets(match: MatchState, plan: LlmEffectTestPlan, effect?: WardEngineEffect): void {
  const sourcePlayerId = plan.setup.activePlayerId ?? "player_1";
  const opponentPlayerId = findOpponentPlayerId(match, sourcePlayerId);
  const text = normalizeText(planText(plan), effectText(effect));

  if (text.includes("wings") || text.includes("winged")) {
    setScenarioPrimaryCreature(match, opponentPlayerId, "gen1_001_blue_dragon", 50);
  } else if (text.includes("dragon target") || text.includes("dragon-type") || text.includes("dragon fox")) {
    setScenarioPrimaryCreature(match, opponentPlayerId, "gen1_041_dragon_fox", 50);
  }

  if (text.includes("magic")) {
    const opponent = getPlayer(match, opponentPlayerId);
    if (opponent.field.magicSlots.length === 0) {
      const magic = takeFirstMagicFromZones(match, opponentPlayerId, plan.card.cardId);
      if (magic) {
        moveCardToMagicSlot(match, opponentPlayerId, magic);
      }
    }
  }

  if ((text.includes("cemetery") || text.includes("graveyard")) && text.includes("undead")) {
    ensureCreatureTypeInCemetery(match, sourcePlayerId, "undead", plan.card.cardId);
  } else if (text.includes("cemetery") || text.includes("graveyard")) {
    moveFirstCreatureToCemetery(match, sourcePlayerId, plan.card.cardId);
  }

  ensureSearchTargetInDeck(match, sourcePlayerId, text, plan.card.cardId);
}

function ensureSourceOnPlayZone(match: MatchState, plan: LlmEffectTestPlan, effect?: WardEngineEffect): void {
  const definition = match.cardCatalog[plan.card.cardId];
  if (definition?.cardType !== "MAGIC") return;

  const trigger = normalizeText(effect?.trigger);
  const actionText = normalizeText(effect?.actionType, effect?.actionText, effect?.effectGroup);
  const shouldPlayFromHand = trigger.includes("on_play") || trigger.includes("when_played") || actionText.includes("on play");
  if (!shouldPlayFromHand) return;

  const source = findSource(match, plan.card.cardId);
  if (!source || source.zone === "HAND") return;

  const player = getPlayer(match, source.playerId);
  if (source.zone === "MAGIC_SLOT") {
    const index = player.field.magicSlots.findIndex(card => card.instanceId === source.card.instanceId);
    if (index >= 0) player.field.magicSlots.splice(index, 1);
  } else if (source.zone === "DECK") {
    const index = player.deck.findIndex(card => card.instanceId === source.card.instanceId);
    if (index >= 0) player.deck.splice(index, 1);
  }

  source.card.zone = "HAND";
  source.card.controllerPlayerId = source.playerId;
  player.hand.push(source.card);
}

function applyPlanAndVariantRolls(match: MatchState, plan: LlmEffectTestPlan, variant: VariantConfig): void {
  const seenLabels = new Set<string>();
  const planRolls = variant.name === "expected-success" ? plan.setup.forcedRolls ?? [] : [];
  for (const roll of [...planRolls, ...variant.forcedRolls]) {
    const key = `${roll.kind}:${roll.dice.join(",")}:${roll.label ?? ""}`;
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    forceNextDevRolls(match, {
      kind: roll.kind,
      dice: roll.dice,
      label: roll.label ?? `${variant.name}: ${plan.title}`
    });
  }
}

function getEffectSuccessDice(effect?: WardEngineEffect): number[] {
  const condition = effect?.condition as { successValues?: unknown } | undefined;
  const paramsCondition = effect?.params?.condition as { successValues?: unknown } | undefined;
  const successValues = condition?.successValues ?? paramsCondition?.successValues;
  if (!Array.isArray(successValues)) return SUCCESS_EFFECT_DICE;

  const dice = successValues
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 6);

  return dice.length > 0 ? dice : SUCCESS_EFFECT_DICE;
}

function getEffectFailureDice(effect?: WardEngineEffect): number[] {
  const successDice = new Set(getEffectSuccessDice(effect));
  const failures = [1, 2, 3, 4, 5, 6].filter(value => !successDice.has(value));
  return failures.length > 0 ? failures : FAIL_EFFECT_DICE;
}

function buildVariants(plan: LlmEffectTestPlan, effect?: WardEngineEffect): VariantConfig[] {
  const text = normalizeText(planText(plan), effectText(effect));
  const actionType = normalizeText(effect?.actionType);
  const needsBattle = text.includes("on_hit") || text.includes("hit") || text.includes("battle") || text.includes("attack damage");
  const needsEffectRoll = text.includes("roll_for_effect") || text.includes("effect roll") || text.includes("roll") || Boolean(plan.setup.forcedRolls?.some(roll => roll.kind === "EFFECT_ROLL"));
  const successEffectDice = getEffectSuccessDice(effect);
  const failureEffectDice = getEffectFailureDice(effect);
  const expectedHitDice = actionType.includes("temporary_hit_override") ? LOW_HIT_DICE : needsBattle ? HIGH_HIT_DICE : [4, 4, 4, 4];

  const base: VariantConfig = {
    name: "expected-success",
    description: "Expected-success route using high hit/effect rolls and low damage rolls to avoid accidental kills.",
    targetStrategy: "FIRST_VALID",
    forcedRolls: [
      { kind: "SPEED_TIE_ROLL", dice: [6, 1, 6, 1], label: "Headless speed tie success route" },
      { kind: "HIT_ROLL", dice: expectedHitDice, label: "Headless hit success route" },
      { kind: "EFFECT_ROLL", dice: needsEffectRoll ? successEffectDice : [successEffectDice[0] ?? 6], label: "Headless effect success route" },
      { kind: "ATTACK_DAMAGE_ROLL", dice: LOW_DAMAGE_DICE, label: "Headless low damage route" },
      { kind: "SELF_DAMAGE_ROLL", dice: [1, 1, 1, 1], label: "Headless low self damage route" },
      { kind: "GENERIC_ROLL", dice: SUCCESS_EFFECT_DICE, label: "Headless generic success route" }
    ]
  };

  const variants = [base];

  if (needsEffectRoll || needsBattle) {
    variants.push({
      name: "failure-control",
      description: "Failure-control route using failed hit/effect rolls to confirm the effect does not falsely apply.",
      targetStrategy: "FIRST_VALID",
      forcedRolls: [
        { kind: "SPEED_TIE_ROLL", dice: [6, 1], label: "Headless speed tie control route" },
        { kind: "HIT_ROLL", dice: LOW_HIT_DICE, label: "Headless hit failure control" },
        { kind: "EFFECT_ROLL", dice: failureEffectDice, label: "Headless effect failure control" },
        { kind: "ATTACK_DAMAGE_ROLL", dice: HIGH_DAMAGE_DICE, label: "Headless high damage control" },
        { kind: "SELF_DAMAGE_ROLL", dice: [1, 1, 1, 1], label: "Headless low self damage control" },
        { kind: "GENERIC_ROLL", dice: failureEffectDice, label: "Headless generic failure control" }
      ]
    });
  }

  return variants;
}

function summarizeMatch(match: MatchState): string {
  return match.players.map(player => {
    const primary = player.field.primaryCreature;
    const primaryName = primary ? match.cardCatalog[primary.cardId]?.name ?? primary.cardId : "none";
    const primaryHp = primary ? `${primary.currentHp ?? primary.baseHp ?? "?"}/${primary.baseHp ?? "?"}` : "n/a";
    const statuses = primary?.activeStatuses?.map(status => status.status || status.label).join(", ") || "none";
    return `${player.displayName}: primary=${primaryName} HP=${primaryHp} statuses=${statuses} hand=${player.hand.length} deck=${player.deck.length} cemetery=${player.cemetery.length} magic=${player.field.magicSlots.length} limited=${player.field.limitedSummons.length}`;
  }).join(" | ");
}

function readDerivedPath(root: unknown, path: string): unknown {
  const match = root as MatchState;
  const cardIdForName = (name: unknown): string | undefined => {
    const normalized = normalizeText(name).trim();
    return Object.values(match.cardCatalog).find(definition => normalizeText(definition.name).trim() === normalized)?.id;
  };

  if (path === "effectLog") {
    const semanticEntries = match.eventLog.flatMap(event => {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) return [];

      if (event.type === "CHAIN_LINK_NEGATED") {
        const negated = cardIdForName(payload.negatedCardName) ?? payload.negatedCardName;
        return [`negated:${negated}`];
      }

      if (event.type === "MAGIC_CHAIN_RESOLVED" && Array.isArray(payload.resolutionOrder)) {
        return payload.resolutionOrder.flatMap(item => {
          const entry = item as { cardName?: unknown; status?: unknown };
          const cardId = cardIdForName(entry.cardName) ?? entry.cardName;
          return [`${String(entry.status ?? "").toLowerCase()}:${cardId}`];
        });
      }

      return [];
    });
    return [...match.eventLog, ...semanticEntries];
  }

  if (path === "chain.resolvedCards") {
    return match.eventLog.flatMap(event => {
      const payload = event.payload as { resolutionOrder?: unknown } | undefined;
      if (event.type !== "MAGIC_CHAIN_RESOLVED" || !Array.isArray(payload?.resolutionOrder)) return [];

      return payload.resolutionOrder.flatMap(item => {
        const entry = item as { cardName?: unknown; status?: unknown };
        if (entry.status !== "RESOLVED") return [];
        return cardIdForName(entry.cardName) ?? entry.cardName ?? [];
      });
    });
  }

  if (path === "damageEvents") {
    return match.eventLog.flatMap(event => {
      const payload = event.payload as { damageAmount?: unknown; multiplier?: unknown; effectAndManualDamageMultiplier?: unknown; criticalHit?: unknown } | undefined;
      if (event.type === "BATTLE_DAMAGE_MULTIPLIER_APPLIED" || event.type === "BATTLE_DAMAGE_MULTIPLIER_ALREADY_APPLIED") {
        return [`multiplier:${payload?.multiplier}`];
      }

      if (event.type === "BATTLE_DAMAGE_PIPELINE_RESOLVED") {
        return [
          `multiplier:${payload?.effectAndManualDamageMultiplier}`,
          payload?.criticalHit ? "critical" : ""
        ].filter(Boolean);
      }

      const damageAmount = Number(payload?.damageAmount);
      if (!Number.isFinite(damageAmount)) return [];

      if (event.type === "BATTLE_FORCED_DAMAGE_DICE_RESOLVED") {
        return [`effectDamage:${damageAmount}`];
      }

      if (event.type.includes("DAMAGE")) {
        return [`damage:${damageAmount}`];
      }

      return [];
    });
  }

  const playerCollectionPath = path.match(/^players\.([^.]+)\.(magicSlots|cemetery)$/);
  if (playerCollectionPath) {
    const [, playerId, collection] = playerCollectionPath;
    const player = match.players.find(item => item.id === playerId);
    if (!player) return undefined;
    const cards = collection === "magicSlots" ? player.field.magicSlots : player.cemetery;
    return cards.map(card => card.cardId);
  }

  const playerCountDeltaPath = path.match(/^players\.([^.]+)\.(hand|deck)\.countDelta$/);
  if (playerCountDeltaPath) {
    const [, playerId, collection] = playerCountDeltaPath;
    const drawEvents = match.eventLog.filter(event => event.type === "AUTO_EFFECT_DRAW_CARDS_RESOLVED");
    const drawn = drawEvents.reduce((total, event) => {
      const payload = event.payload as { results?: unknown } | undefined;
      if (!Array.isArray(payload?.results)) return total;
      const playerResult = payload.results.find(result => (result as { playerId?: unknown }).playerId === playerId) as { actualDrawn?: unknown } | undefined;
      return total + Number(playerResult?.actualDrawn ?? 0);
    }, 0);

    return collection === "hand" ? drawn : -drawn;
  }

  const playerPath = path.match(/^players\.([^.]+)\.(primaryCreature|field\.primaryCreature)(?:\.(.+))?$/);
  if (playerPath) {
    const [, playerId, , rest] = playerPath;
    const player = match.players.find(item => item.id === playerId);
    const primary = player?.field.primaryCreature;
    if (!rest) return primary;
    return readPath(primary, rest);
  }

  return undefined;
}

function readPath(root: unknown, path: string): unknown {
  const derived = readDerivedPath(root, path);
  if (derived !== undefined) return derived;

  const cleaned = path.replace(/\[(\d+)\]/g, ".$1");
  const parts = cleaned.split(".").map(part => part.trim()).filter(Boolean);
  let current: unknown = root;

  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function containsValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some(item => containsValue(item, expected));
  }

  if (typeof actual === "string") {
    return actual.toLowerCase().includes(String(expected ?? "").toLowerCase());
  }

  if (actual && typeof actual === "object") {
    const text = JSON.stringify(actual).toLowerCase();
    return text.includes(String(expected ?? "").toLowerCase());
  }

  return Object.is(actual, expected);
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return false;
}

function evaluateAssertion(match: MatchState, assertion: LlmEffectTestPlan["expectedAssertions"][number]): LlmHeadlessAssertionResult {
  const actual = readPath(match, assertion.path);
  let status: AssertionStatus = "FAIL";

  if (assertion.operator === "exists") {
    status = actual !== undefined && actual !== null ? "PASS" : "FAIL";
  } else if (assertion.operator === "notExists") {
    status = actual === undefined || actual === null ? "PASS" : "FAIL";
  } else if (assertion.operator === "equals") {
    status = valuesEqual(actual, assertion.value) ? "PASS" : "FAIL";
  } else if (assertion.operator === "notEquals") {
    status = !valuesEqual(actual, assertion.value) ? "PASS" : "FAIL";
  } else if (assertion.operator === "contains") {
    status = containsValue(actual, assertion.value) ? "PASS" : "FAIL";
  } else if (assertion.operator === "notContains") {
    status = !containsValue(actual, assertion.value) ? "PASS" : "FAIL";
  } else if (assertion.operator === "greaterThan") {
    status = Number(actual) > Number(assertion.value) ? "PASS" : "FAIL";
  } else if (assertion.operator === "lessThan") {
    status = Number(actual) < Number(assertion.value) ? "PASS" : "FAIL";
  }

  return {
    label: assertion.label,
    path: assertion.path,
    operator: assertion.operator,
    expected: assertion.value,
    actual,
    status
  };
}

function evaluateAssertions(match: MatchState, plan: LlmEffectTestPlan): LlmHeadlessAssertionResult[] {
  return plan.expectedAssertions.map(assertion => evaluateAssertion(match, assertion));
}

function choosePromptOption(match: MatchState, strategy: VariantConfig["targetStrategy"]): string | undefined {
  const prompt = match.pendingEffectTargetPrompt;
  if (!prompt?.options?.length) return undefined;

  const sourcePlayerId = prompt.controllerPlayerId;
  const opponentId = findOpponentPlayerId(match, sourcePlayerId);
  const text = normalizeText(prompt.promptText, prompt.actionType, prompt.effectGroup, prompt.actionText, prompt.effectValue);

  const options = [...prompt.options];
  const preferred = options.find(option => text.includes("opponent") && option.playerId === opponentId) ??
    options.find(option => !text.includes("opponent") && option.playerId === sourcePlayerId) ??
    options.find(option => option.zone === "PRIMARY_CREATURE" && option.playerId === opponentId) ??
    options.find(option => option.zone === "MAGIC_SLOT" && option.playerId === opponentId) ??
    options[0];

  if (strategy === "LAST_VALID") {
    return options[options.length - 1]?.id ?? preferred.id;
  }

  return preferred.id;
}

function drainTargetPrompts(match: MatchState, variant: VariantConfig, steps: RunStep[]): MatchState {
  let next = match;
  let guard = 0;

  while (next.pendingEffectTargetPrompt && guard < 10) {
    guard += 1;
    const prompt = next.pendingEffectTargetPrompt;
    const optionId = choosePromptOption(next, variant.targetStrategy);

    if (!optionId) {
      steps.push({ label: "resolve target prompt", ok: false, detail: "No valid target options were available." });
      break;
    }

    next = resolvePendingEffectTargetPrompt(next, prompt.id, optionId);
    steps.push({ label: "resolve target prompt", ok: true, detail: `${prompt.actionType} → ${optionId}` });
  }

  return next;
}

function drainChain(match: MatchState, steps: RunStep[]): MatchState {
  let next = match;
  let guard = 0;

  while (next.pendingChain && guard < 10) {
    guard += 1;
    const priorityPlayerId = next.pendingChain.priorityPlayerId;
    if (!priorityPlayerId) break;
    next = passMagicChainPriority(next, priorityPlayerId);
    steps.push({ label: "pass/resolve magic chain", ok: true, detail: `priority=${priorityPlayerId}` });
  }

  return next;
}

function drainEffectRoll(match: MatchState, steps: RunStep[]): MatchState {
  let next = match;
  let guard = 0;

  while (next.pendingEffectRoll && guard < 10) {
    guard += 1;
    const pending = next.pendingEffectRoll;
    if (pending.status === "AWAITING_ROLL") {
      next = rollPendingEffectRoll(next, pending.id);
      steps.push({ label: "roll pending effect", ok: true, detail: pending.effectId });
      continue;
    }

    if (next.pendingEffectRoll?.status === "ROLLED") {
      next = applyPendingEffectRoll(next, next.pendingEffectRoll.id);
      steps.push({ label: "apply pending effect roll", ok: true, detail: `${pending.effectId}` });
      continue;
    }

    break;
  }

  return next;
}

function runPendingBattle(match: MatchState, steps: RunStep[]): MatchState {
  let next = match;
  let guard = 0;

  while (next.pendingBattle && guard < 40) {
    guard += 1;
    const session = next.pendingBattle;

    if (session.status === "AWAITING_SPEED_CHECK") {
      next = updateManualBattleSpeedModifiers(next, session.id, {
        ...session.speedModifiers,
        override: "ATTACKER_FIRST",
        note: "Headless LLM runner: force declared attacker first for deterministic effect verification."
      });
      next = runManualBattleSpeedCheck(next, session.id);
      steps.push({ label: "run battle speed check", ok: true, detail: "attacker first" });
      continue;
    }

    if (session.status === "AWAITING_HIT_ROLL") {
      next = rollManualBattleHit(next, session.id);
      steps.push({ label: "roll battle hit", ok: true });
      next = drainEffectRoll(next, steps);
      continue;
    }

    if (session.status === "AWAITING_EFFECT_ROLL") {
      next = drainEffectRoll(next, steps);
      continue;
    }

    if (session.status === "AWAITING_DAMAGE_ROLL") {
      next = rollManualBattleDamage(next, session.id);
      steps.push({ label: "roll battle damage", ok: true });
      continue;
    }

    if (session.status === "AWAITING_DAMAGE_APPLICATION") {
      next = applyManualBattleDamage(next, session.id);
      steps.push({ label: "apply battle damage", ok: true });
      continue;
    }

    if (session.status === "COMPLETE") {
      next = finishManualBattleSession(next, session.id);
      steps.push({ label: "finish battle", ok: true });
      break;
    }

    break;
  }

  return next;
}

function drainAllAutomation(match: MatchState, variant: VariantConfig, steps: RunStep[]): MatchState {
  let next = match;
  let guard = 0;

  while (guard < 40) {
    guard += 1;
    const before = JSON.stringify({
      chain: next.pendingChain?.id,
      prompt: next.pendingEffectTargetPrompt?.id,
      effectRoll: next.pendingEffectRoll?.id,
      battle: next.pendingBattle?.id,
      battleStatus: next.pendingBattle?.status
    });

    next = drainChain(next, steps);
    next = drainEffectRoll(next, steps);
    next = drainTargetPrompts(next, variant, steps);
    next = runPendingBattle(next, steps);

    const after = JSON.stringify({
      chain: next.pendingChain?.id,
      prompt: next.pendingEffectTargetPrompt?.id,
      effectRoll: next.pendingEffectRoll?.id,
      battle: next.pendingBattle?.id,
      battleStatus: next.pendingBattle?.status
    });

    if (before === after) break;
  }

  return next;
}

function runInitialAction(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const definition = match.cardCatalog[plan.card.cardId];
  if (!definition) throw new Error(`Card definition was not found for ${plan.card.cardId}.`);

  const source = findSource(match, plan.card.cardId);
  if (!source) throw new Error(`No source card instance was found for ${plan.card.cardId}.`);

  const text = normalizeText(planText(plan), effectText(effect));
  const trigger = normalizeText(effect?.trigger);
  const actionType = normalizeText(effect?.actionType);

  if (plan.effect?.effectId && trigger.includes("activated")) {
    const next = activateCardEffect(match, {
      playerId: source.playerId,
      sourceInstanceId: source.card.instanceId,
      effectId: plan.effect.effectId
    });
    steps.push({ label: "activate field/card effect", ok: true, detail: `${definition.name} ${plan.effect.effectId}` });
    return next;
  }

  const shouldRunBattle = definition.cardType === "CREATURE" && (
    trigger.includes("on_hit") ||
    trigger.includes("hit") ||
    text.includes("battle") ||
    actionType.includes("roll_for_effect") ||
    text.includes("attack damage")
  );

  if (shouldRunBattle) {
    const player = getPlayer(match, source.playerId);
    const attacker = player.field.primaryCreature?.cardId === plan.card.cardId
      ? player.field.primaryCreature
      : source.card;
    const opponent = getPlayer(match, findOpponentPlayerId(match, source.playerId));
    const defender = opponent.field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless battle needs a source primary and opponent primary creature.");
    }

    match.turn.activePlayerId = source.playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(source.playerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;
    let next = startManualBattleSession(match, source.playerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start manual battle", ok: true, detail: `${definition.name} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
    next = runPendingBattle(next, steps);
    return next;
  }

  const shouldRunMagicResponse = definition.cardType === "MAGIC" &&
    definition.magicType === "LIGHTNING" &&
    source.zone === "HAND" &&
    (
      trigger.includes("opponent_plays_magic") ||
      text.includes("opponent plays a magic") ||
      text.includes("lightning response")
    );

  if (shouldRunMagicResponse) {
    const triggerPlayerId = plan.setup.activePlayerId ?? findOpponentPlayerId(match, source.playerId);
    const triggerPlayer = getPlayer(match, triggerPlayerId);
    const preferredTriggerCardId = plan.setup.player2Cards?.find(cardId => {
      const candidate = match.cardCatalog[cardId];
      return candidate?.cardType === "MAGIC" && candidate.magicType !== "LIGHTNING";
    });
    const triggerCard = preferredTriggerCardId
      ? ensureCardInHand(match, triggerPlayerId, preferredTriggerCardId)
      : triggerPlayer.hand.find(card => {
        const candidate = match.cardCatalog[card.cardId];
        return candidate?.cardType === "MAGIC" && candidate.magicType !== "LIGHTNING" && card.cardId !== plan.card.cardId;
      });

    if (!triggerCard) {
      throw new Error("Headless Lightning response needs an opponent Magic card in hand to trigger the chain.");
    }

    match.turn.activePlayerId = triggerPlayerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(triggerPlayerId));
    match.turn.phase = "SUMMON_MAGIC";

    let next = playMagicFromHand(match, triggerPlayerId, triggerCard.instanceId);
    steps.push({ label: "play triggering magic from hand", ok: true, detail: match.cardCatalog[triggerCard.cardId]?.name ?? triggerCard.cardId });

    const response = findSource(next, plan.card.cardId);
    if (!response) {
      throw new Error(`No Lightning response card instance was found for ${plan.card.cardId}.`);
    }

    next = playLightningResponseFromHand(next, response.playerId, response.card.instanceId);
    steps.push({ label: "play lightning response from hand", ok: true, detail: definition.name });
    return next;
  }

  if (definition.cardType === "MAGIC" && source.zone === "HAND") {
    match.turn.activePlayerId = source.playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(source.playerId));
    match.turn.phase = "SUMMON_MAGIC";
    let next = playMagicFromHand(match, source.playerId, source.card.instanceId);
    steps.push({ label: "play magic from hand", ok: true, detail: definition.name });
    return next;
  }

  const shouldRunFieldAuraBattle = definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    (
      actionType.includes("damage_multiplier") ||
      text.includes("damage multiplier") ||
      text.includes("atk damage")
    );

  if (shouldRunFieldAuraBattle) {
    const playerId = plan.setup.activePlayerId ?? source.playerId;
    const player = getPlayer(match, playerId);
    const opponent = getPlayer(match, findOpponentPlayerId(match, playerId));
    const attacker = player.field.primaryCreature;
    const defender = opponent.field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless field aura battle needs active and opponent primary creatures.");
    }

    match.turn.activePlayerId = playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;
    let next = startManualBattleSession(match, playerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start field aura battle", ok: true, detail: `${definition.name}: ${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
    next = runPendingBattle(next, steps);
    return next;
  }

  if (plan.effect?.effectId) {
    const next = activateCardEffect(match, {
      playerId: source.playerId,
      sourceInstanceId: source.card.instanceId,
      effectId: plan.effect.effectId
    });
    steps.push({ label: "activate field/card effect", ok: true, detail: `${definition.name} ${plan.effect.effectId}` });
    return next;
  }

  throw new Error("No parsed effect id was available for headless testing.");
}

function runFollowupBattleForTemporaryHitOverride(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  if (!actionType.includes("temporary_hit_override")) return match;
  if (match.pendingChain || match.pendingEffectTargetPrompt || match.pendingEffectRoll || match.pendingBattle || match.pendingPrompt) return match;

  const playerId = plan.setup.activePlayerId ?? "player_1";
  const player = getPlayer(match, playerId);
  const attacker = player.field.primaryCreature;
  const opponent = getPlayer(match, findOpponentPlayerId(match, playerId));
  const defender = opponent.field.primaryCreature;

  if (!attacker || !defender) return match;

  match.turn.activePlayerId = playerId;
  match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
  match.turn.phase = "COMBAT";
  match.turn.firstTurnCycleComplete = true;

  let next = startManualBattleSession(match, playerId, attacker.instanceId, defender.instanceId);
  steps.push({ label: "start follow-up battle", ok: true, detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
  next = runPendingBattle(next, steps);
  return next;
}

function classifyVariant(args: {
  plan: LlmEffectTestPlan;
  variant: VariantConfig;
  before: MatchState;
  after: MatchState;
  startEventCount: number;
  startManualQueueCount: number;
  steps: RunStep[];
  error?: unknown;
}): LlmHeadlessVariantResult {
  const newEvents = args.after.eventLog.slice(args.startEventCount);
  const eventTypes = newEvents.map(event => event.type);
  const assertionResults = args.variant.name === "expected-success"
    ? evaluateAssertions(args.after, args.plan)
    : [];
  const assertionPasses = assertionResults.filter(result => result.status === "PASS").length;
  const assertionFailures = assertionResults.filter(result => result.status === "FAIL").length;
  const manualEffectQueueCount = args.after.manualEffectQueue?.length ?? 0;
  const newManualQueueCount = Math.max(0, manualEffectQueueCount - args.startManualQueueCount);
  const evidence: string[] = [];

  evidence.push(`Variant ${args.variant.name}: ${args.variant.description}`);
  evidence.push(`Before: ${summarizeMatch(args.before)}`);
  evidence.push(`After: ${summarizeMatch(args.after)}`);

  if (eventTypes.length > 0) {
    evidence.push(`Event log emitted ${eventTypes.length} event(s): ${eventTypes.join(", ")}.`);
  } else {
    evidence.push("No new runtime events were emitted after scenario setup.");
  }

  for (const step of args.steps) {
    evidence.push(`${step.ok ? "✓" : "✗"} ${step.label}${step.detail ? `: ${step.detail}` : ""}`);
  }

  if (assertionResults.length > 0) {
    evidence.push(`Assertions: ${assertionPasses} passed, ${assertionFailures} failed.`);
  }

  if (args.after.pendingEffectTargetPrompt) {
    evidence.push(`Unresolved target prompt remains: ${args.after.pendingEffectTargetPrompt.actionType} with ${args.after.pendingEffectTargetPrompt.options.length} option(s).`);
  }

  if (args.after.pendingPrompt) {
    evidence.push("Unresolved general prompt remains.");
  }

  if (args.after.pendingBattle) {
    evidence.push(`Unresolved battle remains: ${args.after.pendingBattle.status}.`);
  }

  if (args.after.pendingEffectRoll) {
    evidence.push(`Unresolved effect roll remains: ${args.after.pendingEffectRoll.status}.`);
  }

  if (newManualQueueCount > 0) {
    evidence.push(`${newManualQueueCount} manual fallback request(s) were queued.`);
  }

  if (args.error) {
    const message = args.error instanceof Error ? args.error.message : String(args.error);
    const unsupported = /unsupported|no runtime route|not supported|not have a supported/i.test(message);
    return {
      name: args.variant.name,
      status: unsupported ? "BLOCKED_RUNTIME" : "BROKEN",
      issueType: unsupported ? "UNSUPPORTED_ACTION_TYPE" : "NONE",
      summary: `Headless run stopped: ${message}`,
      evidence: [...evidence, message],
      eventTypes,
      assertionResults,
      beforeSummary: summarizeMatch(args.before),
      afterSummary: summarizeMatch(args.after),
      manualEffectQueueCount,
      pendingPrompt: args.after.pendingPrompt ? "General prompt pending" : undefined,
      pendingEffectTargetPrompt: args.after.pendingEffectTargetPrompt?.promptText
    };
  }

  if (newManualQueueCount > 0) {
    return {
      name: args.variant.name,
      status: "BLOCKED_RUNTIME",
      issueType: "UNSUPPORTED_ACTION_TYPE",
      summary: "Headless run reached manual fallback instead of a reusable runtime route.",
      evidence,
      eventTypes,
      assertionResults,
      beforeSummary: summarizeMatch(args.before),
      afterSummary: summarizeMatch(args.after),
      manualEffectQueueCount
    };
  }

  if (args.after.pendingEffectTargetPrompt || args.after.pendingPrompt || args.after.pendingBattle || args.after.pendingEffectRoll) {
    return {
      name: args.variant.name,
      status: "PARTIAL",
      issueType: args.after.pendingEffectTargetPrompt ? "MISSING_PROMPT" : "NONE",
      summary: "Headless run executed but left an unresolved prompt/session.",
      evidence,
      eventTypes,
      assertionResults,
      beforeSummary: summarizeMatch(args.before),
      afterSummary: summarizeMatch(args.after),
      manualEffectQueueCount,
      pendingPrompt: args.after.pendingPrompt ? "General prompt pending" : undefined,
      pendingEffectTargetPrompt: args.after.pendingEffectTargetPrompt?.promptText
    };
  }

  if (assertionResults.length > 0 && assertionFailures === 0) {
    return {
      name: args.variant.name,
      status: "WORKING",
      issueType: "NONE",
      summary: "Headless run completed and all generated assertions passed.",
      evidence,
      eventTypes,
      assertionResults,
      beforeSummary: summarizeMatch(args.before),
      afterSummary: summarizeMatch(args.after),
      manualEffectQueueCount
    };
  }

  if (eventTypes.length > 0 && assertionFailures === 0) {
    return {
      name: args.variant.name,
      status: assertionResults.length > 0 ? "WORKING" : "PARTIAL",
      issueType: "NONE",
      summary: assertionResults.length > 0
        ? "Headless run completed with runtime events and no failed assertions."
        : "Headless run completed with runtime events, but no assertions were available to prove full correctness.",
      evidence,
      eventTypes,
      assertionResults,
      beforeSummary: summarizeMatch(args.before),
      afterSummary: summarizeMatch(args.after),
      manualEffectQueueCount
    };
  }

  return {
    name: args.variant.name,
    status: assertionFailures > 0 ? "BROKEN" : "PARTIAL",
    issueType: assertionFailures > 0 ? "NONE" : "MISSING_PROMPT",
    summary: assertionFailures > 0
      ? "Headless run completed but one or more expected assertions failed."
      : "Headless run completed but did not emit enough evidence to confirm the effect.",
    evidence,
    eventTypes,
    assertionResults,
    beforeSummary: summarizeMatch(args.before),
    afterSummary: summarizeMatch(args.after),
    manualEffectQueueCount
  };
}

function combineVariantStatuses(variants: LlmHeadlessVariantResult[]) {
  const success = variants.find(variant => variant.name === "expected-success") ?? variants[0];
  const statuses = variants.map(variant => variant.status);

  if (!success) {
    return { status: "BROKEN" as const, issueType: "NONE" as const, summary: "No headless variants were executed." };
  }

  if (success.status === "WORKING" && statuses.every(status => status === "WORKING" || status === "PARTIAL")) {
    return { status: "WORKING" as const, issueType: "NONE" as const, summary: "Expected-success route worked; control variants did not expose a hard failure." };
  }

  if (success.status === "WORKING" || statuses.includes("WORKING")) {
    return { status: "PARTIAL" as const, issueType: success.issueType, summary: "At least one headless route worked, but another route needs review." };
  }

  if (statuses.every(status => status === "BLOCKED_RUNTIME")) {
    return { status: "BLOCKED_RUNTIME" as const, issueType: "UNSUPPORTED_ACTION_TYPE" as const, summary: "All headless routes were blocked by missing runtime support." };
  }

  if (statuses.includes("BROKEN")) {
    return { status: "BROKEN" as const, issueType: success.issueType, summary: "Headless route executed but produced errors or failed assertions." };
  }

  return { status: success.status, issueType: success.issueType, summary: success.summary };
}

function runVariant(args: {
  baseMatch: MatchState;
  plan: LlmEffectTestPlan;
  effect?: WardEngineEffect;
  variant: VariantConfig;
}): { match: MatchState; result: LlmHeadlessVariantResult } {
  let match = cloneMatch(args.baseMatch);
  const before = cloneMatch(match);
  const steps: RunStep[] = [];
  let error: unknown;
  const startEventCount = match.eventLog.length;
  const startManualQueueCount = match.manualEffectQueue?.length ?? 0;

  try {
    applyPlanAndVariantRolls(match, args.plan, args.variant);
    match = runInitialAction(match, args.plan, args.effect, steps);
    match = drainAllAutomation(match, args.variant, steps);
    match = runFollowupBattleForTemporaryHitOverride(match, args.plan, args.effect, steps);
    match = drainAllAutomation(match, args.variant, steps);
  } catch (caught) {
    error = caught;
  }

  const result = classifyVariant({
    plan: args.plan,
    variant: args.variant,
    before,
    after: match,
    startEventCount,
    startManualQueueCount,
    steps,
    error
  });

  return { match, result };
}

export function runLlmHeadlessEffectTest(args: {
  cardCatalog: Record<string, CardDefinition>;
  plan: LlmEffectTestPlan;
}): { match: MatchState; result: LlmDirectEffectSmokeTestResult } {
  const effect = findEffect(args.cardCatalog, args.plan);
  let baseMatch = createEffectTestScenarioMatch({
    cardCatalog: args.cardCatalog,
    cardId: args.plan.card.cardId,
    effectId: args.plan.effect?.effectId
  });

  baseMatch.setup.decksShuffled = true;
  baseMatch.turn.activePlayerId = args.plan.setup.activePlayerId ?? "player_1";
  baseMatch.turn.currentTurnIndex = Math.max(0, baseMatch.turn.currentTurnOrder.indexOf(baseMatch.turn.activePlayerId));
  baseMatch.turn.phase = args.plan.setup.phase ?? baseMatch.turn.phase;
  baseMatch.turn.firstTurnCycleComplete = true;
  baseMatch.players.forEach(player => {
    player.turnFlags.hasTakenFirstTurn = true;
    baseMatch.setup.firstTurnDrawsByPlayer[player.id] = true;
  });

  ensurePlanSetupCards(baseMatch, args.plan);
  prepareScenarioTargets(baseMatch, args.plan, effect);
  ensureSourceOnPlayZone(baseMatch, args.plan, effect);

  const variants = buildVariants(args.plan, effect);
  const variantResults: LlmHeadlessVariantResult[] = [];
  let representativeMatch = baseMatch;

  for (const variant of variants) {
    const { match, result } = runVariant({
      baseMatch,
      plan: args.plan,
      effect,
      variant
    });
    variantResults.push(result);
    if (variant.name === "expected-success") {
      representativeMatch = match;
    }
  }

  const combined = combineVariantStatuses(variantResults);
  const successVariant = variantResults.find(variant => variant.name === "expected-success") ?? variantResults[0];
  const allEventTypes = Array.from(new Set(variantResults.flatMap(variant => variant.eventTypes)));
  const evidence = [
    `Headless LLM runner tested ${variantResults.length} route(s) using real engine actions, battle rolls, effect rolls, chain priority passes, and prompt resolution.`,
    ...variantResults.flatMap(variant => [
      `${variant.name}: ${variant.status} — ${variant.summary}`,
      ...variant.evidence.slice(0, 12).map(item => `  ${item}`)
    ])
  ];

  const result: LlmDirectEffectSmokeTestResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    key: `${args.plan.card.packId}:${args.plan.card.cardId}:${args.plan.effect?.effectId ?? "NO_EFFECT"}`,
    matchId: representativeMatch.matchId,
    cardId: args.plan.card.cardId,
    cardName: args.plan.card.cardName,
    effectId: args.plan.effect?.effectId,
    status: combined.status,
    issueType: combined.issueType,
    summary: combined.summary,
    evidence,
    eventTypes: allEventTypes,
    pendingPrompt: successVariant?.pendingPrompt,
    pendingEffectTargetPrompt: successVariant?.pendingEffectTargetPrompt,
    manualEffectQueueCount: successVariant?.manualEffectQueueCount ?? 0,
    runMode: "HEADLESS_ENGINE",
    variantResults,
    beforeSummary: successVariant?.beforeSummary,
    afterSummary: successVariant?.afterSummary,
    assertionResults: successVariant?.assertionResults ?? []
  };

  representativeMatch.eventLog.push({
    id: `llm-headless-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: representativeMatch.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "LLM_HEADLESS_EFFECT_TEST_COMPLETED",
    payload: {
      cardId: args.plan.card.cardId,
      cardName: args.plan.card.cardName,
      effectId: args.plan.effect?.effectId,
      status: result.status,
      issueType: result.issueType,
      variantCount: variantResults.length,
      summary: result.summary
    }
  });

  return { match: representativeMatch, result };
}
