export type BoardPlayerId = "player_1" | "player_2";

export type BoardSlotId =
  | `${BoardPlayerId}-primary`
  | `${BoardPlayerId}-limited-${1 | 2 | 3 | 4}`
  | `${BoardPlayerId}-magic-${1 | 2 | 3 | 4 | 5}`
  | `${BoardPlayerId}-hand-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`
  | `${BoardPlayerId}-deck`
  | `${BoardPlayerId}-cemetery`;

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
  owner?: BoardPlayerId;
  lane?: "primary" | "limited" | "magic" | "hand" | "deck" | "cemetery";
};

export type BoardLayoutSnapshot = Array<{ id: BoardSlotId; xPercent: number; zPercent: number }>;
