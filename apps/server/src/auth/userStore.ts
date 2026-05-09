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
};

export type UserProfile = AuthUser & {
  email: string;
  ownedUniqueCards: number;
  ownedTotalCopies: number;
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
        returning id, username, email, display_name, password_hash, role, dev_tools_enabled
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
      select id, username, email, display_name, password_hash, role, dev_tools_enabled
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
        count(distinct o.card_id) filter (where o.owned_count > 0) as owned_unique_cards,
        coalesce(sum(o.owned_count) filter (where o.owned_count > 0), 0) as owned_total_copies
      from users u
      left join user_card_ownership o on o.user_id = u.id
      where u.id = $1
      group by u.id
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
        set email = $2, display_name = $3, dev_tools_enabled = $4, updated_at = now()
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

function toAuthUser(row: UserRow): AuthUser {
  const canAccessDevTools = row.role === "DEVELOPER" || row.role === "ADMIN";

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    canAccessDevTools,
    devToolsEnabled: canAccessDevTools && row.dev_tools_enabled
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505";
}
