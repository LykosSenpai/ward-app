export type WatchPolicy = "PUBLIC" | "LOBBY_MEMBERS" | "PARTICIPANTS_ONLY";

export type WatchLobbyPlayer = {
  userId: string;
  ownerUserId?: string;
};

export type WatchLobby = {
  matchId?: string;
  status?: "OPEN" | "IN_MATCH" | "CLOSED";
  players: WatchLobbyPlayer[];
};

export type WatchUser = {
  id: string;
  role: "PLAYER" | "HOST" | "DEVELOPER" | "ADMIN";
};

export function canUserViewLiveMatch(params: {
  user?: WatchUser | null;
  matchId: string;
  owners?: Set<string>;
  policy: WatchPolicy;
  findLobbyByMatchId?: (matchId: string) => WatchLobby | undefined;
}): boolean {
  const { user, matchId, owners, policy, findLobbyByMatchId } = params;

  if (user && (user.role === "ADMIN" || user.role === "HOST" || user.role === "DEVELOPER")) {
    return true;
  }

  if (user && owners?.has(user.id)) {
    return true;
  }

  if (policy === "PUBLIC") {
    return true;
  }

  if (!user) {
    return false;
  }

  if (policy === "LOBBY_MEMBERS") {
    const lobby = findLobbyByMatchId?.(matchId);
    if (!lobby || lobby.status === "CLOSED") {
      return false;
    }

    return lobby.players.some(player => player.userId === user.id || player.ownerUserId === user.id);
  }

  return false;
}
