export type BoardZoneKind =
  | "HAND"
  | "DECK"
  | "CEMETERY"
  | "PRIMARY_CREATURE"
  | "LIMITED_SUMMON"
  | "MAGIC_SLOT"
  | "CHAIN"
  | "BATTLE"
  | "PROMPT"
  | "REMOVED_FROM_GAME"
  | "ATTACHED_UNDER";

export type BoardZoneRef = {
  playerId?: string;
  zone: BoardZoneKind;
  slotIndex?: number;
};

export type BoardCardView = {
  instanceId: string;
  cardId: string;
  cardName: string;
  ownerPlayerId: string;
  controllerPlayerId: string;
  zoneRef: BoardZoneRef;
  faceUp: boolean;
  selectable: boolean;
  disabledReason?: string;
  attachedToInstanceId?: string;
  attachedCardInstanceIds?: string[];
  activeStatusLabels?: string[];
};

export type BoardZoneView = {
  id: string;
  zoneRef: BoardZoneRef;
  label: string;
  cardInstanceIds: string[];
  selectable: boolean;
  disabledReason?: string;
};

export type BoardAffordanceKind =
  | "PLAYABLE_CARD"
  | "VALID_TARGET_CARD"
  | "VALID_TARGET_ZONE"
  | "VALID_COST_CARD"
  | "VALID_CHAIN_RESPONSE"
  | "VALID_BATTLE_RESPONSE"
  | "VALID_DROP_ZONE"
  | "DISABLED_ACTION";

export type BoardAffordanceHighlightStyle =
  | "VALID"
  | "TARGET"
  | "COST"
  | "CHAIN"
  | "BATTLE_RESPONSE"
  | "WARNING"
  | "LOCKED";

export type BoardAffordance = {
  id: string;
  kind: BoardAffordanceKind;
  playerId: string;
  sourceCardInstanceId?: string;
  targetCardInstanceId?: string;
  targetZoneRef?: BoardZoneRef;
  promptId?: string;
  actionId?: string;
  label: string;
  highlightStyle: BoardAffordanceHighlightStyle;
  disabledReason?: string;
};

export type BoardEvent = {
  id: string;
  sequenceNumber: number;
  matchId: string;
  type: string;
  playerId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
  payload?: unknown;
};

export type BoardEventBatch = {
  matchId: string;
  sequenceNumber: number;
  events: BoardEvent[];
};

export type BoardAnimationStep =
  | {
      type: "MOVE_CARD";
      cardInstanceId: string;
      toZoneRef: BoardZoneRef;
      durationMs: number;
    }
  | {
      type: "FLIP_CARD";
      cardInstanceId: string;
      faceUp: boolean;
      durationMs: number;
    }
  | {
      type: "GLOW_CARD";
      cardInstanceId: string;
      glowKind: "VALID" | "TARGET" | "COST" | "CHAIN" | "DAMAGE" | "HEAL" | "LOCKED";
      durationMs: number;
    }
  | {
      type: "GLOW_ZONE";
      zoneRef: BoardZoneRef;
      glowKind: "VALID_DROP" | "TARGET" | "COST" | "LOCKED";
      durationMs: number;
    }
  | {
      type: "DAMAGE_NUMBER";
      cardInstanceId: string;
      amount: number;
    }
  | {
      type: "HEAL_NUMBER";
      cardInstanceId: string;
      amount: number;
    }
  | {
      type: "ATTACH_CARD";
      attachmentInstanceId: string;
      targetInstanceId: string;
      durationMs: number;
    }
  | {
      type: "DETACH_CARD";
      attachmentInstanceId: string;
      targetInstanceId: string;
      durationMs: number;
    }
  | {
      type: "DESTROY_CARD";
      cardInstanceId: string;
      durationMs: number;
    }
  | {
      type: "ROLL_DICE";
      values: number[];
      rollKind: string;
      durationMs: number;
    }
  | {
      type: "SHOW_STATUS_CHIP";
      cardInstanceId?: string;
      playerId?: string;
      label: string;
      durationMs: number;
    };
