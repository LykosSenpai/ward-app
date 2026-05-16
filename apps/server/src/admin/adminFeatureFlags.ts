import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthUser } from "../auth/session.js";

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

export function isAdminUser(user?: Pick<AuthUser, "role"> | null): boolean {
  return user?.role === "ADMIN";
}

function mergeWithDefaults(features: ServerFeatureFlag[]): ServerFeatureFlag[] {
  const byKey = new Map(features.map(flag => [flag.key, flag]));
  return DEFAULT_FLAGS.map(defaultFlag => byKey.get(defaultFlag.key) ?? defaultFlag);
}

export async function loadFeatureFlags(): Promise<ServerFeatureFlag[]> {
  try {
    const raw = await fs.promises.readFile(FEATURE_FLAGS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { features?: ServerFeatureFlag[] };
    const features = Array.isArray(parsed.features) ? parsed.features : [];
    return mergeWithDefaults(features).sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    await saveFeatureFlags(DEFAULT_FLAGS);
    return DEFAULT_FLAGS;
  }
}

export async function saveFeatureFlags(features: ServerFeatureFlag[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(FEATURE_FLAGS_FILE_PATH), { recursive: true });
  await fs.promises.writeFile(FEATURE_FLAGS_FILE_PATH, JSON.stringify({ features }, null, 2));
}

export async function listFeatureFlagsForUser(user: Pick<AuthUser, "role"> | null): Promise<ServerFeatureFlag[]> {
  const flags = await loadFeatureFlags();
  if (isAdminUser(user)) return flags;
  return flags.filter(flag => !flag.adminOnly && flag.enabledForPlayers);
}

export async function updateFeatureFlagForPlayers(user: Pick<AuthUser, "role"> | null, key: FeatureKey, enabledForPlayers: boolean): Promise<ServerFeatureFlag[]> {
  if (!isAdminUser(user)) {
    throw new Error("Admin access required.");
  }
  const flags = await loadFeatureFlags();
  const nextFlags = flags.map(flag => {
    if (flag.key !== key) return flag;
    if (flag.adminOnly && enabledForPlayers) {
      throw new Error("Admin-only features cannot be enabled for players.");
    }
    return { ...flag, enabledForPlayers, updatedAt: new Date().toISOString() };
  });
  await saveFeatureFlags(nextFlags);
  return nextFlags;
}

export async function isFeatureEnabledForPlayers(key: FeatureKey): Promise<boolean> {
  const flags = await loadFeatureFlags();
  return flags.some(flag => flag.key === key && flag.enabledForPlayers);
}
