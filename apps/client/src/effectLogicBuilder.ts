import type { WardEngineEffect, WardEffectDuration, WardEffectStatChange } from "@ward/shared";
import type { CardLibraryCardSummary } from "./clientTypes";

export type EffectBuildResult = {
  effects: WardEngineEffect[];
  warnings: string[];
};

type EffectDraft = Omit<WardEngineEffect, "id">;

type BuildEffectArgs = {
  card: CardLibraryCardSummary;
  text: string;
};

const STAT_LABELS: Array<{ pattern: RegExp; stat: string; actionType: string }> = [
  { pattern: /\b(?:al|armor level)\s*:\s*([+-]?\d+)/gi, stat: "AL", actionType: "APPLY_STAT_MODIFIER" },
  { pattern: /\b(?:spd|speed)\s*:\s*([+-]?\d+)/gi, stat: "SPD", actionType: "APPLY_STAT_MODIFIER" },
  { pattern: /\b(?:modifier|mod)\s*:\s*([+-]?\d+)/gi, stat: "MODIFIER", actionType: "APPLY_STAT_MODIFIER" },
  { pattern: /\b(?:atk dice rolls?|attack dice rolls?)\s*:\s*([+-]?\d+)/gi, stat: "ATK_DICE_ROLLS", actionType: "APPLY_STAT_MODIFIER" },
  { pattern: /\b(?:hit dice rolls?)\s*:\s*([+-]?\d+)/gi, stat: "HIT_DICE_ROLLS", actionType: "APPLY_DICE_MODIFIER" },
  { pattern: /\b(?:hit)\s*:\s*([+-]?\d+)/gi, stat: "HIT", actionType: "APPLY_DICE_MODIFIER" },
  { pattern: /\b(?:atk|attack damage)\s*:\s*([+-]?\d+)/gi, stat: "ATK_DAMAGE", actionType: "APPLY_DICE_MODIFIER" }
];

function normalizeEffectIdBase(card: CardLibraryCardSummary): string {
  const number = card.cardNumber?.trim();

  if (number) {
    return number.padStart(3, "0");
  }

  return card.id
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sentenceSplit(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?:\n+|(?<=[.!?])\s+)/g)
    .map(part => part.trim())
    .filter(Boolean);
}

function numberFromText(text: string): number | undefined {
  const match = text.match(/\b(\d+)\b/);
  if (!match) return undefined;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function targetFromText(text: string, fallback = "Target creature"): string {
  const normalized = text.toLowerCase();

  if (normalized.includes("equipped creature")) return "Equipped creature";
  if (normalized.includes("opponent") && normalized.includes("primary creature")) return "Opponent primary creature";
  if (normalized.includes("your") && normalized.includes("primary creature")) return "Your primary creature";
  if (normalized.includes("primary creature")) return "Primary creature";
  if (normalized.includes("opponent") && normalized.includes("creature")) return "Opponent creature";
  if (normalized.includes("your") && normalized.includes("creature")) return "Your creature";
  if (normalized.includes("all creatures")) return "All creatures";
  if (normalized.includes("magic card")) return "Magic card on the field";
  if (normalized.includes("opponent")) return "Opponent";
  if (normalized.includes("your")) return "You";

  return fallback;
}

function durationFromText(text: string): WardEffectDuration | undefined {
  const normalized = text.toLowerCase();

  // Explicit finite durations must win over target wording like "equipped creature".
  // Smokescreen-style text says "The equipped creature ... for the next 2 turn cycles";
  // that is a 2-turn-cycle duration, not a while-equipped duration.
  const turnCycleMatch = normalized.match(/(?:for\s+)?(?:the\s+next\s+)?(\d+)\s*turn cycles?/i);
  if (turnCycleMatch) {
    return {
      text: `${turnCycleMatch[1]} turn cycle${turnCycleMatch[1] === "1" ? "" : "s"}`,
      type: "TURN_CYCLES",
      amount: Number(turnCycleMatch[1]),
      unit: "TURN_CYCLE",
      starts: "EFFECT_ACTIVATION",
      expires: "BEGINNING_OF_START_PLAYER_TURN"
    };
  }

  if (normalized.includes("single battle") || normalized.includes("for one battle") || normalized.includes("for 1 battle")) {
    return {
      text: "1 battle",
      type: "BATTLE",
      amount: 1,
      unit: "BATTLE",
      starts: "EFFECT_ACTIVATION",
      expires: "END_OF_BATTLE"
    };
  }

  if (normalized.includes("while equipped")) {
    return {
      text: "While equipped",
      type: "WHILE_EQUIPPED",
      starts: "EQUIP_RESOLUTION",
      expires: "SOURCE_REMOVED_FROM_FIELD"
    };
  }

  if (normalized.includes("while on the field") || normalized.includes("while this card is on the field")) {
    return {
      text: "While on the field",
      type: "WHILE_ON_FIELD",
      starts: "EFFECT_ACTIVATION",
      expires: "SOURCE_REMOVED_FROM_FIELD"
    };
  }

  return undefined;
}

function conditionFromText(text: string): { type: string; text: string } | undefined {
  const normalized = text.toLowerCase();

  if (normalized.includes("when your opponent plays a magic")) {
    return { type: "OPPONENT_PLAYS_MAGIC", text: "Opponent plays a Magic card" };
  }

  if (normalized.includes("when your opponent plays a lightning")) {
    return { type: "OPPONENT_PLAYS_LIGHTNING", text: "Opponent plays a Lightning card" };
  }

  if (normalized.includes("when your opponent lands a hit") || normalized.includes("opponent lands a hit")) {
    return { type: "OPPONENT_LANDS_HIT", text: "Opponent lands a hit" };
  }

  if (normalized.includes("if this creature hits first") || normalized.includes("if this card hits first")) {
    return { type: "HITS_FIRST", text: "This creature hits first during battle" };
  }

  if (normalized.includes("when summoned") || normalized.includes("when this creature is summoned")) {
    return { type: "ON_SUMMON", text: "This creature is summoned" };
  }

  if (normalized.includes("when equipped")) {
    return { type: "ON_EQUIP", text: "This card becomes equipped" };
  }

  if (normalized.includes("if killed") || normalized.includes("when this creature is killed") || normalized.includes("when this card is killed")) {
    return { type: "THIS_CREATURE_KILLED", text: "This creature is killed" };
  }

  return undefined;
}

function triggerFromText(text: string, defaultTrigger = "ON_PLAY"): string {
  const normalized = text.toLowerCase();

  if (normalized.includes("while equipped") || normalized.includes("equipped creature")) return "WHILE_EQUIPPED";
  if (normalized.includes("while on the field") || normalized.includes("while this card is on the field")) return "WHILE_ON_FIELD";
  if (normalized.includes("when your opponent plays a magic")) return "WHEN_OPPONENT_PLAYS_MAGIC";
  if (normalized.includes("when your opponent plays a lightning")) return "WHEN_OPPONENT_PLAYS_LIGHTNING";
  if (normalized.includes("when your opponent lands a hit") || normalized.includes("opponent lands a hit")) return "WHEN_OPPONENT_LANDS_HIT";
  if (normalized.includes("when summoned") || normalized.includes("when this creature is summoned")) return "ON_SUMMON";
  if (normalized.includes("when equipped")) return "ON_EQUIP";
  if (normalized.includes("at the beginning of your turn") || normalized.includes("beginning of your turn")) return "BEGINNING_OF_YOUR_TURN";
  if (normalized.includes("at the end of your turn") || normalized.includes("end of your turn")) return "END_OF_YOUR_TURN";
  if (normalized.includes("hits first")) return "ON_HIT_FIRST";
  if (normalized.includes("if this creature hits") || normalized.includes("if this card hits") || normalized.includes("when this creature hits")) return "ON_HIT";
  if (normalized.includes("if killed") || normalized.includes("when this creature is killed") || normalized.includes("when this card is killed")) return "WHEN_THIS_CREATURE_KILLED";

  return defaultTrigger;
}

function reusableFunctionForAction(actionType: string): string {
  const lookup: Record<string, string> = {
    APPLY_STAT_MODIFIER: "applyStatModifier",
    APPLY_DICE_MODIFIER: "applyDiceModifier",
    APPLY_DICE_LIMIT: "applyDiceLimit",
    APPLY_ATTACK_DAMAGE_MULTIPLIER: "applyAttackDamageMultiplier",
    APPLY_DAMAGE_OVER_TIME: "applyDamageOverTime",
    HEAL_CREATURE: "healCreature",
    DEAL_INSTANT_DAMAGE: "dealInstantDamage",
    DESTROY_MAGIC_CARDS: "destroyMagicCard",
    DESTROY_ALL_MAGIC: "destroyAllMagic",
    DRAW_CARDS: "drawCards",
    SEARCH_DECK_TO_HAND: "searchDeckToHand",
    MOVE_CARD: "moveCard",
    SUMMON_LIMITED_CREATURE: "limitedSummonCreature",
    NEGATE_MAGIC_EFFECT: "negateMagicEffect",
    NEGATE_ATTACK: "negateAttack",
    CANNOT_BE_NEGATED: "preventNegation",
    UNAFFECTED_BY_MAGIC: "applyMagicImmunity",
    UNAFFECTED_BY_CREATURE_EFFECTS: "applyCreatureEffectImmunity",
    PREVENT_DAMAGE: "preventDamage"
  };

  return lookup[actionType] ?? "manualReview";
}

function makeStatChange(stat: string, rawDelta: string): WardEffectStatChange {
  const value = Math.abs(Number(rawDelta));

  return {
    stat,
    operation: rawDelta.trim().startsWith("-") ? "SUBTRACT" : "ADD",
    value
  };
}

function statEffectTarget(card: CardLibraryCardSummary, text: string): string {
  const normalized = text.toLowerCase();

  if (normalized.includes("all creatures")) return "All creatures";
  if (normalized.includes("equipped creature") || card.magicSubType === "EQUIP") return "Equipped creature";
  if (card.magicSubType === "FIELD") return "Affected creatures on the field";
  if (card.cardType === "CREATURE") return "This creature";

  return targetFromText(text, "Target creature");
}

function createStatModifierEffects(card: CardLibraryCardSummary, text: string): EffectDraft[] {
  const effects: EffectDraft[] = [];

  for (const label of STAT_LABELS) {
    label.pattern.lastIndex = 0;
    let match = label.pattern.exec(text);

    while (match) {
      const duration = durationFromText(text) ?? (card.magicSubType === "EQUIP" ? durationFromText("equipped creature") : undefined);
      const statChange = makeStatChange(label.stat, match[1]);
      const actionType = label.actionType;

      effects.push({
        trigger: duration?.type === "WHILE_EQUIPPED" ? "WHILE_EQUIPPED" : triggerFromText(text),
        condition: conditionFromText(text),
        actionType,
        effectGroup: actionType === "APPLY_STAT_MODIFIER" ? "Stat Modifier" : "Dice Modifier",
        actionText: `${statChange.operation === "SUBTRACT" ? "Subtract" : "Add"} ${statChange.value} ${label.stat}`,
        target: statEffectTarget(card, text),
        value: `${match[1]} ${label.stat}`,
        duration,
        reusableFunction: reusableFunctionForAction(actionType),
        params: {
          target: statEffectTarget(card, text),
          valueText: `${match[1]} ${label.stat}`,
          statChanges: [statChange],
          condition: conditionFromText(text),
          duration,
          sourceLinked: duration?.type === "WHILE_EQUIPPED" || duration?.type === "WHILE_ON_FIELD",
          usesAnchoring: false,
          roundingMode: null,
          stackRule: null,
          tickTiming: null
        },
        needsReview: actionType !== "APPLY_STAT_MODIFIER",
        notes: actionType !== "APPLY_STAT_MODIFIER" ? "Dice/flat attack modifiers are parsed for review; automation may need a handler." : ""
      });

      match = label.pattern.exec(text);
    }
  }

  return effects;
}

function createEffect(actionType: string, text: string, overrides: Partial<EffectDraft> = {}): EffectDraft {
  const duration = overrides.duration ?? durationFromText(text);
  const condition = overrides.condition ?? conditionFromText(text);

  return {
    trigger: overrides.trigger ?? triggerFromText(text),
    condition,
    actionType,
    effectGroup: overrides.effectGroup,
    actionText: overrides.actionText ?? text,
    target: overrides.target ?? targetFromText(text),
    value: overrides.value ?? text,
    duration,
    reusableFunction: overrides.reusableFunction ?? reusableFunctionForAction(actionType),
    params: {
      target: overrides.params?.target ?? overrides.target ?? targetFromText(text),
      valueText: overrides.params?.valueText ?? overrides.value ?? text,
      statChanges: overrides.params?.statChanges ?? [],
      condition: overrides.params?.condition ?? condition,
      duration: overrides.params?.duration ?? duration,
      damageType: overrides.params?.damageType,
      sourceLinked: overrides.params?.sourceLinked ?? false,
      usesAnchoring: overrides.params?.usesAnchoring ?? false,
      roundingMode: overrides.params?.roundingMode ?? null,
      stackRule: overrides.params?.stackRule ?? null,
      tickTiming: overrides.params?.tickTiming ?? null,
      ...overrides.params
    },
    notes: overrides.notes ?? "",
    needsReview: overrides.needsReview ?? false
  };
}

function classifySentence(card: CardLibraryCardSummary, sentence: string): EffectDraft[] {
  const text = sentence.trim();
  const normalized = text.toLowerCase();
  const effects: EffectDraft[] = [];

  effects.push(...createStatModifierEffects(card, text));


  const hitDiceLimitMatch = text.match(/can\s+only\s+roll\s+(\d+|one)\s+hit\s+di(?:e|ce)/i);
  if (hitDiceLimitMatch) {
    const limitValue = hitDiceLimitMatch[1].toLowerCase() === "one" ? 1 : Number(hitDiceLimitMatch[1]);
    const limitTarget = normalized.includes("equipped creature") ? "Target creature" : targetFromText(text, "Target creature");

    effects.push(createEffect("APPLY_DICE_LIMIT", text, {
      trigger: card.magicSubType === "EQUIP" ? "ON_PLAY" : triggerFromText(text),
      effectGroup: "Dice Modifier",
      actionText: `${limitTarget} can only roll ${limitValue} Hit Die${limitValue === 1 ? "" : "s"}.`,
      target: limitTarget,
      value: `Hit Roll limited to ${limitValue}D6`,
      duration: durationFromText(text),
      reusableFunction: "applyDiceLimit",
      params: {
        target: limitTarget,
        valueText: `${limitTarget} can only roll ${limitValue} Hit Die${limitValue === 1 ? "" : "s"}.`,
        statChanges: [],
        duration: durationFromText(text),
        rollKind: "HIT_ROLL",
        diceLimitMode: "MAX",
        diceLimitValue: limitValue
      },
      notes: "Dice-limit effects are static battle modifiers, not DOT/HOT tick effects.",
      needsReview: false
    }));
  }

  if (/draw\s+\d+\s+cards?/i.test(text)) {
    effects.push(createEffect("DRAW_CARDS", text, {
      effectGroup: "Draw",
      target: targetFromText(text, "You"),
      value: `Draw ${numberFromText(text) ?? "?"} card(s)`,
      needsReview: numberFromText(text) === undefined
    }));
  }

  if (normalized.includes("destroy all magic")) {
    effects.push(createEffect("DESTROY_ALL_MAGIC", text, {
      effectGroup: "Magic Removal",
      target: normalized.includes("opponent") ? "Opponent magic cards" : "All magic cards on the field",
      needsReview: true,
      notes: "Parsed as all-magic destruction. Add/confirm engine automation before relying on it."
    }));
  } else if (/destroy\s+(?:1|one)\s+magic card|destroy\s+(?:a|target)\s+magic card/i.test(text)) {
    effects.push(createEffect("DESTROY_MAGIC_CARDS", text, {
      effectGroup: "Magic Removal",
      target: targetFromText(text, "1 magic card on the field"),
      value: "Destroy 1 magic card"
    }));
  }

  if (/search .*deck.*hand|deck.*(?:add|move|put|return).*hand/i.test(text)) {
    effects.push(createEffect("SEARCH_DECK_TO_HAND", text, {
      effectGroup: "Search",
      target: "Card in your deck",
      value: text,
      params: {
        target: "Card in your deck",
        valueText: text,
        sourceZone: "DECK",
        destinationZone: "HAND"
      }
    }));
  }

  if (/(?:return|move|add|put).*cemetery.*hand|cemetery.*(?:return|move|add|put).*hand|graveyard.*hand/i.test(text)) {
    effects.push(createEffect("MOVE_CARD", text, {
      effectGroup: "Card Movement",
      target: "Card in your cemetery",
      value: text,
      params: {
        target: "Card in your cemetery",
        valueText: text,
        sourceZone: "CEMETERY",
        destinationZone: "HAND"
      }
    }));
  }

  if (/limited summon|summon .*limited|limited-summon/i.test(text)) {
    const fromZone = normalized.includes("cemetery") || normalized.includes("graveyard")
      ? "CEMETERY"
      : normalized.includes("deck")
        ? "DECK"
        : normalized.includes("removed")
          ? "REMOVED_FROM_GAME"
          : "HAND";

    effects.push(createEffect("SUMMON_LIMITED_CREATURE", text, {
      effectGroup: "Limited Summon",
      target: `Creature in your ${fromZone.toLowerCase().split("_").join(" ")}`,
      value: text,
      params: {
        target: `Creature in your ${fromZone.toLowerCase().split("_").join(" ")}`,
        valueText: text,
        fromZone,
        summonKind: "LIMITED_SUMMON",
        sourceLinked: normalized.includes("if") && (normalized.includes("leaves the field") || normalized.includes("changes control")),
        usesAnchoring: true
      }
    }));
  }

  const dotMatch = text.match(/(?:inflict|deal|receives?|takes?)\s+(\d+)\s*(?:hp\s*)?damage.*?(?:once per turn cycle|per turn cycle).*?(?:for\s+)?(\d+)\s*turn cycles?/i);
  if (dotMatch) {
    const duration: WardEffectDuration = {
      text: `${dotMatch[2]} turn cycle${dotMatch[2] === "1" ? "" : "s"}`,
      type: "TURN_CYCLES",
      amount: Number(dotMatch[2]),
      unit: "TURN_CYCLE",
      starts: "EFFECT_ACTIVATION",
      expires: "BEGINNING_OF_START_PLAYER_TURN",
      tickTiming: "END_OF_COMBAT_PHASE",
      stackRule: "DO_NOT_STACK"
    };

    effects.push(createEffect("APPLY_DAMAGE_OVER_TIME", text, {
      trigger: triggerFromText(text, "ON_HIT"),
      effectGroup: "Damage Over Time",
      target: targetFromText(text),
      value: `${dotMatch[1]} damage per turn cycle`,
      duration,
      params: {
        target: targetFromText(text),
        valueText: `${dotMatch[1]} damage per turn cycle`,
        duration,
        damageType: "DAMAGE_OVER_TIME",
        stackRule: "DO_NOT_STACK",
        tickTiming: "END_OF_COMBAT_PHASE"
      }
    }));
  }

  const damageMatch = text.match(/(?:inflict|deal|take|takes|receives?)\s+(\d+)\s*(?:hp\s*)?damage/i);
  if (damageMatch && !dotMatch) {
    effects.push(createEffect("DEAL_INSTANT_DAMAGE", text, {
      effectGroup: "Damage",
      target: targetFromText(text),
      value: `${damageMatch[1]} damage`,
      params: {
        target: targetFromText(text),
        valueText: `${damageMatch[1]} damage`,
        damageType: "INSTANT_DAMAGE"
      }
    }));
  }

  const healMatch = text.match(/heal\s+(?:a|target|your|the|this)?\s*(?:creature)?\s*(?:for\s*)?(\d+)\s*(?:hp)?|restore .*hp to\s*(\d+)%/i);
  if (healMatch) {
    effects.push(createEffect("HEAL_CREATURE", text, {
      effectGroup: "Healing",
      target: targetFromText(text),
      value: healMatch[1] ? `${healMatch[1]} HP` : `Restore to ${healMatch[2]}% HP`,
      needsReview: !!healMatch[2],
      notes: healMatch[2] ? "Percent healing needs confirmation/handler support." : ""
    }));
  }

  const multiplierMatch = text.match(/(?:inflicts?|deal|deals)\s+(\d+)x\s*(?:atk|attack)\s*damage/i);
  if (multiplierMatch) {
    effects.push(createEffect("APPLY_ATTACK_DAMAGE_MULTIPLIER", text, {
      trigger: normalized.includes("hits first") ? "ON_HIT_FIRST" : "ON_HIT",
      condition: normalized.includes("hits first")
        ? { type: "HITS_FIRST", text: "This creature hits first during battle" }
        : { type: "HIT_LANDS", text: "Hit lands" },
      effectGroup: "Attack Damage Multiplier",
      target: "This creature attack damage",
      value: `${multiplierMatch[1]}x Attack Damage`,
      params: {
        target: "This creature attack damage",
        valueText: `${multiplierMatch[1]}x Attack Damage`,
        multiplier: Number(multiplierMatch[1]),
        damageType: "ATTACK_DAMAGE"
      }
    }));
  }

  if (normalized.includes("negate") && normalized.includes("magic")) {
    effects.push(createEffect("NEGATE_MAGIC_EFFECT", text, {
      trigger: triggerFromText(text, "WHEN_OPPONENT_PLAYS_MAGIC"),
      effectGroup: "Negation",
      target: "Magic card effect",
      value: "Negate Magic effect",
      needsReview: true,
      notes: "Negation is parsed but chain automation may need additional handler work."
    }));
  }

  if (normalized.includes("negate") && (normalized.includes("attack") || normalized.includes("atk damage") || normalized.includes("hit"))) {
    effects.push(createEffect("NEGATE_ATTACK", text, {
      trigger: triggerFromText(text, "WHEN_OPPONENT_LANDS_HIT"),
      effectGroup: "Negation",
      target: "Attack",
      value: "Negate attack",
      needsReview: true,
      notes: "Attack negation is parsed for battle resolver/manual effect support."
    }));
  }

  if (normalized.includes("cannot be negated")) {
    effects.push(createEffect("CANNOT_BE_NEGATED", text, {
      trigger: "STATIC_RULE",
      effectGroup: "Protection",
      target: "This card",
      value: "Cannot be negated",
      params: {
        target: "This card",
        valueText: "Cannot be negated",
        sourceLinked: true
      }
    }));
  }

  if (normalized.includes("unaffected by magic")) {
    effects.push(createEffect("UNAFFECTED_BY_MAGIC", text, {
      trigger: "STATIC_WHILE_ON_FIELD",
      effectGroup: "Protection",
      target: "This creature",
      value: "Unaffected by Magic cards",
      params: {
        target: "This creature",
        valueText: "Unaffected by Magic cards",
        sourceLinked: true
      },
      needsReview: true,
      notes: "Immunity interacts with summon activation windows; verify card timing."
    }));
  }

  if (normalized.includes("unaffected by creature effects")) {
    effects.push(createEffect("UNAFFECTED_BY_CREATURE_EFFECTS", text, {
      trigger: "STATIC_WHILE_ON_FIELD",
      effectGroup: "Protection",
      target: "This creature",
      value: "Unaffected by creature effects",
      params: {
        target: "This creature",
        valueText: "Unaffected by creature effects",
        sourceLinked: true
      },
      needsReview: true,
      notes: "Creature-effect immunity may need specific timing support."
    }));
  }

  if (effects.length === 0) {
    effects.push(createEffect("MANUAL_REVIEW", text, {
      trigger: triggerFromText(text),
      effectGroup: "Manual Review",
      target: targetFromText(text, "Review target"),
      value: text,
      reusableFunction: "manualReview",
      needsReview: true,
      notes: "The builder could not confidently map this sentence to a supported effect template."
    }));
  }

  return dedupeEffects(effects);
}

function dedupeEffects(effects: EffectDraft[]): EffectDraft[] {
  const seen = new Set<string>();
  const result: EffectDraft[] = [];

  for (const effect of effects) {
    const key = JSON.stringify({
      trigger: effect.trigger,
      actionType: effect.actionType,
      target: effect.target,
      value: effect.value,
      params: effect.params
    });

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(effect);
  }

  return result;
}

function finalizeEffects(card: CardLibraryCardSummary, drafts: EffectDraft[]): WardEngineEffect[] {
  const idBase = normalizeEffectIdBase(card);

  return drafts.map((effect, index) => ({
    id: `${idBase}-E${String(index + 1).padStart(2, "0")}`,
    ...effect
  }));
}

export function buildWardEffectsFromText({ card, text }: BuildEffectArgs): EffectBuildResult {
  const normalizedText = text.trim();
  const warnings: string[] = [];

  if (!normalizedText) {
    return {
      effects: [],
      warnings: ["No effect text was entered. Saved card will have an empty effects array."]
    };
  }

  const sentences = sentenceSplit(normalizedText);
  const drafts = sentences.flatMap(sentence => classifySentence(card, sentence));
  const effects = finalizeEffects(card, drafts);

  if (effects.some(effect => effect.needsReview)) {
    warnings.push("Some generated effects are marked needsReview. Keep the JSON but verify the action type/target before treating it as automated.");
  }

  if (effects.some(effect => effect.actionType === "MANUAL_REVIEW")) {
    warnings.push("At least one sentence could not be mapped to a reusable effect template.");
  }

  return {
    effects,
    warnings
  };
}
