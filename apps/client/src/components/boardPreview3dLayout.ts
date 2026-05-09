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

export type BoardZone = {
  id: string;
  label: string;
  xPercent: number;
  zPercent: number;
  widthPercent: number;
  heightPercent: number;
  rotationDeg?: number;

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

export const BOARD_ZONES: BoardZone[] = [
  { id: "p2-primary-zone", label: "P2 Primary", xPercent: 50, zPercent: 26, widthPercent: 14, heightPercent: 10 },
  { id: "p2-limited-zone", label: "P2 Limited", xPercent: 50, zPercent: 34, widthPercent: 62, heightPercent: 12 },
  { id: "p2-magic-zone", label: "P2 Magic", xPercent: 50, zPercent: 21, widthPercent: 84, heightPercent: 10 },
  { id: "p1-primary-zone", label: "P1 Primary", xPercent: 50, zPercent: 74, widthPercent: 14, heightPercent: 10 },
  { id: "p1-limited-zone", label: "P1 Limited", xPercent: 50, zPercent: 66, widthPercent: 62, heightPercent: 12 },
  { id: "p1-magic-zone", label: "P1 Magic", xPercent: 50, zPercent: 79, widthPercent: 84, heightPercent: 10 },
  { id: "p2-deck-zone", label: "P2 Deck", xPercent: 95, zPercent: 12, widthPercent: 8, heightPercent: 14 },
  { id: "p1-cemetery-zone", label: "P1 Cemetery", xPercent: 95, zPercent: 88, widthPercent: 8, heightPercent: 14 }
];

export const BOARD_SLOTS: BoardSlot[] = [
  { id: "player_2-primary", owner: "player_2", xPercent: 50, zPercent: 26, label: "P2 Primary" },
  { id: "player_2-limited-1", owner: "player_2", xPercent: 22, zPercent: 34, label: "P2 Limited 1" },
  { id: "player_2-limited-2", owner: "player_2", xPercent: 41, zPercent: 34, label: "P2 Limited 2" },
  { id: "player_2-limited-3", owner: "player_2", xPercent: 59, zPercent: 34, label: "P2 Limited 3" },
  { id: "player_2-limited-4", owner: "player_2", xPercent: 78, zPercent: 34, label: "P2 Limited 4" },
  { id: "player_2-magic-1", owner: "player_2", xPercent: 10, zPercent: 22, label: "P2 Magic 1" },
  { id: "player_2-magic-2", owner: "player_2", xPercent: 30, zPercent: 21, label: "P2 Magic 2" },
  { id: "player_2-magic-3", owner: "player_2", xPercent: 50, zPercent: 20, label: "P2 Magic 3" },
  { id: "player_2-magic-4", owner: "player_2", xPercent: 70, zPercent: 21, label: "P2 Magic 4" },
  { id: "player_2-magic-5", owner: "player_2", xPercent: 90, zPercent: 22, label: "P2 Magic 5" },
  { id: "player_1-primary", owner: "player_1", xPercent: 50, zPercent: 74, label: "P1 Primary" },
  { id: "player_1-limited-1", owner: "player_1", xPercent: 78, zPercent: 66, label: "P1 Limited 1" },
  { id: "player_1-limited-2", owner: "player_1", xPercent: 59, zPercent: 66, label: "P1 Limited 2" },
  { id: "player_1-limited-3", owner: "player_1", xPercent: 41, zPercent: 66, label: "P1 Limited 3" },
  { id: "player_1-limited-4", owner: "player_1", xPercent: 22, zPercent: 66, label: "P1 Limited 4" },
  { id: "player_1-magic-1", owner: "player_1", xPercent: 90, zPercent: 78, label: "P1 Magic 1" },
  { id: "player_1-magic-2", owner: "player_1", xPercent: 70, zPercent: 79, label: "P1 Magic 2" },
  { id: "player_1-magic-3", owner: "player_1", xPercent: 50, zPercent: 80, label: "P1 Magic 3" },
  { id: "player_1-magic-4", owner: "player_1", xPercent: 30, zPercent: 79, label: "P1 Magic 4" },
  { id: "player_1-magic-5", owner: "player_1", xPercent: 10, zPercent: 78, label: "P1 Magic 5" }

];
