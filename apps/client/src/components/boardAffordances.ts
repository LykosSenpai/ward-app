import type { BoardAffordance, BoardZoneKind, BoardZoneRef, EffectTargetOption, PendingEffectTargetPrompt } from "@ward/shared";

function toBoardZoneKind(zone: EffectTargetOption["zone"]): BoardZoneKind | null {
  switch (zone) {
    case "HAND":
    case "DECK":
    case "CEMETERY":
    case "REMOVED_FROM_GAME":
    case "PRIMARY_CREATURE":
    case "LIMITED_SUMMON":
      return zone;
    case "MAGIC_SLOT":
      return "MAGIC_SLOT";
    case "PLAYER":
      return null;
  }
}

function toTargetZoneRef(option: EffectTargetOption): BoardZoneRef | undefined {
  const zone = toBoardZoneKind(option.zone);
  if (!zone) return undefined;
  return {
    playerId: option.playerId,
    zone
  };
}

export function buildPendingEffectTargetAffordances(prompt: PendingEffectTargetPrompt | null | undefined): BoardAffordance[] {
  if (!prompt) return [];

  return prompt.options.flatMap(option => {
    const targetZoneRef = toTargetZoneRef(option);
    if (!option.cardInstanceId && !targetZoneRef) return [];

    return [{
      id: `${prompt.id}:${option.id}`,
      kind: option.cardInstanceId ? "VALID_TARGET_CARD" : "VALID_TARGET_ZONE",
      playerId: prompt.controllerPlayerId,
      sourceCardInstanceId: prompt.sourceCardInstanceId || undefined,
      targetCardInstanceId: option.cardInstanceId,
      targetZoneRef,
      promptId: prompt.id,
      actionId: option.id,
      label: option.label,
      highlightStyle: "TARGET"
    } satisfies BoardAffordance];
  });
}
