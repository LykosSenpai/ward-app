const fs = require("fs");
const path = require("path");

const root = process.argv[2];

function relPath(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(relPath(rel), "utf8");
}

function write(rel, text) {
  fs.writeFileSync(relPath(rel), text);
}

function backup(rel) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(root, "_patch_backups", "silence-resolve-fix-" + stamp);
  const dst = path.join(backupRoot, rel);

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(relPath(rel), dst);

  console.log("Backed up: " + rel);
}

function replaceOnce(text, find, replacement, label) {
  if (!text.includes(find)) {
    throw new Error("Could not find patch location: " + label);
  }

  return text.replace(find, replacement);
}

const target = "packages/engine/src/magicChainActions.ts";

backup(target);

let s = read(target);

if (!s.includes("function isSilenceFromTheGraveLink(")) {
  s = replaceOnce(
    s,
`function linkHasNegateEffect(state: MatchState, link: { cardId: string; text?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const effects = getCardEngineEffects(definition);

  if (effects.some(effectNegatesMagicChainLink)) {
    return true;
  }

  const rawText = String(link.text ?? "").toLowerCase();
  if (rawText.includes("attack") && !rawText.includes("magic")) {
    return false;
  }

  return rawText.includes("negate") && (rawText.includes("magic") || rawText.includes("lightning") || rawText.includes("effect") || rawText.includes("card"));
}


`,
`function linkHasNegateEffect(state: MatchState, link: { cardId: string; text?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const effects = getCardEngineEffects(definition);

  if (effects.some(effectNegatesMagicChainLink)) {
    return true;
  }

  const rawText = String(link.text ?? "").toLowerCase();
  if (rawText.includes("attack") && !rawText.includes("magic")) {
    return false;
  }

  return rawText.includes("negate") && (rawText.includes("magic") || rawText.includes("lightning") || rawText.includes("effect") || rawText.includes("card"));
}

function isSilenceFromTheGraveLink(state: MatchState, link: { cardId: string; cardName?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const id = String(definition?.id ?? "").trim().toLowerCase();
  const name = String(definition?.name ?? link.cardName ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return id.includes("silence-from-the-grave") ||
    id.includes("silence_from_the_grave") ||
    name === "silence from the grave" ||
    (cardNumber === "151" && name.includes("silence"));
}

function getNormalizedActionType(effect: WardEngineEffect): string {
  return String(effect.actionType ?? "").trim().toUpperCase();
}

function isSilenceFromTheGravePreChainCostEffect(effect: WardEngineEffect): boolean {
  return getNormalizedActionType(effect) === "PAY_DISCARD_MAGIC_COST";
}

function isSilenceFromTheGraveSplitRuntimeEffect(effect: WardEngineEffect): boolean {
  const actionType = getNormalizedActionType(effect);

  return actionType === "APPLY_OPPONENT_MAGIC_PLAY_LOCK" ||
    actionType === "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION";
}

function silenceEffectIsAutomatic(effect: WardEngineEffect): boolean {
  return isSilenceFromTheGraveSplitRuntimeEffect(effect) || isAutomaticMagicEffectSupported(effect);
}


`,
    "insert Silence resolve helpers"
  );
}

if (!s.includes("const effectsThatResolveNowWithoutPreChainCosts")) {
  s = replaceOnce(
    s,
`  const effectsThatResolveNow = effects.filter(effectShouldResolveWhenCardIsPlayed);

  if (effectsThatResolveNow.length === 0) {
    addEvent(state, "NO_ON_PLAY_MAGIC_EFFECTS_TO_RESOLVE", link.playerId, {
      sourceCardName: link.cardName,
      effectCount: effects.length,
      reason:
        "This card has parsed effects, but none of them resolve when the card is played."
    });

    return;
  }

  const immediateEffects = orderImmediateEffectsForResolution(
    effectsThatResolveNow.filter(effect => !isDeferredToAttachmentEffect(effect))
  );
`,
`  const effectsThatResolveNow = effects.filter(effectShouldResolveWhenCardIsPlayed);

  const effectsThatResolveNowWithoutPreChainCosts = isSilenceFromTheGraveLink(state, link)
    ? effectsThatResolveNow.filter(effect => !isSilenceFromTheGravePreChainCostEffect(effect))
    : effectsThatResolveNow;

  if (effectsThatResolveNowWithoutPreChainCosts.length !== effectsThatResolveNow.length) {
    addEvent(state, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_SKIPPED_AFTER_RESOLUTION", link.playerId, {
      sourceCardName: link.cardName,
      skippedCostEffectCount: effectsThatResolveNow.length - effectsThatResolveNowWithoutPreChainCosts.length,
      note: "Silence From The Grave's discard-Magic cost was already paid before the card entered the Magic Chain."
    });
  }

  if (effectsThatResolveNowWithoutPreChainCosts.length === 0) {
    addEvent(state, "NO_ON_PLAY_MAGIC_EFFECTS_TO_RESOLVE", link.playerId, {
      sourceCardName: link.cardName,
      effectCount: effects.length,
      reason:
        "This card has parsed effects, but none of them resolve when the card is played after pre-chain costs are removed."
    });

    return;
  }

  const immediateEffects = orderImmediateEffectsForResolution(
    effectsThatResolveNowWithoutPreChainCosts.filter(effect => !isDeferredToAttachmentEffect(effect))
  );
`,
    "filter Silence pre-chain cost out of chain resolution"
  );
}

s = s.replaceAll(
`  const allImmediateEffectsAreAutomatic = immediateEffects.every(
    isAutomaticMagicEffectSupported
  );
`,
`  const allImmediateEffectsAreAutomatic = immediateEffects.every(effect =>
    isSilenceFromTheGraveLink(state, link)
      ? silenceEffectIsAutomatic(effect)
      : isAutomaticMagicEffectSupported(effect)
  );
`
);

s = s.replaceAll(
`    if (isAutomaticMagicEffectSupported(effect)) {
      const resolved = tryResolveAutomaticMagicEffect(state, {
        effect,
        controllerPlayerId: link.playerId,
        sourceCardName: link.cardName,
        sourceCardInstanceId: link.cardInstanceId,
        addEvent
      });

      if (resolved) {
        continue;
      }
    }
`,
`    if (
      isAutomaticMagicEffectSupported(effect) ||
      (isSilenceFromTheGraveLink(state, link) && isSilenceFromTheGraveSplitRuntimeEffect(effect))
    ) {
      const resolved = tryResolveAutomaticMagicEffect(state, {
        effect,
        controllerPlayerId: link.playerId,
        sourceCardName: link.cardName,
        sourceCardInstanceId: link.cardInstanceId,
        addEvent
      });

      if (resolved) {
        continue;
      }
    }
`
);

write(target, s);

console.log("Patched: " + target);
console.log("Silence From The Grave resolve fix complete.");
