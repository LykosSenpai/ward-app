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
  CARD_SENT_TO_CEMETERY: { durationMs: 300, label: "to-cemetery" },
  CREATURE_SUMMONED_PRIMARY: { durationMs: 340, label: "summon-primary" },
  CREATURE_SUMMONED_LIMITED: { durationMs: 340, label: "summon-limited" },
  MAGIC_PLAYED_TO_CHAIN: { durationMs: 320, label: "chain-add" },
  MAGIC_RESOLVED: { durationMs: 360, label: "magic-resolve" },
  MAGIC_NEGATED: { durationMs: 360, label: "magic-negate" },
  MAGIC_ATTACHED: { durationMs: 320, label: "attach" },
  ANCHOR_LINK_CREATED: { durationMs: 260, label: "anchor-link" },
  SOURCE_LINK_CLEANUP_TRIGGERED: { durationMs: 280, label: "source-cleanup" },
  CARD_DAMAGED: { durationMs: 520, label: "damage" },
  CARD_HEALED: { durationMs: 520, label: "heal" },
  STATUS_APPLIED: { durationMs: 420, label: "status" },
  STATUS_REMOVED: { durationMs: 320, label: "status-remove" },
  STAT_MODIFIER_APPLIED: { durationMs: 420, label: "stat-modifier" },
  STAT_MODIFIER_REMOVED: { durationMs: 320, label: "stat-modifier-remove" },
  PROMPT_OPENED: { durationMs: 200, label: "prompt" },
  PROMPT_RESOLVED: { durationMs: 180, label: "prompt-resolve" },
  CHAIN_LINK_ADDED: { durationMs: 320, label: "chain-add" },
  CHAIN_PRIORITY_PASSED: { durationMs: 200, label: "chain-pass" },
  CHAIN_LINK_NEGATED: { durationMs: 380, label: "chain-negate" },
  CHAIN_LINK_RESOLVED: { durationMs: 360, label: "chain-resolve" },
  MAGIC_STOLEN: { durationMs: 380, label: "magic-steal" },
  STOLEN_MAGIC_PLAYED: { durationMs: 340, label: "stolen-magic-play" },
  STOLEN_MAGIC_SENT_TO_CEMETERY: { durationMs: 320, label: "stolen-magic-cemetery" },
  CARD_MOVED_ZONE: { durationMs: 300, label: "move" },
  BATTLE_STARTED: { durationMs: 420, label: "battle-start" },
  BATTLE_STRIKE_STARTED: { durationMs: 420, label: "battle-strike" },
  BATTLE_HIT_ROLLED: { durationMs: 800, label: "hit-roll" },
  BATTLE_DAMAGE_ROLLED: { durationMs: 800, label: "damage-roll" },
  BATTLE_DAMAGE_PREVENTED: { durationMs: 520, label: "damage-prevented" },
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
