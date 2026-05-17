import type { AuthUser } from "./clientTypes";

export function hasCompletedEmailVerification(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.emailVerifiedAt) || isSyntheticDiscordEmail(user.email);
}

export function needsEmailVerification(user: AuthUser | null | undefined): boolean {
  return Boolean(user) && !hasCompletedEmailVerification(user);
}

function isSyntheticDiscordEmail(email: string | undefined): boolean {
  return Boolean(email?.trim().toLowerCase().endsWith("@discord.local"));
}
