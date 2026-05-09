export type BoardSlot = {
  id: string;
  owner: "player_1" | "player_2";
  xPercent: number;
  zPercent: number;
  label: string;
};

export type ZoneAnchor = {
  id: string;
  label: string;
  xPercent: number;
  zPercent: number;
};

export type StackZone = ZoneAnchor & {
  owner: "player_1" | "player_2";
  kind: "deck" | "cemetery";
};

export type CameraPresetKey = "tactical" | "neutral" | "cinematic";

export const CAMERA_PRESETS: Record<CameraPresetKey, { tilt: number; zoom: number; height: number }> = {
  tactical: { tilt: 58, zoom: 1.04, height: 1.15 },
  neutral: { tilt: 54, zoom: 1.08, height: 1 },
  cinematic: { tilt: 48, zoom: 1.18, height: 1.35 }
};

export const ZONE_ANCHORS: ZoneAnchor[] = [
  { id: "far-magic", label: "P2 Spell / Trap", xPercent: 50, zPercent: 24 },
  { id: "far-monster", label: "P2 Monster Row", xPercent: 50, zPercent: 36 },
  { id: "center-line", label: "Battle Line", xPercent: 50, zPercent: 50 },
  { id: "near-monster", label: "P1 Monster Row", xPercent: 50, zPercent: 64 },
  { id: "near-magic", label: "P1 Spell / Trap", xPercent: 50, zPercent: 76 }
];

export const STACK_ZONES: StackZone[] = [
  { id: "player_2-cemetery", owner: "player_2", kind: "cemetery", label: "P2 Cemetery", xPercent: 93, zPercent: 24 },
  { id: "player_2-deck", owner: "player_2", kind: "deck", label: "P2 Deck", xPercent: 7, zPercent: 24 },
  { id: "player_1-deck", owner: "player_1", kind: "deck", label: "P1 Deck", xPercent: 93, zPercent: 76 },
  { id: "player_1-cemetery", owner: "player_1", kind: "cemetery", label: "P1 Cemetery", xPercent: 7, zPercent: 76 }
];

export const BOARD_SLOTS: BoardSlot[] = [
  { id: "player_2-limited-1", owner: "player_2", xPercent: 18, zPercent: 36, label: "P2 Monster 1" },
  { id: "player_2-limited-2", owner: "player_2", xPercent: 34, zPercent: 36, label: "P2 Monster 2" },
  { id: "player_2-primary", owner: "player_2", xPercent: 50, zPercent: 36, label: "P2 Primary" },
  { id: "player_2-limited-3", owner: "player_2", xPercent: 66, zPercent: 36, label: "P2 Monster 4" },
  { id: "player_2-limited-4", owner: "player_2", xPercent: 82, zPercent: 36, label: "P2 Monster 5" },
  { id: "player_2-magic-1", owner: "player_2", xPercent: 18, zPercent: 24, label: "P2 Magic 1" },
  { id: "player_2-magic-2", owner: "player_2", xPercent: 34, zPercent: 24, label: "P2 Magic 2" },
  { id: "player_2-magic-3", owner: "player_2", xPercent: 50, zPercent: 24, label: "P2 Magic 3" },
  { id: "player_2-magic-4", owner: "player_2", xPercent: 66, zPercent: 24, label: "P2 Magic 4" },
  { id: "player_2-magic-5", owner: "player_2", xPercent: 82, zPercent: 24, label: "P2 Magic 5" },
  { id: "player_1-limited-1", owner: "player_1", xPercent: 82, zPercent: 64, label: "P1 Monster 1" },
  { id: "player_1-limited-2", owner: "player_1", xPercent: 66, zPercent: 64, label: "P1 Monster 2" },
  { id: "player_1-primary", owner: "player_1", xPercent: 50, zPercent: 64, label: "P1 Primary" },
  { id: "player_1-limited-3", owner: "player_1", xPercent: 34, zPercent: 64, label: "P1 Monster 4" },
  { id: "player_1-limited-4", owner: "player_1", xPercent: 18, zPercent: 64, label: "P1 Monster 5" },
  { id: "player_1-magic-1", owner: "player_1", xPercent: 82, zPercent: 76, label: "P1 Magic 1" },
  { id: "player_1-magic-2", owner: "player_1", xPercent: 66, zPercent: 76, label: "P1 Magic 2" },
  { id: "player_1-magic-3", owner: "player_1", xPercent: 50, zPercent: 76, label: "P1 Magic 3" },
  { id: "player_1-magic-4", owner: "player_1", xPercent: 34, zPercent: 76, label: "P1 Magic 4" },
  { id: "player_1-magic-5", owner: "player_1", xPercent: 18, zPercent: 76, label: "P1 Magic 5" }
];
