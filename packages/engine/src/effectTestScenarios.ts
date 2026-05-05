import { v4 as uuidv4 } from "uuid";
import type { CardDefinition, CardInstance, MatchState, WardEngineEffect } from "@ward/shared";
import { create1v1MatchFromDeckCardIds } from "./matchFactory.js";

function cardEffects(definition: CardDefinition): WardEngineEffect[] {
  return Array.isArray(definition.effects) ? definition.effects : [];
}

function findCreatureId(cardCatalog: Record<string, CardDefinition>, preferredNotId?: string): string {
  const candidates = Object.values(cardCatalog)
    .filter((card): card is Extract<CardDefinition, { cardType: "CREATURE" }> => card.cardType === "CREATURE")
    .sort((a, b) => (a.armorLevel - b.armorLevel) || (b.hp - a.hp) || a.name.localeCompare(b.name));

  return (candidates.find(card => card.id !== preferredNotId) ?? candidates[0])?.id ?? preferredNotId ?? "";
}

function findMagicId(cardCatalog: Record<string, CardDefinition>, preferredNotId?: string): string | undefined {
  return Object.values(cardCatalog)
    .find(card => card.cardType === "MAGIC" && card.id !== preferredNotId)?.id;
}

function buildTestDeck(cardCatalog: Record<string, CardDefinition>, sourceCardId: string, fillerCreatureId: string): string[] {
  const magicId = findMagicId(cardCatalog, sourceCardId);
  const deck = [sourceCardId, fillerCreatureId, fillerCreatureId, fillerCreatureId, fillerCreatureId];
  while (deck.length < 10) {
    deck.push(magicId ?? fillerCreatureId);
  }
  return deck;
}

function takeInstanceFromZone(cards: CardInstance[], cardId: string): CardInstance {
  const index = cards.findIndex(card => card.cardId === cardId);
  if (index < 0) {
    throw new Error(`Could not find test card instance for ${cardId}.`);
  }
  const [card] = cards.splice(index, 1);
  return card;
}

function placeAsPrimary(card: CardInstance, playerId: string, definition: CardDefinition): CardInstance {
  card.ownerPlayerId = card.ownerPlayerId || playerId;
  card.controllerPlayerId = playerId;
  card.zone = "PRIMARY_CREATURE";
  if (definition.cardType === "CREATURE") {
    card.baseHp = definition.hp;
    card.currentHp = definition.hp;
  }
  return card;
}

function inferScenarioPhase(effect?: WardEngineEffect): MatchState["turn"]["phase"] {
  const trigger = (effect?.trigger ?? "").toUpperCase();
  const actionType = (effect?.actionType ?? "").toUpperCase();
  const text = `${trigger} ${actionType} ${effect?.actionText ?? ""} ${effect?.value ?? ""}`.toUpperCase();

  if (text.includes("BATTLE") || text.includes("HIT") || text.includes("DAMAGE_CALC") || text.includes("COMBAT")) {
    return "COMBAT";
  }

  if (trigger.includes("END_OF_YOUR_TURN")) return "END";
  if (trigger.includes("BEGINNING") || trigger.includes("DRAW")) return "DRAW";
  return "SUMMON_MAGIC";
}

export function createEffectTestScenarioMatch(options: {
  cardCatalog: Record<string, CardDefinition>;
  cardId: string;
  effectId?: string;
  player1Name?: string;
  player2Name?: string;
}): MatchState {
  const sourceDefinition = options.cardCatalog[options.cardId];
  if (!sourceDefinition) throw new Error(`Card not found: ${options.cardId}`);

  const effect = options.effectId
    ? cardEffects(sourceDefinition).find(item => item.id === options.effectId)
    : cardEffects(sourceDefinition)[0];

  const fillerCreatureId = findCreatureId(options.cardCatalog, options.cardId);
  if (!fillerCreatureId) throw new Error("No creature card was found to build the test scenario.");

  const player1DeckCardIds = buildTestDeck(options.cardCatalog, options.cardId, fillerCreatureId);
  const player2DeckCardIds = buildTestDeck(options.cardCatalog, fillerCreatureId, fillerCreatureId);

  const match = create1v1MatchFromDeckCardIds({
    cardCatalog: options.cardCatalog,
    player1DeckCardIds,
    player2DeckCardIds,
    player1Name: options.player1Name ?? "Effect Tester",
    player2Name: options.player2Name ?? "Test Opponent",
    exactDeckSize: 10,
    defaultCopyLimit: 10
  });

  // Effect scenarios are deterministic dev fixtures. Treat decks as already
  // shuffled so the Play Table can draw/advance without requiring a separate
  // setup step that interrupts LLM direct testing.
  match.setup.decksShuffled = true;

  const player1 = match.players[0];
  const player2 = match.players[1];
  const opponentDefinition = options.cardCatalog[fillerCreatureId];

  const opponentPrimary = takeInstanceFromZone(player2.deck, fillerCreatureId);
  player2.field.primaryCreature = placeAsPrimary(opponentPrimary, player2.id, opponentDefinition);

  const phase = inferScenarioPhase(effect);
  match.turn.activePlayerId = player1.id;
  match.turn.currentTurnIndex = 0;
  match.turn.phase = phase;
  match.turn.firstTurnCycleComplete = true;
  player1.turnFlags.hasTakenFirstTurn = true;
  player2.turnFlags.hasTakenFirstTurn = true;
  match.setup.firstTurnDrawsByPlayer[player1.id] = true;
  match.setup.firstTurnDrawsByPlayer[player2.id] = true;

  if (sourceDefinition.cardType === "CREATURE") {
    const source = takeInstanceFromZone(player1.deck, options.cardId);
    player1.field.primaryCreature = placeAsPrimary(source, player1.id, sourceDefinition);
  } else {
    const source = takeInstanceFromZone(player1.deck, options.cardId);
    const trigger = (effect?.trigger ?? "").toUpperCase();
    const subtype = sourceDefinition.magicSubType;

    const sourceNeedsField = trigger.includes("WHILE") || trigger.includes("STATIC") || sourceDefinition.magicType === "INFINITE" || subtype === "FIELD" || subtype === "EQUIP";

    if (sourceNeedsField) {
      if (!player1.field.primaryCreature) {
        const p1Primary = takeInstanceFromZone(player1.deck, fillerCreatureId);
        player1.field.primaryCreature = placeAsPrimary(p1Primary, player1.id, opponentDefinition);
      }
      source.zone = "MAGIC_SLOT";
      source.controllerPlayerId = player1.id;
      if (subtype === "EQUIP" && player1.field.primaryCreature) {
        source.attachedToInstanceId = player1.field.primaryCreature.instanceId;
      }
      player1.field.magicSlots.push(source);
    } else {
      source.zone = "HAND";
      source.controllerPlayerId = player1.id;
      player1.hand.push(source);
    }
  }

  while (player1.hand.length < 5 && player1.deck.length > 0) {
    const card = player1.deck.shift()!;
    card.zone = "HAND";
    player1.hand.push(card);
  }

  while (player2.hand.length < 5 && player2.deck.length > 0) {
    const card = player2.deck.shift()!;
    card.zone = "HAND";
    player2.hand.push(card);
  }

  match.eventLog.push({
    id: uuidv4(),
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "EFFECT_TEST_SCENARIO_CREATED",
    payload: {
      cardId: options.cardId,
      cardName: sourceDefinition.name,
      effectId: effect?.id,
      trigger: effect?.trigger,
      actionType: effect?.actionType,
      phase
    }
  });

  return match;
}
