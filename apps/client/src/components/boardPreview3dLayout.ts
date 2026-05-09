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

export type CameraPresetKey = "tactical" | "neutral" | "cinematic";

export const CAMERA_PRESETS: Record<CameraPresetKey, { tilt: number; zoom: number; height: number }> = {
  tactical: { tilt: 64, zoom: 0.92, height: 1.25 },
  neutral: { tilt: 60, zoom: 1, height: 1 },
  cinematic: { tilt: 52, zoom: 1.08, height: 1.45 }
};

export const ZONE_ANCHORS: ZoneAnchor[] = [
  { id: "far-primary", label: "Far Primary Lane", xPercent: 50, zPercent: 26 },
  { id: "near-primary", label: "Near Primary Lane", xPercent: 50, zPercent: 74 },
  { id: "far-magic", label: "Far Magic Band", xPercent: 18, zPercent: 26 },
  { id: "near-magic", label: "Near Magic Band", xPercent: 82, zPercent: 74 }
];

export const BOARD_SLOTS: BoardSlot[] = [
  { id: "player_2-primary", owner: "player_2", xPercent: 50, zPercent: 26, label: "P2 Primary" },
  { id: "player_2-limited-1", owner: "player_2", xPercent: 30, zPercent: 34, label: "P2 Limited 1" },
  { id: "player_2-limited-2", owner: "player_2", xPercent: 70, zPercent: 34, label: "P2 Limited 2" },
  { id: "player_2-magic-1", owner: "player_2", xPercent: 18, zPercent: 26, label: "P2 Magic 1" },
  { id: "player_2-magic-2", owner: "player_2", xPercent: 82, zPercent: 26, label: "P2 Magic 2" },
  { id: "player_1-primary", owner: "player_1", xPercent: 50, zPercent: 74, label: "P1 Primary" },
  { id: "player_1-limited-1", owner: "player_1", xPercent: 70, zPercent: 66, label: "P1 Limited 1" },
  { id: "player_1-limited-2", owner: "player_1", xPercent: 30, zPercent: 66, label: "P1 Limited 2" },
  { id: "player_1-magic-1", owner: "player_1", xPercent: 82, zPercent: 74, label: "P1 Magic 1" },
  { id: "player_1-magic-2", owner: "player_1", xPercent: 18, zPercent: 74, label: "P1 Magic 2" }
];
