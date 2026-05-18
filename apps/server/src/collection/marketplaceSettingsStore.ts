import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDbPool } from "../db/pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../..");
const USER_DATA_DIR = path.join(ROOT_DIR, "data", "users");

export type MarketplaceRetainOverride = {
  neverAutoList?: boolean;
  forceListQuantity?: number;
  trade?: boolean;
  sale?: boolean;
  price?: number;
  note?: string;
};

export type MarketplaceAutoListingSettings = {
  enabled: boolean;
  generationFilters?: string[];
  rarityFilters?: string[];
  retainByCardId?: Record<string, number>;
  manualReservedByCardId?: Record<string, number>;
  pendingByCardId?: Record<string, number>;
  overridesByCardId?: Record<string, MarketplaceRetainOverride>;
};

const DEFAULT_SETTINGS: MarketplaceAutoListingSettings = { enabled: false };

function userSettingsPath(userId: string): string {
  return path.join(USER_DATA_DIR, userId, "marketplace-settings.json");
}

function normalizeSettings(settings: MarketplaceAutoListingSettings | undefined): MarketplaceAutoListingSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
    overridesByCardId: settings?.overridesByCardId ?? {},
    retainByCardId: settings?.retainByCardId ?? {},
    manualReservedByCardId: settings?.manualReservedByCardId ?? {},
    pendingByCardId: settings?.pendingByCardId ?? {}
  };
}

function parseSettingsJson(value: MarketplaceAutoListingSettings | string): MarketplaceAutoListingSettings {
  return normalizeSettings(typeof value === "string" ? JSON.parse(value) as MarketplaceAutoListingSettings : value);
}

async function readLegacySettingsFile(userId: string): Promise<MarketplaceAutoListingSettings | undefined> {
  try {
    const raw = await fs.readFile(userSettingsPath(userId), "utf-8");
    return parseSettingsJson(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadMarketplaceAutoListingSettings(userId: string): Promise<MarketplaceAutoListingSettings> {
  const result = await getDbPool().query<{ settings: MarketplaceAutoListingSettings | string }>(
    `select settings
       from user_marketplace_auto_listing_settings
      where user_id = $1`,
    [userId]
  );

  if (result.rows[0]) {
    return parseSettingsJson(result.rows[0].settings);
  }

  const legacySettings = await readLegacySettingsFile(userId);
  if (legacySettings) {
    return saveMarketplaceAutoListingSettings(userId, legacySettings);
  }

  return normalizeSettings(DEFAULT_SETTINGS);
}

export async function saveMarketplaceAutoListingSettings(userId: string, settings: MarketplaceAutoListingSettings): Promise<MarketplaceAutoListingSettings> {
  const normalized = normalizeSettings(settings);
  await getDbPool().query(
    `insert into user_marketplace_auto_listing_settings (user_id, settings, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id)
     do update set
       settings = excluded.settings,
       updated_at = now()`,
    [userId, JSON.stringify(normalized)]
  );
  return normalized;
}

export type MarketplaceSettingsFileImportRow = {
  userId: string;
  sourcePath: string;
  settings: MarketplaceAutoListingSettings;
};

export type MarketplaceSettingsFileImportResult = {
  applied: boolean;
  sourceDir: string;
  importedCount: number;
  failedCount: number;
  rows: MarketplaceSettingsFileImportRow[];
  failures: Array<{ userId: string; sourcePath: string; message: string }>;
};

async function listLegacySettingsFiles(): Promise<MarketplaceSettingsFileImportRow[]> {
  try {
    const entries = await fs.readdir(USER_DATA_DIR, { withFileTypes: true });
    const rows: MarketplaceSettingsFileImportRow[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userId = entry.name;
      const sourcePath = userSettingsPath(userId);
      const settings = await readLegacySettingsFile(userId);
      if (!settings) continue;
      rows.push({ userId, sourcePath, settings });
    }

    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function importMarketplaceAutoListingSettingsFiles(args?: { apply?: boolean }): Promise<MarketplaceSettingsFileImportResult> {
  const apply = args?.apply ?? false;
  const rows = await listLegacySettingsFiles();
  const failures: MarketplaceSettingsFileImportResult["failures"] = [];

  if (apply) {
    for (const row of rows) {
      try {
        await saveMarketplaceAutoListingSettings(row.userId, row.settings);
      } catch (error) {
        failures.push({
          userId: row.userId,
          sourcePath: row.sourcePath,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return {
    applied: apply,
    sourceDir: USER_DATA_DIR,
    importedCount: apply ? rows.length - failures.length : rows.length,
    failedCount: failures.length,
    rows,
    failures
  };
}
