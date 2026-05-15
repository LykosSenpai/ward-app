export const MARKETPLACE_GAME = {
  id: "ward",
  name: "WARD"
} as const;

export function assertSingleGameId(gameId: unknown): void {
  if (gameId === undefined || gameId === null || String(gameId).trim() === "") return;
  if (String(gameId).trim() !== MARKETPLACE_GAME.id) {
    throw new Error(`Only ${MARKETPLACE_GAME.name} is supported in this release.`);
  }
}
