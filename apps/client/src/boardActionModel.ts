import type { TurnPhase } from "@ward/shared";

export type BoardZoneId =
  | "own-hand"
  | "opponent-hand"
  | "primary"
  | "limited"
  | "magic"
  | "deck"
  | "cemetery"
  | "chain";

export type BoardPanelSection =
  | "battle"
  | "effect-roll"
  | "magic-chain"
  | "target-prompt"
  | "hand-prompt"
  | "manual-effects"
  | "controls";

export type BoardAction =
  | "draw"
  | "advance-phase"
  | "summon-primary"
  | "play-magic"
  | "discard"
  | "declare-battle"
  | "promote-limited"
  | "attach-magic"
  | "remove-magic"
  | "resolve-target"
  | "pass-chain-priority"
  | "resolve-chain";

export type BoardActionAvailability = {
  action: BoardAction;
  enabled: boolean;
  reason?: string;
  phase?: TurnPhase;
  sourceZone?: BoardZoneId;
  targetZone?: BoardZoneId;
};
