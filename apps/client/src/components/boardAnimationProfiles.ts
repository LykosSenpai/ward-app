import type { BoardRenderEventType } from "./boardRenderContracts";

export type BoardAnimationProfile = {
  durationMs: number;
  label: string;
};

const DEFAULT_PROFILE: BoardAnimationProfile = {
  durationMs: 220,
  label: "state-sync"
};

const PROFILES: Record<BoardRenderEventType, BoardAnimationProfile> = {
  CARD_MOVED_ZONE: { durationMs: 300, label: "move" },
  BATTLE_STARTED: { durationMs: 420, label: "battle-start" },
  BATTLE_RESOLVED: { durationMs: 460, label: "battle-resolve" },
  EFFECT_PROMPT_OPENED: { durationMs: 200, label: "prompt" },
  CHAIN_RESOLVED: { durationMs: 260, label: "chain" },
  STATE_SYNCED: DEFAULT_PROFILE
};

export function getBoardAnimationProfile(type?: BoardRenderEventType | null): BoardAnimationProfile {
  if (!type) return DEFAULT_PROFILE;
  return PROFILES[type] ?? DEFAULT_PROFILE;
}
