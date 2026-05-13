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

export type BoardEventType =
  | "CARD_MOVED"
  | "CARD_DRAWN"
  | "CARD_DISCARDED"
  | "CARD_DESTROYED"
  | "CARD_RETURNED_TO_HAND"
  | "CARD_RETURNED_TO_DECK"
  | "CARD_SENT_TO_CEMETERY"
  | "CREATURE_SUMMONED_PRIMARY"
  | "CREATURE_SUMMONED_LIMITED"
  | "LIMITED_PROMOTED_TO_PRIMARY"
  | "MAGIC_PLAYED_TO_CHAIN"
  | "MAGIC_RESOLVED"
  | "MAGIC_NEGATED"
  | "MAGIC_ATTACHED"
  | "MAGIC_DETACHED"
  | "ANCHOR_LINK_CREATED"
  | "ANCHOR_LINK_REMOVED"
  | "SOURCE_LINK_CLEANUP_TRIGGERED"
  | "CARD_DAMAGED"
  | "CARD_HEALED"
  | "STATUS_APPLIED"
  | "STATUS_REMOVED"
  | "STAT_MODIFIER_APPLIED"
  | "STAT_MODIFIER_REMOVED"
  | "DICE_ROLLED"
  | "BATTLE_STARTED"
  | "BATTLE_STRIKE_STARTED"
  | "BATTLE_HIT_ROLLED"
  | "BATTLE_DAMAGE_ROLLED"
  | "BATTLE_DAMAGE_APPLIED"
  | "BATTLE_RESOLVED"
  | "PROMPT_OPENED"
  | "PROMPT_RESOLVED"
  | "CHAIN_LINK_ADDED"
  | "CHAIN_PRIORITY_PASSED"
  | "CHAIN_LINK_RESOLVED"
  | "PLAYER_LOCK_APPLIED"
  | "PLAYER_LOCK_REMOVED"
  | "TURN_PHASE_CHANGED"
  | "TURN_STARTED"
  | "TURN_ENDED";

export type BoardEventBase = {
  id: string;
  sequenceNumber: number;
  matchId: string;
  type: BoardEventType;
  playerId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
};

export type CardMoveBoardEvent = BoardEventBase & {
  type: "CARD_MOVED";
  cardInstanceId: string;
  fromZoneRef: BoardZoneRef;
  toZoneRef: BoardZoneRef;
};

export type BoardEvent =
  | CardMoveBoardEvent
  | (BoardEventBase & {
      cardInstanceId?: string;
      targetCardInstanceId?: string;
      fromZoneRef?: BoardZoneRef;
      toZoneRef?: BoardZoneRef;
      zoneRef?: BoardZoneRef;
      promptId?: string;
      chainLinkId?: string;
      battleId?: string;
      strikeId?: string;
      amount?: number;
      damageType?: string;
      healType?: string;
      values?: number[];
      status?: string;
      statusLabel?: string;
      stat?: string;
      delta?: number;
      modifierId?: string;
      metadata?: Record<string, unknown>;
    });

export type BoardEventBatch = {
  id: string;
  matchId: string;
  events: BoardEvent[];
};

export type BoardAnimationGlowKind =
  | "VALID"
  | "TARGET"
  | "COST"
  | "CHAIN"
  | "DAMAGE"
  | "HEAL"
  | "LOCKED";

export type BoardAnimationZoneGlowKind =
  | "VALID_DROP"
  | "TARGET"
  | "COST"
  | "LOCKED";

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
      glowKind: BoardAnimationGlowKind;
      durationMs: number;
    }
  | {
      type: "GLOW_ZONE";
      zoneRef: BoardZoneRef;
      glowKind: BoardAnimationZoneGlowKind;
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
