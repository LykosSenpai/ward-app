import bcrypt from "bcryptjs";

import { getDbPool } from "../db/pool.js";
import type { AuthUser } from "./session.js";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
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
        returning id, username, display_name, password_hash
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
      select id, username, display_name, password_hash
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
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505";
}
