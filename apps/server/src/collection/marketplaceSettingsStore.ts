import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd());
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

function ensureDirForUser(userId: string): void {
  fs.mkdirSync(path.join(USER_DATA_DIR, userId), { recursive: true });
}

export function loadMarketplaceAutoListingSettings(userId: string): MarketplaceAutoListingSettings {
  const settingsPath = userSettingsPath(userId);
  if (!fs.existsSync(settingsPath)) return { ...DEFAULT_SETTINGS };
  const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as MarketplaceAutoListingSettings;
  return { ...DEFAULT_SETTINGS, ...raw };
}

export function saveMarketplaceAutoListingSettings(userId: string, settings: MarketplaceAutoListingSettings): MarketplaceAutoListingSettings {
  ensureDirForUser(userId);
  const normalized: MarketplaceAutoListingSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    overridesByCardId: settings.overridesByCardId ?? {},
    retainByCardId: settings.retainByCardId ?? {},
    manualReservedByCardId: settings.manualReservedByCardId ?? {},
    pendingByCardId: settings.pendingByCardId ?? {}
  };
  fs.writeFileSync(userSettingsPath(userId), JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  return normalized;
}
