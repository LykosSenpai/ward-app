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
  CARD_MOVED: { durationMs: 300, label: "move" },
  CARD_DRAWN: { durationMs: 300, label: "draw" },
  CARD_DISCARDED: { durationMs: 300, label: "discard" },
  CARD_DESTROYED: { durationMs: 320, label: "destroy" },
  CARD_RETURNED_TO_HAND: { durationMs: 300, label: "return-hand" },
  CARD_RETURNED_TO_DECK: { durationMs: 300, label: "return-deck" },
  CREATURE_SUMMONED_PRIMARY: { durationMs: 340, label: "summon-primary" },
  CREATURE_SUMMONED_LIMITED: { durationMs: 340, label: "summon-limited" },
  MAGIC_ATTACHED: { durationMs: 320, label: "attach" },
  ANCHOR_LINK_CREATED: { durationMs: 260, label: "anchor-link" },
  SOURCE_LINK_CLEANUP_TRIGGERED: { durationMs: 280, label: "source-cleanup" },
  PROMPT_OPENED: { durationMs: 200, label: "prompt" },
  PROMPT_RESOLVED: { durationMs: 180, label: "prompt-resolve" },
  CARD_MOVED_ZONE: { durationMs: 300, label: "move" },
  BATTLE_STARTED: { durationMs: 420, label: "battle-start" },
  BATTLE_DAMAGE_APPLIED: { durationMs: 2400, label: "damage" },
  BATTLE_RESOLVED: { durationMs: 460, label: "battle-resolve" },
  EFFECT_PROMPT_OPENED: { durationMs: 200, label: "prompt" },
  CHAIN_RESOLVED: { durationMs: 260, label: "chain" },
  STATE_SYNCED: DEFAULT_PROFILE
};

export function getBoardAnimationProfile(type?: BoardRenderEventType | null): BoardAnimationProfile {
  if (!type) return DEFAULT_PROFILE;
  return PROFILES[type] ?? DEFAULT_PROFILE;
}
