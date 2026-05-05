import type {
  CardDefinition,
  DeckCardLimitMap,
  DeckValidationResult,
  ValidationIssue
} from "@ward/shared";

export type ValidateDeckOptions = {
  cardIds: string[];
  cardCatalog: Record<string, CardDefinition>;
  exactDeckSize?: number | null;
  defaultCopyLimit?: number;
  cardLimits?: DeckCardLimitMap;
  allowNoCreatures?: boolean;
};

export function validateDeckCardIds(
  options: ValidateDeckOptions
): DeckValidationResult {
  const exactDeckSize = options.exactDeckSize ?? 30;
  const shouldValidateExactDeckSize = options.exactDeckSize !== null;
  const defaultCopyLimit = options.defaultCopyLimit ?? 3;

  const issues: ValidationIssue[] = [];
  const cardCounts: Record<string, number> = {};

  let creatureCount = 0;
  let magicCount = 0;

  for (const cardId of options.cardIds) {
    cardCounts[cardId] = (cardCounts[cardId] ?? 0) + 1;

    const definition = options.cardCatalog[cardId];

    if (!definition) {
      issues.push({
        severity: "ERROR",
        code: "UNKNOWN_CARD_ID",
        message: `Deck contains unknown card ID: ${cardId}`
      });

      continue;
    }

    if (definition.cardType === "CREATURE") {
      creatureCount++;
    }

    if (definition.cardType === "MAGIC") {
      magicCount++;
    }
  }

  if (shouldValidateExactDeckSize && options.cardIds.length !== exactDeckSize) {
    issues.push({
      severity: "ERROR",
      code: "INVALID_DECK_SIZE",
      message: `Deck must contain exactly ${exactDeckSize} cards. Current size: ${options.cardIds.length}.`
    });
  }

  for (const [cardId, count] of Object.entries(cardCounts)) {
    const definition = options.cardCatalog[cardId];
    const name = definition?.name ?? cardId;

    const limitRule = options.cardLimits?.[cardId];

    const allowedCopies = Math.min(
      defaultCopyLimit,
      Math.max(0, limitRule?.limit ?? defaultCopyLimit)
    );

    if (allowedCopies === 0 && count > 0) {
      issues.push({
        severity: "ERROR",
        code: "BANNED_CARD",
        message: `${name} is banned and cannot be included in this deck.${
          limitRule?.reason ? ` Reason: ${limitRule.reason}` : ""
        }`
      });

      continue;
    }

    if (count > allowedCopies) {
      issues.push({
        severity: "ERROR",
        code: "CARD_LIMIT_EXCEEDED",
        message: `${name} has ${count} copies. Maximum allowed is ${allowedCopies}.${
          limitRule?.reason ? ` Reason: ${limitRule.reason}` : ""
        }`
      });
    }
  }

  if (!options.allowNoCreatures && creatureCount === 0) {
    issues.push({
      severity: "ERROR",
      code: "NO_CREATURES",
      message:
        "Deck must contain at least one creature or the player may be unable to maintain a primary creature."
    });
  }

  if (creatureCount < 8 || creatureCount > 12) {
    issues.push({
      severity: "WARNING",
      code: "CREATURE_COUNT_OUTSIDE_RECOMMENDED_RANGE",
      message: `Recommended creature count is 8–12. Current creature count: ${creatureCount}.`
    });
  }

  if (magicCount < 18 || magicCount > 22) {
    issues.push({
      severity: "WARNING",
      code: "MAGIC_COUNT_OUTSIDE_RECOMMENDED_RANGE",
      message: `Recommended magic count is 18–22. Current magic count: ${magicCount}.`
    });
  }

  return {
    isLegal: !issues.some(issue => issue.severity === "ERROR"),
    deckSize: options.cardIds.length,
    creatureCount,
    magicCount,
    cardCounts,
    issues
  };
}