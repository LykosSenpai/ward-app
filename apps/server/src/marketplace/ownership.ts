export type MarketplaceOwner = {
  /**
   * Public display identity currently used by local-only marketplace ownership.
   * Migration path: replace this with account/user id after hosted auth rollout.
   */
  displayName: string;
  /**
   * Internal owner key for moderation and account migration hooks.
   * Today this is local and deterministic, later this becomes authenticated user id.
   */
  internalUserKey: string;
};

export type MarketplaceActorContext = {
  displayName: string;
  userId?: string;
};

export function resolveMarketplaceOwner(actor: MarketplaceActorContext): MarketplaceOwner {
  const normalizedDisplayName = actor.displayName.trim().slice(0, 60);
  if (!normalizedDisplayName) {
    throw new Error("Display name is required.");
  }

  return {
    displayName: normalizedDisplayName,
    // Migration note: this prefers authenticated user id when available.
    // Local mode fallback keeps ownership deterministic for current deployments.
    internalUserKey: actor.userId?.trim() || `local:${normalizedDisplayName.toLowerCase()}`
  };
}

export function isOwnedBy(owner: MarketplaceOwner, actor: MarketplaceActorContext): boolean {
  return owner.internalUserKey === resolveMarketplaceOwner(actor).internalUserKey;
}
