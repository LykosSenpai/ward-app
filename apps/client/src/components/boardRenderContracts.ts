import type { AppMatchState } from "../clientTypes";
import type { BoardObject } from "./boardPreview3dAdapter";

export type BoardRenderAnchor = {
  zone: "PRIMARY" | "LIMITED" | "MAGIC";
  slotId: string;
  owner: "player_1" | "player_2";
};

export type BoardRenderCard = {
  cardInstanceId: string;
  cardId: string;
  owner: "player_1" | "player_2";
  controller: "player_1" | "player_2";
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
  | "CARD_MOVED_ZONE"
  | "BATTLE_STARTED"
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
