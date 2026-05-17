import type { AuthUser } from "./clientTypes";

const SKIP_LOCAL_EMAIL_VERIFICATION = import.meta.env.DEV &&
  !isDisabledEnvFlag(import.meta.env.VITE_SKIP_LOCAL_EMAIL_VERIFICATION);

export function hasCompletedEmailVerification(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return SKIP_LOCAL_EMAIL_VERIFICATION || Boolean(user.emailVerifiedAt) || isSyntheticDiscordEmail(user.email);
}

export function needsEmailVerification(user: AuthUser | null | undefined): boolean {
  return Boolean(user) && !hasCompletedEmailVerification(user);
}

function isDisabledEnvFlag(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "false" || normalized === "0";
}

function isSyntheticDiscordEmail(email: string | undefined): boolean {
  return Boolean(email?.trim().toLowerCase().endsWith("@discord.local"));
}
