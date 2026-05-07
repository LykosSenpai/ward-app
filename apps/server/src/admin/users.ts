import "../env/loadEnvFile.js";

import bcrypt from "bcryptjs";

import { closeDbPool, getDbPool } from "../db/pool.js";

type UserRow = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: "PLAYER" | "DEVELOPER" | "ADMIN";
  dev_tools_enabled: boolean;
  created_at: Date;
  owned_unique_cards: string | number;
  owned_total_copies: string | number;
};

type Command =
  | "list"
  | "set-email"
  | "set-role"
  | "set-dev-tools"
  | "reset-password"
  | "delete";

const [command, ...args] = process.argv.slice(2) as [Command | undefined, ...string[]];

function printUsage(): void {
  console.log(`
WARD local user admin

Commands:
  pnpm user:list
  pnpm user:set-email <username> <email>
  pnpm user:set-role <username> <PLAYER|DEVELOPER|ADMIN>
  pnpm user:set-dev-tools <username> <on|off>
  pnpm user:reset-password <username> <new-password>
  pnpm user:delete <username>

Notes:
  - These commands operate on the local DATABASE_URL.
  - Delete is intended for local test accounts.
  `.trim());
}

function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email address is required.");
  }

  return email;
}

async function listUsers(): Promise<void> {
  const result = await getDbPool().query<UserRow>(`
    select
      u.id,
      u.username,
      u.email,
      u.display_name,
      u.role,
      u.dev_tools_enabled,
      u.created_at,
      count(distinct o.card_id) filter (where o.owned_count > 0) as owned_unique_cards,
      coalesce(sum(o.owned_count) filter (where o.owned_count > 0), 0) as owned_total_copies
    from users u
    left join user_card_ownership o on o.user_id = u.id
    group by u.id
    order by u.created_at desc
  `);

  if (result.rows.length === 0) {
    console.log("No users found.");
    return;
  }

  console.table(result.rows.map(row => ({
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    devTools: row.dev_tools_enabled ? "on" : "off",
    ownedUnique: Number(row.owned_unique_cards ?? 0),
    ownedCopies: Number(row.owned_total_copies ?? 0),
    createdAt: row.created_at.toISOString()
  })));
}

async function setEmail(usernameArg: string | undefined, emailArg: string | undefined): Promise<void> {
  const username = normalizeUsername(requireArg(usernameArg, "username"));
  const email = normalizeEmail(requireArg(emailArg, "email"));

  const result = await getDbPool().query<UserRow>(
    `
      update users
      set email = $2, updated_at = now()
      where username = $1
      returning id, username, email, display_name, role, dev_tools_enabled, created_at, 0 as owned_unique_cards, 0 as owned_total_copies
    `,
    [username, email]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error(`User not found: ${username}`);
  }

  console.log(`Updated ${user.username} email to ${user.email}.`);
}

function normalizeRole(value: string): UserRow["role"] {
  const role = value.trim().toUpperCase();

  if (role !== "PLAYER" && role !== "DEVELOPER" && role !== "ADMIN") {
    throw new Error("Role must be PLAYER, DEVELOPER, or ADMIN.");
  }

  return role;
}

function parseToggle(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;

  throw new Error("Toggle must be on or off.");
}

async function setRole(usernameArg: string | undefined, roleArg: string | undefined): Promise<void> {
  const username = normalizeUsername(requireArg(usernameArg, "username"));
  const role = normalizeRole(requireArg(roleArg, "role"));
  const devToolsEnabled = role === "PLAYER" ? false : undefined;

  const result = await getDbPool().query<UserRow>(
    `
      update users
      set role = $2,
          dev_tools_enabled = coalesce($3, dev_tools_enabled),
          updated_at = now()
      where username = $1
      returning id, username, email, display_name, role, dev_tools_enabled, created_at, 0 as owned_unique_cards, 0 as owned_total_copies
    `,
    [username, role, devToolsEnabled]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error(`User not found: ${username}`);
  }

  console.log(`Updated ${user.username} role to ${user.role}.`);
}

async function setDevTools(usernameArg: string | undefined, enabledArg: string | undefined): Promise<void> {
  const username = normalizeUsername(requireArg(usernameArg, "username"));
  const enabled = parseToggle(requireArg(enabledArg, "on|off"));

  const result = await getDbPool().query<UserRow>(
    `
      update users
      set dev_tools_enabled = case when role in ('DEVELOPER', 'ADMIN') then $2 else false end,
          updated_at = now()
      where username = $1
      returning id, username, email, display_name, role, dev_tools_enabled, created_at, 0 as owned_unique_cards, 0 as owned_total_copies
    `,
    [username, enabled]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error(`User not found: ${username}`);
  }

  if (enabled && user.role === "PLAYER") {
    throw new Error(`${user.username} is a PLAYER. Set role to DEVELOPER or ADMIN before enabling dev tools.`);
  }

  console.log(`Updated ${user.username} developer tools to ${user.dev_tools_enabled ? "on" : "off"}.`);
}

async function resetPassword(usernameArg: string | undefined, passwordArg: string | undefined): Promise<void> {
  const username = normalizeUsername(requireArg(usernameArg, "username"));
  const password = requireArg(passwordArg, "new-password");

  if (password.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await getDbPool().query<UserRow>(
    `
      update users
      set password_hash = $2, updated_at = now()
      where username = $1
      returning id, username, email, display_name, role, dev_tools_enabled, created_at, 0 as owned_unique_cards, 0 as owned_total_copies
    `,
    [username, passwordHash]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error(`User not found: ${username}`);
  }

  console.log(`Reset password for ${user.username}.`);
}

async function deleteUser(usernameArg: string | undefined): Promise<void> {
  const username = normalizeUsername(requireArg(usernameArg, "username"));

  const result = await getDbPool().query<UserRow>(
    `
      delete from users
      where username = $1
      returning id, username, email, display_name, role, dev_tools_enabled, created_at, 0 as owned_unique_cards, 0 as owned_total_copies
    `,
    [username]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error(`User not found: ${username}`);
  }

  console.log(`Deleted user ${user.username} (${user.email}).`);
}

async function run(): Promise<void> {
  if (!command) {
    printUsage();
    return;
  }

  if (command === "list") {
    await listUsers();
    return;
  }

  if (command === "set-email") {
    await setEmail(args[0], args[1]);
    return;
  }

  if (command === "set-role") {
    await setRole(args[0], args[1]);
    return;
  }

  if (command === "set-dev-tools") {
    await setDevTools(args[0], args[1]);
    return;
  }

  if (command === "reset-password") {
    await resetPassword(args[0], args[1]);
    return;
  }

  if (command === "delete") {
    await deleteUser(args[0]);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
