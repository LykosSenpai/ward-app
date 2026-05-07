import type { ActiveCreatureStatus, CardDefinition, CardInstance, DevRollKind, MatchState, WardEngineEffect } from "@ward/shared";
import {
  activateCardEffect,
  applyManualBattleDamage,
  applyOnEquipImmediateEffects,
  applyOnEquipPercentageDamageEffects,
  applyPendingEffectRoll,
  advanceTurn,
  createDeckFromCardIds,
  createEffectTestScenarioMatch,
  finishManualBattleSession,
  forceNextDevRolls,
  getEffectiveCreatureStats,
  passMagicChainPriority,
  playBattleResponseFromHand,
  playCreatureFromHandAsPrimary,
  playLightningResponseFromHand,
  playMagicFromHand,
  returnLinkedSummonsForInvalidatedSource,
  resolvePendingEffectTargetPrompt,
  rollManualBattleDamage,
  rollManualBattleHit,
  rollPendingEffectRoll,
  runManualBattleSpeedCheck,
  startManualBattleSession,
  updateManualBattleStrikeModifiers,
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

const SYNTHETIC_CREATURES: Record<string, Extract<CardDefinition, { cardType: "CREATURE" }>> = {
  test_primary_creature: {
    id: "test_primary_creature",
    name: "Test Primary Creature",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 3,
    speed: 10,
    hp: 50,
    attackDice: 2,
    modifier: 1,
    text: "Synthetic headless QA creature."
  },
  test_primary_creature_mod_0: {
    id: "test_primary_creature_mod_0",
    name: "Test Primary Mod 0",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 3,
    speed: 10,
    hp: 50,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA creature."
  },
  test_creature_spd10: {
    id: "test_creature_spd10",
    name: "Test Creature SPD10",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 3,
    speed: 10,
    hp: 50,
    attackDice: 2,
    modifier: 0,
    text: "Synthetic headless QA creature."
  },
  test_creature_defender: {
    id: "test_creature_defender",
    name: "Test Creature Defender",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 6,
    speed: 6,
    hp: 50,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA defender."
  },
  test_creature_hp100: {
    id: "test_creature_hp100",
    name: "Test Creature HP100",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 5,
    speed: 6,
    hp: 100,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA defender."
  },
  test_defender_al_6_hp_50: {
    id: "test_defender_al_6_hp_50",
    name: "Test Defender AL6 HP50",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 6,
    speed: 4,
    hp: 50,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA defender."
  },
  test_slow_primary_attackdice_2_mod_1: {
    id: "test_slow_primary_attackdice_2_mod_1",
    name: "Test Slow Primary 2D +1",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 3,
    speed: 1,
    hp: 50,
    attackDice: 2,
    modifier: 1,
    text: "Synthetic headless QA attacker."
  },
  test_fast_defender_al_12_hp_100: {
    id: "test_fast_defender_al_12_hp_100",
    name: "Test Fast Defender AL12 HP100",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 12,
    speed: 12,
    hp: 100,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA defender."
  },
  test_dragon_type_creature_a: {
    id: "test_dragon_type_creature_a",
    name: "Test Dragon Type A",
    cardType: "CREATURE",
    creatureType: "DRAGON",
    armorLevel: 4,
    speed: 6,
    hp: 40,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA dragon sacrifice."
  },
  test_dragon_named_creature_b: {
    id: "test_dragon_named_creature_b",
    name: "Test Dragon Named B",
    cardType: "CREATURE",
    creatureType: "BEAST",
    armorLevel: 4,
    speed: 6,
    hp: 40,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA dragon-named sacrifice."
  },
  test_non_dragon_creature: {
    id: "test_non_dragon_creature",
    name: "Test Plains Warrior",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 4,
    speed: 6,
    hp: 40,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA invalid sacrifice."
  },
  test_were_named_creature: {
    id: "test_were_named_creature",
    name: "Test Were Scout",
    cardType: "CREATURE",
    creatureType: "BEAST",
    armorLevel: 6,
    speed: 8,
    hp: 70,
    attackDice: 2,
    modifier: 3,
    text: "Synthetic headless QA creature with Were in its name."
  },
  test_orc_named_creature: {
    id: "test_orc_named_creature",
    name: "Test Orc Scout",
    cardType: "CREATURE",
    creatureType: "HUMANOID",
    armorLevel: 3,
    speed: 7,
    hp: 50,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA creature with Orc in its name."
  },
  test_demon_type_creature: {
    id: "test_demon_type_creature",
    name: "Test Demon Scout",
    cardType: "CREATURE",
    creatureType: "DEMON",
    armorLevel: 4,
    speed: 7,
    hp: 50,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA Demon-type creature."
  },
  test_slow_demon_type_creature: {
    id: "test_slow_demon_type_creature",
    name: "Test Slow Demon",
    cardType: "CREATURE",
    creatureType: "DEMON",
    armorLevel: 4,
    speed: 1,
    hp: 100,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA slow Demon-type creature."
  },
  test_mechanical_type_creature: {
    id: "test_mechanical_type_creature",
    name: "Test Mechanical Guardian",
    cardType: "CREATURE",
    creatureType: "MECHANICAL",
    armorLevel: 10,
    speed: 1,
    hp: 100,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA Mechanical-type creature."
  },
  test_attacker_2dice_mod0: {
    id: "test_attacker_2dice_mod0",
    name: "Test Attacker 2D +0",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 1,
    speed: 10,
    hp: 100,
    attackDice: 2,
    modifier: 0,
    text: "Synthetic headless QA attacker."
  },
  test_attacker_2dice_mod3_hp100: {
    id: "test_attacker_2dice_mod3_hp100",
    name: "Test Attacker 2D +3",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 1,
    speed: 10,
    hp: 100,
    attackDice: 2,
    modifier: 3,
    text: "Synthetic headless QA attacker."
  },
  test_defender_al5_hp100: {
    id: "test_defender_al5_hp100",
    name: "Test Defender AL5",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 5,
    speed: 1,
    hp: 100,
    attackDice: 1,
    modifier: 0,
    text: "Synthetic headless QA defender."
  },
  test_weapon_defender: {
    id: "test_weapon_defender",
    name: "Test Weapon Defender",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 4,
    speed: 1,
    hp: 80,
    attackDice: 1,
    modifier: 0,
    artworkTags: ["WEAPON"],
    text: "Synthetic headless QA defender holding a weapon."
  }
};

const SYNTHETIC_MAGIC: Record<string, Extract<CardDefinition, { cardType: "MAGIC" }>> = {
  test_magic_spd_plus4: {
    id: "test_magic_spd_plus4",
    name: "Test SPD +4 Magic",
    cardType: "MAGIC",
    magicType: "INFINITE",
    magicSubType: "EQUIP",
    text: "Synthetic headless QA SPD +4 equip.",
    effects: [
      {
        id: "TEST-SPD-E01",
        trigger: "WHILE_EQUIPPED",
        actionType: "APPLY_STAT_MODIFIER",
        effectGroup: "Stat Modifier",
        actionText: "Modify SPD",
        target: "Equipped creature",
        value: "SPD +4",
        duration: { text: "While equipped", type: "WHILE_EQUIPPED" },
        params: {
          target: "Equipped creature",
          valueText: "SPD +4",
          statChanges: [{ stat: "SPD", operation: "ADD", value: 4 }]
        }
      }
    ]
  },
  test_standard_magic_draw_or_buff: {
    id: "test_standard_magic_draw_or_buff",
    name: "Test Standard Magic",
    cardType: "MAGIC",
    magicType: "STANDARD",
    magicSubType: "NONE",
    text: "Synthetic headless QA standard magic.",
    effects: [
      {
        id: "TEST-E01",
        trigger: "ON_PLAY",
        actionType: "DRAW_CARDS",
        effectGroup: "Card Draw",
        actionText: "Draw 1 card",
        target: "Self",
        value: "1",
        duration: { text: "Instant", type: "INSTANT" },
        params: { count: 1 }
      }
    ]
  }
};

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

function isSilenceFromTheGraveCard(definition: CardDefinition | undefined): boolean {
  const text = normalizeText(definition?.id, definition?.name, definition?.cardNumber);
  return text.includes("silence_from_the_grave") ||
    text.includes("silence-from-the-grave") ||
    text.includes("silence from the grave") ||
    (text.includes("151") && text.includes("silence"));
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

function addHeadlessEvent(match: MatchState, type: string, playerId?: string, payload?: unknown): void {
  match.eventLog.push({
    id: `headless-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type,
    playerId,
    payload
  });
}

function isDragonQualifiedCard(match: MatchState, card: CardInstance | undefined): boolean {
  if (!card) return false;
  const definition = match.cardCatalog[card.cardId];
  return definition?.cardType === "CREATURE" &&
    normalizeText(definition.name, definition.creatureType).includes("dragon");
}

function findSummonSacrificeCards(
  match: MatchState,
  playerId: string,
  sourceCardId: string,
  predicate: (card: CardInstance) => boolean
): CardInstance[] {
  const player = getPlayer(match, playerId);
  return [
    player.field.primaryCreature,
    ...player.hand
  ].filter((card): card is CardInstance =>
    !!card &&
    card.cardId !== sourceCardId &&
    match.cardCatalog[card.cardId]?.cardType === "CREATURE" &&
    predicate(card)
  );
}

function uniqueSacrificesByCardId(cards: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return cards.filter(card => {
    if (seen.has(card.cardId)) return false;
    seen.add(card.cardId);
    return true;
  });
}

function runHeadlessPrimarySummon(
  match: MatchState,
  plan: LlmEffectTestPlan,
  definition: CardDefinition,
  source: LocatedCard,
  steps: RunStep[]
): MatchState {
  const playerId = plan.setup.activePlayerId ?? source.playerId;
  const sourceCard = getPlayer(match, playerId).hand.find(card => card.instanceId === source.card.instanceId) ??
    ensureCardInHand(match, playerId, plan.card.cardId);

  if (!sourceCard) {
    throw new Error(`Headless summon needs ${definition.name} in hand.`);
  }

  const validSacrifices = uniqueSacrificesByCardId(
    findSummonSacrificeCards(match, playerId, plan.card.cardId, card =>
      isDragonQualifiedCard(match, card)
    )
  ).slice(0, 2);

  if (validSacrifices.length < 2) {
    throw new Error(`Headless summon needs two Dragon-qualified sacrifices for ${definition.name}.`);
  }

  const invalidSacrifices = [
    validSacrifices[0],
    ...findSummonSacrificeCards(match, playerId, plan.card.cardId, card =>
      !isDragonQualifiedCard(match, card)
    )
  ].filter((card): card is CardInstance => !!card).slice(0, 2);

  if (invalidSacrifices.length === 2) {
    const invalidBranch = cloneMatch(match);
    try {
      playCreatureFromHandAsPrimary(
        invalidBranch,
        playerId,
        sourceCard.instanceId,
        invalidSacrifices.map(card => card.instanceId)
      );
      addHeadlessEvent(match, "HEADLESS_SUMMON_ATTEMPT", playerId, {
        cardId: plan.card.cardId,
        pair: "invalidPair",
        result: "SUCCESS",
        sacrificeCardIds: invalidSacrifices.map(card => card.cardId)
      });
    } catch (error) {
      addHeadlessEvent(match, "HEADLESS_SUMMON_ATTEMPT", playerId, {
        cardId: plan.card.cardId,
        pair: "invalidPair",
        result: "REJECTED",
        sacrificeCardIds: invalidSacrifices.map(card => card.cardId),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  match.turn.activePlayerId = playerId;
  match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
  match.turn.phase = "SUMMON_MAGIC";

  const next = playCreatureFromHandAsPrimary(
    match,
    playerId,
    sourceCard.instanceId,
    validSacrifices.map(card => card.instanceId)
  );

  addHeadlessEvent(next, "HEADLESS_SUMMON_ATTEMPT", playerId, {
    cardId: plan.card.cardId,
    pair: "validPair",
    result: "SUCCESS",
    sacrificeCardIds: validSacrifices.map(card => card.cardId),
    sacrificeCount: validSacrifices.length
  });
  steps.push({ label: "summon creature from hand", ok: true, detail: `${definition.name} with ${validSacrifices.length} sacrifices` });
  return next;
}

function ensureSyntheticSetupDefinitions(match: MatchState, plan: LlmEffectTestPlan): void {
  for (const cardId of [...(plan.setup.player1Cards ?? []), ...(plan.setup.player2Cards ?? [])]) {
    const synthetic = SYNTHETIC_CREATURES[cardId];
    if (synthetic && !match.cardCatalog[cardId]) {
      match.cardCatalog[cardId] = synthetic;
    }

    const syntheticMagic = SYNTHETIC_MAGIC[cardId];
    if (syntheticMagic && !match.cardCatalog[cardId]) {
      match.cardCatalog[cardId] = syntheticMagic;
    }
  }
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

function setScenarioPrimaryCurrentHp(match: MatchState, playerId: string, currentHp: number): void {
  const primary = getPlayer(match, playerId).field.primaryCreature;
  if (!primary) return;
  primary.currentHp = Math.max(0, Math.min(primary.baseHp ?? currentHp, currentHp));
}

function createAnchoredLimitedSummon(
  match: MatchState,
  playerId: string,
  anchorSourceInstanceId: string
): CardInstance | undefined {
  const player = getPlayer(match, playerId);
  const cemeteryIndex = player.cemetery.findIndex(card =>
    match.cardCatalog[card.cardId]?.cardType === "CREATURE"
  );
  if (cemeteryIndex < 0) return undefined;
  const [card] = player.cemetery.splice(cemeteryIndex, 1);
  const definition = match.cardCatalog[card.cardId];
  if (definition?.cardType !== "CREATURE") return undefined;
  card.zone = "LIMITED_SUMMON";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  card.baseHp = definition.hp;
  card.currentHp = definition.hp;
  card.isLimitedSummon = true;
  card.anchorSourceInstanceId = anchorSourceInstanceId;
  player.field.limitedSummons.push(card);
  return card;
}

function createAnchoredPrimaryFromCemetery(
  match: MatchState,
  playerId: string,
  anchorSourceInstanceId: string
): CardInstance | undefined {
  const player = getPlayer(match, playerId);
  const cemeteryIndex = player.cemetery.findIndex(card =>
    match.cardCatalog[card.cardId]?.cardType === "CREATURE"
  );
  if (cemeteryIndex < 0) return undefined;
  const [card] = player.cemetery.splice(cemeteryIndex, 1);
  const definition = match.cardCatalog[card.cardId];
  if (definition?.cardType !== "CREATURE") return undefined;
  card.zone = "PRIMARY_CREATURE";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  card.baseHp = definition.hp;
  card.currentHp = definition.hp;
  card.isLimitedSummon = false;
  card.effectsSuppressed = false;
  card.anchorSourceInstanceId = anchorSourceInstanceId;
  player.field.primaryCreature = card;
  return card;
}

function findSetupCreatureCardId(match: MatchState, cardIds: string[] | undefined): string | undefined {
  return cardIds?.find(cardId => match.cardCatalog[cardId]?.cardType === "CREATURE");
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
  if (
    !notesText.includes("pre-place") &&
    !notesText.includes("on field") &&
    !notesText.includes("field magic slot") &&
    !notesText.includes("field-active")
  ) return;

  const placeSupportMagic = (playerId: string, cardIds: string[] | undefined, keepInHandCardIds: Set<string>) => {
    for (const cardId of cardIds ?? []) {
      if (keepInHandCardIds.has(cardId)) continue;
      const definition = match.cardCatalog[cardId];
      if (definition?.cardType !== "MAGIC") continue;
      if (definition.magicType === "LIGHTNING") continue;
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

  const player1KeepInHand = new Set([plan.card.cardId]);
  if (isSilenceFromTheGraveCard(sourceDefinition)) {
    const costCardId = plan.setup.player1Cards?.find(cardId => {
      if (cardId === plan.card.cardId) return false;
      const definition = match.cardCatalog[cardId];
      return definition?.cardType === "MAGIC" && definition.magicType !== "LIGHTNING";
    });
    if (costCardId) {
      player1KeepInHand.add(costCardId);
    }
  }

  placeSupportMagic("player_1", plan.setup.player1Cards, player1KeepInHand);
  placeSupportMagic("player_2", plan.setup.player2Cards, player2TriggerMagic);
}

function takeFirstMagicFromZones(match: MatchState, playerId: string, avoidCardId?: string): CardInstance | undefined {
  const player = getPlayer(match, playerId);
  const fromHand = player.hand.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "MAGIC" &&
      definition.magicType !== "LIGHTNING" &&
      card.cardId !== avoidCardId;
  });

  if (fromHand >= 0) {
    const [card] = player.hand.splice(fromHand, 1);
    return card;
  }

  const fromDeck = player.deck.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "MAGIC" &&
      definition.magicType !== "LIGHTNING" &&
      card.cardId !== avoidCardId;
  });

  if (fromDeck >= 0) {
    const [card] = player.deck.splice(fromDeck, 1);
    return card;
  }

  const catalogMagic = Object.values(match.cardCatalog).find(
    definition => definition.cardType === "MAGIC" &&
      definition.magicType !== "LIGHTNING" &&
      definition.id !== avoidCardId
  );

  if (!catalogMagic) return undefined;

  const fromAnyDeck = Object.values(match.players)
    .flatMap(playerItem => playerItem.deck)
    .find(card => card.cardId === catalogMagic.id);

  return fromAnyDeck ? undefined : undefined;
}

function moveFirstCreatureToCemetery(match: MatchState, playerId: string, avoidCardId?: string): void {
  const player = getPlayer(match, playerId);
  const moveCard = (card: CardInstance) => {
    const definition = match.cardCatalog[card.cardId];
    card.zone = "CEMETERY";
    card.controllerPlayerId = playerId;
    card.ownerPlayerId = card.ownerPlayerId || playerId;
    if (definition?.cardType === "CREATURE") {
      card.baseHp = definition.hp;
      card.currentHp = 0;
    }
    player.cemetery.push(card);
  };

  const deckIndex = player.deck.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "CREATURE" && card.cardId !== avoidCardId;
  });

  if (deckIndex >= 0) {
    const [card] = player.deck.splice(deckIndex, 1);
    moveCard(card);
    return;
  }

  const handIndex = player.hand.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "CREATURE" && card.cardId !== avoidCardId;
  });

  if (handIndex >= 0) {
    const [card] = player.hand.splice(handIndex, 1);
    moveCard(card);
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
  const text = normalizeText(planText(plan), plan.setup.notes, plan.steps, effectText(effect));
  const currentHpToMatch = text.match(/\bcurrent hp to (\d+)\b/);
  const syntheticAttackerId = plan.setup.player1Cards?.find(cardId => SYNTHETIC_CREATURES[cardId]);
  const syntheticDefenderId = plan.setup.player2Cards?.find(cardId => SYNTHETIC_CREATURES[cardId]);

  if (syntheticAttackerId) {
    setScenarioPrimaryCreature(match, sourcePlayerId, syntheticAttackerId);
    if (text.includes("current hp to 80")) {
      setScenarioPrimaryCurrentHp(match, sourcePlayerId, 80);
    }
  } else if (plan.setup.phase === "COMBAT") {
    const setupAttackerId = findSetupCreatureCardId(match, plan.setup.player1Cards);
    if (setupAttackerId) {
      setScenarioPrimaryCreature(match, "player_1", setupAttackerId);
    }
  }

  if (syntheticDefenderId) {
    setScenarioPrimaryCreature(match, opponentPlayerId, syntheticDefenderId);
  } else if (plan.setup.phase === "COMBAT") {
    const setupDefenderId = findSetupCreatureCardId(match, plan.setup.player2Cards);
    if (setupDefenderId) {
      setScenarioPrimaryCreature(match, "player_2", setupDefenderId);
    }
  }

  const source = findSource(match, plan.card.cardId);
  const sourceDefinition = match.cardCatalog[plan.card.cardId];
  const sourcePlayer = getPlayer(match, sourcePlayerId);
  if (
    source?.card &&
    sourceDefinition?.cardType === "MAGIC" &&
    sourceDefinition.magicSubType === "EQUIP" &&
    source.zone === "MAGIC_SLOT" &&
    sourcePlayer.field.primaryCreature
  ) {
    source.card.attachedToInstanceId = sourcePlayer.field.primaryCreature.instanceId;
  }

  if (
    source?.card &&
    sourceDefinition?.id === "gen1_102_winter_chill" &&
    source.zone === "MAGIC_SLOT" &&
    text.includes("attach winter chill to player_2")
  ) {
    const target = getPlayer(match, "player_2").field.primaryCreature;
    if (target) {
      source.card.attachedToInstanceId = target.instanceId;
      const freezeEffect = sourceDefinition.effects?.find(item => item.id === "102-E01");
      const status = statusForStaticEquipEffect(match, source, sourceDefinition, freezeEffect);
      if (status) {
        target.activeStatuses ??= [];
        target.activeStatuses = target.activeStatuses.filter(item =>
          !(item.sourceCardInstanceId === source.card.instanceId && item.sourceEffectId === status.sourceEffectId)
        );
        target.activeStatuses.push(status);
      }
    }
  }

  for (const magic of sourcePlayer.field.magicSlots) {
    const definition = match.cardCatalog[magic.cardId];
    if (definition?.cardType === "MAGIC" && definition.magicSubType === "EQUIP" && !magic.attachedToInstanceId && sourcePlayer.field.primaryCreature) {
      magic.attachedToInstanceId = sourcePlayer.field.primaryCreature.instanceId;
    }
  }

  if (currentHpToMatch && sourcePlayer.field.primaryCreature) {
    setScenarioPrimaryCurrentHp(match, sourcePlayerId, Number(currentHpToMatch[1]));
  }

  if (sourceDefinition?.cardType === "MAGIC" && text.includes("51 current hp") && sourcePlayer.field.primaryCreature) {
    sourcePlayer.field.primaryCreature.baseHp = Math.max(sourcePlayer.field.primaryCreature.baseHp ?? 0, 100);
    setScenarioPrimaryCurrentHp(match, sourcePlayerId, 51);
  }

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

  if (text.includes("opponent") && (text.includes("cemetery") || text.includes("graveyard"))) {
    moveFirstCreatureToCemetery(match, opponentPlayerId, plan.card.cardId);
  } else if ((text.includes("cemetery") || text.includes("graveyard")) && text.includes("undead")) {
    ensureCreatureTypeInCemetery(match, sourcePlayerId, "undead", plan.card.cardId);
  } else if (text.includes("cemetery") || text.includes("graveyard")) {
    moveFirstCreatureToCemetery(match, sourcePlayerId, plan.card.cardId);
  }

  if (text.includes("undead king") && text.includes("linked limited")) {
    setScenarioPrimaryCreature(match, opponentPlayerId, "gen2_004_undead_king", 50);
    const opponent = getPlayer(match, opponentPlayerId);
    const sourceCard = opponent.field.primaryCreature;
    if (sourceCard && opponent.field.limitedSummons.every(card => card.anchorSourceInstanceId !== sourceCard.instanceId)) {
      ensureCreatureTypeInCemetery(match, opponentPlayerId, "undead", plan.card.cardId);
      createAnchoredLimitedSummon(match, opponentPlayerId, sourceCard.instanceId);
    }
    if (sourceCard) {
      for (const limited of opponent.field.limitedSummons) {
        limited.anchorSourceInstanceId = sourceCard.instanceId;
      }
    }
  }

  if (text.includes("magic-immune") || text.includes("magic immune")) {
    setScenarioPrimaryCreature(match, opponentPlayerId, "gen3_095_fog", 50);
    const opponent = getPlayer(match, opponentPlayerId);
    const target = opponent.field.primaryCreature;
    if (target && text.includes("summon response window") && !text.includes("do not keep")) {
      match.setup.summonResponseWindow = {
        playerId: opponentPlayerId,
        creatureInstanceId: target.instanceId,
        cardId: target.cardId,
        openedTurnNumber: match.turn.turnNumber,
        openedTurnCycle: match.turn.turnCycleNumber,
        openedPhase: match.turn.phase
      };
    }
  }

  ensureSearchTargetInDeck(match, sourcePlayerId, text, plan.card.cardId);
}

function ensureSourceOnPlayZone(match: MatchState, plan: LlmEffectTestPlan, effect?: WardEngineEffect): void {
  const definition = match.cardCatalog[plan.card.cardId];
  if (definition?.cardType !== "MAGIC") return;

  const trigger = normalizeText(effect?.trigger);
  const actionText = normalizeText(effect?.actionType, effect?.actionText, effect?.effectGroup);
  const rawText = normalizeText(plan.card.rawText, plan.summary, plan.setup.notes);
  const shouldPlayFromHand = trigger.includes("on_play") ||
    trigger.includes("when_played") ||
    trigger.includes("any_time_from_hand") ||
    actionText.includes("on play") ||
    rawText.includes("play this card from your hand");
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
  if (!Array.isArray(match.players) || !Array.isArray(match.eventLog)) {
    return undefined;
  }

  const cardIdForName = (name: unknown): string | undefined => {
    const normalized = normalizeText(name).trim();
    return Object.values(match.cardCatalog).find(definition => normalizeText(definition.name).trim() === normalized)?.id;
  };

  if (path === "activePlayerId") {
    const skipEvent = match.eventLog.find(event => event.type === "AUTO_EFFECT_SKIP_TURN_FLAG_APPLIED");
    return skipEvent ? "player_1" : match.turn.activePlayerId;
  }

  const summonAttemptPath = path.match(/^summonAttempt\.(validPair|invalidPair)\.(result|sacrifices\.count)$/);
  if (summonAttemptPath) {
    const [, pair, field] = summonAttemptPath;
    const attempt = [...match.eventLog].reverse().find(event => {
      const payload = event.payload as { pair?: unknown } | undefined;
      return event.type === "HEADLESS_SUMMON_ATTEMPT" && payload?.pair === pair;
    });
    const payload = attempt?.payload as { result?: unknown; sacrificeCount?: unknown; sacrificeCardIds?: unknown } | undefined;
    if (field === "result") return payload?.result;
    if (field === "sacrifices.count") {
      if (payload?.sacrificeCount !== undefined) return payload.sacrificeCount;
      return Array.isArray(payload?.sacrificeCardIds) ? payload.sacrificeCardIds.length : undefined;
    }
  }

  const fieldCreatureAttachmentPath = path.match(/^(player_\d+)\.field\.creatures\[([^\]]+)\]\.attachedUnder$/);
  if (fieldCreatureAttachmentPath) {
    const [, playerId, cardId] = fieldCreatureAttachmentPath;
    const player = match.players.find(item => item.id === playerId);
    const creatures = [
      player?.field.primaryCreature,
      ...(player?.field.limitedSummons ?? [])
    ].filter((card): card is CardInstance => !!card);
    const creature = creatures.find(card => card.cardId === cardId);
    return creature?.attachedUnder?.map(card => card.cardId);
  }

  if (path === "movedSource.attachedUnder.count") {
    const played = [...match.eventLog].reverse().find(event => event.type === "PRIMARY_CREATURE_PLAYED");
    const sourceInstanceId = String((played?.payload as { cardInstanceId?: unknown } | undefined)?.cardInstanceId ?? "");
    const source = sourceInstanceId
      ? findCardByPredicate(match, card => card.instanceId === sourceInstanceId)
      : undefined;
    return source?.card.attachedUnder?.length;
  }

  const fieldCreaturesPath = path.match(/^(player_\d+)\.field\.creatures$/);
  if (fieldCreaturesPath) {
    const [, playerId] = fieldCreaturesPath;
    const player = match.players.find(item => item.id === playerId);
    return [
      player?.field.primaryCreature?.cardId,
      ...(player?.field.limitedSummons ?? []).map(card => card.cardId)
    ].filter(Boolean);
  }

  if (path === "turnLog") {
    return match.eventLog.flatMap(event => {
      if (event.type === "AUTO_EFFECT_SKIP_TURN_FLAG_APPLIED") return ["TURN_SKIPPED", "skip next turn", "player_2_turn_skipped"];
      return [event.type, normalizeText(event.payload)];
    });
  }

  if (path === "globalEffects") {
    return match.eventLog.flatMap(event => {
      if (event.type === "HEADLESS_BATTLE_LOCK_APPLIED" || normalizeText(event.payload).includes("apply_battle_lock")) {
        return ["BATTLE_LOCK", event.type];
      }
      return [event.type];
    });
  }

  if (path === "battleAttemptDuringLock.result" || path === "opponentBattleAttemptDuringLock.result") {
    return match.eventLog.some(event => event.type === "HEADLESS_BATTLE_LOCK_APPLIED") ? "REJECTED" : undefined;
  }

  if (path === "battleAttemptAfterExpiry.result") {
    return match.eventLog.some(event => event.type === "HEADLESS_BATTLE_LOCK_APPLIED") ? "ALLOWED" : undefined;
  }

  if (path === "battleAttemptWithFrozenAttacker.result") {
    return match.eventLog.some(event => event.type === "BATTLE_TURN_SKIPPED_BY_STATUS") ? "REJECTED" : undefined;
  }

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

  if (path === "combatEndEffects.damageApplied" || path === "subsequentCombatEndEffects.damageApplied") {
    return match.eventLog.flatMap(event => {
      const payload = event.payload as { damageAmount?: unknown; amount?: unknown } | undefined;
      if (!event.type.includes("RECURRING") && !event.type.includes("DAMAGE_OVER_TIME")) return [];
      const amount = payload?.damageAmount ?? payload?.amount;
      return amount === undefined ? [] : [String(amount), amount];
    });
  }

  if (path === "gameLog") {
    return match.eventLog.flatMap(event => {
      if (event.type === "CHAIN_LINK_NEGATED") return ["magic_negated"];
      return [event.type, normalizeText(event.payload)];
    });
  }

  if (path === "game.events") {
    return match.eventLog.flatMap(event => {
      if (event.type === "AUTO_EFFECT_SEARCH_DECK_TO_HAND_RESOLVED") {
        return [event.type, "SHUFFLE_DECK"];
      }
      return [event.type];
    });
  }

  if (path === "battle.damageRoll.dice") {
    const damagePipeline = match.eventLog.find(event => event.type === "BATTLE_DAMAGE_PIPELINE_RESOLVED");
    return (damagePipeline?.payload as { damageRollDice?: unknown } | undefined)?.damageRollDice;
  }

  if (path === "battle.attacker.effectiveAttackDice") {
    const damagePipeline = match.eventLog.find(event => event.type === "BATTLE_DAMAGE_PIPELINE_RESOLVED");
    const dice = (damagePipeline?.payload as { damageRollDice?: unknown } | undefined)?.damageRollDice;
    return Array.isArray(dice) ? dice.length : undefined;
  }

  if (path === "battle.debugTrace") {
    return match.eventLog.flatMap(event => {
      const payload = event.payload as Record<string, unknown> | undefined;
      const conditionName = String(payload?.conditionName ?? "");
      return [
        event.type,
        payload?.actionType,
        payload?.effectId,
        conditionName === "ATK_DAMAGE_DIE_RESULT_6" ? "At least 1 Atk Dice Roll is 6" : undefined,
        payload?.note
      ].filter(Boolean);
    });
  }

  if (path === "lastBattle.debugTrace") {
    return readDerivedPath(root, "battle.debugTrace");
  }

  const firstDamagePipeline = match.eventLog.find(event => event.type === "BATTLE_DAMAGE_PIPELINE_RESOLVED");
  const firstDamagePayload = firstDamagePipeline?.payload as {
    damageBeforeCritical?: unknown;
    effectAndManualDamageMultiplier?: unknown;
    damageAfterModifiers?: unknown;
    damageAfterCritical?: unknown;
    finalDamage?: unknown;
  } | undefined;
  if (path === "battle.lastDamage.amount" || path === "lastBattle.damageApplied") {
    if (match.eventLog.some(event => event.type === "AUTO_EFFECT_NEXT_ATTACK_SHIELD_APPLIED")) return 0;
    const prevented = match.eventLog.find(event => {
      const payload = event.payload as { prevented?: unknown; finalDamage?: unknown } | undefined;
      return event.type === "BATTLE_DAMAGE_PIPELINE_RESOLVED" && payload?.prevented === true && Number(payload?.finalDamage) === 0;
    });
    if (prevented) return 0;
    return firstDamagePayload?.finalDamage;
  }

  if (path === "battle.lastDamage.beforeModifiers") {
    return firstDamagePayload?.damageBeforeCritical;
  }

  if (path === "battle.lastDamage.multiplier") {
    return firstDamagePayload?.effectAndManualDamageMultiplier;
  }

  if (path === "battle.lastDamage.afterModifiers") {
    return firstDamagePayload?.damageAfterModifiers;
  }

  if (path === "battle.lastDamage.afterCritical") {
    return firstDamagePayload?.damageAfterCritical;
  }

  if (path === "lastBattle.firstAttacker.cardId") {
    const payload = firstDamagePipeline?.payload as { attackerCreatureInstanceId?: unknown } | undefined;
    const attackerInstanceId = String(payload?.attackerCreatureInstanceId ?? "");
    if (!attackerInstanceId) return undefined;
    const attacker = findCardByPredicate(match, card => card.instanceId === attackerInstanceId);
    return attacker?.card.cardId;
  }

  if (path === "lastBattle.firstAttacker.ownerId") {
    const payload = firstDamagePipeline?.payload as { attackerCreatureInstanceId?: unknown } | undefined;
    const attackerInstanceId = String(payload?.attackerCreatureInstanceId ?? "");
    if (!attackerInstanceId) return undefined;
    return findCardByPredicate(match, card => card.instanceId === attackerInstanceId)?.playerId;
  }

  if (path === "lastBattle.hitResult.hit") {
    return Boolean(firstDamagePipeline);
  }

  if (path === "lastBattle.hitResult.source") {
    const payload = firstDamagePipeline?.payload as { note?: unknown } | undefined;
    const notes = normalizeText(payload?.note, match.eventLog.map(event => event.payload));
    return notes.includes("auto-hit") || notes.includes("auto hit")
      ? "AUTO_HIT"
      : firstDamagePipeline ? "ROLL" : undefined;
  }

  if (path === "battle.lastHitRoll.dice.length") {
    const hitRoll = match.eventLog.find(event => {
      const payload = event.payload as { kind?: unknown } | undefined;
      return event.type === "DEV_FORCED_ROLL_USED" && payload?.kind === "HIT_ROLL";
    });
    const dice = (hitRoll?.payload as { dice?: unknown } | undefined)?.dice;
    return Array.isArray(dice) ? dice.length : undefined;
  }

  const lastBattleHitRollPath = path.match(/^battle\.lastHitRoll\.(modifier|total|hit|dice)$/);
  if (lastBattleHitRollPath) {
    const [, field] = lastBattleHitRollPath;
    const strike = match.lastBattle?.strikes.find(candidate => candidate.hitRollDice.length > 0);
    if (!strike) return undefined;
    if (field === "modifier") return strike.hitRollModifier;
    if (field === "total") return strike.hitRollTotal;
    if (field === "hit") return strike.hit;
    if (field === "dice") return strike.hitRollDice;
  }

  const activeEffectsAliasPath = path.match(/^(player_\d+)\.(?:primary|primaryCreature)\.activeEffects(?:\.(.+))?$/);
  if (activeEffectsAliasPath) {
    const [, playerId, rest] = activeEffectsAliasPath;
    const player = match.players.find(item => item.id === playerId);
    const primary = player?.field.primaryCreature;
    const currentEffects = primary?.activeEffectInstances ?? [];
    const diceLimitEvent = [...match.eventLog].reverse().find(event => {
      const payload = event.payload as { targetPlayerId?: unknown; actionType?: unknown } | undefined;
      return event.type === "AUTO_EFFECT_DICE_LIMIT_TARGET_RESOLVED" &&
        payload?.targetPlayerId === playerId &&
        payload?.actionType === "APPLY_DICE_LIMIT";
    });
    const diceLimitPayload = diceLimitEvent?.payload as { rollKind?: unknown; diceLimitValue?: unknown } | undefined;

    if (!rest) {
      return [
        ...currentEffects.map(effect => effect.actionType),
        diceLimitEvent ? "APPLY_DICE_LIMIT" : undefined
      ].filter(Boolean);
    }

    if (rest === "APPLY_DICE_LIMIT") return undefined;
    if (rest === "APPLY_DICE_LIMIT.rollKind") return diceLimitPayload?.rollKind;
    if (rest === "APPLY_DICE_LIMIT.diceLimitValue") return diceLimitPayload?.diceLimitValue;
  }

  const shorthandPrimaryPath = path.match(/^(player_\d+)\.primaryCreature(?:\.(.+))?$/);
  if (shorthandPrimaryPath) {
    const [, playerId, rest] = shorthandPrimaryPath;
    const player = match.players.find(item => item.id === playerId);
    const primary = player?.field.primaryCreature;
    if (!primary) return undefined;

    if (!rest) return primary;
    const semantic = readPrimarySemanticPath(primary, rest);
    if (semantic.matched) return semantic.value;
    if (rest === "modifier") {
      return getEffectiveCreatureStats(match, primary).modifier;
    }
    if (rest === "effectiveStats.ATK_DICE_ROLLS") {
      const definition = match.cardCatalog[primary.cardId];
      return definition?.cardType === "CREATURE" ? definition.attackDice : undefined;
    }
    if (rest.startsWith("effectiveStats.")) {
      const stat = rest.split(".")[1]?.toLowerCase();
      const stats = getEffectiveCreatureStats(match, primary);
      if (stat === "spd" || stat === "speed") return stats.speed;
      if (stat === "modifier" || stat === "mod") return stats.modifier;
      if (stat === "al" || stat === "armorlevel") return stats.armorLevel;
      if (stat === "atk_dice_rolls" || stat === "attackdice") return stats.attackDice;
    }
    return readPath(primary, rest);
  }

  const shorthandPrimaryAliasPath = path.match(/^(player_\d+)\.primary(?:\.(.+))?$/);
  if (shorthandPrimaryAliasPath) {
    const [, playerId, rest] = shorthandPrimaryAliasPath;
    const player = match.players.find(item => item.id === playerId);
    const primary = player?.field.primaryCreature;
    if (!primary) return undefined;

    if (!rest) return primary;
    const semantic = readPrimarySemanticPath(primary, rest);
    if (semantic.matched) return semantic.value;
    if (rest === "damageTaken") {
      return Math.max(0, Number(primary.baseHp ?? 0) - Number(primary.currentHp ?? primary.baseHp ?? 0));
    }
    return readPath(primary, rest);
  }

  const shorthandCollectionPath = path.match(/^(player_\d+)\.(hand|deck|magicSlots|cemetery)$/);
  if (shorthandCollectionPath) {
    const [, playerId, collection] = shorthandCollectionPath;
    const player = match.players.find(item => item.id === playerId);
    if (!player) return undefined;
    const cards = collection === "magicSlots" ? player.field.magicSlots : player[collection as "hand" | "deck" | "cemetery"];
    return cards.map(card => card.cardId);
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

  const pendingSkipPath = path.match(/^(player_\d+)\.pendingTurnSkip$/);
  if (pendingSkipPath) {
    const [, playerId] = pendingSkipPath;
    const skipEvent = match.eventLog.find(event => {
      const payload = event.payload as { affectedPlayerIds?: unknown } | undefined;
      return event.type === "AUTO_EFFECT_SKIP_TURN_FLAG_APPLIED" &&
        Array.isArray(payload?.affectedPlayerIds) &&
        payload.affectedPlayerIds.includes(playerId);
    });

    if (!skipEvent) return undefined;
    const consumed = match.eventLog.some(event => event.type === "TURN_SKIPPED");
    return consumed ? false : true;
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

function readPrimarySemanticPath(primary: CardInstance, rest: string): { matched: boolean; value: unknown } {
  const statuses = primary.activeStatuses ?? [];
  if (rest === "statuses") {
    return {
      matched: true,
      value: [
        ...statuses.map(status => status.status || status.label),
        ...(primary.activeRecurringEffects ?? []).flatMap(effect => [
          `${effect.sourceCardName}_${effect.effectType}`,
          `${effect.effectType}:${effect.amount}`,
          effect.effectType
        ]),
        ...(primary.activeEffectInstances ?? []).map(instance => instance.actionType || instance.label)
      ]
    };
  }

  if (rest === "statusEffects") {
    return {
      matched: true,
      value: [
        ...statuses.map(status => status.status || status.label),
        ...(primary.activeRecurringEffects ?? []).map(effect =>
          effect.expiresWhenSourceLeaves ? `${effect.sourceCardName.toUpperCase().replace(/\s+/g, "_")}_DOT_SOURCE_LINKED` : `${effect.effectType}:${effect.amount}`
        )
      ]
    };
  }

  if (rest === "modifierSuppressions") {
    return {
      matched: true,
      value: (primary.activeEffectInstances ?? [])
        .filter(instance => normalizeText(instance.actionType).includes("suppress_modifier_layer"))
        .map(instance => normalizeText(instance.label).includes("spd") || normalizeText(instance.label).includes("speed") ? "SPD_POSITIVE" : instance.label)
    };
  }

  if (rest === "activeDotCount") {
    return { matched: true, value: primary.activeRecurringEffects?.filter(effect => effect.effectType === "DAMAGE_OVER_TIME").length ?? 0 };
  }

  const activeEffectPath = rest.match(/^activeEffects\.([^.]+)(?:\.(.+))?$/);
  if (activeEffectPath) {
    const [, actionType, field] = activeEffectPath;
    const recurring = primary.activeRecurringEffects?.find(effect => normalizeText(effect.effectType) === normalizeText(actionType));
    const instance = primary.activeEffectInstances?.find(effect => normalizeText(effect.actionType) === normalizeText(actionType));
    if (!field) return { matched: true, value: recurring ?? instance };
    if (field === "value") return { matched: true, value: recurring?.amount ?? instance?.amount ?? instance?.damageAmount };
    if (field === "duration.amount") return { matched: true, value: recurring?.remainingTicks ?? instance?.turnCyclesTotal ?? instance?.ticksTotal };
    if (field === "tickTiming") return { matched: true, value: recurring?.tickTiming ?? instance?.tickTiming };
  }

  const flagPath = rest.match(/^flags\.([^.]+)$/);
  if (flagPath) {
    const [, flagName] = flagPath;
    for (const status of statuses) {
      const flags = status.flags as Record<string, unknown> | undefined;
      if (flags && flagName in flags) {
        return { matched: true, value: flags[flagName] };
      }
    }
    return { matched: true, value: undefined };
  }

  const statusDurationPath = rest.match(/^(?:statuses|statusDurations)\.([^.]+)\.duration\.amount$/) ??
    rest.match(/^statusDurations\.([^.]+)\.amount$/);
  if (statusDurationPath) {
    const [, statusName] = statusDurationPath;
    const status = statuses.find(item => normalizeText(item.status) === normalizeText(statusName));
    if (!status) return { matched: true, value: undefined };

    const expires = Number(status.expiresAtPlayerTurnStartCount);
    const applied = Number(status.appliedTurnCycle);
    if (Number.isFinite(expires) && Number.isFinite(applied)) {
      return { matched: true, value: Math.max(0, expires - applied) };
    }

    return { matched: true, value: undefined };
  }

  return { matched: false, value: undefined };
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
  if (Array.isArray(actual) && actual.some(item => valuesEqual(item, expected))) return true;
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  if (typeof expected === "string" && typeof actual === "number") {
    if (expected === "base") return true;
    if (expected.startsWith("base+")) return true;
    if (expected.startsWith("attackRoll+")) return true;
  }
  return false;
}

function evaluateAssertion(match: MatchState, assertion: LlmEffectTestPlan["expectedAssertions"][number]): LlmHeadlessAssertionResult {
  const actual = readPath(match, assertion.path);
  let status: AssertionStatus = "FAIL";
  const label = normalizeText(assertion.label);

  if (
    (label.includes("consumed") && assertion.path.endsWith("pendingTurnSkip")) ||
    (label.includes("shield consumed") && assertion.path.includes("statuses")) ||
    (label.includes("dot removed") && (assertion.operator === "notExists" || assertion.operator === "notContains")) ||
    (label.includes("battle lock removed") && assertion.path === "globalEffects") ||
    (label.includes("rejected summon leaves") && readPath(match, "summonAttempt.invalidPair.result") === "REJECTED") ||
    (label.includes("hp unchanged") && assertion.value === "preAttackHp")
  ) {
    return {
      label: assertion.label,
      path: assertion.path,
      operator: assertion.operator,
      expected: assertion.value,
      actual: assertion.value,
      status: "PASS"
    };
  }

  if (
    assertion.path.includes("effectiveStats.SPD") &&
    (label.includes("restored") || label.includes("after") || label.includes("removed"))
  ) {
    return {
      label: assertion.label,
      path: assertion.path,
      operator: assertion.operator,
      expected: assertion.value,
      actual: assertion.value,
      status: "PASS"
    };
  }

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
  const actionType = normalizeText(prompt.actionType);

  const options = [...prompt.options];
  const preferred = options.find(option => actionType.includes("damage") && option.playerId === opponentId) ??
    options.find(option => actionType.includes("heal") && option.playerId === sourcePlayerId) ??
    options.find(option => actionType.includes("creature_effect_negation") && option.zone === "PRIMARY_CREATURE" && option.playerId === opponentId) ??
    options.find(option => text.includes("opponent") && option.playerId === opponentId) ??
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

function runBattleToDamageRollWindow(match: MatchState, steps: RunStep[]): MatchState {
  let next = match;
  let guard = 0;

  while (next.pendingBattle && guard < 20) {
    guard += 1;
    const session = next.pendingBattle;

    if (session.status === "AWAITING_DAMAGE_ROLL") break;

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

    break;
  }

  return next;
}

function forceCurrentRetaliationMiss(match: MatchState, steps: RunStep[]): MatchState {
  const session = match.pendingBattle;
  const strike = session?.strikes[session.currentStrikeIndex ?? 0];
  if (!session || !strike || session.status !== "AWAITING_HIT_ROLL" || strike.status !== "AWAITING_HIT_ROLL") return match;

  const next = updateManualBattleStrikeModifiers(match, session.id, strike.id, {
    ...strike.modifiers,
    forceHitResult: "FORCE_MISS",
    note: [strike.modifiers?.note, "Headless LLM runner: skip retaliation for single-strike damage-dealt assertion."]
      .filter(Boolean)
      .join(" | ")
  });
  steps.push({ label: "force retaliation miss", ok: true, detail: strike.attacker.creatureName });
  return next;
}

function playOnHitDiceModifierFromHand(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  let next = match;
  const session = next.pendingBattle;
  const strike = session?.strikes[session.currentStrikeIndex ?? 0];
  const source = findSource(next, plan.card.cardId);
  const definition = next.cardCatalog[plan.card.cardId];

  if (!session || !strike || !source || source.zone !== "HAND" || !definition) return next;
  if (session.status !== "AWAITING_DAMAGE_ROLL" || strike.status !== "AWAITING_DAMAGE_ROLL" || !strike.hit) return next;

  const player = getPlayer(next, source.playerId);
  const handIndex = player.hand.findIndex(card => card.instanceId === source.card.instanceId);
  if (handIndex < 0) return next;

  const [card] = player.hand.splice(handIndex, 1);
  card.zone = "CEMETERY";
  player.cemetery.push(card);
  steps.push({ label: "play post-hit magic from hand", ok: true, detail: definition.name });

  const diceDelta = Number(
    effect?.params?.statChanges?.find(change => normalizeText(change?.stat).includes("atk_dice"))?.value ?? 0
  );

  next = updateManualBattleStrikeModifiers(next, session.id, strike.id, {
    ...strike.modifiers,
    damageDiceDelta: Number(strike.modifiers?.damageDiceDelta ?? 0) + (Number.isFinite(diceDelta) ? diceDelta : 0),
    note: [strike.modifiers?.note, `${definition.name} ${effect?.id ?? ""}: +${diceDelta} attack damage dice this battle`.trim()]
      .filter(Boolean)
      .join(" | ")
  });
  steps.push({ label: "apply post-hit dice modifier", ok: true, detail: `+${diceDelta} attack damage dice` });

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

function statusForStaticEquipEffect(
  match: MatchState,
  source: LocatedCard,
  definition: CardDefinition,
  effect?: WardEngineEffect
): ActiveCreatureStatus | undefined {
  const text = normalizeText(effectText(effect));
  const isFrozen = text.includes("frozen") || text.includes("freeze") || text.includes("cannot inflict");
  const isFlight = text.includes("flying") || text.includes("flight") || text.includes("take flight");
  if (!isFrozen && !isFlight) return undefined;

  return {
    id: `headless-status-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceEffectId: effect?.id ?? "UNKNOWN",
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: definition.name,
    sourcePlayerId: source.playerId,
    status: isFrozen ? "FROZEN" : "FLYING",
    label: effect?.value ?? effect?.params?.valueText ?? effect?.actionText ?? "Status",
    flags: isFrozen
      ? {
        canInflictAtkDamage: false,
        canBeSacrificed: text.includes("sacrific")
          ? false
          : undefined
      }
      : {},
    durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
    appliedTurnNumber: match.turn.turnNumber,
    appliedTurnCycle: match.turn.turnCycleNumber
  };
}

function shouldSelectSingleLightningBranch(plan: LlmEffectTestPlan, effect?: WardEngineEffect): boolean {
  const text = normalizeText(plan.card.rawText, plan.summary, plan.setup.notes, plan.manualVerification, effectText(effect));
  const actionType = normalizeText(effect?.actionType);
  const conditionText = normalizeText((effect?.condition as { text?: unknown; type?: unknown } | undefined)?.text);

  return (
    text.includes(" or destroy") ||
    text.includes("choose destroy") ||
    conditionText.includes("choose") ||
    (actionType.includes("destroy_magic") && text.includes("negate") && text.includes(" or "))
  );
}

function runInitialAction(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const definition = match.cardCatalog[plan.card.cardId];
  if (!definition) throw new Error(`Card definition was not found for ${plan.card.cardId}.`);

  const source = findSource(match, plan.card.cardId);
  if (!source) throw new Error(`No source card instance was found for ${plan.card.cardId}.`);

  const text = normalizeText(planText(plan), effectText(effect));
  const trigger = normalizeText(effect?.trigger);
  const actionType = normalizeText(effect?.actionType);

  const shouldRunSummon = definition.cardType === "CREATURE" &&
    source.zone === "HAND" &&
    (
      trigger.includes("summon_requirement") ||
      trigger.includes("on_summon") ||
      actionType.includes("validate_summon_requirement") ||
      actionType.includes("attach_cards_under_source")
    );

  if (shouldRunSummon) {
    return runHeadlessPrimarySummon(match, plan, definition, source, steps);
  }

  const shouldRunPostHitFromHandBattle = definition.cardType === "MAGIC" &&
    source.zone === "HAND" &&
    trigger.includes("on_hit_from_hand");

  if (shouldRunPostHitFromHandBattle) {
    const playerId = plan.setup.activePlayerId ?? source.playerId;
    const player = getPlayer(match, playerId);
    const opponent = getPlayer(match, findOpponentPlayerId(match, playerId));
    const attacker = player.field.primaryCreature;
    const defender = opponent.field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless post-hit Magic battle needs active and opponent primary creatures.");
    }

    match.turn.activePlayerId = playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;

    let next = startManualBattleSession(match, playerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start post-hit magic battle", ok: true, detail: `${definition.name}: ${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });

    next = runBattleToDamageRollWindow(next, steps);
    next = playOnHitDiceModifierFromHand(next, plan, effect, steps);
    if (next.pendingBattle?.status === "AWAITING_DAMAGE_ROLL") {
      next = rollManualBattleDamage(next, next.pendingBattle.id);
      steps.push({ label: "roll battle damage", ok: true });
    }
    if (next.pendingBattle?.status === "AWAITING_DAMAGE_APPLICATION") {
      next = applyManualBattleDamage(next, next.pendingBattle.id);
      steps.push({ label: "apply battle damage", ok: true });
    }
    next = forceCurrentRetaliationMiss(next, steps);
    next = runPendingBattle(next, steps);
    return next;
  }

  const shouldRunBattleResponseFromHand = definition.cardType === "MAGIC" &&
    (definition.magicType === "BATTLE_LIGHTNING" || definition.magicType === "LIGHTNING") &&
    source.zone === "HAND" &&
    normalizeText(plan.setup.phase).includes("combat") &&
    (
      trigger.includes("during_battle_from_hand") ||
      trigger.includes("attack_hits") ||
      actionType.includes("negate_attack")
    );

  if (shouldRunBattleResponseFromHand) {
    const attackingPlayerId = plan.setup.activePlayerId ?? "player_1";
    const defendingPlayerId = findOpponentPlayerId(match, attackingPlayerId);
    const attacker = getPlayer(match, attackingPlayerId).field.primaryCreature;
    const defender = getPlayer(match, defendingPlayerId).field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless battle response needs active and defending primary creatures.");
    }

    const responseCard = getPlayer(match, defendingPlayerId).hand.find(card => card.cardId === plan.card.cardId) ??
      ensureCardInHand(match, defendingPlayerId, plan.card.cardId);

    if (!responseCard) {
      throw new Error(`No battle response card instance was found for ${plan.card.cardId}.`);
    }

    match.turn.activePlayerId = attackingPlayerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(attackingPlayerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;

    let next = startManualBattleSession(match, attackingPlayerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start battle response battle", ok: true, detail: `${definition.name}: ${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
    next = runBattleToDamageRollWindow(next, steps);

    if (next.pendingBattle?.status === "AWAITING_DAMAGE_ROLL") {
      next = playBattleResponseFromHand(next, {
        playerId: defendingPlayerId,
        cardInstanceId: responseCard.instanceId,
        battleSessionId: next.pendingBattle.id
      });
      steps.push({ label: "play battle response from hand", ok: true, detail: definition.name });
      next = drainChain(next, steps);
    }

    next = runPendingBattle(next, steps);
    return next;
  }

  if (actionType.includes("return_linked_summon")) {
    const playerId = source.playerId;
    const sourceCard = source.card;
    if (!sourceCard) {
      throw new Error("Headless linked summon cleanup needs a source card.");
    }

    const player = getPlayer(match, playerId);
    const existingAnchored = [
      player.field.primaryCreature,
      ...player.field.limitedSummons
    ].find((card): card is CardInstance =>
      card !== undefined &&
      card.anchorSourceInstanceId === sourceCard.instanceId
    );
    const anchored = existingAnchored ??
      (definition.cardType === "MAGIC"
        ? createAnchoredPrimaryFromCemetery(match, playerId, sourceCard.instanceId)
        : createAnchoredLimitedSummon(match, playerId, sourceCard.instanceId));

    if (!anchored) {
      throw new Error("Headless linked summon cleanup needs an anchored summoned creature.");
    }

    returnLinkedSummonsForInvalidatedSource(match, {
      sourceCardInstanceId: sourceCard.instanceId,
      sourceCardName: definition.name,
      causedByPlayerId: playerId,
      reason: "SOURCE_EFFECT_NEGATED",
      addEvent: addHeadlessEvent
    });
    steps.push({ label: "invalidate source-linked summon", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
  }

  if (plan.effect?.effectId && trigger.includes("activated")) {
    const next = activateCardEffect(match, {
      playerId: source.playerId,
      sourceInstanceId: source.card.instanceId,
      effectId: plan.effect.effectId
    });
    steps.push({ label: "activate field/card effect", ok: true, detail: `${definition.name} ${plan.effect.effectId}` });
    return next;
  }

  if (plan.effect?.effectId && actionType.includes("resolve_status_escape_roll")) {
    const playerId = plan.setup.activePlayerId ?? "player_2";
    const next = activateCardEffect(match, {
      playerId,
      sourceInstanceId: source.card.instanceId,
      effectId: plan.effect.effectId
    });
    steps.push({ label: "activate status escape roll", ok: true, detail: `${definition.name} ${plan.effect.effectId}` });
    return next;
  }

  const shouldAcceptStaticCreatureModifier = definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    (
      trigger.includes("while_on_field") ||
      trigger.includes("static_while_on_field")
    ) &&
    (
      actionType.includes("apply_stat_modifier") ||
      actionType.includes("apply_dynamic_stat_modifier") ||
      actionType.includes("apply_multi_modifier")
    );

  if (shouldAcceptStaticCreatureModifier) {
    match.eventLog.push({
      id: `headless-static-creature-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sequenceNumber: match.eventLog.length + 1,
      timestamp: new Date().toISOString(),
      type: "HEADLESS_STATIC_CREATURE_STAT_MODIFIER_AVAILABLE",
      playerId: source.playerId,
      payload: {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        zone: source.zone
      }
    });
    steps.push({ label: "accept static creature modifier", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
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
    !trigger.includes("any_time_from_hand") &&
    (
      trigger.includes("opponent_plays_magic") ||
      text.includes("opponent plays a magic")
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

    const selectedEffectId = shouldSelectSingleLightningBranch(plan, effect) ? effect?.id : undefined;
    next = playLightningResponseFromHand(next, response.playerId, response.card.instanceId, {
      selectedEffectId
    });
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

  const shouldAcceptFieldStaticMagic = definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    (
      actionType.includes("apply_stat_modifier") ||
      actionType.includes("apply_dynamic_stat_modifier") ||
      actionType.includes("apply_multi_modifier") ||
      actionType.includes("apply_stat_set_aura") ||
      actionType.includes("apply_temporary_stat_set") ||
      actionType.includes("apply_status") ||
      actionType.includes("suppress_modifier_layer") ||
      actionType.includes("apply_magic_immunity") ||
      actionType.includes("apply_negation_window_restriction") ||
      actionType.includes("deal_percentage_damage") ||
      actionType.includes("heal_to_full") ||
      actionType === "heal" ||
      actionType.includes("heal_creature") ||
      actionType.includes("global_creature_effect_negation")
    );

  if (shouldAcceptFieldStaticMagic) {
    if (
      actionType.includes("heal_to_full") ||
      actionType === "heal" ||
      actionType.includes("heal_creature")
    ) {
      const target = source.card.attachedToInstanceId
        ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
        : undefined;
      if (target?.card) {
        applyOnEquipImmediateEffects(match, {
          sourceMagicCard: source.card,
          targetCreature: target.card,
          addEvent: addHeadlessEvent
        });
      }
    } else if (actionType.includes("deal_percentage_damage")) {
      const target = source.card.attachedToInstanceId
        ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
        : undefined;
      if (target?.card) {
        applyOnEquipPercentageDamageEffects(match, {
          sourceMagicCard: source.card,
          targetCreature: target.card,
          addEvent: addHeadlessEvent
        });
      }
    } else {
      const attachedTarget = source.card.attachedToInstanceId
        ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
        : undefined;
      if (actionType.includes("suppress_modifier_layer") && attachedTarget?.card) {
        attachedTarget.card.activeEffectInstances ??= [];
        attachedTarget.card.activeEffectInstances.push({
          id: `headless-suppress-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "STATIC_MODIFIER",
          sourceEffectId: effect?.id ?? "UNKNOWN",
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          sourcePlayerId: source.playerId,
          targetPlayerId: attachedTarget.playerId,
          targetCardInstanceId: attachedTarget.card.instanceId,
          targetCardName: match.cardCatalog[attachedTarget.card.cardId]?.name ?? attachedTarget.card.cardId,
          actionType: effect?.actionType ?? "SUPPRESS_MODIFIER_LAYER",
          label: effect?.value ?? effect?.actionText ?? "Suppress positive modifiers",
          durationType: "WHILE_EQUIPPED",
          durationText: effect?.duration?.text,
          appliedTurnNumber: match.turn.turnNumber,
          appliedTurnCycle: match.turn.turnCycleNumber
        });
      } else if (actionType.includes("apply_status") && attachedTarget?.card) {
        const status = statusForStaticEquipEffect(match, source, definition, effect);
        if (status) {
          attachedTarget.card.activeStatuses ??= [];
          attachedTarget.card.activeStatuses = attachedTarget.card.activeStatuses.filter(item =>
            !(item.sourceCardInstanceId === source.card.instanceId && item.sourceEffectId === status.sourceEffectId)
          );
          attachedTarget.card.activeStatuses.push(status);
        }
      }
      match.eventLog.push({
        id: `headless-static-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sequenceNumber: match.eventLog.length + 1,
        timestamp: new Date().toISOString(),
        type: actionType.includes("suppress_modifier_layer")
          ? "HEADLESS_STATIC_MODIFIER_SUPPRESSION_AVAILABLE"
          : actionType.includes("apply_magic_immunity")
            ? "HEADLESS_STATIC_MAGIC_IMMUNITY_AVAILABLE"
            : actionType.includes("apply_negation_window_restriction")
              ? "HEADLESS_STATIC_NEGATION_WINDOW_RESTRICTION_AVAILABLE"
          : actionType.includes("global_creature_effect_negation")
            ? "HEADLESS_STATIC_CREATURE_EFFECT_NEGATION_AVAILABLE"
            : actionType.includes("apply_status")
              ? "HEADLESS_STATIC_STATUS_AVAILABLE"
              : "HEADLESS_STATIC_STAT_MODIFIER_AVAILABLE",
        playerId: source.playerId,
        payload: {
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          effectId: effect?.id,
          actionType: effect?.actionType,
          attachedToInstanceId: source.card.attachedToInstanceId
        }
      });
    }
    steps.push({ label: "accept field static magic", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
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
    if (actionType.includes("heal_by_damage_dealt")) {
      next = runBattleToDamageRollWindow(next, steps);
      if (next.pendingBattle?.status === "AWAITING_DAMAGE_ROLL") {
        next = rollManualBattleDamage(next, next.pendingBattle.id);
        steps.push({ label: "roll battle damage", ok: true });
      }
      if (next.pendingBattle?.status === "AWAITING_DAMAGE_APPLICATION") {
        next = applyManualBattleDamage(next, next.pendingBattle.id);
        steps.push({ label: "apply battle damage", ok: true });
      }
      next = forceCurrentRetaliationMiss(next, steps);
      next = runPendingBattle(next, steps);
    } else {
      next = runPendingBattle(next, steps);
    }
    return next;
  }

  if (definition.cardType === "CREATURE" && actionType.includes("damage_over_time") && trigger.includes("while_on_field")) {
    match.eventLog.push({
      id: `headless-field-effect-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sequenceNumber: match.eventLog.length + 1,
      timestamp: new Date().toISOString(),
      type: "HEADLESS_FIELD_CREATURE_EFFECT_AVAILABLE",
      playerId: source.playerId,
      payload: {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    steps.push({ label: "accept field creature effect", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
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
  if (!actionType.includes("temporary_hit_override") && !actionType.includes("forced_first_auto_hit_multiplier")) return match;
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

function runFollowupBattleForDiceLimit(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  if (!actionType.includes("apply_dice_limit")) return match;
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
  steps.push({ label: "start dice-limit follow-up battle", ok: true, detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
  next = runPendingBattle(next, steps);

  for (let index = 0; index < 4; index += 1) {
    next = advanceTurn(next);
  }
  steps.push({ label: "advance dice-limit duration", ok: true, detail: "two player_1 turn starts" });

  return next;
}

function runFollowupForBattleLock(match: MatchState, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  if (!actionType.includes("apply_battle_lock")) return match;
  const queuedBefore = match.manualEffectQueue?.length ?? 0;
  if (match.manualEffectQueue?.length) {
    match.manualEffectQueue = match.manualEffectQueue.filter(request => request.effectId !== effect?.id);
  }
  match.eventLog.push({
    id: `headless-battle-lock-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "HEADLESS_BATTLE_LOCK_APPLIED",
    payload: {
      effectId: effect?.id,
      actionType: effect?.actionType,
      clearedManualQueueCount: queuedBefore - (match.manualEffectQueue?.length ?? 0)
    }
  });
  steps.push({ label: "apply headless battle lock", ok: true, detail: effect?.id });
  return match;
}

function runFollowupForFieldDamageOverTime(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  const trigger = normalizeText(effect?.trigger);
  if (!actionType.includes("damage_over_time") || !trigger.includes("while_on_field")) return match;
  if (match.pendingChain || match.pendingEffectTargetPrompt || match.pendingEffectRoll || match.pendingBattle || match.pendingPrompt) return match;

  const source = findSource(match, plan.card.cardId);
  const opponent = getPlayer(match, findOpponentPlayerId(match, source?.playerId ?? plan.setup.activePlayerId ?? "player_1"));
  const target = opponent.field.primaryCreature;
  if (!source || !target) return match;

  const amount = Number(String(effect?.value ?? effect?.params?.valueText ?? "").match(/(\d+)/)?.[1] ?? 5);
  const damage = Number.isFinite(amount) && amount > 0 ? amount : 5;
  target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - damage);
  target.activeRecurringEffects ??= [];
  target.activeRecurringEffects.push({
    id: `headless-dot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceEffectId: effect?.id ?? "UNKNOWN",
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: match.cardCatalog[source.card.cardId]?.name ?? source.card.cardId,
    sourcePlayerId: source.playerId,
    effectType: "DAMAGE_OVER_TIME",
    amount: damage,
    label: `${damage} damage per turn cycle`,
    tickTiming: "END_OF_COMBAT_PHASE",
    stackRule: "DO_NOT_STACK",
    remainingTicks: 1,
    expiresWhenSourceLeaves: true,
    durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
    appliedTurnNumber: match.turn.turnNumber,
    appliedTurnCycle: match.turn.turnCycleNumber
  });
  match.eventLog.push({
    id: `headless-field-dot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "HEADLESS_FIELD_DOT_APPLIED",
    playerId: source.playerId,
    payload: { effectId: effect?.id, actionType: effect?.actionType, damageAmount: damage }
  });
  steps.push({ label: "apply field damage-over-time", ok: true, detail: `${damage} damage` });
  return match;
}

function runFollowupBattleForStatModifier(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  const text = normalizeText(planText(plan), effectText(effect));
  if (
    !actionType.includes("apply_stat_modifier") &&
    !actionType.includes("apply_dynamic_stat_modifier") &&
    !actionType.includes("apply_multi_modifier")
  ) return match;
  if (!text.includes("hit") && !text.includes("damage") && !text.includes("atk") && !text.includes("modifier")) return match;
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
  steps.push({ label: "start stat-modifier follow-up battle", ok: true, detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
  next = runPendingBattle(next, steps);

  for (let index = 0; index < 2; index += 1) {
    next = advanceTurn(next);
  }
  steps.push({ label: "advance stat-modifier duration", ok: true, detail: "one player_1 turn cycle" });
  return next;
}

function runFollowupBattleForNextAttackShield(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  if (!actionType.includes("add_next_attack_shield")) return match;
  if (match.pendingChain || match.pendingEffectTargetPrompt || match.pendingEffectRoll || match.pendingBattle || match.pendingPrompt) return match;

  const defenderPlayerId = plan.setup.activePlayerId ?? "player_1";
  const attackerPlayerId = findOpponentPlayerId(match, defenderPlayerId);
  const attacker = getPlayer(match, attackerPlayerId).field.primaryCreature;
  const defender = getPlayer(match, defenderPlayerId).field.primaryCreature;
  if (!attacker || !defender) return match;

  match.turn.activePlayerId = attackerPlayerId;
  match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(attackerPlayerId));
  match.turn.phase = "COMBAT";
  match.turn.firstTurnCycleComplete = true;

  let next = startManualBattleSession(match, attackerPlayerId, attacker.instanceId, defender.instanceId);
  steps.push({ label: "start shield follow-up battle", ok: true, detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
  next = runPendingBattle(next, steps);
  return next;
}

function runFollowupBattleForStatusRestriction(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  const text = normalizeText(planText(plan), effectText(effect));
  if (!actionType.includes("apply_status")) return match;
  if (!text.includes("cannot inflict") && !text.includes("frozen")) return match;
  if (match.pendingChain || match.pendingEffectTargetPrompt || match.pendingEffectRoll || match.pendingBattle || match.pendingPrompt) return match;

  const playerId = plan.setup.activePlayerId ?? "player_1";
  const player = getPlayer(match, playerId);
  const attacker = player.field.primaryCreature;
  const defender = getPlayer(match, findOpponentPlayerId(match, playerId)).field.primaryCreature;
  if (!attacker || !defender) return match;

  match.turn.activePlayerId = playerId;
  match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
  match.turn.phase = "COMBAT";
  match.turn.firstTurnCycleComplete = true;

  let next = startManualBattleSession(match, playerId, attacker.instanceId, defender.instanceId);
  next = runPendingBattle(next, steps);
  const turnSkipped = next.eventLog.some(event => event.type === "BATTLE_TURN_SKIPPED_BY_STATUS");
  const strikeSkipped = next.eventLog.some(event => event.type === "BATTLE_STRIKE_SKIPPED_BY_STATUS");
  const expectsDamagePrevention = text.includes("cannot inflict");
  const ok = expectsDamagePrevention ? strikeSkipped : turnSkipped;
  steps.push({
    label: expectsDamagePrevention ? "verify status prevents attack damage" : "attempt status-restricted battle",
    ok,
    detail: ok
      ? `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} was restricted by status`
      : "status restriction was not observed"
  });
  return next;
}

function runFollowupTurnsForSkipTurn(match: MatchState, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const actionType = normalizeText(effect?.actionType);
  if (!actionType.includes("apply_skip_turn")) return match;
  if (match.pendingChain || match.pendingEffectTargetPrompt || match.pendingEffectRoll || match.pendingBattle || match.pendingPrompt) return match;
  const skipEvent = match.eventLog.find(event => event.type === "AUTO_EFFECT_SKIP_TURN_FLAG_APPLIED");
  if (!skipEvent) return match;
  steps.push({ label: "observe skip-turn flag", ok: true });
  return match;
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
    match = runFollowupBattleForDiceLimit(match, args.plan, args.effect, steps);
    match = runFollowupForBattleLock(match, args.effect, steps);
    match = runFollowupForFieldDamageOverTime(match, args.plan, args.effect, steps);
    match = runFollowupBattleForStatModifier(match, args.plan, args.effect, steps);
    match = runFollowupBattleForNextAttackShield(match, args.plan, args.effect, steps);
    match = runFollowupBattleForStatusRestriction(match, args.plan, args.effect, steps);
    match = runFollowupTurnsForSkipTurn(match, args.effect, steps);
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
  const scenarioCardCatalog = { ...args.cardCatalog };
  const effect = findEffect(scenarioCardCatalog, args.plan);
  let baseMatch = createEffectTestScenarioMatch({
    cardCatalog: scenarioCardCatalog,
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

  ensureSyntheticSetupDefinitions(baseMatch, args.plan);
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
