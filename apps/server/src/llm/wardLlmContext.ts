import type { CardDefinition, MatchState, WardEngineEffect } from "@ward/shared";

export const WARD_RULES_SUMMARY = `
WARD effect QA rules summary:
- Each player normally uses a 30-card deck and starts with 5 cards.
- A player must always have one primary creature if possible.
- If a primary creature is killed or removed, replacement happens immediately.
- Summoning sacrifice requirements are based on printed/base AL: AL 1-6 no sacrifice, AL 7-11 one sacrifice, AL 12 two sacrifices.
- AL cannot exceed 12 after buffs.
- Turn phases are DRAW, SUMMON_MAGIC, COMBAT, SECOND_MAGIC, END.
- First turn cycle prevents battle and damage during both players' first turns.
- Battle uses SPD to determine first strike. Hit roll is 2D6 + Modifier against defender AL. Attack damage is attack dice + Modifier + effects.
- Critical hit is all 6s on hit dice and doubles final attack damage. Critical miss is all 1s and self-inflicts one die of flat damage.
- DOT/HOT normally tick once per turn cycle. Common DOT timing is end of Combat Phase and DOTs do not stack unless card says otherwise.
- Infinite magic stays in one of five magic slots. Standard magic resolves and goes to cemetery. Lightning magic can respond when its condition is met.
- Magic chains resolve in reverse order. A player cannot respond to their own latest chain link.
- Limited Summons can only happen through card effects, max four per side. They cannot receive HP damage, lose creature effects while limited, and cannot be sacrificed.
- Anchoring effects take priority: when an anchoring source leaves or is negated, the anchored creature leaves according to that source effect.
`;

export function getCardEffect(card: CardDefinition, effectId?: string): WardEngineEffect | undefined {
  const effects = Array.isArray(card.effects) ? card.effects : [];
  return effectId ? effects.find(effect => effect.id === effectId) : effects[0];
}

export function summarizeCard(card: CardDefinition, packId: string): Record<string, unknown> {
  const metadata = card as CardDefinition & {
    generation?: string | number;
    edition?: string;
    rarity?: string;
    cardNumber?: string | number;
  };

  const base = {
    packId,
    id: card.id,
    name: card.name,
    cardType: card.cardType,
    generation: metadata.generation,
    edition: metadata.edition,
    rarity: metadata.rarity,
    cardNumber: metadata.cardNumber,
    text: card.text ?? "",
    effects: card.effects ?? []
  };

  if (card.cardType === "CREATURE") {
    return {
      ...base,
      creatureType: card.creatureType,
      armorLevel: card.armorLevel,
      speed: card.speed,
      hp: card.hp,
      attackDice: card.attackDice,
      modifier: card.modifier
    };
  }

  return {
    ...base,
    magicType: card.magicType,
    magicSubType: card.magicSubType
  };
}

function summarizeCreatureForReview(match: MatchState, playerId: string, card: MatchState["players"][number]["field"]["primaryCreature"]): Record<string, unknown> | undefined {
  if (!card) return undefined;
  const definition = match.cardCatalog[card.cardId];
  return {
    playerId,
    instanceId: card.instanceId,
    cardId: card.cardId,
    name: definition?.name ?? card.cardId,
    zone: card.zone,
    currentHp: card.currentHp,
    baseHp: card.baseHp,
    activeStatuses: card.activeStatuses ?? [],
    activeRecurringEffects: card.activeRecurringEffects ?? [],
    activeEffectInstances: card.activeEffectInstances ?? [],
    attachedCards: Object.values(match.cardCatalog).length
  };
}

export function summarizeMatchForReview(match: MatchState): Record<string, unknown> {
  return {
    matchId: match.matchId,
    status: match.status,
    turn: match.turn,
    setup: match.setup,
    players: match.players.map(player => ({
      id: player.id,
      displayName: player.displayName,
      cemeteryCreatureHpTotal: player.cemeteryCreatureHpTotal,
      hasLost: player.hasLost,
      lossReason: player.lossReason,
      handCount: player.hand.length,
      deckCount: player.deck.length,
      cemeteryCount: player.cemetery.length,
      primaryCreature: summarizeCreatureForReview(match, player.id, player.field.primaryCreature),
      limitedSummons: player.field.limitedSummons.map(card => summarizeCreatureForReview(match, player.id, card)),
      magicSlots: player.field.magicSlots.map(card => ({
        instanceId: card.instanceId,
        cardId: card.cardId,
        name: match.cardCatalog[card.cardId]?.name ?? card.cardId,
        attachedToInstanceId: card.attachedToInstanceId,
        anchorSourceInstanceId: card.anchorSourceInstanceId
      }))
    })),
    pendingPromptType: match.pendingPrompt?.type,
    pendingEffectTargetPrompt: match.pendingEffectTargetPrompt,
    pendingEffectRoll: match.pendingEffectRoll,
    pendingBattle: match.pendingBattle
      ? {
          id: match.pendingBattle.id,
          status: match.pendingBattle.status,
          message: match.pendingBattle.message,
          strikes: match.pendingBattle.strikes
        }
      : undefined,
    lastBattle: match.lastBattle,
    forcedRollQueue: match.devTools?.rolls?.forcedRollQueue ?? [],
    eventLogTail: match.eventLog.slice(-80)
  };
}
