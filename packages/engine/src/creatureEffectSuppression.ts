import type { CardInstance, MatchState } from "@ward/shared";
import { hasActiveSilenceReplacementSuppression, isCreatureSuppressedBySilenceFromTheGrave } from "./silenceFromTheGrave.js";

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isGlobalCreatureEffectNegationActive(state: MatchState): boolean {
  for (const player of state.players) {
    for (const magic of player.field.magicSlots) {
      for (const instance of magic.activeEffectInstances ?? []) {
        if (
          normalize(instance.actionType) === "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION" ||
          normalize(instance.label).includes("CREATURE EFFECT") && normalize(instance.label).includes("NEGAT")
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function areCreatureEffectsSuppressed(state: MatchState, card: CardInstance): boolean {
  const hasAttachedStaticSuppression = state.players.some(player =>
    player.field.magicSlots.some(magic =>
      magic.attachedToInstanceId === card.instanceId &&
      (state.cardCatalog[magic.cardId]?.effects ?? []).some(effect =>
        normalize(effect.actionType) === "NEGATE_CREATURE_EFFECTS"
      )
    )
  );

  return Boolean(
    card.isLimitedSummon ||
    card.effectsSuppressed ||
    card.activeEffectInstances?.some(instance =>
      String(instance.actionType ?? "").trim().toUpperCase() === "APPLY_CREATURE_EFFECT_NEGATION"
    ) ||
    hasAttachedStaticSuppression ||
    hasActiveSilenceReplacementSuppression(state, card) ||
    isGlobalCreatureEffectNegationActive(state) ||
    isCreatureSuppressedBySilenceFromTheGrave(state, card)
  );
}
