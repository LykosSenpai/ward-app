export type BoardSlotId =
  | "player_1-primary"
  | "player_1-limited-1"
  | "player_1-limited-2"
  | "player_1-limited-3"
  | "player_1-limited-4"
  | "player_1-magic-1"
  | "player_1-magic-2"
  | "player_1-magic-3"
  | "player_1-magic-4"
  | "player_1-magic-5"
  | "player_2-primary"
  | "player_2-limited-1"
  | "player_2-limited-2"
  | "player_2-limited-3"
  | "player_2-limited-4"
  | "player_2-magic-1"
  | "player_2-magic-2"
  | "player_2-magic-3"
  | "player_2-magic-4"
  | "player_2-magic-5";

export type BoardSlotOffsetMap = Partial<Record<BoardSlotId, { x: number; z: number }>>;

export type BoardSlotFocusSource = "mini-map" | "table" | "debug" | "keyboard";

export type BoardPieceFocusSource = "mini-map" | "table";

export type BoardSlotFocusEvent = {
  slotId: string;
  source: BoardSlotFocusSource;
};

export type BoardPieceFocusEvent = {
  pieceId: string;
  source: BoardPieceFocusSource;
};

export type BoardPreviewInteractionIntent = {
  source: BoardSlotFocusSource | BoardPieceFocusSource;
  slotId?: string;
  pieceId?: string;
  owner?: "player_1" | "player_2";
  lane?: "primary" | "limited" | "magic";
};

export type BoardLayoutSnapshot = Array<{ id: BoardSlotId; xPercent: number; zPercent: number }>;
