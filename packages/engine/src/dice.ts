export type D6RollResult = {
  dice: number[];
  total: number;
};

export function rollD6(count: number): number[] {
  if (!Number.isFinite(count)) {
    throw new Error("Dice count must be a finite number.");
  }

  const normalizedCount = Math.floor(count);

  if (normalizedCount < 1) {
    throw new Error("Roll at least 1 die.");
  }

  if (normalizedCount > 100) {
    throw new Error("Roll no more than 100 dice at once.");
  }

  return Array.from(
    { length: normalizedCount },
    () => Math.floor(Math.random() * 6) + 1
  );
}

export function sumDice(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function rollD6WithTotal(count: number): D6RollResult {
  const dice = rollD6(count);

  return {
    dice,
    total: sumDice(dice)
  };
}
