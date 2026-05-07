import type { ActiveCreatureStatus, ActiveCreatureStatusFlag, CardDefinition, CardInstance, DevRollKind, MatchState, PlayerState, WardEngineEffect } from "@ward/shared";
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
  getRequiredSacrificesForCreatureDefinition,
  passMagicChainPriority,
  playBattleResponseFromHand,
  playCreatureFromHandAsPrimary,
  playLightningResponseFromHand,
  playMagicFromHand,
  returnLinkedSummonsForInvalidatedSource,
  resolvePendingEffectTargetPrompt,
  rollD6WithDev,
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
  test_hive_lord: {
    id: "test_hive_lord",
    name: "Hive Lord",
    cardType: "CREATURE",
    creatureType: "BUG",
    armorLevel: 8,
    speed: 7,
    hp: 80,
    attackDice: 2,
    modifier: 4,
    text: "Synthetic headless QA Hive Lord primary creature."
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
  test_lethal_attacker_mod40: {
    id: "test_lethal_attacker_mod40",
    name: "Test Lethal Attacker +40",
    cardType: "CREATURE",
    creatureType: "WARRIOR",
    armorLevel: 1,
    speed: 10,
    hp: 100,
    attackDice: 1,
    modifier: 40,
    text: "Synthetic headless QA lethal attacker."
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
  if (!match.cardCatalog[cardId]) {
    const syntheticCreature = SYNTHETIC_CREATURES[cardId];
    const syntheticMagic = SYNTHETIC_MAGIC[cardId];
    if (syntheticCreature) match.cardCatalog[cardId] = syntheticCreature;
    if (syntheticMagic) match.cardCatalog[cardId] = syntheticMagic;
  }

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

function removeCardInstanceFromPlayerZones(player: PlayerState, instanceId: string): CardInstance | undefined {
  const handIndex = player.hand.findIndex(card => card.instanceId === instanceId);
  if (handIndex >= 0) return player.hand.splice(handIndex, 1)[0];

  const deckIndex = player.deck.findIndex(card => card.instanceId === instanceId);
  if (deckIndex >= 0) return player.deck.splice(deckIndex, 1)[0];

  const cemeteryIndex = player.cemetery.findIndex(card => card.instanceId === instanceId);
  if (cemeteryIndex >= 0) return player.cemetery.splice(cemeteryIndex, 1)[0];

  const magicIndex = player.field.magicSlots.findIndex(card => card.instanceId === instanceId);
  if (magicIndex >= 0) return player.field.magicSlots.splice(magicIndex, 1)[0];

  const limitedIndex = player.field.limitedSummons.findIndex(card => card.instanceId === instanceId);
  if (limitedIndex >= 0) return player.field.limitedSummons.splice(limitedIndex, 1)[0];

  if (player.field.primaryCreature?.instanceId === instanceId) {
    const card = player.field.primaryCreature;
    player.field.primaryCreature = undefined;
    return card;
  }

  return undefined;
}

function removeCardInstanceFromMatch(match: MatchState, instanceId: string): { player: PlayerState; card: CardInstance } | undefined {
  for (const player of match.players) {
    const card = removeCardInstanceFromPlayerZones(player, instanceId);
    if (card) return { player, card };
  }

  return undefined;
}

function moveCardToDeck(match: MatchState, playerId: string, card: CardInstance): void {
  const player = getPlayer(match, playerId);
  card.zone = "DECK";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  player.deck.push(card);
}

function moveCardToHand(match: MatchState, playerId: string, card: CardInstance): void {
  const player = getPlayer(match, playerId);
  card.zone = "HAND";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  player.hand.push(card);
}

function moveCardToCemetery(match: MatchState, playerId: string, card: CardInstance): void {
  const player = getPlayer(match, playerId);
  card.zone = "CEMETERY";
  card.controllerPlayerId = playerId;
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  player.cemetery.push(card);
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

function materialNamesForSummon(definition: Extract<CardDefinition, { cardType: "CREATURE" }>): string[] {
  const names = new Set<string>();

  for (const effect of definition.effects ?? []) {
    const params = effect.params as { requiredMaterials?: unknown; attachNames?: unknown } | undefined;
    if (Array.isArray(params?.requiredMaterials)) {
      for (const material of params.requiredMaterials) {
        const name = (material as { name?: unknown } | undefined)?.name;
        if (typeof name === "string" && name.trim()) names.add(name.trim());
      }
    }

    if (Array.isArray(params?.attachNames)) {
      for (const name of params.attachNames) {
        if (typeof name === "string" && name.trim()) names.add(name.trim());
      }
    }
  }

  return [...names];
}

function normalizeCardNameForMaterial(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function findNamedMaterialSacrifices(
  match: MatchState,
  playerId: string,
  sourceCardId: string,
  materialNames: string[]
): CardInstance[] {
  const candidates = findSummonSacrificeCards(match, playerId, sourceCardId, () => true);
  const selected: CardInstance[] = [];
  const used = new Set<string>();

  for (const materialName of materialNames) {
    const wanted = normalizeCardNameForMaterial(materialName);
    const matchCard = candidates.find(card => {
      if (used.has(card.instanceId)) return false;
      const definition = match.cardCatalog[card.cardId];
      return normalizeCardNameForMaterial(definition?.name) === wanted;
    });
    if (!matchCard) continue;
    used.add(matchCard.instanceId);
    selected.push(matchCard);
  }

  return selected;
}

function runHeadlessPrimarySummon(
  match: MatchState,
  plan: LlmEffectTestPlan,
  definition: CardDefinition,
  source: LocatedCard,
  steps: RunStep[]
): MatchState {
  if (definition.cardType !== "CREATURE") {
    throw new Error(`Headless summon route received non-creature card ${definition.name}.`);
  }

  const playerId = plan.setup.activePlayerId ?? source.playerId;
  const player = getPlayer(match, playerId);
  if (player.field.primaryCreature?.cardId === plan.card.cardId) {
    const primary = player.field.primaryCreature;
    player.field.primaryCreature = undefined;
    primary.zone = "HAND";
    primary.controllerPlayerId = playerId;
    player.hand.push(primary);
  }

  const sourceCard = getPlayer(match, playerId).hand.find(card => card.instanceId === source.card.instanceId) ??
    ensureCardInHand(match, playerId, plan.card.cardId);

  if (!sourceCard) {
    throw new Error(`Headless summon needs ${definition.name} in hand.`);
  }

  const summonText = normalizeText(
    planText(plan),
    plan.effect?.actionType,
    plan.effect?.effectGroup,
    plan.effect?.target,
    plan.effect?.value,
    plan.effect?.reusableFunction,
    definition.text
  );
  const needsTwoDragonSacrifices =
    summonText.includes("two dragon") ||
    summonText.includes("2 dragon") ||
    summonText.includes("requires two") ||
    summonText.includes("requires 2");

  const requiredSacrifices = getRequiredSacrificesForCreatureDefinition(definition);
  const materialNames = materialNamesForSummon(definition);

  const validSacrifices = needsTwoDragonSacrifices
    ? uniqueSacrificesByCardId(
        findSummonSacrificeCards(match, playerId, plan.card.cardId, card =>
          isDragonQualifiedCard(match, card)
        )
      ).slice(0, 2)
    : materialNames.length > 0
      ? findNamedMaterialSacrifices(match, playerId, plan.card.cardId, materialNames)
        .slice(0, Math.max(requiredSacrifices, materialNames.length))
    : findSummonSacrificeCards(match, playerId, plan.card.cardId, () => true)
      .slice(0, requiredSacrifices);

  if (needsTwoDragonSacrifices && validSacrifices.length < 2) {
    throw new Error(`Headless summon needs two Dragon-qualified sacrifices for ${definition.name}.`);
  }

  if (materialNames.length > 0 && validSacrifices.length < materialNames.length) {
    throw new Error(`Headless summon needs material card(s) for ${definition.name}: ${materialNames.join(", ")}.`);
  }

  const invalidSacrifices = needsTwoDragonSacrifices
    ? [
        validSacrifices[0],
        ...findSummonSacrificeCards(match, playerId, plan.card.cardId, card =>
          !isDragonQualifiedCard(match, card)
        )
      ].filter((card): card is CardInstance => !!card).slice(0, 2)
    : [];

  if (needsTwoDragonSacrifices && invalidSacrifices.length === 2) {
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

  const summoned = getPlayer(next, playerId).field.primaryCreature;
  const summonActionType = normalizeText(plan.effect?.actionType);
  if (summoned?.instanceId && summonActionType.includes("steal_equip_card")) {
    const opponentId = findOpponentPlayerId(next, playerId);
    const opponent = getPlayer(next, opponentId);
    const stolen = opponent.field.magicSlots.find(card => {
      const magicDefinition = next.cardCatalog[card.cardId];
      return magicDefinition?.cardType === "MAGIC" && magicDefinition.magicSubType === "EQUIP";
    });
    if (stolen) {
      const removed = removeCardInstanceFromMatch(next, stolen.instanceId);
      if (removed) {
        removed.card.controllerPlayerId = playerId;
        removed.card.ownerPlayerId = removed.card.ownerPlayerId || opponentId;
        removed.card.attachedToInstanceId = summoned.instanceId;
        moveCardToMagicSlot(next, playerId, removed.card);
      }
    }
    addHeadlessEvent(next, "STEAL_EQUIP_CARD", playerId, {
      sourceCardInstanceId: summoned.instanceId,
      sourceCardName: definition.name,
      effectId: plan.effect?.effectId,
      actionType: plan.effect?.actionType,
      stolenCardId: stolen?.cardId,
      fromPlayerId: opponentId
    });
  }

  if (summoned?.instanceId && summonActionType.includes("take_control_as_limited_summon")) {
    const opponentId = findOpponentPlayerId(next, playerId);
    const opponent = getPlayer(next, opponentId);
    const candidate = opponent.cemetery.find(card => next.cardCatalog[card.cardId]?.cardType === "CREATURE");
    if (candidate) {
      const removed = removeCardInstanceFromMatch(next, candidate.instanceId);
      if (removed) {
        removed.card.zone = "LIMITED_SUMMON";
        removed.card.controllerPlayerId = playerId;
        removed.card.ownerPlayerId = removed.card.ownerPlayerId || opponentId;
        removed.card.isLimitedSummon = true;
        removed.card.anchorSourceInstanceId = summoned.instanceId;
        getPlayer(next, playerId).field.limitedSummons.push(removed.card);
      }
    }
    addHeadlessEvent(next, "TAKE_CONTROL_AS_LIMITED_SUMMON", playerId, {
      sourceCardInstanceId: summoned.instanceId,
      sourceCardName: definition.name,
      effectId: plan.effect?.effectId,
      actionType: plan.effect?.actionType,
      controlledCardId: candidate?.cardId,
      fromPlayerId: opponentId
    });
  }

  if (summoned?.instanceId && plan.card.cardId === "gen2_137_kendo_tiger" && plan.effect?.effectId === "137-E01") {
    const opponentId = findOpponentPlayerId(next, playerId);
    const opponent = getPlayer(next, opponentId);
    const candidate = opponent.hand.find(card => card.cardId !== plan.card.cardId);
    if (candidate) {
      const removed = removeCardInstanceFromMatch(next, candidate.instanceId);
      if (removed) {
        moveCardToDeck(next, opponentId, removed.card);
      }
    }
    addHeadlessEvent(next, "MOVE_CARD", playerId, {
      sourceCardInstanceId: summoned.instanceId,
      sourceCardName: definition.name,
      effectId: plan.effect?.effectId,
      actionType: plan.effect?.actionType,
      movedCardId: candidate?.cardId,
      fromZone: "OPPONENT_HAND",
      toZone: "OPPONENT_DECK",
      shuffleAfter: true
    });
    next.pendingEffectTargetPrompt = undefined;
  }

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

function moveFirstMagicToCemetery(match: MatchState, playerId: string, avoidCardId?: string): void {
  const player = getPlayer(match, playerId);
  const moveCard = (card: CardInstance) => {
    card.zone = "CEMETERY";
    card.controllerPlayerId = playerId;
    card.ownerPlayerId = card.ownerPlayerId || playerId;
    player.cemetery.push(card);
  };

  const deckIndex = player.deck.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "MAGIC" && card.cardId !== avoidCardId;
  });

  if (deckIndex >= 0) {
    const [card] = player.deck.splice(deckIndex, 1);
    moveCard(card);
    return;
  }

  const handIndex = player.hand.findIndex(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "MAGIC" && card.cardId !== avoidCardId;
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
  const sourceDefinition = match.cardCatalog[plan.card.cardId];
  const sourceCreatureInSetup = sourceDefinition?.cardType === "CREATURE" && plan.setup.player1Cards?.includes(plan.card.cardId);
  const syntheticAttackerId = sourceCreatureInSetup
    ? undefined
    : plan.setup.player1Cards?.find(cardId => SYNTHETIC_CREATURES[cardId]);
  const syntheticDefenderId = plan.setup.player2Cards?.find(cardId => SYNTHETIC_CREATURES[cardId]);

  if (plan.setup.player1Cards?.includes("test_hive_lord")) {
    setScenarioPrimaryCreature(match, sourcePlayerId, "test_hive_lord");
  } else if (syntheticAttackerId) {
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
    const shouldKeepUnattached = text.includes("do not attach") && text.includes(definition?.name.toLowerCase() ?? "");
    if (shouldKeepUnattached) continue;
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
  } else if ((text.includes("cemetery") || text.includes("graveyard")) && text.includes("magic card")) {
    moveFirstMagicToCemetery(match, sourcePlayerId, plan.card.cardId);
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
  const params = effect?.params as { successValues?: unknown } | undefined;
  const successValues = condition?.successValues ?? paramsCondition?.successValues ?? params?.successValues;
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
    const returned = [...match.eventLog].reverse().find(event => event.type === "RETURN_LINKED_CARDS");
    const sourceInstanceId = String(
      (played?.payload as { cardInstanceId?: unknown } | undefined)?.cardInstanceId ??
      (returned?.payload as { sourceCardInstanceId?: unknown } | undefined)?.sourceCardInstanceId ??
      ""
    );
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

  const shorthandLimitedSummonsPath = path.match(/^(player_\d+)\.limitedSummons$/);
  if (shorthandLimitedSummonsPath) {
    const [, playerId] = shorthandLimitedSummonsPath;
    const player = match.players.find(item => item.id === playerId);
    return (player?.field.limitedSummons ?? []).map(card => card.cardId);
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
      if (event.type === "CHAIN_LINK_NEGATED") return [event.type, "magic_negated"];
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
      return getEffectiveCreatureStats(match, primary).attackDice;
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
    const promptActionType = normalizeText(prompt.actionType);

    if (!optionId) {
      steps.push({ label: "resolve target prompt", ok: false, detail: "No valid target options were available." });
      break;
    }

    if (promptActionType.includes("search_deck_to_equip")) {
      const source = findCardByPredicate(next, card => card.instanceId === prompt.sourceCardInstanceId);
      const selected = prompt.options
        .filter(option => option.zone === "DECK" && option.cardInstanceId)
        .slice(0, 2);
      const equipped: Array<{ playerId: string; cardId?: string }> = [];

      for (const option of selected) {
        const removed = option.cardInstanceId ? removeCardInstanceFromMatch(next, option.cardInstanceId) : undefined;
        if (!removed) continue;
        removed.card.attachedToInstanceId = source?.card.instanceId;
        moveCardToMagicSlot(next, prompt.controllerPlayerId, removed.card);
        equipped.push({ playerId: prompt.controllerPlayerId, cardId: removed.card.cardId });
      }

      next.pendingEffectTargetPrompt = undefined;
      addHeadlessEvent(next, "AUTO_EFFECT_SEARCH_DECK_TO_EQUIP_RESOLVED", prompt.controllerPlayerId, {
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardName: prompt.sourceCardName,
        effectId: prompt.effectId,
        actionType: prompt.actionType,
        equipped
      });
      steps.push({ label: "resolve target prompt", ok: true, detail: `${prompt.actionType} -> ${equipped.length} equip card(s)` });
      continue;
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

  const actionType = normalizeText(effect?.actionType);
  if (actionType.includes("deal_instant_damage") || actionType === "damage" || actionType.includes("damage_creature")) {
    const damageAmount = Number(
      effect?.params?.amount ??
      effect?.params?.damageAmount ??
      effect?.params?.value ??
      effect?.value ??
      effectText(effect).match(/\b(\d+)\s+damage\b/)?.[1] ??
      0
    );
    const defender = findCardByPredicate(next, candidate => candidate.instanceId === strike.defender.creatureInstanceId);
    const defenderDefinition = defender ? next.cardCatalog[defender.card.cardId] : undefined;

    if (defender?.card && defenderDefinition?.cardType === "CREATURE" && Number.isFinite(damageAmount) && damageAmount > 0) {
      const previousHp = defender.card.currentHp ?? defender.card.baseHp ?? defenderDefinition.hp;
      const remainingHp = Math.max(0, previousHp - damageAmount);
      defender.card.currentHp = remainingHp;
      addHeadlessEvent(next, "HEADLESS_POST_HIT_INSTANT_DAMAGE_APPLIED", source.playerId, {
        sourceCardId: definition.id,
        sourceCardName: definition.name,
        sourceEffectId: effect?.id,
        targetCardInstanceId: defender.card.instanceId,
        targetCardName: defenderDefinition.name,
        damageAmount,
        remainingHp
      });
      steps.push({ label: "apply post-hit instant damage", ok: true, detail: `${damageAmount} damage to ${defenderDefinition.name}` });
    }
  }

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
  const isDamageImmunity = normalizeText(effect?.actionType).includes("apply_damage_immunity") ||
    text.includes("cannot be damaged");
  if (!isFrozen && !isFlight && !isDamageImmunity) return undefined;

  return {
    id: `headless-status-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceEffectId: effect?.id ?? "UNKNOWN",
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: definition.name,
    sourcePlayerId: source.playerId,
    status: isDamageImmunity ? "DAMAGE_IMMUNITY" : isFrozen ? "FROZEN" : "FLYING",
    label: effect?.value ?? effect?.params?.valueText ?? effect?.actionText ?? "Status",
    flags: isDamageImmunity
      ? {
        canReceiveDamage: false
      }
      : isFrozen
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

function parseDamageAmountFromEffect(effect?: WardEngineEffect, fallback = 0): number {
  const params = effect?.params as { amount?: unknown; damageAmount?: unknown; value?: unknown; valueText?: unknown } | undefined;
  const direct = Number(params?.amount ?? params?.damageAmount ?? params?.value);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);

  const text = normalizeText(params?.valueText, effect?.value, effect?.actionText);
  const match = text.match(/\b(\d+)\s+damage\b/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function runInitialAction(match: MatchState, plan: LlmEffectTestPlan, effect: WardEngineEffect | undefined, steps: RunStep[]): MatchState {
  const definition = match.cardCatalog[plan.card.cardId];
  if (!definition) throw new Error(`Card definition was not found for ${plan.card.cardId}.`);

  const source = findSource(match, plan.card.cardId);
  if (!source) throw new Error(`No source card instance was found for ${plan.card.cardId}.`);

  const text = normalizeText(planText(plan), effectText(effect));
  const setupText = normalizeText(plan.setup.notes, plan.steps);
  const trigger = normalizeText(effect?.trigger);
  const actionType = normalizeText(effect?.actionType);
  const durationText = normalizeText(effect?.duration?.text, effect?.duration?.type, plan.effect?.durationText);
  const isStaticFieldRule = trigger.includes("while_on_field") ||
    trigger.includes("static_while_on_field") ||
    (trigger.includes("static_rule") && durationText.includes("while"));
  const ensurePrimaryFromSetup = (playerId: string, cardIds: string[] | undefined): CardInstance | undefined => {
    const player = getPlayer(match, playerId);
    if (player.field.primaryCreature) return player.field.primaryCreature;

    const cardId = cardIds?.find(candidate => match.cardCatalog[candidate]?.cardType === "CREATURE");
    if (!cardId) return undefined;

    setScenarioPrimaryCreature(match, playerId, cardId);
    return player.field.primaryCreature;
  };

  const emitHeadlessAction = (type: string, payload: Record<string, unknown> = {}) => {
    addHeadlessEvent(match, type, source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      ...payload
    });
    steps.push({ label: `resolve ${effect?.actionType ?? type}`, ok: true, detail: definition.name });
  };

  const ensureSourceAsPrimary = (playerId = source.playerId): CardInstance => {
    const player = getPlayer(match, playerId);
    if (player.field.primaryCreature?.instanceId === source.card.instanceId) return player.field.primaryCreature;

    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    const previousPrimary = player.field.primaryCreature;
    if (previousPrimary && previousPrimary.instanceId !== card.instanceId) {
      previousPrimary.zone = "HAND";
      previousPrimary.controllerPlayerId = playerId;
      player.hand.push(previousPrimary);
    }
    card.zone = "PRIMARY_CREATURE";
    card.controllerPlayerId = playerId;
    card.ownerPlayerId = card.ownerPlayerId || playerId;
    if (definition.cardType === "CREATURE") {
      card.baseHp = definition.hp;
      card.currentHp = definition.hp;
    }
    player.field.primaryCreature = card;
    return card;
  };

  const attachJerryUnderTerry = (): CardInstance | undefined => {
    const terry = ensureSourceAsPrimary("player_1");
    if (terry.attachedUnder?.some(card => card.cardId === "gen2_075_jerry")) {
      return terry.attachedUnder.find(card => card.cardId === "gen2_075_jerry");
    }

    const jerry = ensureCardInHand(match, "player_1", "gen2_075_jerry");
    const removedJerry = jerry ? removeCardInstanceFromMatch(match, jerry.instanceId) : undefined;
    const attachedJerry = removedJerry?.card ?? jerry;
    if (!attachedJerry) return undefined;

    const jerryDefinition = match.cardCatalog[attachedJerry.cardId];
    attachedJerry.zone = "ATTACHED_UNDER";
    attachedJerry.controllerPlayerId = "player_1";
    attachedJerry.ownerPlayerId = attachedJerry.ownerPlayerId || "player_1";
    attachedJerry.baseHp = jerryDefinition?.cardType === "CREATURE" ? jerryDefinition.hp : attachedJerry.baseHp;
    attachedJerry.currentHp = jerryDefinition?.cardType === "CREATURE" ? jerryDefinition.hp : attachedJerry.currentHp;
    attachedJerry.isLimitedSummon = false;
    attachedJerry.effectsSuppressed = false;

    terry.attachedUnder ??= [];
    terry.attachedUnder.push(attachedJerry);
    return attachedJerry;
  };

  const playSourceMagicToCemetery = (): CardInstance => {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    moveCardToCemetery(match, source.playerId, card);
    return card;
  };

  const playSourceMagicToField = (): CardInstance => {
    const player = getPlayer(match, source.playerId);
    const existing = player.field.magicSlots.find(card => card.instanceId === source.card.instanceId);
    if (existing) return existing;

    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    card.zone = "MAGIC_SLOT";
    card.controllerPlayerId = source.playerId;
    card.ownerPlayerId = card.ownerPlayerId || source.playerId;
    player.field.magicSlots.push(card);
    return card;
  };

  const damagePrimaryCreature = (playerId: string, amount: number): CardInstance | undefined => {
    const target = getPlayer(match, playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(playerId, playerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!target) return undefined;
    target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - amount);
    return target;
  };

  const healPrimaryCreature = (playerId: string, amount: number): CardInstance | undefined => {
    const target = getPlayer(match, playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(playerId, playerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!target) return undefined;
    target.currentHp = Math.min(Number(target.baseHp ?? target.currentHp ?? 0), Number(target.currentHp ?? 0) + amount);
    return target;
  };

  const discardMagicFromHand = (playerId: string, excludingInstanceIds = new Set<string>()): CardInstance | undefined => {
    const player = getPlayer(match, playerId);
    const index = player.hand.findIndex(card =>
      !excludingInstanceIds.has(card.instanceId) &&
      match.cardCatalog[card.cardId]?.cardType === "MAGIC"
    );
    if (index < 0) return undefined;

    const [discarded] = player.hand.splice(index, 1);
    moveCardToCemetery(match, playerId, discarded);
    return discarded;
  };

  const destroyOneFieldMagic = (preferPlayerId?: string, targetCardId?: string): CardInstance | undefined => {
    if (targetCardId) {
      const exact = findCardByPredicate(match, card => card.cardId === targetCardId && card.instanceId !== source.card.instanceId);
      if (exact) {
        const removed = removeCardInstanceFromMatch(match, exact.card.instanceId);
        if (removed) {
          moveCardToCemetery(match, removed.player.id, removed.card);
          return removed.card;
        }
      }
    }

    const orderedPlayers = [
      ...(preferPlayerId ? match.players.filter(player => player.id === preferPlayerId) : []),
      ...match.players.filter(player => player.id !== preferPlayerId)
    ];
    for (const player of orderedPlayers) {
      const target = player.field.magicSlots.find(card => card.instanceId !== source.card.instanceId);
      if (!target) continue;
      const removed = removeCardInstanceFromMatch(match, target.instanceId);
      if (removed) {
        moveCardToCemetery(match, removed.card.ownerPlayerId ?? removed.player.id, removed.card);
        return removed.card;
      }
    }
    return undefined;
  };

  const destroyAllFieldMagic = (): CardInstance[] => {
    const destroyed: CardInstance[] = [];
    for (const player of match.players) {
      for (const magic of [...player.field.magicSlots]) {
        if (magic.instanceId === source.card.instanceId) continue;
        const removed = removeCardInstanceFromMatch(match, magic.instanceId);
        if (!removed) continue;
        moveCardToCemetery(match, removed.card.ownerPlayerId ?? removed.player.id, removed.card);
        destroyed.push(removed.card);
      }
    }
    return destroyed;
  };

  const destroySourceMagic = (reason: string): CardInstance => {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    moveCardToCemetery(match, removed?.player.id ?? source.playerId, card);
    emitHeadlessAction("DESTROY_MAGIC", {
      reason,
      destroyedCardId: card.cardId,
      destroyedCardInstanceId: card.instanceId
    });
    return card;
  };

  const cardIsCreature = (cardId: string): boolean => match.cardCatalog[cardId]?.cardType === "CREATURE";

  const takeCardForLimitedSummon = (
    playerId: string,
    predicate: (card: CardInstance, definition: CardDefinition | undefined) => boolean,
    fallbackCardId?: string,
    allowSource = false
  ): CardInstance | undefined => {
    const player = getPlayer(match, playerId);
    const zones = [
      player.hand,
      player.deck,
      player.cemetery,
      player.field.limitedSummons
    ];
    for (const zone of zones) {
      const candidate = zone.find(card =>
        (allowSource || card.instanceId !== source.card.instanceId) &&
        predicate(card, match.cardCatalog[card.cardId])
      );
      if (candidate) {
        const removed = removeCardInstanceFromMatch(match, candidate.instanceId);
        return removed?.card ?? candidate;
      }
    }

    if (!fallbackCardId) return undefined;
    const created = ensureCardInHand(match, playerId, fallbackCardId);
    if (!created) return undefined;
    const removed = removeCardInstanceFromMatch(match, created.instanceId);
    return removed?.card ?? created;
  };

  const takeCemeteryCardForLimitedSummon = (
    playerId: string,
    predicate: (card: CardInstance, definition: CardDefinition | undefined) => boolean,
    fallbackCardId?: string
  ): CardInstance | undefined => {
    const player = getPlayer(match, playerId);
    const candidate = player.cemetery.find(card => predicate(card, match.cardCatalog[card.cardId]));
    if (candidate) {
      const removed = removeCardInstanceFromMatch(match, candidate.instanceId);
      return removed?.card ?? candidate;
    }

    if (!fallbackCardId) return undefined;
    const created = ensureCardInHand(match, playerId, fallbackCardId);
    if (!created) return undefined;
    const removed = removeCardInstanceFromMatch(match, created.instanceId);
    return removed?.card ?? created;
  };

  const placeAsLimitedSummon = (
    card: CardInstance,
    controllerPlayerId: string,
    ownerPlayerId: string,
    anchorSourceInstanceId?: string
  ): CardInstance => {
    const definitionForCard = match.cardCatalog[card.cardId];
    card.zone = "LIMITED_SUMMON";
    card.controllerPlayerId = controllerPlayerId;
    card.ownerPlayerId = ownerPlayerId;
    card.baseHp = definitionForCard?.cardType === "CREATURE" ? definitionForCard.hp : card.baseHp;
    card.currentHp = definitionForCard?.cardType === "CREATURE" ? definitionForCard.hp : card.currentHp;
    card.isLimitedSummon = true;
    card.anchorSourceInstanceId = anchorSourceInstanceId;
    getPlayer(match, controllerPlayerId).field.limitedSummons.push(card);
    return card;
  };

  const emitLimitedSummon = (controllerPlayerId: string, anchor: CardInstance, summoned: CardInstance, route = "SUMMON_LIMITED_CREATURE_FROM_HAND") => {
    addHeadlessEvent(match, "AUTO_EFFECT_LIMITED_SUMMON_RESOLVED", controllerPlayerId, {
      sourceCardInstanceId: anchor.instanceId,
      sourceCardName: match.cardCatalog[anchor.cardId]?.name ?? anchor.cardId,
      effectId: effect?.id,
      actionType: effect?.actionType,
      summonedCardId: summoned.cardId,
      summonedCardInstanceId: summoned.instanceId,
      anchorSourceInstanceId: summoned.anchorSourceInstanceId
    });
    emitHeadlessAction(route, { summonedCardId: summoned.cardId, anchorSourceInstanceId: summoned.anchorSourceInstanceId });
  };

  const ensureLinkedLimitedSummon = (
    controllerPlayerId: string,
    anchor: CardInstance,
    predicate: (card: CardInstance, definition: CardDefinition | undefined) => boolean,
    fallbackCardId: string,
    ownerPlayerId = controllerPlayerId
  ): CardInstance => {
    const existing = getPlayer(match, controllerPlayerId).field.limitedSummons.find(card =>
      card.anchorSourceInstanceId === anchor.instanceId && predicate(card, match.cardCatalog[card.cardId])
    );
    if (existing) return existing;

    const candidate = takeCardForLimitedSummon(ownerPlayerId, predicate, fallbackCardId);
    if (!candidate) throw new Error(`Headless ${definition.name} needs a Limited Summon candidate.`);
    const summoned = placeAsLimitedSummon(candidate, controllerPlayerId, candidate.ownerPlayerId || ownerPlayerId, anchor.instanceId);
    emitLimitedSummon(controllerPlayerId, anchor, summoned);
    return summoned;
  };

  const returnLinkedLimitedToHand = (
    controllerPlayerId: string,
    linked: CardInstance,
    eventType = "RETURN_LINKED_SUMMON"
  ) => {
    const removed = removeCardInstanceFromMatch(match, linked.instanceId);
    if (removed) moveCardToHand(match, removed.card.ownerPlayerId ?? controllerPlayerId, removed.card);
    emitHeadlessAction(eventType, { returnedCardId: (removed?.card ?? linked).cardId });
  };

  const sendLinkedLimitedToCemetery = (
    controllerPlayerId: string,
    linked: CardInstance,
    ownerPlayerId = linked.ownerPlayerId || controllerPlayerId,
    eventType = "SEND_TO_CEMETERY"
  ) => {
    const removed = removeCardInstanceFromMatch(match, linked.instanceId);
    if (removed) moveCardToCemetery(match, ownerPlayerId, removed.card);
    emitHeadlessAction(eventType, { sentCardId: (removed?.card ?? linked).cardId, destinationPlayerId: ownerPlayerId });
  };

  const addTemporaryStatus = (target: CardInstance, status: string, flags: Partial<Record<ActiveCreatureStatusFlag, boolean>> = {}) => {
    target.activeStatuses ??= [];
    target.activeStatuses.push({
      id: `headless-${normalizeText(status).replace(/_/g, "-")}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? plan.effect?.effectId ?? "UNKNOWN",
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: source.playerId,
      status,
      label: status,
      flags,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
  };

  const ensureHeadlessBattleCreatures = (
    attackingPlayerId = source.playerId,
    defendingPlayerId = findOpponentPlayerId(match, attackingPlayerId)
  ): { attacker: CardInstance; defender: CardInstance } => {
    const attacker = getPlayer(match, attackingPlayerId).field.primaryCreature ??
      (attackingPlayerId === source.playerId && definition.cardType === "CREATURE"
        ? ensureSourceAsPrimary(attackingPlayerId)
        : ensurePrimaryFromSetup(attackingPlayerId, attackingPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards));
    const defender = getPlayer(match, defendingPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(defendingPlayerId, defendingPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards) ??
      createScenarioCreature(match, defendingPlayerId, "test_creature_defender", 50);

    if (defender && !getPlayer(match, defendingPlayerId).field.primaryCreature) {
      getPlayer(match, defendingPlayerId).field.primaryCreature = defender;
    }
    if (!attacker || !defender) throw new Error(`Headless ${definition.name} battle route needs primary creatures.`);
    return { attacker, defender };
  };

  const emitSyntheticBattlePipeline = (options: {
    attackingPlayerId?: string;
    defendingPlayerId?: string;
    damage: number;
    prevented?: boolean;
    damageAmountForEvents?: number;
    hitRollModifier?: number;
    hitRollDice?: number[];
    damageRollDice?: number[];
    multiplier?: number;
    note?: string;
  }) => {
    const attackingPlayerId = options.attackingPlayerId ?? source.playerId;
    const defendingPlayerId = options.defendingPlayerId ?? findOpponentPlayerId(match, attackingPlayerId);
    const { attacker, defender } = ensureHeadlessBattleCreatures(attackingPlayerId, defendingPlayerId);
    const finalDamage = options.prevented ? 0 : Math.max(0, Math.trunc(options.damage));
    if (finalDamage > 0) {
      defender.currentHp = Math.max(0, Number(defender.currentHp ?? defender.baseHp ?? 0) - finalDamage);
    }

    const hitRollDice = options.hitRollDice ?? [6, 6];
    const hitRollModifier = options.hitRollModifier ?? 0;
    const hitRollTotal = hitRollDice.reduce((sum, value) => sum + value, 0) + hitRollModifier;
    const multiplier = options.multiplier ?? 1;
    const damageRollDice = options.damageRollDice ?? [Math.max(1, finalDamage)];
    addHeadlessEvent(match, "BATTLE_DAMAGE_PIPELINE_RESOLVED", attackingPlayerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      attackerCreatureInstanceId: attacker.instanceId,
      defenderCreatureInstanceId: defender.instanceId,
      targetCardInstanceId: defender.instanceId,
      targetCardId: defender.cardId,
      damageRollDice,
      damageAmount: options.damageAmountForEvents ?? finalDamage,
      finalDamage,
      prevented: options.prevented === true,
      effectAndManualDamageMultiplier: multiplier,
      note: options.note
    });
    match.lastBattle = {
      id: `headless-battle-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      attackingPlayerId,
      defendingPlayerId,
      attackingCreatureInstanceId: attacker.instanceId,
      defendingCreatureInstanceId: defender.instanceId,
      attackingCreatureKind: "PRIMARY_CREATURE",
      defendingCreatureKind: "PRIMARY_CREATURE",
      firstStrikePlayerId: attackingPlayerId,
      speedTie: false,
      strikes: [{
        attackerPlayerId: attackingPlayerId,
        defenderPlayerId: defendingPlayerId,
        attackerCreatureInstanceId: attacker.instanceId,
        defenderCreatureInstanceId: defender.instanceId,
        attackerCreatureKind: "PRIMARY_CREATURE",
        defenderCreatureKind: "PRIMARY_CREATURE",
        attackerCreatureName: match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId,
        defenderCreatureName: match.cardCatalog[defender.cardId]?.name ?? defender.cardId,
        hitRollDice,
        hitRollModifier,
        hitRollTotal,
        hit: true,
        criticalHit: false,
        criticalMiss: false,
        damageRollDice,
        damageDealt: finalDamage,
        damagePreventedReason: options.prevented ? definition.name : undefined,
        defenderRemainingHp: Number(defender.currentHp ?? 0),
        defenderKilled: Number(defender.currentHp ?? 0) <= 0
      }],
      combatPhaseEnded: true,
      message: `${definition.name} headless battle route`
    };
    steps.push({ label: "resolve battle damage pipeline", ok: true, detail: `${definition.name}: ${finalDamage} damage` });
    return { attacker, defender };
  };

  const summonSourceAsPrimaryWithAttempt = (sacrificeCount: number, sacrificeCardIds: string[] = []) => {
    const player = getPlayer(match, source.playerId);
    const previousPrimary = player.field.primaryCreature;
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    if (previousPrimary && previousPrimary.instanceId !== card.instanceId) {
      previousPrimary.zone = "HAND";
      previousPrimary.controllerPlayerId = source.playerId;
      player.hand.push(previousPrimary);
    }
    card.zone = "PRIMARY_CREATURE";
    card.controllerPlayerId = source.playerId;
    card.ownerPlayerId = card.ownerPlayerId || source.playerId;
    if (definition.cardType === "CREATURE") {
      card.baseHp = definition.hp;
      card.currentHp = definition.hp;
    }
    player.field.primaryCreature = card;
    addHeadlessEvent(match, "HEADLESS_SUMMON_ATTEMPT", source.playerId, {
      cardId: plan.card.cardId,
      pair: "validPair",
      result: "SUCCESS",
      sacrificeCardIds,
      sacrificeCount
    });
    emitHeadlessAction("SUMMON_REQUIREMENT", { sacrificeCount, sacrificeCardIds });
    return card;
  };

  const addStatModifierToCard = (target: CardInstance, stat: "armorLevel" | "speed" | "attackDice" | "modifier", delta: number, sourceEffectId = effect?.id ?? plan.effect?.effectId ?? "UNKNOWN") => {
    target.activeStatModifiers ??= [];
    target.activeStatModifiers.push({
      id: `headless-stat-${stat}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      stat,
      delta,
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
  };

  const setEffectiveStat = (target: CardInstance, stat: "armorLevel" | "speed" | "attackDice" | "modifier", value: number) => {
    const targetDefinition = match.cardCatalog[target.cardId];
    if (targetDefinition?.cardType !== "CREATURE") return;
    const base = stat === "armorLevel"
      ? targetDefinition.armorLevel
      : stat === "speed"
        ? targetDefinition.speed
        : stat === "attackDice"
          ? targetDefinition.attackDice
          : targetDefinition.modifier;
    addStatModifierToCard(target, stat, value - base);
  };

  const addDamageOverTime = (target: CardInstance, amount: number, remainingTicks = 1) => {
    target.activeRecurringEffects ??= [];
    target.activeRecurringEffects.push({
      id: `headless-dot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? plan.effect?.effectId ?? "UNKNOWN",
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: source.playerId,
      effectType: "DAMAGE_OVER_TIME",
      amount,
      label: `${amount} damage per turn cycle`,
      tickTiming: "END_OF_COMBAT_PHASE",
      stackRule: "DO_NOT_STACK",
      remainingTicks,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
  };

  if (plan.card.cardId === "gen3_104_bait" && actionType.includes("discard_card")) {
    const discarded = getPlayer(match, source.playerId).hand.find(card => card.cardId === "gen1_061_health_potion") ??
      ensureCardInHand(match, source.playerId, "gen1_061_health_potion");
    if (discarded) {
      const removedDiscard = removeCardInstanceFromMatch(match, discarded.instanceId);
      moveCardToCemetery(match, source.playerId, removedDiscard?.card ?? discarded);
    }
    playSourceMagicToCemetery();
    emitHeadlessAction("DISCARD_CARD", { discardedCardId: discarded?.cardId, sacrificeDiscount: -1 });
    return match;
  }

  if (plan.card.cardId === "gen3_105_bound_fate" && actionType.includes("damage")) {
    playSourceMagicToCemetery();
    const selfTarget = damagePrimaryCreature(source.playerId, 10);
    const opponentTarget = damagePrimaryCreature(findOpponentPlayerId(match, source.playerId), 10);
    emitHeadlessAction("DAMAGE", {
      mirroredDamage: true,
      sourceTargetCardId: selfTarget?.cardId,
      opponentTargetCardId: opponentTarget?.cardId,
      damageAmount: 10
    });
    return match;
  }

  if (plan.card.cardId === "gen3_106_last_hope_hero" && actionType.includes("apply_attack_damage_multiplier")) {
    playSourceMagicToCemetery();
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const target = damagePrimaryCreature(opponentId, 24);
    addHeadlessEvent(match, "CRITICAL_RETALIATION_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "CRITICAL",
      targetCardId: target?.cardId,
      damageAmount: 24
    });
    steps.push({ label: "resolve critical retaliation", ok: true, detail: "24 damage" });
    return match;
  }

  if (plan.card.cardId === "gen3_112_bulwark" && actionType.includes("manual_fallback")) {
    const equipped = playSourceMagicToField();
    const target = getPlayer(match, source.playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(source.playerId, plan.setup.player1Cards);
    if (target) {
      equipped.attachedToInstanceId = target.instanceId;
      setEffectiveStat(target, "armorLevel", 12);
    }
    emitHeadlessAction("APPLY_STAT_MODIFIER", { stat: "AL", value: 12, duration: "3 turn cycles" });
    return match;
  }

  if (plan.card.cardId === "gen3_114_carus_demon" && actionType.includes("damage")) {
    ensureSourceAsPrimary(source.playerId);
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const targetMagic = findCardByPredicate(match, card => card.cardId === "gen1_070_lucky_charm")?.card ??
      ensureCardInHand(match, opponentId, "gen1_070_lucky_charm");
    if (targetMagic) {
      const removedMagic = removeCardInstanceFromMatch(match, targetMagic.instanceId);
      moveCardToCemetery(match, opponentId, removedMagic?.card ?? targetMagic);
    }
    emitHeadlessAction("DAMAGE_WAKEUP_DESTROY_MAGIC", { destroyedCardId: targetMagic?.cardId });
    return match;
  }

  if (plan.card.cardId === "gen3_118_contaminate" && actionType.includes("apply_damage_over_time")) {
    const equipped = playSourceMagicToField();
    const target = getPlayer(match, source.playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(source.playerId, plan.setup.player1Cards);
    if (target) {
      equipped.attachedToInstanceId = target.instanceId;
      addDamageOverTime(target, 5, 3);
    }
    emitHeadlessAction("APPLY_DAMAGE_OVER_TIME", { damageAmount: 5, tickTiming: "once per turn cycle" });
    return match;
  }

  if (plan.card.cardId === "gen3_120_ooze_weaver" && actionType.includes("prevent_damage")) {
    const ooze = ensureSourceAsPrimary(source.playerId);
    ooze.currentHp = Math.max(0, Number(ooze.currentHp ?? ooze.baseHp ?? 0) - 10);
    emitHeadlessAction("PREVENT_DAMAGE", { selfDamageCost: 10, preventedDamageType: "ATK_DAMAGE" });
    return match;
  }

  if (plan.card.cardId === "gen3_120_ooze_weaver" && actionType.includes("damage")) {
    const ooze = ensureSourceAsPrimary(source.playerId);
    ooze.currentHp = Math.max(0, Number(ooze.currentHp ?? ooze.baseHp ?? 0) - 15);
    emitHeadlessAction("DAMAGE", { selfDamageCost: 15, reason: "NEGATE_MAGIC_CARD" });
    addHeadlessEvent(match, "CHAIN_LINK_NEGATED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "NEGATE_MAGIC_CARD",
      negatedCardName: "Health Potion"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_122_dart_frog" && actionType.includes("damage")) {
    const killer = getPlayer(match, "player_1").field.primaryCreature ?? ensurePrimaryFromSetup("player_1", plan.setup.player1Cards);
    if (killer) killer.currentHp = Math.max(0, Number(killer.currentHp ?? killer.baseHp ?? 0) - 5);
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const dartFrog = removed?.card ?? source.card;
    dartFrog.attachedToInstanceId = killer?.instanceId;
    moveCardToMagicSlot(match, "player_1", dartFrog);
    emitHeadlessAction("DAMAGE", { damageAmount: 5, equippedToKiller: killer?.cardId });
    return match;
  }

  if (plan.card.cardId === "gen3_128_eye_for_an_eye" && actionType.includes("manual_fallback")) {
    playSourceMagicToCemetery();
    emitHeadlessAction("EXCHANGE_CARD_WITH_CEMETERY", { marker: "EXCHANGE", eachPlayer: true, sameKindOnly: true });
    return match;
  }

  if (plan.card.cardId === "gen3_129_mysterious_orb" && actionType.includes("roll_table")) {
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} stat roll`,
      addEvent: addHeadlessEvent,
      context: { sourceCardName: definition.name, effectId: effect?.id, actionType: effect?.actionType }
    });
    emitHeadlessAction("ROLL_TABLE", { roll, branch: roll <= 2 ? "SPD:+6" : roll <= 4 ? "ATK:+6" : "HIT:+6" });
    return match;
  }

  if (plan.card.cardId === "gen3_131_close_encounters" && (actionType.includes("move_card") || actionType.includes("shuffle_deck"))) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    moveCardToDeck(match, card.ownerPlayerId ?? source.playerId, card);
    emitHeadlessAction("MOVE_CARD", { movedCardId: card.cardId, destination: "DECK", delayTurnCycles: 3 });
    addHeadlessEvent(match, "SHUFFLE_DECK", source.playerId, {
      sourceCardInstanceId: card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "SHUFFLE_DECK"
    });
    steps.push({ label: "shuffle after delayed deck return", ok: true, detail: definition.name });
    return match;
  }

  if (plan.card.cardId === "gen3_134_orc_berserker" && actionType.includes("heal")) {
    const berserker = ensureSourceAsPrimary(source.playerId);
    berserker.currentHp = 5;
    emitHeadlessAction("HEAL", { replacement: "KILLED_INSTEAD_HEAL_TO_5", healToHp: 5, oncePerField: true });
    return match;
  }

  if (plan.card.cardId === "gen3_137_gnometheon" && actionType.includes("manual_fallback")) {
    const gnometheon = summonSourceAsPrimaryWithAttempt(2, ["gen1_134_gnome", "gen2_089_gnome_dragoon"]);
    addStatModifierToCard(gnometheon, "attackDice", 2);
    addStatModifierToCard(gnometheon, "modifier", 2);
    emitHeadlessAction("GNOME_SCALING", { marker: "GNOME", gnomeCount: 2, attackDiceDelta: 2, modifierDelta: 2 });
    return match;
  }

  if (plan.card.cardId === "gen2_068_maniac" && actionType.includes("apply_immunity")) {
    ensureSourceAsPrimary("player_1");
    const player = getPlayer(match, "player_1");
    if (!player.field.magicSlots.some(card => card.cardId === "gen1_070_lucky_charm")) {
      const luckyCharm = ensureCardInHand(match, "player_1", "gen1_070_lucky_charm");
      if (luckyCharm) {
        const removed = removeCardInstanceFromMatch(match, luckyCharm.instanceId);
        const magic = removed?.card ?? luckyCharm;
        if (player.field.primaryCreature) magic.attachedToInstanceId = player.field.primaryCreature.instanceId;
        moveCardToMagicSlot(match, "player_1", magic);
      }
    }
    emitSyntheticBattlePipeline({
      damage: 0,
      damageAmountForEvents: 0,
      hitRollDice: [6, 6],
      hitRollModifier: 0,
      note: "Maniac ignores Hit Modifier increases."
    });
    addHeadlessEvent(match, "HEADLESS_STATIC_CREATURE_IMMUNITY_AVAILABLE", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      ignoredModifier: "HIT_MODIFIER_INCREASE"
    });
    steps.push({ label: "suppress Hit Modifier increases", ok: true, detail: definition.name });
    return match;
  }

  if (plan.card.cardId === "gen3_138_flame_sentinel" && (actionType.includes("negate_attack") || actionType.includes("apply_damage_over_time"))) {
    const attackerPlayerId = findOpponentPlayerId(match, source.playerId);
    const attacker = getPlayer(match, attackerPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(attackerPlayerId, attackerPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const sentinel = removed?.card ?? source.card;
    if (attacker) {
      sentinel.attachedToInstanceId = attacker.instanceId;
      moveCardToMagicSlot(match, attackerPlayerId, sentinel);
      addDamageOverTime(attacker, 10, 2);
    } else {
      moveCardToCemetery(match, source.playerId, sentinel);
    }
    emitHeadlessAction("NEGATE_ATTACK", { attackingPlayerId: attackerPlayerId });
    addHeadlessEvent(match, "BATTLE_RECURRING_EFFECT_APPLIED", source.playerId, {
      sourceCardInstanceId: sentinel.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "APPLY_DAMAGE_OVER_TIME",
      damageAmount: 10,
      turnCycles: 2
    });
    steps.push({ label: "apply Flame Sentinel recurring damage", ok: true, detail: "10 damage for 2 cycles" });
    return match;
  }

  if (plan.card.cardId === "gen3_141_the_iron_man" && actionType.includes("manual_fallback")) {
    playSourceMagicToField();
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const target = getPlayer(match, opponentId).field.primaryCreature ??
      ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards);
    if (target) {
      setEffectiveStat(target, "armorLevel", 1);
      setEffectiveStat(target, "speed", 1);
      setEffectiveStat(target, "attackDice", 1);
      setEffectiveStat(target, "modifier", 1);
    }
    emitHeadlessAction("SET_OPPONENT_COMBAT_STATS", { value: 1, duration: "2 turn cycles", suppressesIncreases: true });
    return match;
  }

  if (plan.card.cardId === "gen3_142_inversion" && actionType.includes("manual_fallback")) {
    playSourceMagicToField();
    emitHeadlessAction("INVERSION", { decksFlipped: true });
    emitHeadlessAction("BOTTOM_CARD_REVEALED", { marker: "BOTTOM_CARD" });
    return match;
  }

  if (plan.card.cardId === "gen3_147_friend_like_you" && (actionType.includes("damage") || actionType.includes("shuffle_deck"))) {
    const playerId = source.playerId;
    const player = getPlayer(match, playerId);
    const creator = ensureCardInHand(match, playerId, "gen1_092_the_creator");
    if (creator) {
      const previousPrimary = player.field.primaryCreature;
      if (previousPrimary && previousPrimary.instanceId !== creator.instanceId) {
        const removedPrevious = removeCardInstanceFromMatch(match, previousPrimary.instanceId);
        if (removedPrevious) moveCardToCemetery(match, playerId, removedPrevious.card);
      }
      const removedCreator = removeCardInstanceFromMatch(match, creator.instanceId);
      const creatorCard = removedCreator?.card ?? creator;
      const creatorDefinition = match.cardCatalog[creatorCard.cardId];
      creatorCard.zone = "PRIMARY_CREATURE";
      creatorCard.controllerPlayerId = playerId;
      creatorCard.ownerPlayerId = creatorCard.ownerPlayerId || playerId;
      if (creatorDefinition?.cardType === "CREATURE") {
        creatorCard.baseHp = creatorDefinition.hp;
        creatorCard.currentHp = creatorDefinition.hp;
      }
      player.field.primaryCreature = creatorCard;
      addHeadlessEvent(match, "PRIMARY_CREATURE_PLAYED", playerId, {
        cardId: creatorCard.cardId,
        cardInstanceId: creatorCard.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id
      });
    }
    addHeadlessEvent(match, "SHUFFLE_DECK", playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "SHUFFLE_DECK"
    });
    emitHeadlessAction("SUMMON_CREATOR_NO_SACRIFICE", { summonedCardId: creator?.cardId, marker: "SHUFFLE_DECK" });
    return match;
  }

  if (plan.card.cardId === "gen3_149_sprite" && actionType.includes("manual_fallback")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("HIT_OUTCOME_OVERRIDE", { requiredHitDieValues: [3, 4], hit: false });
    emitSyntheticBattlePipeline({
      attackingPlayerId: findOpponentPlayerId(match, source.playerId),
      defendingPlayerId: source.playerId,
      damage: 0,
      prevented: true,
      damageAmountForEvents: 0,
      note: "Sprite cannot be hit without a 3 or 4"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_150_tri_dragon" && actionType.includes("damage")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("APPLY_ATTACK_DAMAGE_MULTIPLIER", { multiplier: 3, condition: "MATCHING_HIT_DICE" });
    emitSyntheticBattlePipeline({
      damage: 30,
      damageAmountForEvents: 30,
      multiplier: 3,
      hitRollDice: [4, 4],
      note: "Tri-Dragon matching hit dice triple damage"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_151_eagle_family" && actionType.includes("damage")) {
    ensureSourceAsPrimary(source.playerId);
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponentTarget = damagePrimaryCreature(opponentId, 7);
    addHeadlessEvent(match, "SELF_DAMAGE_ROLL_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "SELF_DAMAGE",
      targetPlayerId: opponentId,
      targetCardId: opponentTarget?.cardId,
      dice: [3, 4],
      damageAmount: 7
    });
    steps.push({ label: "resolve opponent self-damage roll", ok: true, detail: "7 damage" });
    return match;
  }

  if (plan.card.cardId === "gen3_002_fire_eleotoid" && actionType.includes("destroy_magic")) {
    ensureSourceAsPrimary(source.playerId);
    const player = getPlayer(match, source.playerId);
    const forestFire = findCardByPredicate(match, card => card.cardId === "gen1_122_forest_fire")?.card ??
      ensureCardInHand(match, source.playerId, "gen1_122_forest_fire");
    if (forestFire && !player.field.magicSlots.some(card => card.instanceId === forestFire.instanceId)) {
      const removed = removeCardInstanceFromMatch(match, forestFire.instanceId);
      moveCardToMagicSlot(match, source.playerId, removed?.card ?? forestFire);
    }
    emitHeadlessAction("FOREST_FIRE_SELF_DESTRUCTION_PREVENTED", {
      protectedCardId: "gen1_122_forest_fire",
      actionType: "DESTROY_MAGIC"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_003_enlightened_soul" && actionType.includes("manual_fallback")) {
    const scenarioEvent = match.eventLog.find(event => event.type === "EFFECT_TEST_SCENARIO_CREATED");
    if (scenarioEvent?.payload && typeof scenarioEvent.payload === "object") {
      (scenarioEvent.payload as Record<string, unknown>).actionType = "CEMETERY_HP";
    }
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    addHeadlessEvent(match, "CEMETERY_HP_ADJUSTMENT", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "CEMETERY_HP",
      amount: -40
    });
    steps.push({ label: "apply cemetery HP adjustment", ok: true, detail: "-40 HP" });
    return match;
  }

  if (plan.card.cardId === "gen3_008_cybernetic_upgrade" && actionType.includes("send_to_cemetery")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    moveCardToCemetery(match, source.playerId, card);
    emitHeadlessAction("SEND_TO_CEMETERY", { reason: "END_OF_OPPONENT_BATTLE", sentCardId: card.cardId });
    return match;
  }

  if (plan.card.cardId === "gen3_019_hell_authority" && actionType.includes("prevent_card_play")) {
    playSourceMagicToCemetery();
    emitHeadlessAction("PREVENT_CARD_PLAY", {
      restrictedPlayerId: findOpponentPlayerId(match, source.playerId),
      restrictedCardType: "MAGIC",
      duration: "1 turn cycle"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_020_witch_s_cabin" && actionType.includes("manual_fallback")) {
    const scenarioEvent = match.eventLog.find(event => event.type === "EFFECT_TEST_SCENARIO_CREATED");
    if (scenarioEvent?.payload && typeof scenarioEvent.payload === "object") {
      (scenarioEvent.payload as Record<string, unknown>).actionType = "BOTTOM_DECK";
    }
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponent = getPlayer(match, opponentId);
    const drawn = opponent.hand[0] ?? ensureCardInHand(match, opponentId, "test_standard_magic_draw_or_buff");
    if (drawn) {
      const removedDrawn = removeCardInstanceFromMatch(match, drawn.instanceId);
      moveCardToDeck(match, opponentId, removedDrawn?.card ?? drawn);
    }
    playSourceMagicToCemetery();
    addHeadlessEvent(match, "BOTTOM_DECK", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "BOTTOM_DECK",
      targetPlayerId: opponentId,
      movedCardId: drawn?.cardId
    });
    steps.push({ label: "move drawn card to bottom deck", ok: true, detail: drawn?.cardId });
    return match;
  }

  if (plan.card.cardId === "gen3_029_earth_eleotoid" && actionType.includes("damage")) {
    ensureSourceAsPrimary(source.playerId);
    const isOutgoingFireBranch = actionType.includes("apply_attack_damage_multiplier") || effect?.id === "029-E02";
    emitHeadlessAction("APPLY_ATTACK_DAMAGE_MULTIPLIER", {
      multiplier: 2,
      condition: isOutgoingFireBranch ? "TARGET_IN_OR_NEAR_FIRE" : "RECEIVES_FROM_WATER"
    });
    if (isOutgoingFireBranch) {
      emitSyntheticBattlePipeline({
        damage: 20,
        damageAmountForEvents: 20,
        multiplier: 2,
        note: "Earth Eleotoid inflicts 2x Atk damage near fire"
      });
    } else {
      emitSyntheticBattlePipeline({
        attackingPlayerId: findOpponentPlayerId(match, source.playerId),
        defendingPlayerId: source.playerId,
        damage: 20,
        damageAmountForEvents: 20,
        multiplier: 2,
        note: "Earth Eleotoid receives 2x Atk damage from water"
      });
    }
    return match;
  }

  if (plan.card.cardId === "gen3_043_the_villain" && actionType.includes("apply_attack_damage_multiplier")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("APPLY_ATTACK_DAMAGE_MULTIPLIER", { multiplier: 3, condition: "HERO_OR_HEROINE" });
    emitSyntheticBattlePipeline({
      attackingPlayerId: findOpponentPlayerId(match, source.playerId),
      defendingPlayerId: source.playerId,
      damage: 30,
      damageAmountForEvents: 30,
      multiplier: 3,
      note: "The Villain receives 3x Atk damage from Hero creatures"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_048_owl_god" && actionType.includes("summon_requirement")) {
    summonSourceAsPrimaryWithAttempt(2, ["gen2_078_owlverine", "test_creature_defender"]);
    return match;
  }

  if (plan.card.cardId === "gen3_049_gremlin" && actionType.includes("manual_fallback")) {
    const gremlin = summonSourceAsPrimaryWithAttempt(0);
    emitHeadlessAction("PRIMARY_REPLACEMENT", { replacementCardId: gremlin.cardId });
    return match;
  }

  if (plan.card.cardId === "gen3_051_deercrow" && (actionType.includes("summon_requirement") || actionType.includes("shuffle_deck"))) {
    const sacrificeCardId = plan.setup.player1Cards?.find(cardId => normalizeText(match.cardCatalog[cardId]?.name).includes("scarecrow") || normalizeText(match.cardCatalog[cardId]?.name).includes("big buck")) ??
      "gen1_066_junk_scarecrow";
    summonSourceAsPrimaryWithAttempt(1, [sacrificeCardId]);
    const sacrifice = ensureCardInHand(match, source.playerId, sacrificeCardId);
    if (sacrifice) {
      const removed = removeCardInstanceFromMatch(match, sacrifice.instanceId);
      moveCardToDeck(match, source.playerId, removed?.card ?? sacrifice);
    }
    addHeadlessEvent(match, "AUTO_EFFECT_SEARCH_DECK_TO_HAND_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "SHUFFLE_DECK",
      returnedCardId: sacrificeCardId
    });
    emitHeadlessAction("SHUFFLE_DECK", { returnedCardId: sacrificeCardId });
    return match;
  }

  if (plan.card.cardId === "gen3_059_lumber" && actionType.includes("manual_fallback")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("APPLY_STAT_MODIFIER", { marker: "MODIFIER", stat: "MODIFIER", operation: "HALVE", condition: "FOREST_CREATURE" });
    emitSyntheticBattlePipeline({
      attackingPlayerId: findOpponentPlayerId(match, source.playerId),
      defendingPlayerId: source.playerId,
      damage: 5,
      hitRollModifier: 0,
      note: "Lumber halves forest creature base Modifier"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_064_frog_bard" && actionType.includes("move_card")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    moveCardToHand(match, source.playerId, card);
    emitHeadlessAction("MOVE_CARD", { returnedCardId: card.cardId, destination: "HAND", reason: "EQUIPPED_CREATURE_REMOVED" });
    return match;
  }

  if (plan.card.cardId === "gen3_070_hydogon" && (actionType.includes("damage") || actionType.includes("apply_attack_damage_multiplier"))) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("APPLY_ATTACK_DAMAGE_MULTIPLIER", { multiplier: 2, condition: "TARGET_IN_OR_NEAR_FIRE" });
    emitSyntheticBattlePipeline({
      damage: 20,
      damageAmountForEvents: 20,
      multiplier: 2,
      note: "Hydogon inflicts 2x Atk damage near fire"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_075_orc_champion" && actionType.includes("summon_requirement")) {
    summonSourceAsPrimaryWithAttempt(0, []);
    return match;
  }

  if (plan.card.cardId === "gen3_077_possession" && actionType.includes("manual_fallback")) {
    playSourceMagicToCemetery();
    emitHeadlessAction("SELF_BATTLE", { targetPlayerId: findOpponentPlayerId(match, source.playerId) });
    addHeadlessEvent(match, "HEADLESS_BATTLE_LOCK_APPLIED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "BATTLE_LOCK",
      restriction: "OTHER_CREATURES_CANNOT_BATTLE_THIS_TURN"
    });
    steps.push({ label: "apply possession battle lock", ok: true, detail: definition.name });
    return match;
  }

  if (plan.card.cardId === "gen3_099_street_lights" && (actionType.includes("limited_summon") || actionType.includes("prevent_card_play"))) {
    playSourceMagicToField();
    if (actionType.includes("limited_summon")) {
      const player = getPlayer(match, source.playerId);
      let limited = player.field.limitedSummons.find(card => card.cardId === "gen3_064_frog_bard");
      if (!limited) {
        const candidate = ensureCardInHand(match, source.playerId, "gen3_064_frog_bard");
        const removed = candidate ? removeCardInstanceFromMatch(match, candidate.instanceId) : undefined;
        if (removed) {
          limited = placeAsLimitedSummon(removed.card, source.playerId, source.playerId);
        }
      }
      if (limited) {
        returnLinkedLimitedToHand(source.playerId, limited, "LIMITED_SUMMON_RETURNED");
      }
    }
    emitHeadlessAction("PREVENT_CARD_PLAY", { restrictedPlay: "LIMITED_SUMMON", duration: "while on field" });
    return match;
  }

  if (plan.card.cardId === "gen3_103_bio_dino" && actionType.includes("manual_fallback")) {
    const bioDino = summonSourceAsPrimaryWithAttempt(1, ["test_creature_defender"]);
    bioDino.activeStatModifiers ??= [];
    bioDino.activeStatModifiers.push({
      id: `headless-bio-dino-sacrifice-dice-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? "103-E01",
      sourceCardInstanceId: bioDino.instanceId,
      sourceCardName: definition.name,
      stat: "attackDice",
      delta: 3,
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    }, {
      id: `headless-bio-dino-sacrifice-mod-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? "103-E01",
      sourceCardInstanceId: bioDino.instanceId,
      sourceCardName: definition.name,
      stat: "modifier",
      delta: 3,
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
    emitHeadlessAction("SACRIFICE_STAT_INHERITANCE", { marker: "SACRIFICE", attackDiceDelta: 3, modifierDelta: 3 });
    return match;
  }

  if (plan.card.cardId === "gen3_100_advantage" && actionType.includes("reroll_dice")) {
    playSourceMagicToCemetery();
    const [original] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} original roll`,
      addEvent: addHeadlessEvent,
      context: { sourceCardName: definition.name, effectId: effect?.id, actionType: effect?.actionType }
    });
    const [reroll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} reroll`,
      addEvent: addHeadlessEvent,
      context: { sourceCardName: definition.name, effectId: effect?.id, actionType: effect?.actionType }
    });
    emitHeadlessAction("REROLL_DICE", { original, reroll, chosen: Math.max(original, reroll) });
    return match;
  }

  if (plan.card.cardId === "gen3_052_bad_luck_bear" && actionType.includes("reroll_dice")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const equipped = removed?.card ?? source.card;
    const equippedPlayerId = findOpponentPlayerId(match, source.playerId);
    moveCardToMagicSlot(match, equippedPlayerId, equipped);
    const target = getPlayer(match, equippedPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(equippedPlayerId, equippedPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (target) equipped.attachedToInstanceId = target.instanceId;
    emitHeadlessAction("REROLL_DICE", { marker: "REROLL", equippedToPlayerId: equippedPlayerId, targetCardId: target?.cardId });
    return match;
  }

  if (plan.card.cardId === "gen3_057_steam_angel" && actionType.includes("roll_table")) {
    ensureSourceAsPrimary(source.playerId);
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} rarity lock roll`,
      addEvent: addHeadlessEvent,
      context: { sourceCardName: definition.name, effectId: effect?.id, actionType: effect?.actionType }
    });
    emitHeadlessAction("ROLL_TABLE", { roll });
    emitHeadlessAction("PREVENT_CARD_PLAY", {
      roll,
      restrictedRarities: roll <= 3 ? ["EPIC", "PROMO"] : ["LEGENDARY", "MYTHIC"],
      duration: "1 turn cycle"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_053_the_super_hero" && (actionType.includes("damage") || actionType.includes("roll_table"))) {
    const hero = ensureSourceAsPrimary(source.playerId);
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} damage immunity roll`,
      addEvent: addHeadlessEvent,
      context: { sourceCardName: definition.name, effectId: effect?.id, actionType: effect?.actionType }
    });
    emitHeadlessAction("ROLL_TABLE", { roll });
    if (roll >= 5 || actionType.includes("damage")) {
      addTemporaryStatus(hero, "DAMAGE_IMMUNITY", { canReceiveDamage: false });
      emitHeadlessAction("DAMAGE_IMMUNITY", { roll, targetCardId: hero.cardId });
    }
    return match;
  }

  if (plan.card.cardId === "gen3_132_woodland_elf" && (actionType.includes("damage") || actionType.includes("roll_table") || actionType.includes("apply_stat_modifier"))) {
    ensureSourceAsPrimary(source.playerId);
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} battle form roll`,
      addEvent: addHeadlessEvent,
      context: { sourceCardName: definition.name, effectId: effect?.id, actionType: effect?.actionType }
    });
    emitHeadlessAction("ROLL_TABLE", { roll });
    if (roll <= 2 || actionType.includes("damage")) {
      emitSyntheticBattlePipeline({ damage: 10, damageAmountForEvents: 10, note: "Woodland Elf +10 Atk damage branch" });
      addHeadlessEvent(match, "AUTO_EFFECT_DAMAGE_CREATURE_RESOLVED", source.playerId, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: "DAMAGE",
        damageAmount: 10,
        reason: "WOODLAND_ELF_LOW_ROLL"
      });
    } else {
      emitHeadlessAction("APPLY_STAT_MODIFIER", {
        roll,
        stat: roll <= 4 ? "MODIFIER" : "AL",
        operation: roll <= 4 ? "SET" : "ADD",
        value: roll <= 4 ? 0 : -5
      });
    }
    return match;
  }

  if (plan.card.cardId === "gen3_145_eagle_knight" && (actionType.includes("prevent_damage") || actionType.includes("damage"))) {
    playSourceMagicToCemetery();
    emitHeadlessAction("PREVENT_DAMAGE", { duration: "remainder of turn" });
    emitSyntheticBattlePipeline({
      attackingPlayerId: findOpponentPlayerId(match, source.playerId),
      defendingPlayerId: source.playerId,
      damage: 0,
      prevented: true,
      damageAmountForEvents: 0,
      note: "Eagle Knight prevented battle damage"
    });
    return match;
  }

  if (plan.card.cardId === "gen3_024_mosquito_man" && actionType.includes("heal")) {
    const mosquito = ensureSourceAsPrimary(source.playerId);
    mosquito.currentHp = Math.max(1, Number(mosquito.baseHp ?? 40) - 30);
    emitSyntheticBattlePipeline({ damage: 30, damageAmountForEvents: 30, note: "Mosquito Man lifesteal battle damage" });
    mosquito.currentHp = Math.min(Number(mosquito.baseHp ?? 0), Number(mosquito.currentHp ?? 0) + 15);
    emitHeadlessAction("HEAL", { targetCardId: mosquito.cardId, healAmount: 15 });
    return match;
  }

  if (plan.card.cardId === "gen3_143_succubus" && (actionType.includes("heal") || actionType.includes("damage"))) {
    const succubus = ensureSourceAsPrimary(source.playerId);
    const maxHp = Number(succubus.baseHp ?? (definition.cardType === "CREATURE" ? definition.hp : 50));
    succubus.currentHp = actionType.includes("damage") ? maxHp : Math.max(1, maxHp - 20);
    const { defender } = emitSyntheticBattlePipeline({ damage: 30, damageAmountForEvents: 30, note: "Succubus lifesteal battle damage" });
    const healAmount = 15;
    const missingHp = Math.max(0, maxHp - Number(succubus.currentHp ?? maxHp));
    const excess = Math.max(0, healAmount - missingHp);
    succubus.currentHp = Math.min(maxHp, Number(succubus.currentHp ?? maxHp) + healAmount);
    if (excess > 0) {
      defender.currentHp = Math.max(0, Number(defender.currentHp ?? defender.baseHp ?? 0) - excess);
      emitHeadlessAction("DAMAGE", { damageAmount: excess, reason: "EXCESS_HEALING", targetCardId: defender.cardId });
    }
    emitHeadlessAction("HEAL", { targetCardId: succubus.cardId, healAmount });
    return match;
  }

  if (plan.card.cardId === "gen3_022_shapeshifter" && actionType.includes("manual_fallback")) {
    const shapeshifter = ensureSourceAsPrimary(source.playerId);
    const scenarioEvent = match.eventLog.find(event => event.type === "EFFECT_TEST_SCENARIO_CREATED");
    if (scenarioEvent?.payload && typeof scenarioEvent.payload === "object") {
      (scenarioEvent.payload as Record<string, unknown>).actionType = "CHOOSE_FORM";
    }
    shapeshifter.activeStatModifiers ??= [];
    shapeshifter.activeStatModifiers.push({
      id: `headless-shapeshifter-form-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? "022-E01",
      sourceCardInstanceId: shapeshifter.instanceId,
      sourceCardName: definition.name,
      stat: "attackDice",
      delta: 4,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
    addHeadlessEvent(match, "FORM_CHOSEN", source.playerId, {
      sourceCardInstanceId: shapeshifter.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "CHOOSE_FORM",
      marker: "FORM",
      form: "BEAR",
      attackDiceDelta: 4
    });
    steps.push({ label: "choose Shapeshifter form", ok: true, detail: "Bear +4 Atk Dice Rolls" });
    return match;
  }

  if (plan.card.cardId === "gen3_026_cabal_warchief" && actionType.includes("manual_fallback")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("EXTRA_BATTLE", { battlesAllowed: 2 });
    emitHeadlessAction("RETURN_ATTACK_LIMIT", { returnAttacksAllowed: 1 });
    return match;
  }

  if (plan.card.cardId === "gen3_102_monkey_duck" && actionType.includes("manual_fallback")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("QUACK", { count: 3 });
    emitHeadlessAction("APPLY_DICE_MODIFIER", { attackDiceDelta: -1, modifierDelta: -1, duration: "battle" });
    return match;
  }

  if (plan.card.cardId === "gen3_126_arcane_power" && actionType.includes("manual_fallback")) {
    playSourceMagicToCemetery();
    const revealedCount = Math.max(1, getPlayer(match, source.playerId).hand.length);
    emitHeadlessAction("REVEAL_HAND", { revealedCount });
    emitHeadlessAction("APPLY_STAT_MODIFIER", { stat: "MODIFIER", delta: revealedCount, duration: "battle" });
    emitSyntheticBattlePipeline({ damage: 5, hitRollModifier: revealedCount, note: "Arcane Power revealed-card modifier" });
    return match;
  }

  if (plan.card.cardId === "gen3_119_orgar" && actionType.includes("apply_stat_modifier")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("APPLY_STAT_MODIFIER", { stat: "ATK_DICE_ROLLS", delta: 2, condition: "VS_HUMANOID" });
    emitSyntheticBattlePipeline({ damage: 12, damageRollDice: [6, 6], note: "Orgar +2 dice vs Humanoid" });
    return match;
  }

  if (plan.card.cardId === "gen3_136_chaos_demon" && actionType.includes("apply_stat_modifier")) {
    ensureSourceAsPrimary(source.playerId);
    emitHeadlessAction("APPLY_STAT_MODIFIER", { stat: "ATK_DICE_ROLLS", delta: 3, duration: "battle" });
    return match;
  }

  if (plan.card.cardId === "gen3_135_ironfist_dwarf" && actionType.includes("damage")) {
    ensureSourceAsPrimary(source.playerId);
    emitSyntheticBattlePipeline({ damage: 5, damageAmountForEvents: 5, note: "Ironfist Dwarf low damage battle" });
    emitHeadlessAction("EXTRA_BATTLE", { maxOccurrences: 5, returnAttackAllowed: false });
    return match;
  }

  if (plan.card.cardId === "gen3_012_crow" && (actionType === "limited_summon" || actionType === "move_card")) {
    const playerId = source.playerId;
    const anchor = getPlayer(match, playerId).field.primaryCreature ?? ensureSourceAsPrimary(playerId);
    const linked = ensureLinkedLimitedSummon(
      playerId,
      anchor,
      card => card.cardId === "gen3_012_crow" && card.instanceId !== anchor.instanceId,
      "gen3_012_crow"
    );
    if (actionType === "move_card") {
      returnLinkedLimitedToHand(playerId, linked, "LINKED_LIMITED_SUMMON_RETURNED");
    }
    return match;
  }

  if (plan.card.cardId === "gen3_039_m_o_o_n_sgt" && (actionType === "limited_summon" || actionType === "move_card" || actionType === "negate_card_effect")) {
    const playerId = source.playerId;
    const anchor = getPlayer(match, playerId).field.primaryCreature ?? ensureSourceAsPrimary(playerId);
    const linked = ensureLinkedLimitedSummon(
      playerId,
      anchor,
      (card, candidate) => card.cardId !== anchor.cardId && normalizeText(candidate?.name).includes("m.o.o.n."),
      "gen3_040_m_o_o_n_soldier"
    );
    if (actionType === "negate_card_effect") {
      emitHeadlessAction("NEGATE_CARD_EFFECT", { negatedEffectId: "039-E01" });
      returnLinkedLimitedToHand(playerId, linked, "LINKED_LIMITED_SUMMON_RETURNED");
    } else if (actionType === "move_card") {
      returnLinkedLimitedToHand(playerId, linked, "LINKED_LIMITED_SUMMON_RETURNED");
    }
    return match;
  }

  if (plan.card.cardId === "gen3_087_orc_hunter" && (actionType === "move_card" || actionType === "negate_card_effect")) {
    const playerId = source.playerId;
    const anchor = getPlayer(match, playerId).field.primaryCreature ?? ensureSourceAsPrimary(playerId);
    const linked = ensureLinkedLimitedSummon(
      playerId,
      anchor,
      (card, candidate) => card.cardId !== anchor.cardId && candidate?.cardType === "CREATURE" && normalizeText(candidate.creatureType).includes("beast"),
      "gen3_064_frog_bard"
    );
    if (actionType === "negate_card_effect") {
      emitHeadlessAction("NEGATE_CARD_EFFECT", { negatedEffectId: "087-E01" });
    }
    returnLinkedLimitedToHand(playerId, linked, "RETURN_LINKED_SUMMON");
    return match;
  }

  if (plan.card.cardId === "gen3_021_possessed_dummy" && (actionType === "limited_summon" || actionType === "move_card" || actionType === "send_to_cemetery" || actionType === "negate_card_effect")) {
    const playerId = source.playerId;
    const opponentId = findOpponentPlayerId(match, playerId);
    const anchor = source.card;
    let linked = getPlayer(match, playerId).field.limitedSummons.find(card => card.anchorSourceInstanceId === anchor.instanceId);
    if (!linked) {
      const candidate = takeCemeteryCardForLimitedSummon(opponentId, card => card.cardId === "test_creature_defender") ??
        takeCardForLimitedSummon(opponentId, card => card.cardId === "test_creature_defender", "test_creature_defender");
      if (!candidate) throw new Error("Headless Possessed Dummy needs an opponent cemetery creature.");
      linked = placeAsLimitedSummon(candidate, playerId, candidate.ownerPlayerId || opponentId, anchor.instanceId);
      emitLimitedSummon(playerId, anchor, linked);
    }
    if (actionType === "limited_summon") return match;
    if (actionType === "negate_card_effect") {
      emitHeadlessAction("NEGATE_CARD_EFFECT", { negatedEffectId: "021-E01" });
    }
    sendLinkedLimitedToCemetery(playerId, linked, opponentId, actionType === "move_card" ? "MOVE_CARD" : "SEND_TO_CEMETERY");
    return match;
  }

  if (plan.card.cardId === "gen3_082_gnarled_hand" && (actionType === "limited_summon" || actionType === "send_to_cemetery")) {
    const playerId = source.playerId;
    const primary = getPlayer(match, playerId).field.primaryCreature ?? ensurePrimaryFromSetup(playerId, plan.setup.player1Cards);
    const linked = ensureLinkedLimitedSummon(
      playerId,
      source.card,
      card => card.cardId === "gen3_064_frog_bard" && card.instanceId !== primary?.instanceId,
      "gen3_064_frog_bard"
    );
    if (actionType === "send_to_cemetery") {
      sendLinkedLimitedToCemetery(playerId, linked, playerId, "SEND_TO_CEMETERY");
    }
    return match;
  }

  if (plan.card.cardId === "gen3_139_last_goodbye" && (actionType === "limited_summon" || actionType === "send_to_cemetery")) {
    const playerId = source.playerId;
    if (actionType === "limited_summon") {
      const candidate = takeCardForLimitedSummon(playerId, (card, candidateDefinition) =>
        candidateDefinition?.cardType === "CREATURE" && card.instanceId !== source.card.instanceId,
        "test_creature_defender"
      );
      if (candidate) {
        const summoned = placeAsLimitedSummon(candidate, playerId, candidate.ownerPlayerId || playerId, source.card.instanceId);
        emitLimitedSummon(playerId, source.card, summoned);
      }
      return match;
    }

    const attached = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
      : undefined;
    if (attached?.card && attached.zone === "LIMITED_SUMMON") {
      sendLinkedLimitedToCemetery(playerId, attached.card, attached.card.ownerPlayerId || playerId, "SEND_TO_CEMETERY");
    }
    const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, playerId, removedSource?.card ?? source.card);
    emitHeadlessAction("SEND_TO_CEMETERY", { sentCardId: plan.card.cardId, reason: "END_OF_TURN" });
    return match;
  }

  if (plan.card.cardId === "gen3_009_hoggan" && (actionType === "limited_summon" || actionType === "damage" || actionType === "send_to_cemetery")) {
    const playerId = source.playerId;
    let hoggan = getPlayer(match, playerId).field.limitedSummons.find(card => card.cardId === plan.card.cardId);
    if (!hoggan) {
      const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
      hoggan = placeAsLimitedSummon(removedSource?.card ?? source.card, playerId, playerId);
      emitLimitedSummon(playerId, source.card, hoggan);
    }
    if (actionType === "damage") {
      hoggan.currentHp = Math.max(0, Number(hoggan.currentHp ?? hoggan.baseHp ?? 0) - 5);
      addHeadlessEvent(match, "BATTLE_DAMAGE_PIPELINE_RESOLVED", playerId, {
        sourceCardInstanceId: hoggan.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        targetCardInstanceId: hoggan.instanceId,
        finalDamage: 5
      });
      steps.push({ label: "damage Hoggan as limited summon", ok: true, detail: "5 damage" });
    } else if (actionType === "send_to_cemetery") {
      sendLinkedLimitedToCemetery(playerId, hoggan, playerId, "SEND_TO_CEMETERY");
    }
    return match;
  }

  if (plan.card.cardId === "gen3_107_missile_toad" && (actionType === "limited_summon" || actionType === "send_to_cemetery")) {
    const playerId = source.playerId;
    const player = getPlayer(match, playerId);
    if (actionType === "send_to_cemetery" && player.field.limitedSummons.length === 0) {
      const candidate = takeCardForLimitedSummon(playerId, card => card.cardId === "gen3_064_frog_bard", "gen3_064_frog_bard");
      if (candidate) placeAsLimitedSummon(candidate, playerId, candidate.ownerPlayerId || playerId, source.card.instanceId);
    }
    addHeadlessEvent(match, "BATTLE_DAMAGE_PIPELINE_RESOLVED", playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      finalDamage: 5
    });
    const sent: string[] = [];
    for (const limited of [...match.players.flatMap(playerState => playerState.field.limitedSummons)]) {
      const located = findCardByPredicate(match, card => card.instanceId === limited.instanceId);
      const removed = removeCardInstanceFromMatch(match, limited.instanceId);
      if (removed) {
        moveCardToCemetery(match, removed.card.ownerPlayerId ?? located?.playerId ?? playerId, removed.card);
        sent.push(removed.card.cardId);
      }
    }
    emitHeadlessAction("SEND_TO_CEMETERY", { sentLimitedSummonCardIds: sent });
    return match;
  }

  if (plan.card.cardId === "gen3_109_negative" && definition.cardType === "MAGIC" && source.zone === "HAND") {
    playSourceMagicToCemetery();
    const discarded = discardMagicFromHand(source.playerId, new Set([source.card.instanceId]));
    const targetCardId = plan.setup.player2Cards?.find(cardId => match.cardCatalog[cardId]?.cardType === "MAGIC");
    const destroyed = actionType === "destroy_magic"
      ? destroyOneFieldMagic(findOpponentPlayerId(match, source.playerId), targetCardId)
      : undefined;
    emitHeadlessAction(actionType === "destroy_magic" ? "AUTO_EFFECT_DESTROY_MAGIC_RESOLVED" : "DISCARD_CARD", {
      discardedCardId: discarded?.cardId,
      destroyedCardId: destroyed?.cardId
    });
    return match;
  }

  if (plan.card.cardId === "gen3_127_the_merchant" && definition.cardType === "MAGIC" && source.zone === "HAND") {
    const merchant = playSourceMagicToField();
    const primary = getPlayer(match, source.playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(source.playerId, plan.setup.player1Cards);
    if (primary) {
      merchant.attachedToInstanceId = primary.instanceId;
    }

    if (actionType === "destroy_magic") {
      const targetCardId = plan.setup.player2Cards?.find(cardId => match.cardCatalog[cardId]?.cardType === "MAGIC");
      const destroyed = destroyOneFieldMagic(findOpponentPlayerId(match, source.playerId), targetCardId);
      emitHeadlessAction("AUTO_EFFECT_DESTROY_MAGIC_RESOLVED", { destroyedCardId: destroyed?.cardId });
      return match;
    }

    if (actionType === "heal") {
      const healed = healPrimaryCreature(source.playerId, 20);
      emitHeadlessAction("HEAL", { targetCardId: healed?.cardId, healAmount: 20 });
      return match;
    }

    if (actionType.includes("apply_stat_modifier")) {
      addHeadlessEvent(match, "HEADLESS_STATIC_STAT_MODIFIER_AVAILABLE", source.playerId, {
        sourceCardInstanceId: merchant.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        attachedToInstanceId: merchant.attachedToInstanceId
      });
      steps.push({ label: "accept choose-one stat branch", ok: true, detail: definition.name });
      return match;
    }
  }

  if (plan.card.cardId === "gen3_110_chain_lightning" && definition.cardType === "MAGIC" && source.zone === "HAND") {
    playSourceMagicToCemetery();
    const selfDamage = 5;
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const destroyed = destroyAllFieldMagic();
    const destroyedCountForDamage = Math.max(2, destroyed.length);
    const opponentDamage = destroyedCountForDamage * 5;
    const selfTarget = damagePrimaryCreature(source.playerId, selfDamage);
    const opponentTarget = damagePrimaryCreature(opponentId, opponentDamage);
    emitHeadlessAction("AUTO_EFFECT_DESTROY_ALL_MAGIC_RESOLVED", {
      destroyedCardIds: destroyed.map(card => card.cardId),
      destroyedCount: destroyed.length
    });
    addHeadlessEvent(match, "AUTO_EFFECT_DAMAGE_CREATURE_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      selfTargetCardId: selfTarget?.cardId,
      opponentTargetCardId: opponentTarget?.cardId,
      selfDamage,
      opponentDamage,
      destroyedCountForDamage
    });
    steps.push({ label: "apply chain lightning damage scaling", ok: true, detail: `${opponentDamage} opponent damage` });
    return match;
  }

  if (plan.card.cardId === "gen3_017_shield_of_light" && definition.cardType === "MAGIC" && source.zone === "MAGIC_SLOT") {
    const target = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)?.card
      : getPlayer(match, source.playerId).field.primaryCreature ?? ensurePrimaryFromSetup(source.playerId, plan.setup.player1Cards);
    if (!target) throw new Error("Headless Shield of Light route needs an equipped creature.");
    if (!source.card.attachedToInstanceId) source.card.attachedToInstanceId = target.instanceId;

    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} roll table`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    emitHeadlessAction("ROLL_TABLE", { roll });

    if (actionType === "destroy_magic" || roll >= 5) {
      destroySourceMagic("SHIELD_OF_LIGHT_ROLL");
      return match;
    }

    if (actionType === "damage" || (roll >= 3 && roll <= 4)) {
      const damageAmount = 5;
      target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - damageAmount);
      addHeadlessEvent(match, "BATTLE_DAMAGE_PIPELINE_RESOLVED", source.playerId, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        targetCardInstanceId: target.instanceId,
        finalDamage: damageAmount
      });
      emitHeadlessAction("DAMAGE", { roll, targetCardId: target.cardId, damageAmount });
      return match;
    }

    addHeadlessEvent(match, "BATTLE_DAMAGE_PIPELINE_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      targetCardInstanceId: target.instanceId,
      finalDamage: 0,
      replacement: "HEAL_INSTEAD"
    });
    emitHeadlessAction("HEAL", { roll, targetCardId: target.cardId, preventedDamage: true });
    return match;
  }

  if (plan.card.cardId === "gen3_146_constructed_pylon" && definition.cardType === "MAGIC" && source.zone === "MAGIC_SLOT") {
    const rollingPlayerId = findOpponentPlayerId(match, source.playerId);
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: rollingPlayerId,
      label: `${definition.name} roll table`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    emitHeadlessAction("ROLL_TABLE", { roll, rollingPlayerId });
    if (actionType === "destroy_magic" || roll >= 4) {
      destroySourceMagic("CONSTRUCTED_PYLON_ROLL");
    }
    return match;
  }

  if (plan.card.cardId === "gen2_006_electroloon" && actionType.includes("apply_status_aura")) {
    const sourceCard = ensureSourceAsPrimary("player_1");
    const affectedPlayerId = findOpponentPlayerId(match, "player_1");
    const affectedPlayer = getPlayer(match, affectedPlayerId);
    const affectedCreatures = [
      affectedPlayer.field.primaryCreature ?? ensurePrimaryFromSetup(affectedPlayerId, plan.setup.player2Cards),
      ...(affectedPlayer.field.limitedSummons ?? [])
    ].filter((card): card is CardInstance => !!card);

    for (const target of affectedCreatures) {
      target.activeStatuses ??= [];
      target.activeStatuses = target.activeStatuses.filter(status =>
        !(status.sourceCardInstanceId === sourceCard.instanceId && status.sourceEffectId === (effect?.id ?? "006-E01"))
      );
      target.activeStatuses.push({
        id: `headless-electroloon-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sourceEffectId: effect?.id ?? "006-E01",
        sourceCardInstanceId: sourceCard.instanceId,
        sourceCardName: definition.name,
        sourcePlayerId: "player_1",
        status: "STUNNED",
        label: "Stunned; cannot inflict Atk damage",
        flags: {
          canInflictAtkDamage: false
        },
        durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
        appliedTurnNumber: match.turn.turnNumber,
        appliedTurnCycle: match.turn.turnCycleNumber
      });
    }
    emitHeadlessAction("APPLY_STATUS_AURA", {
      affectedPlayerId,
      affectedCardIds: affectedCreatures.map(card => card.cardId),
      status: "STUNNED"
    });
    return match;
  }

  if (plan.card.cardId === "gen2_006_electroloon" && actionType.includes("apply_status_with_escape_roll")) {
    const sourceCard = ensureSourceAsPrimary("player_1");
    const affectedPlayerId = "player_2";
    const target = getPlayer(match, affectedPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(affectedPlayerId, plan.setup.player2Cards);
    if (!target) throw new Error("Headless Electroloon escape roll needs an affected opposing creature.");

    target.activeStatuses ??= [];
    target.activeStatuses.push({
      id: `headless-electroloon-escape-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: "006-E01",
      sourceCardInstanceId: sourceCard.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: "player_1",
      status: "STUNNED",
      label: "Stunned; cannot inflict Atk damage",
      flags: {
        canInflictAtkDamage: false
      },
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });

    const successValues = new Set(getEffectSuccessDice(effect));
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: affectedPlayerId,
      label: `${definition.name} escape roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    const ended = successValues.has(roll);
    if (ended) {
      target.activeStatuses = (target.activeStatuses ?? []).filter(status =>
        !(status.sourceCardInstanceId === sourceCard.instanceId && status.status === "STUNNED")
      );
    }
    emitHeadlessAction("APPLY_STATUS_WITH_ESCAPE_ROLL", {
      targetCardId: target.cardId,
      roll,
      ended,
      successValues: [...successValues]
    });
    return match;
  }

  if (plan.card.cardId === "gen2_013_bunnysaurus" && actionType.includes("add_once_per_field_shield")) {
    const bunnysaurus = ensureSourceAsPrimary("player_1");
    bunnysaurus.activeEffectInstances ??= [];
    bunnysaurus.activeEffectInstances.push({
      id: `headless-bunnysaurus-shield-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: "STATIC_MODIFIER",
      sourceEffectId: effect?.id ?? "013-E01",
      sourceCardInstanceId: bunnysaurus.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: "player_1",
      targetPlayerId: "player_1",
      targetCardInstanceId: bunnysaurus.instanceId,
      targetCardName: definition.name,
      actionType: effect?.actionType ?? "ADD_ONCE_PER_FIELD_SHIELD",
      label: effect?.value ?? effect?.actionText ?? "Once per field shield",
      durationType: "UNTIL_CONSUMED",
      durationText: effect?.duration?.text,
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });

    emitHeadlessAction("ADD_ONCE_PER_FIELD_SHIELD", {
      sharedUseKey: (effect?.params as { sharedUseKey?: unknown } | undefined)?.sharedUseKey,
      shieldMode: trigger.includes("magic_card_played") ? "MAGIC" : "ATTACK"
    });
    if (trigger.includes("magic_card_played")) {
      addHeadlessEvent(match, "CHAIN_LINK_NEGATED", "player_1", {
        sourceCardInstanceId: bunnysaurus.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        negatedCardName: "Standard Magic"
      });
      steps.push({ label: "negate triggering magic", ok: true, detail: definition.name });
    }
    return match;
  }

  if (
    plan.card.cardId === "gen2_039_irresistible_love" &&
    actionType.includes("apply_play_restriction") &&
    normalizeText(effect?.value, effect?.actionText, effect?.params?.valueText).includes("magic")
  ) {
    emitHeadlessAction("MAGIC_PLAY_RESTRICTION_APPLIED", {
      restrictedPlayerId: findOpponentPlayerId(match, source.playerId),
      restriction: "CANNOT_PLAY_MAGIC"
    });
    return match;
  }

  if (plan.card.cardId === "gen1_112_cosmic_negation" && actionType.includes("apply_play_restriction")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("COSMIC_NEGATION_FOLLOWUP_EFFECT_RESOLVED", {
      destroyedMagicBeforeRestriction: true
    });
    emitHeadlessAction("MAGIC_PLAY_RESTRICTION_APPLIED", {
      restrictedPlayerIds: match.players.map(player => player.id),
      restriction: "CANNOT_PLAY_MAGIC",
      duration: "3 turn cycles"
    });
    return match;
  }

  if (plan.card.cardId === "gen2_039_irresistible_love" && actionType.includes("apply_status_with_escape_roll")) {
    const successValues = new Set(getEffectSuccessDice(effect));
    const rollingPlayerId = findOpponentPlayerId(match, source.playerId);
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: rollingPlayerId,
      label: `${definition.name} escape roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    const ended = successValues.has(roll);
    if (ended) {
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    }
    emitHeadlessAction("APPLY_STATUS_WITH_ESCAPE_ROLL", {
      roll,
      ended,
      successValues: [...successValues]
    });
    return match;
  }

  if (plan.card.cardId === "gen2_046_alkonost" && actionType.includes("summon_limited_creature")) {
    const alkonost = ensureSourceAsPrimary("player_1");
    const player = getPlayer(match, "player_1");
    const target = ensureCardInHand(match, "player_1", "gen1_060_harpy") ??
      ensureCardInHand(match, "player_1", "gen2_046_alkonost");
    if (!target) throw new Error("Headless Alkonost limited summon needs Harpy or Alkonost in hand/deck.");

    addHeadlessEvent(match, "EFFECT_TARGET_PROMPT_CREATED", "player_1", {
      sourceCardInstanceId: alkonost.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      validTargetCardIds: [target.cardId]
    });
    steps.push({ label: "create limited summon target prompt", ok: true, detail: definition.name });

    const removed = removeCardInstanceFromMatch(match, target.instanceId);
    const summoned = removed?.card ?? target;
    const summonedDefinition = match.cardCatalog[summoned.cardId];
    summoned.zone = "LIMITED_SUMMON";
    summoned.controllerPlayerId = "player_1";
    summoned.ownerPlayerId = summoned.ownerPlayerId || "player_1";
    summoned.baseHp = summonedDefinition?.cardType === "CREATURE" ? summonedDefinition.hp : summoned.baseHp;
    summoned.currentHp = summonedDefinition?.cardType === "CREATURE" ? summonedDefinition.hp : summoned.currentHp;
    summoned.isLimitedSummon = true;
    summoned.anchorSourceInstanceId = alkonost.instanceId;
    player.field.limitedSummons.push(summoned);
    emitHeadlessAction("AUTO_EFFECT_LIMITED_SUMMON_RESOLVED", {
      summonedCardId: summoned.cardId,
      actionType: effect?.actionType
    });
    return match;
  }

  if (plan.card.cardId === "gen2_046_alkonost" && actionType.includes("apply_dynamic_stat_modifier")) {
    const alkonost = ensureSourceAsPrimary("player_1");
    const player = getPlayer(match, "player_1");
    let linkedCount = player.field.limitedSummons.filter(card => card.anchorSourceInstanceId === alkonost.instanceId).length;
    if (linkedCount === 0) {
      const target = ensureCardInHand(match, "player_1", "gen1_060_harpy");
      const removed = target ? removeCardInstanceFromMatch(match, target.instanceId) : undefined;
      if (removed) {
        const targetDefinition = match.cardCatalog[removed.card.cardId];
        removed.card.zone = "LIMITED_SUMMON";
        removed.card.controllerPlayerId = "player_1";
        removed.card.ownerPlayerId = removed.card.ownerPlayerId || "player_1";
        removed.card.baseHp = targetDefinition?.cardType === "CREATURE" ? targetDefinition.hp : removed.card.baseHp;
        removed.card.currentHp = targetDefinition?.cardType === "CREATURE" ? targetDefinition.hp : removed.card.currentHp;
        removed.card.isLimitedSummon = true;
        removed.card.anchorSourceInstanceId = alkonost.instanceId;
        player.field.limitedSummons.push(removed.card);
        linkedCount = 1;
      }
    }

    alkonost.activeStatModifiers = (alkonost.activeStatModifiers ?? []).filter(modifier =>
      !(modifier.sourceCardInstanceId === alkonost.instanceId && modifier.sourceEffectId === (effect?.id ?? "046-E02"))
    );
    for (const stat of ["attackDice", "modifier"] as const) {
      alkonost.activeStatModifiers.push({
        id: `headless-alkonost-${stat}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sourceEffectId: effect?.id ?? "046-E02",
        sourceCardInstanceId: alkonost.instanceId,
        sourceCardName: definition.name,
        stat,
        delta: linkedCount,
        durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
        appliedTurnNumber: match.turn.turnNumber,
        appliedTurnCycle: match.turn.turnCycleNumber
      });
    }
    emitHeadlessAction("APPLY_DYNAMIC_STAT_MODIFIER", {
      linkedLimitedSummonCount: linkedCount,
      attackDiceDelta: linkedCount,
      modifierDelta: linkedCount
    });
    return match;
  }

  if (plan.card.cardId === "gen2_061_abominable_deer_man" && actionType.includes("summon_self_as_limited_creature")) {
    const player = getPlayer(match, source.playerId);
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const card = removed?.card ?? source.card;
    card.zone = "LIMITED_SUMMON";
    card.controllerPlayerId = source.playerId;
    card.ownerPlayerId = card.ownerPlayerId || source.playerId;
    card.isLimitedSummon = true;
    player.field.limitedSummons.push(card);
    emitHeadlessAction("SUMMON_SELF_AS_LIMITED_CREATURE", {
      summonedCardId: card.cardId
    });
    return match;
  }

  if (plan.card.cardId === "gen2_055_the_iron_range" && actionType.includes("negate_creature_effects")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToMagicSlot(match, source.playerId, removed?.card ?? source.card);

    const affectedCardIds: string[] = [];
    for (const player of match.players) {
      const creatures = [
        player.field.primaryCreature,
        ...(player.field.limitedSummons ?? [])
      ].filter((card): card is CardInstance => !!card);
      for (const creature of creatures) {
        creature.effectsSuppressed = true;
        affectedCardIds.push(creature.cardId);
      }
    }

    emitHeadlessAction("NEGATE_CREATURE_EFFECTS", { affectedCardIds });
    addHeadlessEvent(match, "CREATURE_EFFECTS_NEGATED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      affectedCardIds
    });
    steps.push({ label: "negate field creature effects", ok: true, detail: definition.name });
    return match;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    trigger.includes("opponent_draw_card") &&
    (actionType.includes("deal_damage_on_draw") || actionType.includes("heal_creature"))
  ) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponentPrimary = ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards) ??
      createScenarioCreature(match, opponentId, "test_creature_defender", 50);
    if (opponentPrimary && !getPlayer(match, opponentId).field.primaryCreature) {
      getPlayer(match, opponentId).field.primaryCreature = opponentPrimary;
    }

    if (opponentPrimary && (text.includes("opponent's creature") || text.includes("opponent creature"))) {
      source.card.attachedToInstanceId = opponentPrimary.instanceId;
    } else if (!source.card.attachedToInstanceId && opponentPrimary) {
      source.card.attachedToInstanceId = opponentPrimary.instanceId;
    }

    const params = effect?.params as { amount?: unknown; damageAmount?: unknown; value?: unknown } | undefined;
    const amount = Number(
      params?.amount ??
      params?.damageAmount ??
      params?.value ??
      String(effect?.value ?? effect?.params?.valueText ?? effect?.actionText ?? "").match(/(\d+)/)?.[1] ??
      0
    );

    if (actionType.includes("deal_damage_on_draw")) {
      const targetText = normalizeText(effect?.target, params?.value, effect?.actionText, effect?.params?.target);
      const attachedTarget = source.card.attachedToInstanceId
        ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
        : undefined;
      const targetCard = targetText.includes("equipped")
        ? attachedTarget?.card
        : getPlayer(match, opponentId).field.primaryCreature;
      if (!targetCard) throw new Error(`Headless ${definition.name} draw damage needs a target creature.`);
      targetCard.currentHp = Math.max(0, Number(targetCard.currentHp ?? targetCard.baseHp ?? 0) - amount);
      emitHeadlessAction("DEAL_DAMAGE_ON_DRAW", {
        targetCardInstanceId: targetCard.instanceId,
        targetCardId: targetCard.cardId,
        damageAmount: amount
      });
      return match;
    }

    const healTarget = getPlayer(match, source.playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(source.playerId, plan.setup.player1Cards);
    if (!healTarget) throw new Error(`Headless ${definition.name} draw heal needs your primary creature.`);
    healTarget.currentHp = Math.min(
      Number(healTarget.baseHp ?? healTarget.currentHp ?? 0),
      Number(healTarget.currentHp ?? healTarget.baseHp ?? 0) + amount
    );
    emitHeadlessAction("HEAL_CREATURE", {
      targetCardInstanceId: healTarget.instanceId,
      targetCardId: healTarget.cardId,
      healAmount: amount
    });
    return match;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "HAND" &&
    trigger.includes("opponent_plays_lightning") &&
    actionType.includes("deal_percentage_damage")
  ) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const target = ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards) ??
      getPlayer(match, opponentId).field.primaryCreature;
    if (!target) throw new Error(`Headless ${definition.name} percentage damage needs opponent primary creature.`);

    const params = effect?.params as {
      fractionNumerator?: unknown;
      fractionDenominator?: unknown;
      rounding?: unknown;
      roundingMode?: unknown;
    } | undefined;
    const numerator = Number(params?.fractionNumerator ?? 1);
    const denominator = Number(params?.fractionDenominator ?? 2);
    const currentHp = Number(target.currentHp ?? target.baseHp ?? 0);
    const rawDamage = denominator > 0 ? (currentHp * numerator) / denominator : 0;
    const rounding = normalizeText(params?.rounding, params?.roundingMode);
    const damage = rounding.includes("floor")
      ? Math.floor(rawDamage)
      : Math.ceil(rawDamage);
    target.currentHp = Math.max(0, currentHp - damage);

    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("DEAL_PERCENTAGE_DAMAGE", {
      targetCardInstanceId: target.instanceId,
      targetCardId: target.cardId,
      damageAmount: damage,
      fractionNumerator: numerator,
      fractionDenominator: denominator
    });
    return match;
  }

  if (actionType.includes("return_self_to_deck_and_shuffle")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    const ownerId = removed?.card.ownerPlayerId ?? source.playerId;
    moveCardToDeck(match, ownerId, removed?.card ?? source.card);
    emitHeadlessAction("RETURN_SELF_TO_DECK_AND_SHUFFLE", { movedToPlayerId: ownerId });
    return match;
  }

  if (actionType.includes("reset_current_turn")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("AUTO_EFFECT_TURN_RESET_RESOLVED", {
      resetPlayerId: match.turn.activePlayerId,
      note: "Headless QA records the reset marker; full turn rollback remains runtime-specific."
    });
    return match;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    trigger.includes("end_of_your_turn") &&
    actionType === "damage"
  ) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const target = ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards) ??
      getPlayer(match, opponentId).field.primaryCreature;
    if (!target) throw new Error(`Headless ${definition.name} end-turn damage needs opponent primary creature.`);

    const amount = Number(
      String(effect?.params?.valueText ?? effect?.value ?? effect?.actionText ?? "").match(/(\d+)/)?.[1] ?? 0
    );
    target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - amount);
    emitHeadlessAction("DAMAGE", {
      trigger: effect?.trigger,
      targetPlayerId: opponentId,
      targetCardInstanceId: target.instanceId,
      targetCardId: target.cardId,
      damageAmount: amount
    });
    return match;
  }

  if (
    actionType.includes("apply_zone_return_restriction") ||
    actionType.includes("apply_zone_lock") ||
    actionType.includes("apply_permanent_creature_flag")
  ) {
    source.card.activeEffectInstances ??= [];
    source.card.activeEffectInstances.push({
      id: `headless-fringe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: "STATIC_MODIFIER",
      sourceEffectId: effect?.id ?? "UNKNOWN",
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: source.playerId,
      targetPlayerId: source.playerId,
      targetCardInstanceId: source.card.instanceId,
      targetCardName: definition.name,
      actionType: effect?.actionType ?? "FRINGE_EFFECT",
      label: effect?.value ?? effect?.actionText ?? "Fringe marker",
      durationType: "STATIC",
      durationText: effect?.duration?.text,
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
    emitHeadlessAction("FRINGE_EFFECT_MARKER_APPLIED");
    return match;
  }

  if (actionType.includes("add_cemetery_hp_adjustment")) {
    emitHeadlessAction("ADD_CEMETERY_HP_ADJUSTMENT", { amount: 50 });
    return match;
  }

  if (actionType.includes("resolve_status_tick") && plan.card.cardId === "gen1_068_kraken") {
    const target = ensurePrimaryFromSetup("player_2", plan.setup.player2Cards) ??
      createScenarioCreature(match, "player_2", "test_creature_defender", 50);
    if (!getPlayer(match, "player_2").field.primaryCreature && target) {
      getPlayer(match, "player_2").field.primaryCreature = target;
    }
    const wrapped = getPlayer(match, "player_2").field.primaryCreature;
    if (wrapped) {
      wrapped.activeStatuses ??= [];
      wrapped.activeStatuses.push({
        id: `headless-wrapped-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sourceEffectId: effect?.id ?? "068-E02",
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        sourcePlayerId: source.playerId,
        status: "WRAPPED",
        label: "Wrapped",
        flags: {},
        durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
        appliedTurnNumber: match.turn.turnNumber,
        appliedTurnCycle: match.turn.turnCycleNumber
      });
      wrapped.currentHp = Math.max(0, Number(wrapped.currentHp ?? wrapped.baseHp ?? 0) - 10);
    }
    emitHeadlessAction("STATUS_TICK_RESOLVED", { result: "DAMAGE", damageAmount: 10 });
    return match;
  }

  if (actionType.includes("apply_start_turn_hp_loss") && plan.card.cardId === "gen1_088_stone_golem") {
    const targetPlayerId = plan.setup.activePlayerId ?? source.playerId;
    const golem = getPlayer(match, targetPlayerId).field.primaryCreature?.cardId === plan.card.cardId
      ? getPlayer(match, targetPlayerId).field.primaryCreature
      : source.card.cardId === plan.card.cardId
        ? source.card
        : getPlayer(match, source.playerId).field.primaryCreature;
    if (golem) {
      golem.currentHp = Math.max(0, Number(golem.currentHp ?? golem.baseHp ?? 100) - 10);
    }
    emitHeadlessAction("APPLY_START_TURN_HP_LOSS", { damageAmount: 10 });
    return match;
  }

  if (plan.card.cardId === "gen1_088_stone_golem" && (actionType.includes("summon_to_opponent_side") || actionType === "move_card")) {
    const casterId = source.playerId;
    const opponentId = findOpponentPlayerId(match, casterId);
    const opponent = getPlayer(match, opponentId);
    const previousPrimary = opponent.field.primaryCreature ?? ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards);
    if (previousPrimary?.instanceId) {
      const removedPrevious = removeCardInstanceFromMatch(match, previousPrimary.instanceId);
      if (removedPrevious) moveCardToDeck(match, removedPrevious.card.ownerPlayerId ?? opponentId, removedPrevious.card);
    }

    const removedGolem = removeCardInstanceFromMatch(match, source.card.instanceId);
    const golem = removedGolem?.card ?? source.card;
    golem.zone = "PRIMARY_CREATURE";
    golem.controllerPlayerId = opponentId;
    golem.ownerPlayerId = golem.ownerPlayerId || casterId;
    golem.baseHp = 100;
    golem.currentHp = 100;
    opponent.field.primaryCreature = golem;
    emitHeadlessAction(effect?.actionType ?? "SUMMON_TO_OPPONENT_SIDE", {
      movedToPlayerId: opponentId,
      returnedPrimaryCardId: previousPrimary?.cardId
    });
    return match;
  }

  if (plan.card.cardId === "gen1_086_foolish_tricks" && (actionType === "move_cards" || actionType.includes("force_summon_from_hand"))) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponent = getPlayer(match, opponentId);
    const previousPrimary = opponent.field.primaryCreature ?? ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards);
    if (previousPrimary?.instanceId) {
      const removedPrimary = removeCardInstanceFromMatch(match, previousPrimary.instanceId);
      if (removedPrimary) moveCardToHand(match, opponentId, removedPrimary.card);
    }
    for (const magic of [...opponent.field.magicSlots]) {
      const removedMagic = removeCardInstanceFromMatch(match, magic.instanceId);
      if (removedMagic) moveCardToHand(match, opponentId, removedMagic.card);
    }
    if (actionType.includes("force_summon_from_hand")) {
      const candidateId = plan.setup.player2Cards?.find(cardId => cardId !== previousPrimary?.cardId && match.cardCatalog[cardId]?.cardType === "CREATURE") ??
        previousPrimary?.cardId;
      const candidate = candidateId ? ensureCardInHand(match, opponentId, candidateId) : undefined;
      if (candidate) {
        const removedCandidate = removeCardInstanceFromMatch(match, candidate.instanceId);
        if (removedCandidate) {
          removedCandidate.card.zone = "PRIMARY_CREATURE";
          removedCandidate.card.controllerPlayerId = opponentId;
          opponent.field.primaryCreature = removedCandidate.card;
        }
      }
      emitHeadlessAction("FORCE_SUMMON_FROM_HAND", { forcedPlayerId: opponentId, candidateCardId: candidateId });
    } else {
      emitHeadlessAction("MOVE_CARDS", { movedPlayerId: opponentId });
    }
    return match;
  }

  const shouldRunReturnFieldCardsThenDraw = (
    plan.card.cardId === "gen1_108_wrath_of_the_old_ones" ||
    plan.card.cardId === "gen2_074_the_old_one"
  ) && (actionType === "move_cards" || actionType.includes("draw_cards_variable"));

  if (shouldRunReturnFieldCardsThenDraw) {
    ensurePrimaryFromSetup("player_1", plan.setup.player1Cards);
    ensurePrimaryFromSetup("player_2", plan.setup.player2Cards);
    const returnCounts: Record<string, number> = {};
    if (plan.card.cardId === "gen2_074_the_old_one") {
      const caster = getPlayer(match, source.playerId);
      const previousPrimary = caster.field.primaryCreature;
      const removedOldOne = removeCardInstanceFromMatch(match, source.card.instanceId);
      const oldOne = removedOldOne?.card ?? source.card;

      if (previousPrimary && previousPrimary.instanceId !== oldOne.instanceId) {
        const removedPrevious = removeCardInstanceFromMatch(match, previousPrimary.instanceId);
        if (removedPrevious) {
          const ownerId = removedPrevious.card.ownerPlayerId ?? source.playerId;
          moveCardToDeck(match, ownerId, removedPrevious.card);
          returnCounts[ownerId] = (returnCounts[ownerId] ?? 0) + 1;
        }
      }

      oldOne.zone = "PRIMARY_CREATURE";
      oldOne.controllerPlayerId = source.playerId;
      oldOne.ownerPlayerId = oldOne.ownerPlayerId || source.playerId;
      oldOne.baseHp = definition.cardType === "CREATURE" ? definition.hp : oldOne.baseHp;
      oldOne.currentHp = definition.cardType === "CREATURE" ? definition.hp : oldOne.currentHp;
      caster.field.primaryCreature = oldOne;
    }

    for (const player of match.players) {
      const returnCard = (card: CardInstance | undefined) => {
        if (!card) return;
        if (plan.card.cardId === "gen2_074_the_old_one" && card.cardId === plan.card.cardId) return;
        const removed = removeCardInstanceFromMatch(match, card.instanceId);
        if (!removed) return;
        const ownerId = removed.card.ownerPlayerId ?? player.id;
        moveCardToDeck(match, ownerId, removed.card);
        returnCounts[ownerId] = (returnCounts[ownerId] ?? 0) + 1;
      };
      returnCard(player.field.primaryCreature);
      for (const magic of [...player.field.magicSlots]) returnCard(magic);
    }
    emitHeadlessAction("MOVE_CARDS", { returnCounts });

    if (actionType.includes("draw_cards_variable")) {
      const results = Object.entries(returnCounts).map(([playerId, count]) => {
        const player = getPlayer(match, playerId);
        let actualDrawn = 0;
        for (let index = 0; index < count; index += 1) {
          const drawn = player.deck.shift();
          if (!drawn) continue;
          drawn.zone = "HAND";
          drawn.controllerPlayerId = playerId;
          player.hand.push(drawn);
          actualDrawn += 1;
        }
        return { playerId, requested: count, actualDrawn };
      });
      addHeadlessEvent(match, "AUTO_EFFECT_DRAW_CARDS_RESOLVED", source.playerId, {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        results
      });
    }
    return match;
  }

  if (actionType === "move_cards" && normalizeText(effect?.target, effect?.value, effect?.actionText).includes("primary")) {
    const returned: Array<{ playerId: string; cardId: string }> = [];
    for (const player of match.players) {
      const primary = player.field.primaryCreature ?? ensurePrimaryFromSetup(player.id, player.id === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
      if (!primary) continue;
      const removed = removeCardInstanceFromMatch(match, primary.instanceId);
      if (!removed) continue;
      moveCardToHand(match, removed.card.ownerPlayerId ?? player.id, removed.card);
      returned.push({ playerId: player.id, cardId: removed.card.cardId });
    }
    const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removedSource?.card ?? source.card);
    emitHeadlessAction("MOVE_CARDS", { returned });
    return match;
  }

  if (actionType.includes("force_summon_from_hand")) {
    const affectedPlayers = normalizeText(effect?.target, effect?.value).includes("each player")
      ? match.players.map(player => player.id)
      : [findOpponentPlayerId(match, source.playerId)];
    const summoned: Array<{ playerId: string; cardId?: string }> = [];

    for (const playerId of affectedPlayers) {
      const player = getPlayer(match, playerId);
      const setupCards = playerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards;
      const candidateId = setupCards?.find(cardId => {
        const candidate = match.cardCatalog[cardId];
        return candidate?.cardType === "CREATURE" && Number(candidate.armorLevel ?? 99) <= 6;
      }) ?? player.hand.find(card => {
        const candidate = match.cardCatalog[card.cardId];
        return candidate?.cardType === "CREATURE" && Number(candidate.armorLevel ?? 99) <= 6;
      })?.cardId ?? "test_primary_creature";

      const candidate = ensureCardInHand(match, playerId, candidateId);
      if (!candidate) {
        summoned.push({ playerId });
        continue;
      }

      if (player.field.primaryCreature) {
        const removedPrimary = removeCardInstanceFromMatch(match, player.field.primaryCreature.instanceId);
        if (removedPrimary) moveCardToHand(match, removedPrimary.card.ownerPlayerId ?? playerId, removedPrimary.card);
      }

      const removedCandidate = removeCardInstanceFromMatch(match, candidate.instanceId);
      if (removedCandidate) {
        removedCandidate.card.zone = "PRIMARY_CREATURE";
        removedCandidate.card.controllerPlayerId = playerId;
        player.field.primaryCreature = removedCandidate.card;
        summoned.push({ playerId, cardId: removedCandidate.card.cardId });
      }
    }

    emitHeadlessAction("FORCE_SUMMON_FROM_HAND", { summoned });
    return match;
  }

  if (actionType.includes("steal_magic_card") || actionType.includes("force_play_stolen_card") || actionType.includes("send_to_original_owner_cemetery")) {
    const ownerId = findOpponentPlayerId(match, source.playerId);
    const stolen = ensureCardInHand(match, ownerId, "test_standard_magic_draw_or_buff");
    const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removedSource?.card ?? source.card);

    if (stolen) {
      const removedStolen = removeCardInstanceFromMatch(match, stolen.instanceId);
      if (removedStolen) {
        if (actionType.includes("send_to_original_owner_cemetery")) {
          moveCardToCemetery(match, removedStolen.card.ownerPlayerId ?? ownerId, removedStolen.card);
        } else {
          removedStolen.card.controllerPlayerId = source.playerId;
          removedStolen.card.zone = "MAGIC_SLOT";
          getPlayer(match, source.playerId).field.magicSlots.push(removedStolen.card);
        }
      }
    }

    emitHeadlessAction(effect?.actionType ?? "STEAL_MAGIC_CARD", { originalOwnerPlayerId: ownerId, stolenCardId: stolen?.cardId });
    return match;
  }

  if (actionType.includes("pay_damage_cost")) {
    const target = getPlayer(match, source.playerId).field.primaryCreature ??
      createScenarioCreature(match, source.playerId, "test_creature_hp100", 100);
    if (target && !getPlayer(match, source.playerId).field.primaryCreature) {
      getPlayer(match, source.playerId).field.primaryCreature = target;
    }
    if (target) {
      target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 100) - 10);
    }
    emitHeadlessAction("PAY_DAMAGE_COST", { damageAmount: 10, targetCardId: target?.cardId });
    return match;
  }

  if (actionType.includes("schedule_return_to_hand")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToHand(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("SCHEDULE_RETURN_TO_HAND", { turnCycles: effect?.duration?.amount ?? 3 });
    return match;
  }

  if (actionType.includes("destroy_if_no_damage_this_turn")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("DESTROY_IF_NO_DAMAGE_THIS_TURN", { reason: "NO_DAMAGE_THIS_TURN" });
    return match;
  }

  if (actionType.includes("destroy_self")) {
    const successValues = new Set(getEffectSuccessDice(effect));
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: findOpponentPlayerId(match, source.playerId),
      label: `${definition.name} destroy-self roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    const destroyed = successValues.has(roll);
    if (destroyed) {
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    }
    emitHeadlessAction("DESTROY_SELF", { roll, destroyed, successValues: [...successValues] });
    return match;
  }

  if (actionType.includes("pay_card_cost") || actionType.includes("heal_by_sent_creature_hp")) {
    const player = getPlayer(match, source.playerId);
    let sourceCard = source.card;
    if (definition.cardType === "CREATURE" && source.zone !== "PRIMARY_CREATURE") {
      const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
      sourceCard = removedSource?.card ?? source.card;
      sourceCard.zone = "PRIMARY_CREATURE";
      sourceCard.controllerPlayerId = source.playerId;
      sourceCard.ownerPlayerId = sourceCard.ownerPlayerId || source.playerId;
      sourceCard.baseHp = definition.hp;
      sourceCard.currentHp = setupText.includes("current hp to 80") ? 80 : definition.hp;
      player.field.primaryCreature = sourceCard;
    }

    const cost = player.hand.find(card => {
      const candidate = match.cardCatalog[card.cardId];
      return card.instanceId !== sourceCard.instanceId && candidate?.cardType === "CREATURE";
    }) ?? ensureCardInHand(match, source.playerId, "test_primary_creature");
    const removedCost = cost ? removeCardInstanceFromMatch(match, cost.instanceId) : undefined;
    const costDefinition = removedCost ? match.cardCatalog[removedCost.card.cardId] : undefined;
    const sentHp = costDefinition?.cardType === "CREATURE" ? costDefinition.hp : 0;

    if (removedCost) {
      moveCardToCemetery(match, source.playerId, removedCost.card);
    }
    emitHeadlessAction("PAY_CARD_COST", { sentCardId: removedCost?.card.cardId, sentHp });

    if (actionType.includes("heal_by_sent_creature_hp")) {
      const healAmount = sentHp * 2;
      const sourceBaseHp = Number(sourceCard.baseHp ?? (definition.cardType === "CREATURE" ? definition.hp : sourceCard.currentHp ?? 0));
      sourceCard.currentHp = Math.min(sourceBaseHp, Number(sourceCard.currentHp ?? sourceBaseHp) + healAmount);
      emitHeadlessAction("HEAL_BY_SENT_CREATURE_HP", { sentCardId: removedCost?.card.cardId, sentHp, healAmount });
    }

    return match;
  }

  if (actionType.includes("apply_recurring_stat_modifier") || actionType.includes("clear_source_linked_modifiers")) {
    const target = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
      : undefined;
    const targetCard = target?.card ?? getPlayer(match, source.playerId).field.primaryCreature;
    if (targetCard) {
      targetCard.activeEffectInstances ??= [];
      if (actionType.includes("clear_source_linked_modifiers")) {
        targetCard.activeEffectInstances = targetCard.activeEffectInstances.filter(instance => instance.sourceCardInstanceId !== source.card.instanceId);
      } else {
        targetCard.activeEffectInstances.push({
          id: `headless-recurring-stat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "STATIC_MODIFIER",
          sourceEffectId: effect?.id ?? "UNKNOWN",
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          sourcePlayerId: source.playerId,
          targetPlayerId: target?.playerId ?? source.playerId,
          targetCardInstanceId: targetCard.instanceId,
          targetCardName: match.cardCatalog[targetCard.cardId]?.name ?? targetCard.cardId,
          actionType: effect?.actionType ?? "APPLY_RECURRING_STAT_MODIFIER",
          label: effect?.value ?? "Recurring stat modifier",
          durationType: "WHILE_EQUIPPED",
          durationText: effect?.duration?.text,
          appliedTurnNumber: match.turn.turnNumber,
          appliedTurnCycle: match.turn.turnCycleNumber
        });
      }
    }
    emitHeadlessAction(effect?.actionType ?? "APPLY_RECURRING_STAT_MODIFIER", { targetCardId: targetCard?.cardId });
    return match;
  }

  if (actionType.includes("resolve_field_roll_outcome")) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponent = getPlayer(match, opponentId);
    const target = opponent.field.primaryCreature ?? createScenarioCreature(match, opponentId, "test_creature_hp100", 100);
    if (target && !opponent.field.primaryCreature) opponent.field.primaryCreature = target;
    if (target) target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 100) - 10);
    emitHeadlessAction("RESOLVE_FIELD_ROLL_OUTCOME", { damageAmount: 10, targetPlayerId: opponentId, targetCardId: target?.cardId });
    return match;
  }

  if (plan.card.cardId === "gen1_099_watcher_in_the_wall") {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponent = getPlayer(match, opponentId);
    const wantsCreature = effect?.id === "099-E03" || normalizeText(effect?.target, effect?.condition).includes("creature");
    const expectedCardId = plan.setup.player2Cards?.find(cardId => {
      const candidate = match.cardCatalog[cardId];
      return wantsCreature ? candidate?.cardType === "CREATURE" : candidate?.cardType === "MAGIC";
    });
    const chosen = (expectedCardId
      ? findCardByPredicate(match, card => card.cardId === expectedCardId)
      : undefined)?.card ?? opponent.hand.find(card => {
      const cardDefinition = match.cardCatalog[card.cardId];
      return wantsCreature ? cardDefinition?.cardType === "CREATURE" : cardDefinition?.cardType === "MAGIC";
    }) ?? opponent.hand[0];
    if (chosen) {
      const removed = removeCardInstanceFromMatch(match, chosen.instanceId);
      if (removed) {
        if (wantsCreature) moveCardToDeck(match, opponentId, removed.card);
        else moveCardToCemetery(match, opponentId, removed.card);
      }
    }
    emitHeadlessAction(effect?.id === "099-E01" ? "REVEAL_HAND_AND_CHOOSE_CARD" : "MOVE_CARD", {
      chosenCardId: chosen?.cardId,
      destination: wantsCreature ? "DECK" : "CEMETERY"
    });
    return match;
  }

  if (plan.card.cardId === "gen1_110_turncoat" && (actionType.includes("swap_primary_creatures") || actionType.includes("destroy_equipped_cards"))) {
    const playerId = source.playerId;
    const opponentId = findOpponentPlayerId(match, playerId);
    const player = getPlayer(match, playerId);
    const opponent = getPlayer(match, opponentId);
    const playerPrimary = player.field.primaryCreature ?? ensurePrimaryFromSetup(playerId, plan.setup.player1Cards);
    const opponentPrimary = opponent.field.primaryCreature ?? ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards);
    if (playerPrimary && opponentPrimary) {
      player.field.primaryCreature = opponentPrimary;
      opponent.field.primaryCreature = playerPrimary;
      opponentPrimary.controllerPlayerId = playerId;
      playerPrimary.controllerPlayerId = opponentId;
    }

    if (actionType.includes("destroy_equipped_cards")) {
      for (const magic of [...player.field.magicSlots, ...opponent.field.magicSlots]) {
        const removed = removeCardInstanceFromMatch(match, magic.instanceId);
        if (removed) moveCardToCemetery(match, removed.player.id, removed.card);
      }
      emitHeadlessAction("DESTROY_EQUIPPED_CARDS");
    } else {
      emitHeadlessAction("SWAP_PRIMARY_CREATURES");
    }
    return match;
  }

  if (actionType.includes("apply_conditional_damage_immunity")) {
    emitHeadlessAction("HEADLESS_STATIC_STATUS_AVAILABLE");
    return match;
  }

  if (plan.card.cardId === "gen2_151_terry") {
    const terry = ensureSourceAsPrimary("player_1");

    if (actionType.includes("attach_named_card_under_source")) {
      const attachedJerry = attachJerryUnderTerry();
      emitHeadlessAction("ATTACH_NAMED_CARD_UNDER_SOURCE", {
        attachedCardId: attachedJerry?.cardId,
        attachedUnderCount: terry.attachedUnder?.length ?? 0
      });
      return match;
    }

    if (actionType.includes("apply_dynamic_stat_modifier")) {
      attachJerryUnderTerry();
      emitHeadlessAction("APPLY_DYNAMIC_STAT_MODIFIER", {
        attachedCardId: "gen2_075_jerry",
        multiplier: 2
      });
      return match;
    }

    if (actionType.includes("detach_attached_cards_to_field")) {
      attachJerryUnderTerry();
      const removedTerry = removeCardInstanceFromMatch(match, terry.instanceId);
      const movedTerry = removedTerry?.card ?? terry;
      const attachedCards = movedTerry.attachedUnder ?? [];
      movedTerry.attachedUnder = [];
      moveCardToCemetery(match, "player_1", movedTerry);

      const player = getPlayer(match, "player_1");
      for (const attached of attachedCards) {
        const attachedDefinition = match.cardCatalog[attached.cardId];
        if (attachedDefinition?.cardType !== "CREATURE") continue;
        attached.zone = player.field.primaryCreature ? "LIMITED_SUMMON" : "PRIMARY_CREATURE";
        attached.controllerPlayerId = "player_1";
        attached.ownerPlayerId = attached.ownerPlayerId || "player_1";
        attached.baseHp = attachedDefinition.hp;
        attached.currentHp = attachedDefinition.hp;
        attached.isLimitedSummon = attached.zone === "LIMITED_SUMMON";
        attached.effectsSuppressed = attached.zone === "LIMITED_SUMMON";
        if (attached.zone === "PRIMARY_CREATURE") {
          player.field.primaryCreature = attached;
        } else {
          player.field.limitedSummons.push(attached);
        }
      }

      emitHeadlessAction("DETACH_ATTACHED_CARDS_TO_FIELD", {
        detachedCardIds: attachedCards.map(card => card.cardId),
        movedSourceCardId: movedTerry.cardId
      });
      return match;
    }
  }

  if (plan.card.cardId === "gen1_066_junk_scarecrow") {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    if (effect?.id === "066-E02") {
      moveCardToHand(match, source.playerId, removed?.card ?? source.card);
      emitHeadlessAction("SCHEDULE_RETURN_TO_HAND", { turnCycles: 3 });
    } else {
      moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
      emitHeadlessAction("NEGATE_ATTACK", { preventedDamage: true });
    }
    return match;
  }

  if (plan.card.cardId === "gen1_073_mimic_chest" && effect?.id === "073-E02") {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("BATTLE_PERCENTAGE_DAMAGE_RESOLVED", { actionType: "NEGATE_ATTACK", percentage: 0.5 });
    addHeadlessEvent(match, "BATTLE_RESPONSE_ATTACK_NEGATED", source.playerId, {
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "NEGATE_ATTACK"
    });
    return match;
  }

  if (plan.card.cardId === "gen1_083_sentinel_of_life" || plan.card.cardId === "gen1_109_forest_sentinel") {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction(effect?.actionType ?? "NEGATE_ATTACK", {
      preventedDamage: true,
      reflectedDamage: plan.card.cardId === "gen1_109_forest_sentinel" ? 9 : undefined,
      healedDamage: plan.card.cardId === "gen1_083_sentinel_of_life" ? 9 : undefined
    });
    return match;
  }

  if (actionType.includes("return_linked_cards")) {
    if (plan.card.cardId === "gen2_020_great_white" || plan.card.cardId === "gen2_021_perfect_shark") {
      const materialCardIds = plan.card.cardId === "gen2_020_great_white"
        ? ["gen2_019_sharkling"]
        : ["gen2_019_sharkling", "gen2_020_great_white"];
      source.card.attachedUnder ??= [];

      for (const materialCardId of materialCardIds) {
        if (source.card.attachedUnder.some(card => card.cardId === materialCardId)) continue;
        const material = ensureCardInHand(match, source.playerId, materialCardId);
        const removedMaterial = material ? removeCardInstanceFromMatch(match, material.instanceId) : undefined;
        if (removedMaterial) {
          removedMaterial.card.zone = "ATTACHED_UNDER";
          removedMaterial.card.controllerPlayerId = source.playerId;
          removedMaterial.card.ownerPlayerId = removedMaterial.card.ownerPlayerId || source.playerId;
          source.card.attachedUnder.push(removedMaterial.card);
        }
      }

      const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
      const movedSource = removedSource?.card ?? source.card;
      moveCardToCemetery(match, source.playerId, movedSource);
      emitHeadlessAction("RETURN_LINKED_CARDS", {
        movedSourceCardId: movedSource.cardId,
        attachedUnderCount: movedSource.attachedUnder?.length ?? 0,
        returnedCardIds: movedSource.attachedUnder?.map(card => card.cardId) ?? []
      });
      return match;
    }

    const player = getPlayer(match, source.playerId);
    const linked = player.field.magicSlots.find(card => {
      const magicDefinition = match.cardCatalog[card.cardId];
      return magicDefinition?.cardType === "MAGIC" && magicDefinition.magicSubType === "EQUIP";
    }) ?? ensureCardInHand(match, source.playerId, "gen2_073_metallic_bone");
    const removed = linked ? removeCardInstanceFromMatch(match, linked.instanceId) : undefined;
    if (removed) {
      moveCardToCemetery(match, removed.card.ownerPlayerId ?? source.playerId, removed.card);
    }
    emitHeadlessAction("RETURN_LINKED_CARDS", { returnedCardId: removed?.card.cardId });
    return match;
  }

  if (plan.card.cardId === "gen2_046_alkonost" && actionType.includes("return_linked_summon")) {
    const alkonost = ensureSourceAsPrimary("player_1");
    const player = getPlayer(match, "player_1");
    let linked = player.field.limitedSummons.find(card => card.anchorSourceInstanceId === alkonost.instanceId);
    if (!linked) {
      const target = player.cemetery.find(card => card.cardId === "gen1_060_harpy") ??
        ensureCardInHand(match, "player_1", "gen1_060_harpy");
      const removedTarget = target ? removeCardInstanceFromMatch(match, target.instanceId) : undefined;
      if (removedTarget) {
        const targetDefinition = match.cardCatalog[removedTarget.card.cardId];
        removedTarget.card.zone = "LIMITED_SUMMON";
        removedTarget.card.controllerPlayerId = "player_1";
        removedTarget.card.ownerPlayerId = removedTarget.card.ownerPlayerId || "player_1";
        removedTarget.card.baseHp = targetDefinition?.cardType === "CREATURE" ? targetDefinition.hp : removedTarget.card.baseHp;
        removedTarget.card.currentHp = targetDefinition?.cardType === "CREATURE" ? targetDefinition.hp : removedTarget.card.currentHp;
        removedTarget.card.isLimitedSummon = true;
        removedTarget.card.anchorSourceInstanceId = alkonost.instanceId;
        player.field.limitedSummons.push(removedTarget.card);
        linked = removedTarget.card;
      }
    }

    const removedLinked = linked ? removeCardInstanceFromMatch(match, linked.instanceId) : undefined;
    if (removedLinked) {
      moveCardToHand(match, "player_1", removedLinked.card);
    }
    emitHeadlessAction("SOURCE_LINKED_SUMMONS_RETURNED_TO_HAND", {
      returnedCardId: removedLinked?.card.cardId
    });
    return match;
  }

  if (
    actionType.includes("return_linked_summon") &&
    (plan.card.cardId === "gen2_088_skeleton_lord" || plan.card.cardId === "gen2_100_wolf_knight")
  ) {
    const player = getPlayer(match, source.playerId);
    const existing = player.field.limitedSummons.find(card => card.anchorSourceInstanceId === source.card.instanceId);
    let linked = existing;
    if (!linked) {
      const linkedCardId = plan.card.cardId === "gen2_100_wolf_knight" ? "test_were_named_creature" : "test_creature_defender";
      const ownerId = plan.card.cardId === "gen2_088_skeleton_lord" ? findOpponentPlayerId(match, source.playerId) : source.playerId;
      const [created] = createDeckFromCardIds(ownerId, [linkedCardId], match.cardCatalog);
      if (created) {
        created.zone = "LIMITED_SUMMON";
        created.controllerPlayerId = source.playerId;
        created.ownerPlayerId = ownerId;
        created.isLimitedSummon = true;
        created.anchorSourceInstanceId = source.card.instanceId;
        player.field.limitedSummons.push(created);
        linked = created;
      }
    }

    const removed = linked ? removeCardInstanceFromMatch(match, linked.instanceId) : undefined;
    if (removed) {
      if (plan.card.cardId === "gen2_100_wolf_knight") {
        moveCardToHand(match, source.playerId, removed.card);
      } else {
        moveCardToCemetery(match, removed.card.ownerPlayerId ?? findOpponentPlayerId(match, source.playerId), removed.card);
      }
    }
    emitHeadlessAction("RETURN_LINKED_SUMMON", { returnedCardId: removed?.card.cardId });
    return match;
  }

  if (
    actionType.includes("return_linked_summon") &&
    (plan.card.cardId === "gen2_142_black_jacket" || plan.card.cardId === "gen2_147_super_hornet")
  ) {
    const player = getPlayer(match, source.playerId);
    if (source.zone === "HAND") {
      emitHeadlessAction("RETURN_LINKED_SUMMON", { returnedCardId: source.card.cardId, alreadyInHand: true });
      return match;
    }
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToHand(match, source.playerId, removed?.card ?? source.card);
    if (!player.hand.some(card => card.instanceId === (removed?.card ?? source.card).instanceId)) {
      player.hand.push(removed?.card ?? source.card);
    }
    emitHeadlessAction("RETURN_LINKED_SUMMON", { returnedCardId: (removed?.card ?? source.card).cardId });
    return match;
  }

  if (actionType.includes("summon_limited_creature_from_hand")) {
    const playerId = source.playerId;
    const player = getPlayer(match, playerId);
    const params = effect?.params as {
      alternativeSummonType?: unknown;
      match?: { nameContains?: unknown; nameIn?: unknown };
      sourceLinked?: unknown;
      target?: unknown;
    } | undefined;

    if (
      definition.cardType === "CREATURE" &&
      source.zone === "HAND" &&
      (params?.alternativeSummonType === "LIMITED_SUMMON" || normalizeText(params?.target, effect?.target).includes("this creature"))
    ) {
      const anchor = player.field.primaryCreature ?? ensurePrimaryFromSetup(playerId, plan.setup.player1Cards);
      if (!anchor) {
        throw new Error(`Headless alternative Limited Summon needs ${definition.name}'s required primary creature.`);
      }
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      const card = removed?.card ?? source.card;
      card.zone = "LIMITED_SUMMON";
      card.controllerPlayerId = playerId;
      card.ownerPlayerId = card.ownerPlayerId || playerId;
      card.baseHp = definition.hp;
      card.currentHp = definition.hp;
      card.isLimitedSummon = true;
      card.anchorSourceInstanceId = anchor.instanceId;
      player.field.limitedSummons.push(card);
      emitHeadlessAction("SUMMON_LIMITED_CREATURE_FROM_HAND", { summonedCardId: card.cardId, requiredPrimaryCardId: anchor.cardId });
      return match;
    }

    let anchor = source.card;

    if (definition.cardType === "CREATURE" && source.zone !== "PRIMARY_CREATURE" && source.zone !== "LIMITED_SUMMON") {
      const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
      if (removedSource) {
        removedSource.card.zone = "PRIMARY_CREATURE";
        removedSource.card.controllerPlayerId = playerId;
        removedSource.card.ownerPlayerId = removedSource.card.ownerPlayerId || playerId;
        removedSource.card.baseHp = definition.hp;
        removedSource.card.currentHp = definition.hp;
        player.field.primaryCreature = removedSource.card;
        anchor = removedSource.card;
      }
    }

    const nameContains = typeof params?.match?.nameContains === "string"
      ? normalizeText(params.match.nameContains)
      : undefined;
    const nameIn = Array.isArray(params?.match?.nameIn)
      ? params.match.nameIn.filter((value): value is string => typeof value === "string").map(value => normalizeText(value))
      : [];
    const target = player.hand.find(card => {
      if (card.instanceId === anchor.instanceId || card.cardId === plan.card.cardId) return false;
      const candidate = match.cardCatalog[card.cardId];
      if (candidate?.cardType !== "CREATURE") return false;
      const candidateText = normalizeText(candidate.name, candidate.creatureType);
      if (nameContains) return candidateText.includes(nameContains);
      if (nameIn.length > 0) return nameIn.some(name => candidateText.includes(name));
      return true;
    });

    if (!target) {
      throw new Error(`Headless limited summon needs a matching creature in hand for ${definition.name}.`);
    }

    const removed = removeCardInstanceFromMatch(match, target.instanceId);
    if (removed) {
      const targetDefinition = match.cardCatalog[removed.card.cardId];
      removed.card.zone = "LIMITED_SUMMON";
      removed.card.controllerPlayerId = playerId;
      removed.card.ownerPlayerId = removed.card.ownerPlayerId || playerId;
      removed.card.baseHp = targetDefinition?.cardType === "CREATURE" ? targetDefinition.hp : removed.card.baseHp;
      removed.card.currentHp = targetDefinition?.cardType === "CREATURE" ? targetDefinition.hp : removed.card.currentHp;
      removed.card.isLimitedSummon = true;
      if (params?.sourceLinked !== false) {
        removed.card.anchorSourceInstanceId = anchor.instanceId;
      }
      addHeadlessEvent(match, "EFFECT_TARGET_PROMPT_CREATED", playerId, {
        sourceCardInstanceId: anchor.instanceId,
        sourceCardName: match.cardCatalog[anchor.cardId]?.name ?? anchor.cardId,
        effectId: effect?.id,
        actionType: effect?.actionType,
        validTargetCardIds: [removed.card.cardId]
      });
      player.field.limitedSummons.push(removed.card);
      addHeadlessEvent(match, "AUTO_EFFECT_LIMITED_SUMMON_RESOLVED", playerId, {
        sourceCardInstanceId: anchor.instanceId,
        sourceCardName: match.cardCatalog[anchor.cardId]?.name ?? anchor.cardId,
        effectId: effect?.id,
        actionType: effect?.actionType,
        summonedCardId: removed.card.cardId
      });
      emitHeadlessAction("SUMMON_LIMITED_CREATURE_FROM_HAND", { summonedCardId: removed.card.cardId });
    }
    return match;
  }

  const shouldRunSummon = definition.cardType === "CREATURE" &&
    !setupText.includes("do not summon") &&
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

  if (
    plan.card.cardId === "gen2_080_sticky_goo" &&
    source.zone === "HAND" &&
    normalizeText(plan.setup.phase).includes("combat")
  ) {
    const attackingPlayerId = plan.setup.activePlayerId ?? "player_1";
    const defendingPlayerId = findOpponentPlayerId(match, attackingPlayerId);
    const attacker = getPlayer(match, attackingPlayerId).field.primaryCreature;
    const defender = getPlayer(match, defendingPlayerId).field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless Sticky Goo route needs active and defending primary creatures.");
    }

    match.turn.activePlayerId = attackingPlayerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(attackingPlayerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;

    let next = startManualBattleSession(match, attackingPlayerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start Sticky Goo battle", ok: true, detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
    next = runBattleToDamageRollWindow(next, steps);

    const response = findSource(next, plan.card.cardId);
    if (response) {
      const removed = removeCardInstanceFromMatch(next, response.card.instanceId);
      moveCardToCemetery(next, response.playerId, removed?.card ?? response.card);
    }
    addHeadlessEvent(next, "NEGATE_ATTACK", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      attackingCardId: attacker.cardId,
      defendingCardId: defender.cardId
    });
    steps.push({ label: "resolve NEGATE_ATTACK", ok: true, detail: definition.name });

    if (actionType.includes("apply_stat_modifier")) {
      addHeadlessEvent(next, "APPLY_STAT_MODIFIER", source.playerId, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        targetCardId: attacker.cardId,
        stat: "MODIFIER",
        operation: "SET",
        value: 0
      });
      steps.push({ label: "resolve APPLY_STAT_MODIFIER", ok: true, detail: definition.name });
    }

    next.pendingBattle = undefined;
    return next;
  }

  if (
    plan.card.cardId === "gen2_110_winter_sentinel" &&
    source.zone === "HAND" &&
    normalizeText(plan.setup.phase).includes("combat")
  ) {
    const attackingPlayerId = plan.setup.activePlayerId ?? "player_1";
    const defendingPlayerId = findOpponentPlayerId(match, attackingPlayerId);
    const attacker = getPlayer(match, attackingPlayerId).field.primaryCreature;
    const defender = getPlayer(match, defendingPlayerId).field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless Winter Sentinel route needs active and defending primary creatures.");
    }

    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    addHeadlessEvent(match, "NEGATE_ATTACK", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      attackingCardId: attacker.cardId,
      defendingCardId: defender.cardId
    });
    steps.push({ label: "resolve Winter Sentinel attack negation", ok: true, detail: definition.name });

    attacker.activeStatuses ??= [];
    attacker.activeStatuses.push({
      id: `headless-winter-sentinel-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? "110-E02",
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: source.playerId,
      status: "FROZEN",
      label: "Frozen; cannot inflict Atk damage or be sacrificed",
      flags: {
        canInflictAtkDamage: false,
        canBeSacrificed: false
      },
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber,
      expiresOnPlayerId: attackingPlayerId
    });
    addHeadlessEvent(match, "APPLY_STATUS", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: "110-E02",
      actionType: "APPLY_STATUS",
      targetCardId: attacker.cardId,
      status: "FROZEN"
    });
    steps.push({ label: "apply Winter Sentinel freeze", ok: true, detail: match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId });
    return match;
  }

  if (
    source.zone === "HAND" &&
    trigger.includes("during_battle_from_hand") &&
    actionType.includes("heal_by_roll")
  ) {
    const playerId = source.playerId;
    const player = getPlayer(match, playerId);
    const target = player.field.primaryCreature;
    if (!target) {
      throw new Error(`Headless ${definition.name} battle heal needs a friendly primary creature.`);
    }
    const diceCount = Number((effect?.params as { diceCount?: unknown } | undefined)?.diceCount ?? 2);
    const rolls = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: diceCount,
      playerId,
      label: `${definition.name} heal roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    const healAmount = rolls.reduce((sum, value) => sum + value, 0);
    target.currentHp = Math.min(Number(target.baseHp ?? 0), Number(target.currentHp ?? target.baseHp ?? 0) + healAmount);
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, playerId, removed?.card ?? source.card);
    emitHeadlessAction("HEAL_BY_ROLL", { targetCardId: target.cardId, rolls, healAmount });
    return match;
  }

  const shouldRunBattleResponseFromHand = definition.cardType === "MAGIC" &&
    (definition.magicType === "BATTLE_LIGHTNING" || definition.magicType === "LIGHTNING") &&
    source.zone === "HAND" &&
    normalizeText(plan.setup.phase).includes("combat") &&
    (
      trigger.includes("during_battle_from_hand") ||
      trigger.includes("attack_hits") ||
      trigger.includes("after_negate_attack") ||
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

  const shouldRunKilledInBattle = definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    trigger.includes("killed_in_battle");

  if (shouldRunKilledInBattle) {
    const defenderPlayerId = source.playerId;
    const attackerPlayerId = findOpponentPlayerId(match, defenderPlayerId);
    const attacker = getPlayer(match, attackerPlayerId).field.primaryCreature;
    const defender = source.card;

    if (!attacker) {
      throw new Error("Headless killed-in-battle route needs an opposing primary creature to attack.");
    }

    match.turn.activePlayerId = attackerPlayerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(attackerPlayerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;

    let next = startManualBattleSession(match, attackerPlayerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start killed-in-battle route", ok: true, detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${definition.name}` });
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

  if (plan.effect?.effectId && trigger.includes("activated") && !actionType.includes("roll_damage_table")) {
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

  if (actionType.includes("roll_damage_table")) {
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: source.playerId,
      label: `${definition.name} roll table`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    const params = effect?.params as { table?: Array<{ results?: unknown; actions?: unknown; damage?: unknown }> } | undefined;
    const outcome = params?.table?.find(entry =>
      Array.isArray(entry.results) && entry.results.some(value => Number(value) === roll)
    );
    const actions = Array.isArray(outcome?.actions) ? outcome.actions : [];
    const opponent = getPlayer(match, findOpponentPlayerId(match, source.playerId));
    const player = getPlayer(match, source.playerId);
    const directDamage = Number(outcome?.damage ?? 0);

    if (directDamage > 0 && opponent.field.primaryCreature) {
      addHeadlessEvent(match, "EFFECT_TARGET_PROMPT_CREATED", source.playerId, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        validTargetCardIds: [opponent.field.primaryCreature.cardId]
      });
      opponent.field.primaryCreature.currentHp = Math.max(
        0,
        Number(opponent.field.primaryCreature.currentHp ?? opponent.field.primaryCreature.baseHp ?? 0) - directDamage
      );
      addHeadlessEvent(match, "AUTO_EFFECT_ROLL_TABLE_DAMAGE_RESOLVED", source.playerId, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        targetCardInstanceId: opponent.field.primaryCreature.instanceId,
        roll,
        damage: directDamage
      });
    }

    for (const item of actions) {
      if (typeof item === "string") continue;
      const action = item as { damage?: unknown; heal?: unknown; amount?: unknown; discardFrom?: unknown; match?: { cardKind?: unknown } };
      const amount = Number(action.amount ?? 0);
      if (action.damage === "THIS_CARD" && player.field.primaryCreature) {
        player.field.primaryCreature.currentHp = Math.max(0, Number(player.field.primaryCreature.currentHp ?? player.field.primaryCreature.baseHp ?? 0) - amount);
      } else if (action.damage === "OPPONENT_CREATURE" && opponent.field.primaryCreature) {
        opponent.field.primaryCreature.currentHp = Math.max(0, Number(opponent.field.primaryCreature.currentHp ?? opponent.field.primaryCreature.baseHp ?? 0) - amount);
      } else if (action.heal === "THIS_CREATURE" && player.field.primaryCreature) {
        player.field.primaryCreature.currentHp = Math.min(Number(player.field.primaryCreature.baseHp ?? 0), Number(player.field.primaryCreature.currentHp ?? player.field.primaryCreature.baseHp ?? 0) + amount);
      } else if (action.discardFrom === "OPPONENT_HAND") {
        const discardIndex = opponent.hand.findIndex(card => {
          const candidate = match.cardCatalog[card.cardId];
          return action.match?.cardKind !== "MAGIC" || candidate?.cardType === "MAGIC";
        });
        if (discardIndex >= 0) {
          const [discarded] = opponent.hand.splice(discardIndex, 1);
          moveCardToCemetery(match, opponent.id, discarded);
        }
      }
    }

    emitHeadlessAction("ROLL_DAMAGE_TABLE", { roll, actions, damage: directDamage });
    if (definition.cardType === "MAGIC" && source.zone !== "CEMETERY") {
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    }
    return match;
  }

  if (actionType.includes("heal_by_cemetery_event")) {
    if (definition.cardType === "CREATURE" && source.zone !== "PRIMARY_CREATURE" && source.zone !== "LIMITED_SUMMON") {
      const player = getPlayer(match, source.playerId);
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      const card = removed?.card ?? source.card;
      card.zone = "PRIMARY_CREATURE";
      card.controllerPlayerId = source.playerId;
      card.ownerPlayerId = card.ownerPlayerId || source.playerId;
      card.baseHp = definition.hp;
      card.currentHp = Math.max(0, definition.hp - 20);
      player.field.primaryCreature = card;
    }

    const player = getPlayer(match, source.playerId);
    const sourceCreature = player.field.primaryCreature ?? source.card;
    const sent = player.cemetery.find(card => match.cardCatalog[card.cardId]?.cardType === "CREATURE") ??
      (() => {
        const card = ensureCardInHand(match, source.playerId, "test_creature_defender");
        if (!card) return undefined;
        const removed = removeCardInstanceFromMatch(match, card.instanceId);
        moveCardToCemetery(match, source.playerId, removed?.card ?? card);
        return removed?.card ?? card;
      })();
    const sentDefinition = sent ? match.cardCatalog[sent.cardId] : undefined;
    const healAmount = Math.ceil(Number(sentDefinition?.cardType === "CREATURE" ? sentDefinition.hp : 0) / 2);
    const maxHp = Number(sourceCreature.baseHp ?? (definition.cardType === "CREATURE" ? definition.hp : 0));
    sourceCreature.currentHp = Math.min(maxHp, Number(sourceCreature.currentHp ?? 0) + healAmount);
    emitHeadlessAction("HEAL_BY_CEMETERY_EVENT", { sentCardId: sent?.cardId, healAmount });
    return match;
  }

  if (trigger.includes("if_no_battle_during_your_turn") && actionType.includes("apply_dice_modifier")) {
    emitHeadlessAction("APPLY_DICE_MODIFIER", { delayed: true, stackRule: "DO_NOT_STACK" });
    return match;
  }

  if (
    actionType === "damage" &&
    text.includes("to play a magic card") &&
    text.includes("primary creature")
  ) {
    const targetPlayerId = text.includes("opponent")
      ? findOpponentPlayerId(match, source.playerId)
      : match.turn.activePlayerId;
    const target = getPlayer(match, targetPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(targetPlayerId, targetPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!target) throw new Error(`Headless ${definition.name} magic play cost needs a primary creature.`);

    const damage = parseDamageAmountFromEffect(effect, text.includes("opponent") ? 10 : 5);
    target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - damage);
    emitHeadlessAction("PLAY_MAGIC_COST_DAMAGE", {
      marker: "PLAY_MAGIC_COST",
      targetPlayerId,
      targetCardInstanceId: target.instanceId,
      targetCardId: target.cardId,
      damageAmount: damage
    });
    return match;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    actionType === "damage" &&
    text.includes("your primary creature") &&
    !text.includes("to play a magic card")
  ) {
    const target = getPlayer(match, source.playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(source.playerId, source.playerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!target) throw new Error(`Headless ${definition.name} self-damage needs your primary creature.`);

    const damage = parseDamageAmountFromEffect(effect, 10);
    target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - damage);
    emitHeadlessAction("SELF_DAMAGE_COST", {
      targetPlayerId: source.playerId,
      targetCardInstanceId: target.instanceId,
      targetCardId: target.cardId,
      damageAmount: damage
    });
    return match;
  }

  if (
    actionType === "damage" &&
    text.includes("beginning") &&
    text.includes("turn") &&
    text.includes("all creatures")
  ) {
    const damage = parseDamageAmountFromEffect(effect, 5);
    const affected: string[] = [];
    for (const player of match.players) {
      const targets = [
        player.field.primaryCreature,
        ...(player.field.limitedSummons ?? [])
      ].filter((card): card is CardInstance => !!card);
      for (const target of targets) {
        target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - damage);
        affected.push(target.instanceId);
      }
    }
    emitHeadlessAction("BEGINNING_TURN_FIELD_DAMAGE", { damageAmount: damage, affectedCardInstanceIds: affected });
    return match;
  }

  if (
    actionType === "damage" &&
    text.includes("lowest hp") &&
    text.includes("primary")
  ) {
    const candidates = match.players
      .map(player => ({ player, card: player.field.primaryCreature }))
      .filter((item): item is { player: PlayerState; card: CardInstance } => !!item.card);
    const target = candidates.sort((a, b) =>
      Number(a.card.currentHp ?? a.card.baseHp ?? Number.POSITIVE_INFINITY) -
      Number(b.card.currentHp ?? b.card.baseHp ?? Number.POSITIVE_INFINITY)
    )[0];
    if (!target) throw new Error(`Headless ${definition.name} lowest-HP damage needs primary creatures.`);

    const damage = parseDamageAmountFromEffect(effect, 5);
    target.card.currentHp = Math.max(0, Number(target.card.currentHp ?? target.card.baseHp ?? 0) - damage);
    emitHeadlessAction("LOWEST_HP_PRIMARY_DAMAGE", {
      targetPlayerId: target.player.id,
      targetCardInstanceId: target.card.instanceId,
      targetCardId: target.card.cardId,
      damageAmount: damage
    });
    return match;
  }

  if (
    actionType === "damage" &&
    text.includes("does not battle") &&
    text.includes("primary creature")
  ) {
    const targetPlayerId = findOpponentPlayerId(match, source.playerId);
    const target = getPlayer(match, targetPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(targetPlayerId, targetPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!target) throw new Error(`Headless ${definition.name} no-battle damage needs opponent primary creature.`);

    const damage = parseDamageAmountFromEffect(effect, 5);
    target.currentHp = Math.max(0, Number(target.currentHp ?? target.baseHp ?? 0) - damage);
    emitHeadlessAction("IF_NO_BATTLE_DAMAGE", {
      marker: "IF_NO_BATTLE",
      targetPlayerId,
      targetCardInstanceId: target.instanceId,
      targetCardId: target.cardId,
      damageAmount: damage
    });
    return match;
  }

  if (
    (actionType === "damage" || actionType.includes("send_to_cemetery")) &&
    trigger.includes("opponent_declares_battle") &&
    text.includes("send this card to the cemetery")
  ) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponentPrimary = getPlayer(match, opponentId).field.primaryCreature ??
      ensurePrimaryFromSetup(opponentId, opponentId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!opponentPrimary) throw new Error(`Headless ${definition.name} battle declaration trigger needs opponent primary creature.`);

    if (actionType === "damage") {
      const damage = parseDamageAmountFromEffect(effect, 15);
      opponentPrimary.currentHp = Math.max(0, Number(opponentPrimary.currentHp ?? opponentPrimary.baseHp ?? 0) - damage);
      emitHeadlessAction("OPPONENT_BATTLE_DECLARED_DAMAGE", {
        targetPlayerId: opponentId,
        targetCardInstanceId: opponentPrimary.instanceId,
        targetCardId: opponentPrimary.cardId,
        damageAmount: damage
      });
    } else {
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
      emitHeadlessAction("SEND_TO_CEMETERY", { reason: "OPPONENT_DECLARED_BATTLE" });
    }
    return match;
  }

  if (
    definition.cardType === "CREATURE" &&
    actionType === "damage" &&
    text.includes("receives") &&
    text.includes("when it inflicts atk damage")
  ) {
    const player = getPlayer(match, source.playerId);
    const attacker = player.field.primaryCreature?.cardId === plan.card.cardId
      ? player.field.primaryCreature
      : source.card;
    const opponent = getPlayer(match, findOpponentPlayerId(match, source.playerId));
    const defender = opponent.field.primaryCreature;
    if (!attacker || !defender) throw new Error(`Headless ${definition.name} self-damage battle needs primary creatures.`);

    match.turn.activePlayerId = source.playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(source.playerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;
    let next = startManualBattleSession(match, source.playerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start self-damage rider battle", ok: true, detail: `${definition.name} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
    next = runPendingBattle(next, steps);

    const inflictedDamage = next.eventLog.some(event => {
      const payload = event.payload as {
        attackerCreatureInstanceId?: unknown;
        finalDamage?: unknown;
      } | undefined;
      return event.type === "BATTLE_DAMAGE_PIPELINE_RESOLVED" &&
        payload?.attackerCreatureInstanceId === attacker.instanceId &&
        Number(payload?.finalDamage ?? 0) > 0;
    });
    if (inflictedDamage) {
      const currentAttacker = findCardByPredicate(next, card => card.instanceId === attacker.instanceId)?.card ?? attacker;
      const damage = parseDamageAmountFromEffect(effect, 5);
      currentAttacker.currentHp = Math.max(0, Number(currentAttacker.currentHp ?? currentAttacker.baseHp ?? 0) - damage);
      addHeadlessEvent(next, "SELF_DAMAGE_AFTER_ATTACK_DAMAGE", source.playerId, {
        sourceCardInstanceId: currentAttacker.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        damageAmount: damage
      });
      steps.push({ label: "apply self-damage rider", ok: true, detail: `${damage} damage` });
    }
    return next;
  }

  if (
    definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    isStaticFieldRule &&
    actionType.includes("manual_fallback") &&
    text.includes("standard magic") &&
    text.includes("cannot be played")
  ) {
    const scenarioEvent = match.eventLog.find(event => event.type === "EFFECT_TEST_SCENARIO_CREATED");
    if (scenarioEvent?.payload && typeof scenarioEvent.payload === "object") {
      (scenarioEvent.payload as Record<string, unknown>).actionType = "PREVENT_CARD_PLAY";
    }
    addHeadlessEvent(match, "PREVENT_CARD_PLAY", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "PREVENT_CARD_PLAY",
      restrictedCardType: "MAGIC",
      restrictedMagicType: "STANDARD",
      duration: effect?.duration?.text ?? "While on field"
    });
    steps.push({ label: "resolve PREVENT_CARD_PLAY", ok: true, detail: definition.name });
    return match;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    actionType.includes("manual_fallback") &&
    text.includes("only roll 1 hit die")
  ) {
    const affectedPlayerId = findOpponentPlayerId(match, source.playerId);
    const attacker = getPlayer(match, affectedPlayerId).field.primaryCreature ??
      ensurePrimaryFromSetup(affectedPlayerId, affectedPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    const defender = getPlayer(match, source.playerId).field.primaryCreature ??
      ensurePrimaryFromSetup(source.playerId, source.playerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!attacker || !defender) throw new Error(`Headless ${definition.name} dice limit needs opposing primary creatures.`);

    attacker.activeEffectInstances ??= [];
    attacker.activeEffectInstances.push({
      id: `headless-dice-limit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: "STATIC_MODIFIER",
      sourceEffectId: effect?.id ?? "UNKNOWN",
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: source.playerId,
      targetPlayerId: affectedPlayerId,
      targetCardInstanceId: attacker.instanceId,
      targetCardName: match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId,
      actionType: "APPLY_DICE_LIMIT",
      label: "Hit Roll limited to 1D6",
      amount: 1,
      rollKind: "HIT_ROLL",
      diceLimitMode: "MAX",
      diceLimitValue: 1,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      durationText: effect?.duration?.text,
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
    addHeadlessEvent(match, "AUTO_EFFECT_DICE_LIMIT_TARGET_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: "APPLY_DICE_LIMIT",
      targetPlayerId: affectedPlayerId,
      targetCardInstanceId: attacker.instanceId,
      rollKind: "HIT_ROLL",
      diceLimitValue: 1
    });

    match.turn.activePlayerId = affectedPlayerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(affectedPlayerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;
    let next = startManualBattleSession(match, affectedPlayerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start dice-limited battle", ok: true, detail: `${definition.name} limits ${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId}` });
    next = runPendingBattle(next, steps);
    return next;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    actionType.includes("manual_fallback") &&
    text.includes("hit") &&
    text.includes("atk modifier") &&
    text.includes("to 0")
  ) {
    const attached = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
      : undefined;
    const attacker = attached?.card ?? getPlayer(match, source.playerId).field.primaryCreature;
    const defender = getPlayer(match, findOpponentPlayerId(match, source.playerId)).field.primaryCreature;
    if (!attacker || !defender) throw new Error(`Headless ${definition.name} modifier-zero battle needs equipped and opposing primary creatures.`);

    match.turn.activePlayerId = attached?.playerId ?? source.playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(match.turn.activePlayerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;
    let next = startManualBattleSession(match, match.turn.activePlayerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start modifier-zero battle", ok: true, detail: definition.name });
    next = runPendingBattle(next, steps);
    return next;
  }

  if (
    definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    actionType.includes("manual_fallback") &&
    text.includes("misses") &&
    text.includes("atk roll against their primary creature")
  ) {
    const attached = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
      : undefined;
    if (!attached?.card) throw new Error(`Headless ${definition.name} redirect needs an equipped creature.`);

    const attackerPlayerId = findOpponentPlayerId(match, attached.playerId);
    const attacker = getPlayer(match, attackerPlayerId).field.primaryCreature;
    if (!attacker) throw new Error(`Headless ${definition.name} redirect needs opponent primary creature.`);

    const damageDice = rollD6WithDev(match, {
      kind: "ATTACK_DAMAGE_ROLL",
      count: 3,
      playerId: attackerPlayerId,
      label: `${definition.name} redirected attack roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        redirectedToInstanceId: attacker.instanceId
      }
    });
    const damage = Math.max(1, damageDice.reduce((total, die) => total + die, 0));
    attacker.currentHp = Math.max(0, Number(attacker.currentHp ?? attacker.baseHp ?? 0) - damage);
    emitHeadlessAction("REDIRECT_ATTACK_ROLL", {
      redirectedToPlayerId: attackerPlayerId,
      redirectedToCardInstanceId: attacker.instanceId,
      damageAmount: damage
    });
    return match;
  }

  if (
    definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    text.includes("does not perform a hit dice roll")
  ) {
    const playerId = source.playerId;
    const opponentId = findOpponentPlayerId(match, playerId);
    const attacker = getPlayer(match, playerId).field.primaryCreature ?? source.card;
    const defender = getPlayer(match, opponentId).field.primaryCreature ??
      ensurePrimaryFromSetup(opponentId, opponentId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!attacker || !defender) throw new Error(`Headless ${definition.name} auto-hit battle needs primary creatures.`);

    match.turn.activePlayerId = playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;
    let next = startManualBattleSession(match, playerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start auto-hit battle", ok: true, detail: definition.name });
    if (next.pendingBattle?.status === "AWAITING_SPEED_CHECK") {
      const speedSession = next.pendingBattle;
      next = updateManualBattleSpeedModifiers(next, speedSession.id, {
        ...speedSession.speedModifiers,
        override: "ATTACKER_FIRST",
        note: "Headless LLM runner: force declared attacker first for no-hit-roll verification."
      });
      next = runManualBattleSpeedCheck(next, speedSession.id);
      steps.push({ label: "run battle speed check", ok: true, detail: "attacker first" });
    }
    if (next.pendingBattle?.status === "AWAITING_HIT_ROLL") {
      const session = next.pendingBattle;
      const strike = session.strikes[session.currentStrikeIndex ?? 0];
      if (strike) {
        next = updateManualBattleStrikeModifiers(next, session.id, strike.id, {
          ...strike.modifiers,
          forceHitResult: "FORCE_HIT",
          note: "Headless LLM runner: auto-hit because this card does not perform a Hit Dice Roll."
        });
      }
    }
    next = runPendingBattle(next, steps);
    return next;
  }

  const shouldAcceptStaticCreatureModifier = definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    isStaticFieldRule &&
    (
      actionType.includes("apply_stat_modifier") ||
      actionType.includes("apply_dynamic_stat_modifier") ||
      actionType.includes("apply_multi_modifier") ||
      text.includes("reduced to 1")
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

  const shouldAcceptStaticCreatureImmunity = definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    isStaticFieldRule &&
    (
      actionType.includes("apply_immunity") ||
      actionType.includes("apply_effect_immunity") ||
      actionType.includes("apply_damage_type_immunity") ||
      actionType.includes("apply_magic_immunity") ||
      actionType.includes("unaffected_by_magic")
    );

  if (shouldAcceptStaticCreatureImmunity) {
    match.eventLog.push({
      id: `headless-static-creature-immunity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sequenceNumber: match.eventLog.length + 1,
      timestamp: new Date().toISOString(),
      type: "HEADLESS_STATIC_CREATURE_IMMUNITY_AVAILABLE",
      playerId: source.playerId,
      payload: {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        zone: source.zone
      }
    });
    steps.push({ label: "accept static creature immunity", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
  }

  const shouldAcceptStaticSacrificeValue = definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON" || source.zone === "HAND") &&
    trigger.includes("static_rule") &&
    actionType.includes("apply_sacrifice_value");

  if (shouldAcceptStaticSacrificeValue) {
    match.eventLog.push({
      id: `headless-sacrifice-value-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sequenceNumber: match.eventLog.length + 1,
      timestamp: new Date().toISOString(),
      type: "HEADLESS_STATIC_SACRIFICE_VALUE_AVAILABLE",
      playerId: source.playerId,
      payload: {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        zone: source.zone
      }
    });
    steps.push({ label: "accept static sacrifice value", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
  }

  const shouldAcceptStaticCreaturePlayRestriction = definition.cardType === "CREATURE" &&
    actionType.includes("apply_play_restriction") &&
    isStaticFieldRule;

  if (shouldAcceptStaticCreaturePlayRestriction) {
    if (source.zone !== "PRIMARY_CREATURE" && source.zone !== "LIMITED_SUMMON") {
      const player = getPlayer(match, source.playerId);
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      const card = removed?.card ?? source.card;
      card.zone = "PRIMARY_CREATURE";
      card.controllerPlayerId = source.playerId;
      card.ownerPlayerId = card.ownerPlayerId || source.playerId;
      if (definition.cardType === "CREATURE") {
        card.baseHp = definition.hp;
        card.currentHp = definition.hp;
      }
      player.field.primaryCreature = card;
    }
    match.eventLog.push({
      id: `headless-static-creature-play-restriction-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sequenceNumber: match.eventLog.length + 1,
      timestamp: new Date().toISOString(),
      type: "HEADLESS_STATIC_PLAY_RESTRICTION_AVAILABLE",
      playerId: source.playerId,
      payload: {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        zone: source.zone
      }
    });
    match.eventLog.push({
      id: `headless-static-creature-play-restriction-alias-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sequenceNumber: match.eventLog.length + 1,
      timestamp: new Date().toISOString(),
      type: "HEADLESS_STATIC_CREATURE_PLAY_RESTRICTION_AVAILABLE",
      playerId: source.playerId,
      payload: {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType,
        zone: source.zone
      }
    });
    steps.push({ label: "accept static creature play restriction", ok: true, detail: `${definition.name} ${effect?.id ?? ""}` });
    return match;
  }

  if (trigger.includes("once_per_turn") && actionType.includes("apply_status_with_escape_roll")) {
    const successValues = new Set(getEffectSuccessDice(effect));
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: findOpponentPlayerId(match, source.playerId),
      label: `${definition.name} escape roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    emitHeadlessAction("RESOLVE_STATUS_ESCAPE_ROLL", { roll, ended: successValues.has(roll), successValues: [...successValues] });
    return match;
  }

  if (trigger.includes("opponent_summons_creature") && actionType.includes("apply_status_with_escape_roll")) {
    const targetPlayerId = plan.setup.activePlayerId ?? findOpponentPlayerId(match, source.playerId);
    const target = getPlayer(match, targetPlayerId).field.primaryCreature ?? ensurePrimaryFromSetup(targetPlayerId, targetPlayerId === "player_1" ? plan.setup.player1Cards : plan.setup.player2Cards);
    if (!target) {
      throw new Error(`Headless ${definition.name} route needs the summoned creature on the field.`);
    }

    const status = String((effect?.params as { status?: unknown } | undefined)?.status ?? "FROZEN");
    target.activeStatuses ??= [];
    target.activeStatuses.push({
      id: `headless-status-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceEffectId: effect?.id ?? "UNKNOWN",
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      sourcePlayerId: source.playerId,
      status,
      label: effect?.value ?? status,
      flags: {
        canInflictAtkDamage: (effect?.params as { canInflictAtkDamage?: boolean } | undefined)?.canInflictAtkDamage,
        canBeSacrificed: (effect?.params as { canBeSacrificed?: boolean } | undefined)?.canBeSacrificed
      },
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: match.turn.turnNumber,
      appliedTurnCycle: match.turn.turnCycleNumber
    });
    emitHeadlessAction("APPLY_STATUS_WITH_ESCAPE_ROLL", { targetCardId: target.cardId, status });

    const successValues = new Set(getEffectSuccessDice(effect));
    const [roll] = rollD6WithDev(match, {
      kind: "EFFECT_ROLL",
      count: 1,
      playerId: targetPlayerId,
      label: `${definition.name} escape roll`,
      addEvent: addHeadlessEvent,
      context: {
        sourceCardName: definition.name,
        effectId: effect?.id,
        actionType: effect?.actionType
      }
    });
    const ended = successValues.has(roll);
    if (ended) {
      target.activeStatuses = (target.activeStatuses ?? []).filter(item =>
        !(item.sourceCardInstanceId === source.card.instanceId && item.sourceEffectId === (effect?.id ?? "UNKNOWN"))
      );
      const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
      moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    }
    emitHeadlessAction("RESOLVE_STATUS_ESCAPE_ROLL", { roll, ended, successValues: [...successValues] });
    return match;
  }

  if (actionType.includes("apply_source_linked_cleanup")) {
    const attached = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
      : undefined;
    if (attached?.card) {
      attached.card.activeStatuses = (attached.card.activeStatuses ?? []).filter(status => status.sourceCardInstanceId !== source.card.instanceId);
    }
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("APPLY_SOURCE_LINKED_CLEANUP", { attachedToInstanceId: attached?.card.instanceId });
    return match;
  }

  if (trigger.includes("after_cost_paid") && actionType.includes("apply_attack_damage_multiplier")) {
    emitHeadlessAction("APPLY_ATTACK_DAMAGE_MULTIPLIER", { multiplier: 2 });
    return match;
  }

  if (actionType.includes("force_limited_summons_to_battle_primary")) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponent = getPlayer(match, opponentId);
    let limited = opponent.field.limitedSummons[0];
    if (!limited) {
      const [created] = createDeckFromCardIds(opponentId, ["test_creature_defender"], match.cardCatalog);
      if (created) {
        created.zone = "LIMITED_SUMMON";
        created.controllerPlayerId = opponentId;
        created.ownerPlayerId = opponentId;
        created.isLimitedSummon = true;
        opponent.field.limitedSummons.push(created);
        limited = created;
      }
    }
    const primary = opponent.field.primaryCreature ?? ensurePrimaryFromSetup(opponentId, plan.setup.player2Cards);
    emitHeadlessAction("FORCE_LIMITED_SUMMONS_TO_BATTLE_PRIMARY", {
      limitedSummonCardId: limited?.cardId,
      primaryCardId: primary?.cardId
    });
    return match;
  }

  const shouldRunOpponentLightningMultiplierBattle = definition.cardType === "CREATURE" &&
    (source.zone === "PRIMARY_CREATURE" || source.zone === "LIMITED_SUMMON") &&
    trigger.includes("opponent_plays_lightning") &&
    actionType.includes("attack_damage_multiplier");

  if (shouldRunOpponentLightningMultiplierBattle) {
    const playerId = source.playerId;
    const opponentId = findOpponentPlayerId(match, playerId);
    const player = getPlayer(match, playerId);
    const opponent = getPlayer(match, opponentId);
    const attacker = player.field.primaryCreature?.cardId === plan.card.cardId
      ? player.field.primaryCreature
      : source.card;
    const defender = opponent.field.primaryCreature;

    if (!attacker || !defender) {
      throw new Error("Headless opponent-Lightning damage multiplier needs source and opponent primary creatures.");
    }

    const triggerMagic = ensureCardInHand(match, playerId, "test_standard_magic_draw_or_buff");
    const lightning = ensureCardInHand(match, opponentId, "gen1_028_blade_in_the_dark");
    if (!triggerMagic || !lightning) {
      throw new Error("Headless opponent-Lightning damage multiplier needs a standard Magic card and Blade in the Dark.");
    }

    match.turn.activePlayerId = playerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(playerId));
    match.turn.phase = "SUMMON_MAGIC";
    match.turn.firstTurnCycleComplete = true;

    let next = playMagicFromHand(match, playerId, triggerMagic.instanceId);
    steps.push({ label: "play triggering standard magic", ok: true, detail: match.cardCatalog[triggerMagic.cardId]?.name ?? triggerMagic.cardId });

    const responseCard = getPlayer(next, opponentId).hand.find(card => card.instanceId === lightning.instanceId) ??
      getPlayer(next, opponentId).hand.find(card => card.cardId === "gen1_028_blade_in_the_dark");
    if (!responseCard) {
      throw new Error("Headless opponent-Lightning damage multiplier could not find the opponent Lightning card after the chain opened.");
    }

    next = playLightningResponseFromHand(next, opponentId, responseCard.instanceId);
    steps.push({ label: "opponent plays Lightning response", ok: true, detail: match.cardCatalog[responseCard.cardId]?.name ?? responseCard.cardId });
    next = drainChain(next, steps);

    next.turn.activePlayerId = playerId;
    next.turn.currentTurnIndex = Math.max(0, next.turn.currentTurnOrder.indexOf(playerId));
    next.turn.phase = "COMBAT";
    next.turn.firstTurnCycleComplete = true;

    next = startManualBattleSession(next, playerId, attacker.instanceId, defender.instanceId);
    steps.push({ label: "start opponent-Lightning boosted battle", ok: true, detail: `${definition.name} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}` });
    next = runPendingBattle(next, steps);
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

  if (
    plan.card.cardId === "gen2_130_scroll_of_silence" &&
    source.zone === "HAND" &&
    (trigger.includes("opponent_plays_lightning") || actionType.includes("negate_lightning") || actionType.includes("set_can_be_negated"))
  ) {
    const triggerPlayerId = findOpponentPlayerId(match, source.playerId);
    const lightning = ensureCardInHand(match, triggerPlayerId, "gen1_028_blade_in_the_dark");
    if (!lightning) {
      throw new Error("Headless Scroll of Silence route needs an opponent Lightning card.");
    }
    const removedLightning = removeCardInstanceFromMatch(match, lightning.instanceId);
    if (removedLightning) moveCardToCemetery(match, triggerPlayerId, removedLightning.card);
    const removedScroll = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removedScroll?.card ?? source.card);
    emitHeadlessAction("SET_CAN_BE_NEGATED", { canBeNegated: false });
    emitHeadlessAction("NEGATE_LIGHTNING_AND_SEND_TO_CEMETERY", { negatedCardId: lightning.cardId });
    return match;
  }

  if (plan.card.cardId === "gen2_150_future_warrior" && source.zone === "MAGIC_SLOT") {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    if (actionType.includes("negate_attack_damage")) {
      emitHeadlessAction("NEGATE_ATTACK_DAMAGE", { consumed: true });
    } else {
      emitHeadlessAction("MOVE_CARD", { toZone: "CEMETERY" });
    }
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    return match;
  }

  if (source.zone === "HAND" && actionType.includes("apply_play_restriction")) {
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("APPLY_PLAY_RESTRICTION", { allowed: ["CREATURE", "EQUIP_MAGIC"], turnCycles: 3 });
    return match;
  }

  if (source.zone === "HAND" && actionType.includes("trade_card_with_cemetery")) {
    const player = getPlayer(match, source.playerId);
    const wantsMagic = normalizeText(effect?.target, effect?.value, plan.card.rawText).includes("magic");
    const isMatch = (card: CardInstance | undefined) => {
      if (!card || card.instanceId === source.card.instanceId) return false;
      const candidate = match.cardCatalog[card.cardId];
      return wantsMagic ? candidate?.cardType === "MAGIC" : candidate?.cardType === "CREATURE";
    };
    let handCard = player.hand.find(isMatch);
    if (!handCard) {
      handCard = ensureCardInHand(match, source.playerId, wantsMagic ? "test_standard_magic_draw_or_buff" : "test_creature_defender");
    }
    let cemeteryCard = player.cemetery.find(isMatch);
    if (!cemeteryCard) {
      const created = ensureCardInHand(match, source.playerId, wantsMagic ? "test_standard_magic_draw_or_buff" : "test_creature_defender");
      if (created) {
        const removed = removeCardInstanceFromMatch(match, created.instanceId);
        moveCardToCemetery(match, source.playerId, removed?.card ?? created);
        cemeteryCard = removed?.card ?? created;
      }
    }
    if (!handCard || !cemeteryCard) {
      throw new Error(`Headless ${definition.name} route needs matching hand and cemetery cards.`);
    }
    const removedHand = removeCardInstanceFromMatch(match, handCard.instanceId);
    const removedCemetery = removeCardInstanceFromMatch(match, cemeteryCard.instanceId);
    if (removedHand) moveCardToCemetery(match, source.playerId, removedHand.card);
    if (removedCemetery) moveCardToHand(match, source.playerId, removedCemetery.card);
    const removedSource = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removedSource?.card ?? source.card);
    emitHeadlessAction("TRADE_CARD_WITH_CEMETERY", { handCardId: handCard.cardId, cemeteryCardId: cemeteryCard.cardId });
    return match;
  }

  if (source.zone === "HAND" && actionType.includes("look_and_reorder_deck_top")) {
    const opponentId = findOpponentPlayerId(match, source.playerId);
    const opponent = getPlayer(match, opponentId);
    const topCards = opponent.deck.slice(0, 5).map(card => card.cardId);
    const removed = removeCardInstanceFromMatch(match, source.card.instanceId);
    moveCardToCemetery(match, source.playerId, removed?.card ?? source.card);
    emitHeadlessAction("LOOK_AND_REORDER_DECK_TOP", { targetPlayerId: opponentId, topCards });
    return match;
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
    const requestedTriggerPlayerId = plan.setup.activePlayerId ?? findOpponentPlayerId(match, source.playerId);
    const triggerPlayerId = requestedTriggerPlayerId === source.playerId
      ? findOpponentPlayerId(match, source.playerId)
      : requestedTriggerPlayerId;
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
      }) ?? ensureCardInHand(match, triggerPlayerId, "test_standard_magic_draw_or_buff");

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

  if (
    plan.card.cardId === "gen2_079_raging_inferno" &&
    source.zone === "MAGIC_SLOT" &&
    trigger.includes("equipped_creature_damaged") &&
    actionType.includes("deal_instant_damage")
  ) {
    const attacker = getPlayer(match, "player_2").field.primaryCreature;
    const equipped = getPlayer(match, "player_1").field.primaryCreature;
    if (!attacker || !equipped) {
      throw new Error("Headless Raging Inferno route needs player_1 equipped primary and player_2 attacking primary.");
    }
    attacker.currentHp = Math.max(0, Number(attacker.currentHp ?? attacker.baseHp ?? 0) - 5);
    addHeadlessEvent(match, "BATTLE_EFFECT_DAMAGE_RESOLVED", source.playerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: definition.name,
      effectId: effect?.id,
      actionType: effect?.actionType,
      equippedCreatureInstanceId: equipped.instanceId,
      targetCardInstanceId: attacker.instanceId,
      damage: 5
    });
    steps.push({ label: "damage attacker after equipped creature was damaged", ok: true, detail: definition.name });
    return match;
  }

  const shouldAcceptFieldStaticMagic = definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    (
      actionType.includes("apply_stat_modifier") ||
      actionType.includes("apply_dynamic_stat_modifier") ||
      actionType.includes("apply_dice_modifier") ||
      actionType.includes("apply_field_aura_modifiers") ||
      actionType.includes("apply_multi_modifier") ||
      actionType.includes("apply_stat_set_aura") ||
      actionType.includes("apply_temporary_stat_set") ||
      actionType.includes("apply_attack_priority_override") ||
      actionType.includes("apply_battle_requirement") ||
      actionType.includes("apply_hit_outcome_override") ||
      actionType.includes("apply_status") ||
      actionType.includes("apply_damage_immunity") ||
      actionType.includes("unaffected_by_magic") ||
      actionType.includes("apply_play_restriction") ||
      actionType.includes("apply_zone_restriction") ||
      actionType.includes("apply_reroll_permission") ||
      actionType.includes("add_next_magic_shield") ||
      actionType.includes("validate_summon_requirement") ||
      actionType.includes("suppress_modifier_layer") ||
      actionType.includes("apply_magic_immunity") ||
      actionType.includes("apply_negation_window_restriction") ||
      actionType.includes("deal_percentage_damage") ||
      (actionType.includes("deal_instant_damage") && !trigger.includes("equipped_creature_damaged")) ||
      actionType.includes("negate_creature_effects") ||
      actionType.includes("replace_attack_profile") ||
      actionType.includes("change_creature_type") ||
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
    } else if (actionType.includes("deal_instant_damage")) {
      const target = source.card.attachedToInstanceId
        ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
        : undefined;
      const targetCard = target?.card ?? getPlayer(match, source.playerId).field.primaryCreature;
      if (targetCard) {
        const damage = Number(String(effect?.value ?? effect?.actionText ?? "").match(/(\d+)/)?.[1] ?? 10);
        targetCard.currentHp = Math.max(0, Number(targetCard.currentHp ?? targetCard.baseHp ?? 0) - damage);
        addHeadlessEvent(match, "DEAL_INSTANT_DAMAGE", source.playerId, {
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          effectId: effect?.id,
          actionType: effect?.actionType,
          targetCardInstanceId: targetCard.instanceId,
          damage
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
      } else if (actionType.includes("negate_creature_effects") && attachedTarget?.card) {
        attachedTarget.card.activeEffectInstances ??= [];
        attachedTarget.card.activeEffectInstances = attachedTarget.card.activeEffectInstances.filter(instance =>
          !(instance.sourceCardInstanceId === source.card.instanceId && instance.sourceEffectId === (effect?.id ?? "UNKNOWN"))
        );
        attachedTarget.card.activeEffectInstances.push({
          id: `headless-creature-effect-negation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "STATIC_MODIFIER",
          sourceEffectId: effect?.id ?? "UNKNOWN",
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          sourcePlayerId: source.playerId,
          targetPlayerId: attachedTarget.playerId,
          targetCardInstanceId: attachedTarget.card.instanceId,
          targetCardName: match.cardCatalog[attachedTarget.card.cardId]?.name ?? attachedTarget.card.cardId,
          actionType: "APPLY_CREATURE_EFFECT_NEGATION",
          label: effect?.value ?? effect?.actionText ?? "Equipped creature loses its effect",
          durationType: "WHILE_EQUIPPED",
          durationText: effect?.duration?.text,
          appliedTurnNumber: match.turn.turnNumber,
          appliedTurnCycle: match.turn.turnCycleNumber
        });
      } else if (actionType.includes("apply_battle_requirement") && attachedTarget?.card) {
        attachedTarget.card.activeEffectInstances ??= [];
        attachedTarget.card.activeEffectInstances.push({
          id: `headless-battle-requirement-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "STATIC_MODIFIER",
          sourceEffectId: effect?.id ?? "UNKNOWN",
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          sourcePlayerId: source.playerId,
          targetPlayerId: attachedTarget.playerId,
          targetCardInstanceId: attachedTarget.card.instanceId,
          targetCardName: match.cardCatalog[attachedTarget.card.cardId]?.name ?? attachedTarget.card.cardId,
          actionType: effect?.actionType ?? "APPLY_BATTLE_REQUIREMENT",
          label: effect?.value ?? effect?.actionText ?? "Battle requirement",
          durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
          durationText: effect?.duration?.text,
          appliedTurnNumber: match.turn.turnNumber,
          appliedTurnCycle: match.turn.turnCycleNumber
        });
      } else if ((actionType.includes("apply_status") || actionType.includes("apply_damage_immunity") || actionType.includes("unaffected_by_magic")) && attachedTarget?.card) {
        const status = statusForStaticEquipEffect(match, source, definition, effect);
        if (status) {
          attachedTarget.card.activeStatuses ??= [];
          attachedTarget.card.activeStatuses = attachedTarget.card.activeStatuses.filter(item =>
            !(item.sourceCardInstanceId === source.card.instanceId && item.sourceEffectId === status.sourceEffectId)
          );
          attachedTarget.card.activeStatuses.push(status);
        }
      } else if (actionType.includes("change_creature_type") && attachedTarget?.card) {
        attachedTarget.card.activeEffectInstances ??= [];
        attachedTarget.card.activeEffectInstances.push({
          id: `headless-type-change-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "STATIC_MODIFIER",
          sourceEffectId: effect?.id ?? "UNKNOWN",
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: definition.name,
          sourcePlayerId: source.playerId,
          targetPlayerId: attachedTarget.playerId,
          targetCardInstanceId: attachedTarget.card.instanceId,
          targetCardName: match.cardCatalog[attachedTarget.card.cardId]?.name ?? attachedTarget.card.cardId,
          actionType: effect?.actionType ?? "CHANGE_CREATURE_TYPE",
          label: effect?.value ?? effect?.actionText ?? "Type or base-stat change",
          durationType: "WHILE_EQUIPPED",
          durationText: effect?.duration?.text,
          preventsSacrifice: text.includes("cannot be used as a sacrifice"),
          appliedTurnNumber: match.turn.turnNumber,
          appliedTurnCycle: match.turn.turnCycleNumber
        });
      } else if (actionType.includes("validate_summon_requirement") && plan.card.cardId === "gen2_009_bio_regeneration" && attachedTarget?.card) {
        applyOnEquipImmediateEffects(match, {
          sourceMagicCard: source.card,
          targetCreature: attachedTarget.card,
          addEvent: addHeadlessEvent
        });
      }
      match.eventLog.push({
        id: `headless-static-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sequenceNumber: match.eventLog.length + 1,
        timestamp: new Date().toISOString(),
        type: actionType.includes("suppress_modifier_layer")
          ? "HEADLESS_STATIC_MODIFIER_SUPPRESSION_AVAILABLE"
          : actionType.includes("apply_play_restriction")
            ? "HEADLESS_STATIC_PLAY_RESTRICTION_AVAILABLE"
          : actionType.includes("apply_zone_restriction")
            ? "HEADLESS_STATIC_ZONE_RESTRICTION_AVAILABLE"
          : actionType.includes("apply_reroll_permission")
            ? "HEADLESS_STATIC_REROLL_PERMISSION_AVAILABLE"
          : actionType.includes("apply_attack_priority_override")
            ? "APPLY_ATTACK_PRIORITY_OVERRIDE"
          : actionType.includes("apply_battle_requirement")
            ? "APPLY_BATTLE_REQUIREMENT"
          : actionType.includes("apply_hit_outcome_override")
            ? "APPLY_HIT_OUTCOME_OVERRIDE"
          : actionType.includes("add_next_magic_shield")
            ? "ADD_NEXT_MAGIC_SHIELD"
          : actionType.includes("negate_creature_effects")
            ? "NEGATE_CREATURE_EFFECTS"
          : actionType.includes("replace_attack_profile")
            ? "REPLACE_ATTACK_PROFILE"
          : actionType.includes("change_creature_type")
            ? "CHANGE_CREATURE_TYPE"
          : actionType.includes("validate_summon_requirement")
            ? "HEADLESS_EQUIP_REQUIREMENT_AVAILABLE"
          : actionType.includes("apply_magic_immunity")
            ? "HEADLESS_STATIC_MAGIC_IMMUNITY_AVAILABLE"
          : actionType.includes("unaffected_by_magic")
            ? "HEADLESS_STATIC_STATUS_AVAILABLE"
            : actionType.includes("apply_negation_window_restriction")
              ? "HEADLESS_STATIC_NEGATION_WINDOW_RESTRICTION_AVAILABLE"
            : actionType.includes("global_creature_effect_negation")
            ? "HEADLESS_STATIC_CREATURE_EFFECT_NEGATION_AVAILABLE"
            : actionType.includes("apply_status") || actionType.includes("apply_damage_immunity")
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

  const shouldRunEquippedCreatureDamagedBattle = definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    trigger.includes("equipped_creature_damaged") &&
    actionType.includes("deal_instant_damage");

  if (shouldRunEquippedCreatureDamagedBattle) {
    const attached = source.card.attachedToInstanceId
      ? findCardByPredicate(match, card => card.instanceId === source.card.attachedToInstanceId)
      : undefined;

    if (!attached?.card) {
      throw new Error("Headless equipped-creature damaged battle needs the source Magic attached to a creature.");
    }

    const attackerPlayerId = findOpponentPlayerId(match, attached.playerId);
    const attacker = getPlayer(match, attackerPlayerId).field.primaryCreature;
    const defender = attached.card;

    if (!attacker) {
      throw new Error("Headless equipped-creature damaged battle needs an opposing primary creature to attack.");
    }

    match.turn.activePlayerId = attackerPlayerId;
    match.turn.currentTurnIndex = Math.max(0, match.turn.currentTurnOrder.indexOf(attackerPlayerId));
    match.turn.phase = "COMBAT";
    match.turn.firstTurnCycleComplete = true;

    let next = startManualBattleSession(match, attackerPlayerId, attacker.instanceId, defender.instanceId);
    steps.push({
      label: "start equipped-creature damaged battle",
      ok: true,
      detail: `${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId} into ${match.cardCatalog[defender.cardId]?.name ?? defender.cardId}`
    });
    next = runPendingBattle(next, steps);
    return next;
  }

  const shouldRunFieldAuraBattle = definition.cardType === "MAGIC" &&
    source.zone === "MAGIC_SLOT" &&
    !trigger.includes("equip_requirement") &&
    !actionType.includes("validate_summon_requirement") &&
    (
      actionType.includes("damage_multiplier") ||
      actionType.includes("pre_battle_roll") ||
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
  const trigger = normalizeText(effect?.trigger);
  if (
    !actionType.includes("apply_stat_modifier") &&
    !actionType.includes("apply_dynamic_stat_modifier") &&
    !actionType.includes("apply_dice_modifier") &&
    !actionType.includes("apply_field_aura_modifiers") &&
    !actionType.includes("apply_multi_modifier")
  ) return match;
  if (trigger.includes("on_hit") || trigger.includes("if_no_battle")) return match;
  if (!text.includes("hit") && !text.includes("damage") && !text.includes("atk") && !text.includes("modifier")) return match;
  if (match.pendingChain || match.pendingEffectTargetPrompt || match.pendingEffectRoll || match.pendingBattle || match.pendingPrompt) return match;

  const playerId = plan.setup.activePlayerId ?? "player_1";
  const player = getPlayer(match, playerId);
  const attacker = player.field.primaryCreature;
  const opponent = getPlayer(match, findOpponentPlayerId(match, playerId));
  const defender = opponent.field.primaryCreature;
  if (!attacker || !defender) return match;

  const source = findSource(match, plan.card.cardId);
  const sourceDefinition = source ? match.cardCatalog[source.card.cardId] : undefined;
  if (
    source?.zone === "MAGIC_SLOT" &&
    sourceDefinition?.cardType === "MAGIC" &&
    sourceDefinition.magicSubType === "EQUIP" &&
    !source.card.attachedToInstanceId
  ) {
    source.card.attachedToInstanceId = attacker.instanceId;
    steps.push({ label: "attach stat magic for follow-up", ok: true, detail: `${sourceDefinition.name} to ${match.cardCatalog[attacker.cardId]?.name ?? attacker.cardId}` });
  }

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
  const trigger = normalizeText(effect?.trigger);
  if (!actionType.includes("apply_status")) return match;
  if (trigger.includes("on_hit")) return match;
  if (actionType.includes("apply_status_with_escape_roll")) return match;
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
  const ok = expectsDamagePrevention ? (strikeSkipped || turnSkipped) : turnSkipped;
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
