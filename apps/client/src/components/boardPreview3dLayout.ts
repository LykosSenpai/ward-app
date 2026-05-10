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
  { id: "near-magic", label: "Near Magic Band", xPercent: 82, zPercent: 74 },
  { id: "far-hand", label: "Far Hand Rail", xPercent: 50, zPercent: 7 },
  { id: "near-hand", label: "Near Hand Rail", xPercent: 50, zPercent: 93 },
  { id: "far-stacks", label: "Far Deck/Cemetery", xPercent: 50, zPercent: 12 },
  { id: "near-stacks", label: "Near Deck/Cemetery", xPercent: 50, zPercent: 88 }
];

export const BOARD_ZONES: BoardZone[] = [
  { id: "p2-hand-zone", label: "P2 Hand", xPercent: 50, zPercent: 7, widthPercent: 78, heightPercent: 9 },
  { id: "p2-deck-zone", label: "P2 Deck", xPercent: 6, zPercent: 12, widthPercent: 8, heightPercent: 14 },
  { id: "p2-cemetery-zone", label: "P2 Cemetery", xPercent: 94, zPercent: 12, widthPercent: 8, heightPercent: 14 },
  { id: "p2-primary-zone", label: "P2 Primary", xPercent: 50, zPercent: 26, widthPercent: 14, heightPercent: 10 },
  { id: "p2-limited-zone", label: "P2 Limited", xPercent: 50, zPercent: 34, widthPercent: 62, heightPercent: 12 },
  { id: "p2-magic-zone", label: "P2 Magic", xPercent: 50, zPercent: 21, widthPercent: 84, heightPercent: 10 },
  { id: "p1-primary-zone", label: "P1 Primary", xPercent: 50, zPercent: 74, widthPercent: 14, heightPercent: 10 },
  { id: "p1-limited-zone", label: "P1 Limited", xPercent: 50, zPercent: 66, widthPercent: 62, heightPercent: 12 },
  { id: "p1-magic-zone", label: "P1 Magic", xPercent: 50, zPercent: 79, widthPercent: 84, heightPercent: 10 },
  { id: "p1-cemetery-zone", label: "P1 Cemetery", xPercent: 6, zPercent: 88, widthPercent: 8, heightPercent: 14 },
  { id: "p1-deck-zone", label: "P1 Deck", xPercent: 94, zPercent: 88, widthPercent: 8, heightPercent: 14 },
  { id: "p1-hand-zone", label: "P1 Hand", xPercent: 50, zPercent: 93, widthPercent: 78, heightPercent: 9 }
];

export const BOARD_SLOTS: BoardSlot[] = [
  { id: "player_2-primary", owner: "player_2", xPercent: 51, zPercent: 35, label: "P2 Primary" },
  { id: "player_2-limited-1", owner: "player_2", xPercent: 73, zPercent: 35, label: "P2 Limited 1" },
  { id: "player_2-limited-2", owner: "player_2", xPercent: 62, zPercent: 35, label: "P2 Limited 2" },
  { id: "player_2-limited-3", owner: "player_2", xPercent: 40, zPercent: 35, label: "P2 Limited 3" },
  { id: "player_2-limited-4", owner: "player_2", xPercent: 29, zPercent: 35, label: "P2 Limited 4" },
  { id: "player_2-magic-1", owner: "player_2", xPercent: 73, zPercent: 4, label: "P2 Magic 1" },
  { id: "player_2-magic-2", owner: "player_2", xPercent: 62, zPercent: 4, label: "P2 Magic 2" },
  { id: "player_2-magic-3", owner: "player_2", xPercent: 51, zPercent: 4, label: "P2 Magic 3" },
  { id: "player_2-magic-4", owner: "player_2", xPercent: 40, zPercent: 4, label: "P2 Magic 4" },
  { id: "player_2-magic-5", owner: "player_2", xPercent: 29, zPercent: 4, label: "P2 Magic 5" },
  { id: "player_2-deck", owner: "player_2", xPercent: 13, zPercent: 3, label: "P2 Deck" },
  { id: "player_2-cemetery", owner: "player_2", xPercent: 88, zPercent: 4, label: "P2 Cemetery" },
  { id: "player_2-hand-1", owner: "player_2", xPercent: 6, zPercent: 35, label: "P2 Hand 1" },
  { id: "player_2-hand-2", owner: "player_2", xPercent: 16, zPercent: 35, label: "P2 Hand 2" },
  { id: "player_2-hand-3", owner: "player_2", xPercent: 26, zPercent: 35, label: "P2 Hand 3" },
  { id: "player_2-hand-4", owner: "player_2", xPercent: 36, zPercent: 35, label: "P2 Hand 4" },
  { id: "player_2-hand-5", owner: "player_2", xPercent: 46, zPercent: 35, label: "P2 Hand 5" },
  { id: "player_2-hand-6", owner: "player_2", xPercent: 56, zPercent: 35, label: "P2 Hand 6" },
  { id: "player_2-hand-7", owner: "player_2", xPercent: 66, zPercent: 35, label: "P2 Hand 7" },
  { id: "player_2-hand-8", owner: "player_2", xPercent: 76, zPercent: 35, label: "P2 Hand 8" },
  { id: "player_2-hand-9", owner: "player_2", xPercent: 83, zPercent: 35, label: "P2 Hand 9" },
  { id: "player_2-hand-10", owner: "player_2", xPercent: 93, zPercent: 35, label: "P2 Hand 10" },
  { id: "player_1-primary", owner: "player_1", xPercent: 51, zPercent: 65, label: "P1 Primary" },
  { id: "player_1-limited-1", owner: "player_1", xPercent: 73, zPercent: 65, label: "P1 Limited 1" },
  { id: "player_1-limited-2", owner: "player_1", xPercent: 62, zPercent: 65, label: "P1 Limited 2" },
  { id: "player_1-limited-3", owner: "player_1", xPercent: 40, zPercent: 65, label: "P1 Limited 3" },
  { id: "player_1-limited-4", owner: "player_1", xPercent: 29, zPercent: 65, label: "P1 Limited 4" },
  { id: "player_1-magic-1", owner: "player_1", xPercent: 73, zPercent: 95, label: "P1 Magic 1" },
  { id: "player_1-magic-2", owner: "player_1", xPercent: 62, zPercent: 95, label: "P1 Magic 2" },
  { id: "player_1-magic-3", owner: "player_1", xPercent: 51, zPercent: 95, label: "P1 Magic 3" },
  { id: "player_1-magic-4", owner: "player_1", xPercent: 40, zPercent: 95, label: "P1 Magic 4" },
  { id: "player_1-magic-5", owner: "player_1", xPercent: 29, zPercent: 95, label: "P1 Magic 5" },
  { id: "player_1-cemetery", owner: "player_1", xPercent: 13, zPercent: 95, label: "P1 Cemetery" },
  { id: "player_1-deck", owner: "player_1", xPercent: 88, zPercent: 95, label: "P1 Deck" },
  { id: "player_1-hand-1", owner: "player_1", xPercent: 6, zPercent: 65, label: "P1 Hand 1" },
  { id: "player_1-hand-2", owner: "player_1", xPercent: 16, zPercent: 65, label: "P1 Hand 2" },
  { id: "player_1-hand-3", owner: "player_1", xPercent: 26, zPercent: 65, label: "P1 Hand 3" },
  { id: "player_1-hand-4", owner: "player_1", xPercent: 36, zPercent: 65, label: "P1 Hand 4" },
  { id: "player_1-hand-5", owner: "player_1", xPercent: 46, zPercent: 65, label: "P1 Hand 5" },
  { id: "player_1-hand-6", owner: "player_1", xPercent: 56, zPercent: 65, label: "P1 Hand 6" },
  { id: "player_1-hand-7", owner: "player_1", xPercent: 66, zPercent: 65, label: "P1 Hand 7" },
  { id: "player_1-hand-8", owner: "player_1", xPercent: 76, zPercent: 65, label: "P1 Hand 8" },
  { id: "player_1-hand-9", owner: "player_1", xPercent: 83, zPercent: 65, label: "P1 Hand 9" },
  { id: "player_1-hand-10", owner: "player_1", xPercent: 93, zPercent: 65, label: "P1 Hand 10" }

];
