import type { AppMatchState } from "../clientTypes";
import type { BoardZoneRef } from "@ward/shared";
import type { BoardObject } from "./boardPreview3dAdapter";
import type { BoardPlayerId } from "./boardPreview3dTypes";

export type BoardRenderAnchor = {
  zone: "PRIMARY" | "LIMITED" | "MAGIC" | "HAND" | "DECK" | "CEMETERY";
  slotId: string;
  owner: BoardPlayerId;
};

export type BoardRenderCard = {
  cardInstanceId: string;
  cardId: string;
  owner: BoardPlayerId;
  controller: BoardPlayerId;
  anchor: BoardRenderAnchor;
};

export type BoardRenderModel = {
  matchId: string;
  sequenceNumber: number;
  activePlayerId: string;
  phase: AppMatchState["turn"]["phase"];
  cards: BoardRenderCard[];
  boardObjects: BoardObject[];
  pending: {
    battle: boolean;
    chain: boolean;
    prompt: boolean;
    manualEffects: number;
  };
};

export type BoardRenderEventType =
  | "CARD_MOVED"
  | "CARD_DRAWN"
  | "CARD_DISCARDED"
  | "CARD_DESTROYED"
  | "CARD_RETURNED_TO_HAND"
  | "CARD_RETURNED_TO_DECK"
  | "CARD_SENT_TO_CEMETERY"
  | "CREATURE_SUMMONED_PRIMARY"
  | "CREATURE_SUMMONED_LIMITED"
  | "MAGIC_PLAYED_TO_CHAIN"
  | "MAGIC_RESOLVED"
  | "MAGIC_NEGATED"
  | "MAGIC_ATTACHED"
  | "ANCHOR_LINK_CREATED"
  | "SOURCE_LINK_CLEANUP_TRIGGERED"
  | "CARD_DAMAGED"
  | "CARD_HEALED"
  | "CARD_REVEALED"
  | "HAND_REVEALED"
  | "STATUS_APPLIED"
  | "STATUS_REMOVED"
  | "RECURRING_EFFECT_TICKED"
  | "SCHEDULED_EFFECT_RESOLVED"
  | "STAT_MODIFIER_APPLIED"
  | "STAT_MODIFIER_REMOVED"
  | "PROMPT_OPENED"
  | "PROMPT_RESOLVED"
  | "CHAIN_LINK_ADDED"
  | "CHAIN_PRIORITY_PASSED"
  | "CHAIN_LINK_NEGATED"
  | "CHAIN_LINK_RESOLVED"
  | "MAGIC_STOLEN"
  | "STOLEN_MAGIC_PLAYED"
  | "STOLEN_MAGIC_SENT_TO_CEMETERY"
  | "TURN_STARTED"
  | "TURN_PHASE_CHANGED"
  | "CARD_MOVED_ZONE"
  | "BATTLE_STARTED"
  | "BATTLE_STRIKE_STARTED"
  | "BATTLE_HIT_ROLLED"
  | "BATTLE_DAMAGE_ROLLED"
  | "BATTLE_DAMAGE_PREVENTED"
  | "BATTLE_DAMAGE_APPLIED"
  | "BATTLE_RESOLVED"
  | "EFFECT_PROMPT_OPENED"
  | "CHAIN_RESOLVED"
  | "STATE_SYNCED";

export type BoardRenderEvent = {
  eventId: string;
  sequenceNumber: number;
  matchId: string;
  type: BoardRenderEventType;
  rawType: string;
  playerId?: string;
  cardInstanceId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
  fromZoneRef?: BoardZoneRef;
  toZoneRef?: BoardZoneRef;
  promptId?: string;
  targetCardInstanceId?: string;
  phase?: AppMatchState["turn"]["phase"];
  turnNumber?: number;
  turnCycleNumber?: number;
  payload: AppMatchState["eventLog"][number]["payload"];
  visualTargets: {
    slotIds: string[];
    cardInstanceIds: string[];
  };
};

export type BoardActionKind =
  | "DRAW"
  | "ADVANCE_PHASE"
  | "DECLARE_BATTLE"
  | "PLAY_FROM_HAND"
  | "OPEN_MANUAL_EFFECTS";

export type BoardActionDescriptor = {
  actionId: string;
  kind: BoardActionKind;
  playerId: string;
  enabled: boolean;
  reason?: string;
};

export type BoardInteractionContext = {
  activePlayerId: string;
  phase: AppMatchState["turn"]["phase"];
  blocked: boolean;
  actions: BoardActionDescriptor[];
};
