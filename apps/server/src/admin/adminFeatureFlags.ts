import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AuthUser } from "../auth/session.js";
import { getDbPool } from "../db/pool.js";

export type FeatureKey =
  | "card-library"
  | "deck-builder"
  | "marketplace"
  | "saved-matches"
  | "play-table"
  | "match-lobby"
  | "online-gameplay"
  | "discord-auth"
  | "effect-tools"
  | "admin-tools";

export type ServerFeatureFlag = {
  key: FeatureKey;
  label: string;
  description: string;
  enabledForPlayers: boolean;
  adminCanPreview: boolean;
  adminOnly: boolean;
  sortOrder: number;
  updatedAt: string;
};

type FeatureFlagRow = {
  key: string;
  enabled_for_players: boolean;
  updated_at: Date | string;
  updated_by_user_id: string | null;
};

export type FeatureFlagFileImportResult = {
  sourcePath: string;
  applied: boolean;
  importedCount: number;
  features: ServerFeatureFlag[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../..");
const FEATURE_FLAGS_FILE_PATH = path.join(ROOT_DIR, "data", "admin", "feature-flags.json");

const DEFAULT_FLAGS: ServerFeatureFlag[] = [
  { key: "card-library", label: "Card Library", description: "Browse the card library.", enabledForPlayers: true, adminCanPreview: true, adminOnly: false, sortOrder: 10, updatedAt: new Date(0).toISOString() },
  { key: "deck-builder", label: "Deck Builder", description: "Build and manage decks.", enabledForPlayers: true, adminCanPreview: true, adminOnly: false, sortOrder: 20, updatedAt: new Date(0).toISOString() },
  { key: "marketplace", label: "Marketplace", description: "Trade and want-list marketplace.", enabledForPlayers: false, adminCanPreview: true, adminOnly: false, sortOrder: 30, updatedAt: new Date(0).toISOString() },
  { key: "saved-matches", label: "Saved Matches", description: "Access saved matches.", enabledForPlayers: false, adminCanPreview: true, adminOnly: false, sortOrder: 40, updatedAt: new Date(0).toISOString() },
  { key: "play-table", label: "Play Table", description: "Lobby and active play table.", enabledForPlayers: false, adminCanPreview: true, adminOnly: false, sortOrder: 50, updatedAt: new Date(0).toISOString() },
  { key: "match-lobby", label: "Match Lobby", description: "Multiplayer lobby flows.", enabledForPlayers: false, adminCanPreview: true, adminOnly: false, sortOrder: 60, updatedAt: new Date(0).toISOString() },
  { key: "online-gameplay", label: "Online Gameplay", description: "Online gameplay systems.", enabledForPlayers: false, adminCanPreview: true, adminOnly: false, sortOrder: 70, updatedAt: new Date(0).toISOString() },
  { key: "discord-auth", label: "Discord Login & Linking", description: "Allow players to sign in with Discord or connect Discord from profile.", enabledForPlayers: false, adminCanPreview: true, adminOnly: false, sortOrder: 75, updatedAt: new Date(0).toISOString() },
  { key: "effect-tools", label: "Effect Tools", description: "Effect authoring and diagnostics.", enabledForPlayers: false, adminCanPreview: true, adminOnly: true, sortOrder: 80, updatedAt: new Date(0).toISOString() },
  { key: "admin-tools", label: "Admin Controls", description: "Admin controls and rollout toggles.", enabledForPlayers: false, adminCanPreview: true, adminOnly: true, sortOrder: 999, updatedAt: new Date(0).toISOString() }
];

const DEFAULT_FLAGS_BY_KEY = new Map(DEFAULT_FLAGS.map(flag => [flag.key, flag]));

export function isAdminUser(user?: Pick<AuthUser, "role"> | null): boolean {
  return user?.role === "ADMIN";
}

function isFeatureKey(value: string): value is FeatureKey {
  return DEFAULT_FLAGS_BY_KEY.has(value as FeatureKey);
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function sortFlags(features: ServerFeatureFlag[]): ServerFeatureFlag[] {
  return [...features].sort((a, b) => a.sortOrder - b.sortOrder);
}

function mergeWithDefaults(features: ServerFeatureFlag[]): ServerFeatureFlag[] {
  const byKey = new Map(features.filter(flag => isFeatureKey(flag.key)).map(flag => [flag.key, flag]));
  return sortFlags(DEFAULT_FLAGS.map(defaultFlag => byKey.get(defaultFlag.key) ?? defaultFlag));
}

function mergeRowsWithDefaults(rows: FeatureFlagRow[]): ServerFeatureFlag[] {
  const rowsByKey = new Map(rows.filter(row => isFeatureKey(row.key)).map(row => [row.key as FeatureKey, row]));

  return sortFlags(DEFAULT_FLAGS.map(defaultFlag => {
    const row = rowsByKey.get(defaultFlag.key);
    if (!row) return defaultFlag;

    return {
      ...defaultFlag,
      enabledForPlayers: row.enabled_for_players,
      updatedAt: serializeTimestamp(row.updated_at)
    };
  }));
}

async function loadFeatureFlagsFromFile(): Promise<ServerFeatureFlag[] | null> {
  try {
    const raw = await fs.promises.readFile(FEATURE_FLAGS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { features?: ServerFeatureFlag[] };
    const features = Array.isArray(parsed.features) ? parsed.features : [];
    return mergeWithDefaults(features);
  } catch {
    return null;
  }
}

async function listFeatureFlagRows(): Promise<FeatureFlagRow[]> {
  const result = await getDbPool().query<FeatureFlagRow>(
    `select key,
            enabled_for_players,
            updated_at,
            updated_by_user_id
       from admin_feature_flags`
  );

  return result.rows;
}

async function upsertFeatureFlagRows(features: ServerFeatureFlag[], updatedByUserId: string | null): Promise<void> {
  for (const flag of mergeWithDefaults(features)) {
    await getDbPool().query(
      `insert into admin_feature_flags (key, enabled_for_players, updated_at, updated_by_user_id)
       values ($1, $2, $3, $4)
       on conflict (key) do update set
         enabled_for_players = excluded.enabled_for_players,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id`,
      [flag.key, flag.enabledForPlayers, flag.updatedAt, updatedByUserId]
    );
  }
}

async function insertMissingDefaultRows(existingRows: FeatureFlagRow[]): Promise<void> {
  const existingKeys = new Set(existingRows.map(row => row.key));

  for (const flag of DEFAULT_FLAGS) {
    if (existingKeys.has(flag.key)) continue;

    await getDbPool().query(
      `insert into admin_feature_flags (key, enabled_for_players, updated_at, updated_by_user_id)
       values ($1, $2, $3, null)
       on conflict (key) do nothing`,
      [flag.key, flag.enabledForPlayers, flag.updatedAt]
    );
  }
}

async function ensureFeatureFlagRows(): Promise<FeatureFlagRow[]> {
  const rows = await listFeatureFlagRows();

  if (rows.length === 0) {
    const seedFlags = await loadFeatureFlagsFromFile() ?? DEFAULT_FLAGS;
    await upsertFeatureFlagRows(seedFlags, null);
    return listFeatureFlagRows();
  }

  await insertMissingDefaultRows(rows);
  return listFeatureFlagRows();
}

export async function loadFeatureFlags(): Promise<ServerFeatureFlag[]> {
  return mergeRowsWithDefaults(await ensureFeatureFlagRows());
}

export async function importFeatureFlagsFromFile(options: { apply: boolean }): Promise<FeatureFlagFileImportResult> {
  const features = await loadFeatureFlagsFromFile();
  if (!features) {
    throw new Error(`Feature flag file not found or unreadable: ${FEATURE_FLAGS_FILE_PATH}`);
  }

  if (options.apply) {
    await upsertFeatureFlagRows(features, null);
  }

  return {
    sourcePath: FEATURE_FLAGS_FILE_PATH,
    applied: options.apply,
    importedCount: features.length,
    features
  };
}

export async function listFeatureFlagsForUser(user: Pick<AuthUser, "role"> | null): Promise<ServerFeatureFlag[]> {
  const flags = await loadFeatureFlags();
  if (isAdminUser(user)) return flags;
  return flags.filter(flag => !flag.adminOnly && flag.enabledForPlayers);
}

export async function updateFeatureFlagForPlayers(user: Pick<AuthUser, "id" | "role"> | null, key: FeatureKey, enabledForPlayers: boolean): Promise<ServerFeatureFlag[]> {
  if (!isAdminUser(user)) {
    throw new Error("Admin access required.");
  }

  const flag = DEFAULT_FLAGS_BY_KEY.get(key);
  if (!flag) {
    throw new Error(`Unknown feature flag: ${key}`);
  }

  if (flag.adminOnly && enabledForPlayers) {
    throw new Error("Admin-only features cannot be enabled for players.");
  }

  await getDbPool().query(
    `insert into admin_feature_flags (key, enabled_for_players, updated_at, updated_by_user_id)
     values ($1, $2, now(), $3)
     on conflict (key) do update set
       enabled_for_players = excluded.enabled_for_players,
       updated_at = now(),
       updated_by_user_id = excluded.updated_by_user_id`,
    [key, enabledForPlayers, user?.id ?? null]
  );

  return loadFeatureFlags();
}

export async function isFeatureEnabledForPlayers(key: FeatureKey): Promise<boolean> {
  const flags = await loadFeatureFlags();
  return flags.some(flag => flag.key === key && flag.enabledForPlayers);
}
