export class SpectatorControlError extends Error {}

export function addSpectatorSocket(map: Map<string, Set<string>>, matchId: string, socketId: string): void {
  const sockets = map.get(matchId) ?? new Set<string>();
  sockets.add(socketId);
  map.set(matchId, sockets);
}

export function removeSpectatorSocket(map: Map<string, Set<string>>, matchId: string, socketId: string): void {
  const sockets = map.get(matchId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) map.delete(matchId);
}

export function assertNotSpectator(map: Map<string, Set<string>>, matchId: string, socketId?: string): void {
  if (socketId && map.get(matchId)?.has(socketId)) {
    throw new SpectatorControlError("Spectators can only view and inspect the match.");
  }
}
