import bcrypt from "bcryptjs";

import { getDbPool } from "../db/pool.js";
import type { AuthUser } from "./session.js";

type UserRow = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: "PLAYER" | "HOST" | "DEVELOPER" | "ADMIN";
  dev_tools_enabled: boolean;
  email_verified_at?: string | null;
  totp_enabled_at?: string | null;
  discord_user_id?: string | null;
  discord_username?: string | null;
  discord_global_name?: string | null;
  discord_avatar?: string | null;
  discord_linked_at?: string | null;
};

export type UserProfile = AuthUser & {
  email: string;
  emailVerifiedAt?: string;
  twoFactorEnabled: boolean;
  twoFactorEnabledAt?: string;
  ownedUniqueCards: number;
  ownedTotalCopies: number;
};

export type SecurityUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
};

export async function createUser(args: {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthUser> {
  const username = normalizeUsername(args.username);
  const email = normalizeEmail(args.email);
  const password = String(args.password ?? "");
  const displayName = String(args.displayName ?? args.username ?? "").trim() || username;

  if (username.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await getDbPool().query<UserRow>(
      `
        insert into users (username, email, password_hash, display_name)
        values ($1, $2, $3, $4)
        returning id, username, email, display_name, password_hash, role, dev_tools_enabled, email_verified_at,
          discord_user_id, discord_username, discord_global_name, discord_avatar, discord_linked_at
      `,
      [username, email, passwordHash, displayName]
    );

    return toAuthUser(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("That username or email is already taken.");
    }

    throw error;
  }
}

export async function verifyUserLogin(args: {
  login: string;
  password: string;
}): Promise<AuthUser> {
  const login = String(args.login ?? "").trim().toLowerCase();

  if (!login) {
    throw new Error("Username or email is required.");
  }

  const result = await getDbPool().query<UserRow>(
    `
      select id, username, email, display_name, password_hash, role, dev_tools_enabled, email_verified_at,
        discord_user_id, discord_username, discord_global_name, discord_avatar, discord_linked_at
      from users
      where username = $1 or email = $1
    `,
    [login]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error("Invalid username or password.");
  }

  const validPassword = await bcrypt.compare(String(args.password ?? ""), user.password_hash);

  if (!validPassword) {
    throw new Error("Invalid username or password.");
  }

  return toAuthUser(user);
}

export async function findUserByDiscordId(discordUserId: string): Promise<AuthUser | null> {
  const result = await getDbPool().query<UserRow>(
    `
      select id, username, email, display_name, password_hash, role, dev_tools_enabled, email_verified_at,
        discord_user_id, discord_username, discord_global_name, discord_avatar, discord_linked_at
      from users
      where discord_user_id = $1
    `,
    [discordUserId]
  );

  return result.rows[0] ? toAuthUser(result.rows[0]) : null;
}

export async function createUserFromDiscord(args: {
  discordUserId: string;
  discordUsername: string;
  discordGlobalName?: string | null;
  discordAvatar?: string | null;
  email?: string | null;
}): Promise<AuthUser> {
  const baseUsername = normalizeDiscordUsername(args.discordGlobalName ?? args.discordUsername);
  const username = await getAvailableUsername(baseUsername);
  const email = normalizeOptionalEmail(args.email) ?? `${args.discordUserId}@discord.local`;
  const displayName = String(args.discordGlobalName ?? args.discordUsername ?? username).trim() || username;
  const passwordHash = await bcrypt.hash(randomPasswordSeed(args.discordUserId), 12);

  try {
    const result = await getDbPool().query<UserRow>(
      `
        insert into users (
          username, email, password_hash, display_name,
          discord_user_id, discord_username, discord_global_name, discord_avatar, discord_linked_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, now())
        returning id, username, email, display_name, password_hash, role, dev_tools_enabled, email_verified_at,
          discord_user_id, discord_username, discord_global_name, discord_avatar, discord_linked_at
      `,
      [
        username,
        email,
        passwordHash,
        displayName,
        args.discordUserId,
        args.discordUsername,
        args.discordGlobalName ?? null,
        args.discordAvatar ?? null
      ]
    );

    return toAuthUser(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await findUserByDiscordId(args.discordUserId);
      if (existing) return existing;
      throw new Error("That Discord account or email is already linked to another Ward account.");
    }

    throw error;
  }
}

export async function linkDiscordAccount(userId: string, args: {
  discordUserId: string;
  discordUsername: string;
  discordGlobalName?: string | null;
  discordAvatar?: string | null;
}): Promise<UserProfile> {
  try {
    await getDbPool().query(
      `
        update users
        set discord_user_id = $2,
            discord_username = $3,
            discord_global_name = $4,
            discord_avatar = $5,
            discord_linked_at = now(),
            updated_at = now()
        where id = $1
      `,
      [userId, args.discordUserId, args.discordUsername, args.discordGlobalName ?? null, args.discordAvatar ?? null]
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("That Discord account is already linked to another Ward account.");
    }

    throw error;
  }

  return getUserProfile(userId);
}

export async function unlinkDiscordAccount(userId: string): Promise<UserProfile> {
  await getDbPool().query(
    `
      update users
      set discord_user_id = null,
          discord_username = null,
          discord_global_name = null,
          discord_avatar = null,
          discord_linked_at = null,
          updated_at = now()
      where id = $1
    `,
    [userId]
  );

  return getUserProfile(userId);
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  const result = await getDbPool().query<UserRow & {
    owned_unique_cards: string | number;
    owned_total_copies: string | number;
  }>(
    `
      select
        u.id,
        u.username,
        u.email,
        u.display_name,
        u.password_hash,
        u.role,
        u.dev_tools_enabled,
        u.email_verified_at,
        s.totp_enabled_at,
        u.discord_user_id,
        u.discord_username,
        u.discord_global_name,
        u.discord_avatar,
        u.discord_linked_at,
        count(distinct o.card_id) filter (where o.owned_count > 0) as owned_unique_cards,
        coalesce(sum(o.owned_count) filter (where o.owned_count > 0), 0) as owned_total_copies
      from users u
      left join user_card_ownership o on o.user_id = u.id
      left join user_security_settings s on s.user_id = u.id
      where u.id = $1
      group by u.id, s.totp_enabled_at
    `,
    [userId]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error("User not found.");
  }

  return {
    ...toAuthUser(user),
    email: user.email,
    emailVerifiedAt: user.email_verified_at ?? undefined,
    twoFactorEnabled: Boolean(user.totp_enabled_at),
    twoFactorEnabledAt: user.totp_enabled_at ?? undefined,
    ownedUniqueCards: Number(user.owned_unique_cards ?? 0),
    ownedTotalCopies: Number(user.owned_total_copies ?? 0)
  };
}

export async function updateUserProfile(userId: string, args: {
  email: string;
  displayName: string;
  devToolsEnabled?: boolean;
}): Promise<UserProfile> {
  const email = normalizeEmail(args.email);
  const displayName = String(args.displayName ?? "").trim();

  if (!displayName) {
    throw new Error("Display name is required.");
  }

  try {
    const currentProfile = await getUserProfile(userId);
    const canAccessDevTools = currentProfile.canAccessDevTools;
    const devToolsEnabled = canAccessDevTools
      ? Boolean(args.devToolsEnabled)
      : false;

    await getDbPool().query(
      `
        update users
        set email = $2,
            email_verified_at = case when email = $2 then email_verified_at else null end,
            display_name = $3,
            dev_tools_enabled = $4,
            updated_at = now()
        where id = $1
      `,
      [userId, email, displayName, devToolsEnabled]
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("That email is already taken.");
    }

    throw error;
  }

  return getUserProfile(userId);
}

export async function changeUserPassword(userId: string, args: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const newPassword = String(args.newPassword ?? "");

  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const result = await getDbPool().query<UserRow>(
    `
      select id, username, email, display_name, password_hash, role, dev_tools_enabled
      from users
      where id = $1
    `,
    [userId]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error("User not found.");
  }

  const validPassword = await bcrypt.compare(String(args.currentPassword ?? ""), user.password_hash);

  if (!validPassword) {
    throw new Error("Current password is incorrect.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await getDbPool().query(
    `
      update users
      set password_hash = $2, updated_at = now()
      where id = $1
    `,
    [userId, passwordHash]
  );
}

export async function listUsersForTournamentDeckReview(): Promise<Array<{ id: string; displayName: string }>> {
  const result = await getDbPool().query<{ id: string; display_name: string }>(
    `
      select id, display_name
      from users
      order by display_name asc
    `
  );

  return result.rows.map(row => ({
    id: row.id,
    displayName: row.display_name
  }));
}

function normalizeUsername(value: string): string {
  const username = String(value ?? "").trim().toLowerCase();

  if (!/^[a-z0-9_-]+$/.test(username)) {
    throw new Error("Username can only contain letters, numbers, underscores, and hyphens.");
  }

  return username;
}

function normalizeEmail(value: string): string {
  const email = String(value ?? "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email address is required.");
  }

  return email;
}

export async function findUserByEmailForSecurity(emailValue: string): Promise<SecurityUser | null> {
  const email = normalizeEmail(emailValue);
  const result = await getDbPool().query<UserRow>(
    `
      select id, username, email, display_name, password_hash, role, dev_tools_enabled
      from users
      where email = $1
    `,
    [email]
  );

  const user = result.rows[0];
  return user ? toSecurityUser(user) : null;
}

export async function getUserForSecurity(userId: string): Promise<SecurityUser> {
  const result = await getDbPool().query<UserRow>(
    `
      select id, username, email, display_name, password_hash, role, dev_tools_enabled
      from users
      where id = $1
    `,
    [userId]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error("User not found.");
  }

  return toSecurityUser(user);
}

export async function setUserPassword(userId: string, newPasswordValue: string): Promise<void> {
  const newPassword = String(newPasswordValue ?? "");

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await getDbPool().query(
    `
      update users
      set password_hash = $2, updated_at = now()
      where id = $1
    `,
    [userId, passwordHash]
  );
}

export async function markUserEmailVerified(userId: string, targetEmail: string): Promise<void> {
  const email = normalizeEmail(targetEmail);

  const result = await getDbPool().query<{ id: string }>(
    `
      update users
      set email_verified_at = now(), updated_at = now()
      where id = $1 and email = $2
      returning id
    `,
    [userId, email]
  );

  if (!result.rows[0]) {
    throw new Error("Verification link does not match the current email.");
  }
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await getDbPool().query(
    "delete from user_sessions where sess::jsonb -> 'user' ->> 'id' = $1",
    [userId]
  );
}

function normalizeOptionalEmail(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  return normalizeEmail(raw);
}

function normalizeDiscordUsername(value: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return normalized.length >= 3 ? normalized : "discord-player";
}

async function getAvailableUsername(baseUsername: string): Promise<string> {
  const base = normalizeDiscordUsername(baseUsername);

  for (let index = 0; index < 50; index += 1) {
    const username = index === 0 ? base : `${base}-${index + 1}`;
    const result = await getDbPool().query<{ exists: boolean }>(
      "select exists(select 1 from users where username = $1) as exists",
      [username]
    );

    if (!result.rows[0]?.exists) return username;
  }

  return `${base}-${Date.now().toString(36)}`;
}

function randomPasswordSeed(discordUserId: string): string {
  return `discord-oauth:${discordUserId}:${Date.now()}:${Math.random()}`;
}

function toSecurityUser(row: UserRow): SecurityUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash
  };
}

function toAuthUser(row: UserRow): AuthUser {
  const canAccessDevTools = row.role === "DEVELOPER" || row.role === "ADMIN";
  const discord = row.discord_user_id && row.discord_username
    ? {
        userId: row.discord_user_id,
        username: row.discord_username,
        globalName: row.discord_global_name ?? undefined,
        avatar: row.discord_avatar ?? undefined,
        linkedAt: row.discord_linked_at ?? undefined
      }
    : undefined;

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    canAccessDevTools,
    devToolsEnabled: canAccessDevTools && row.dev_tools_enabled,
    discord
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505";
}
