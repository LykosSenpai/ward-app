export type EmbedPage = "play" | "board-preview";
export type EmbedView = "board" | "split" | "text";

export type EmbedCommandType = "set-page" | "set-view" | "set-animation-speed" | "focus-card" | "request-state" | "request-snapshot" | "request-capabilities";
export type EmbedEventType = "ready" | "state" | "snapshot" | "heightChanged" | "eventApplied" | "capabilities" | "error";

export type EmbedEnvelope = {
  channel: "ward-embed";
  version: 1;
};

export type EmbedSetPageCommand = EmbedEnvelope & {
  type: "set-page";
  page: EmbedPage;
};

export type EmbedSetViewCommand = EmbedEnvelope & {
  type: "set-view";
  view: EmbedView;
};

export type EmbedRequestStateCommand = EmbedEnvelope & {
  type: "request-state";
};

export type EmbedSetAnimationSpeedCommand = EmbedEnvelope & {
  type: "set-animation-speed";
  speed: number;
};

export type EmbedFocusCardCommand = EmbedEnvelope & {
  type: "focus-card";
  cardId: string;
};

export type EmbedRequestSnapshotCommand = EmbedEnvelope & {
  type: "request-snapshot";
};

export type EmbedRequestCapabilitiesCommand = EmbedEnvelope & {
  type: "request-capabilities";
};

export type EmbedCommandPayload =
  | EmbedSetPageCommand
  | EmbedSetViewCommand
  | EmbedSetAnimationSpeedCommand
  | EmbedFocusCardCommand
  | EmbedRequestStateCommand
  | EmbedRequestSnapshotCommand
  | EmbedRequestCapabilitiesCommand;

export type EmbedStatePayload = EmbedEnvelope & {
  type: "state";
  embed: true;
  activePage: string;
  playViewMode: string;
  animationSpeed: number;
  focusedCardId: string | null;
};

export type EmbedReadyPayload = EmbedEnvelope & {
  type: "ready";
  embed: true;
  activePage: string;
  playViewMode: string;
  animationSpeed: number;
  focusedCardId: string | null;
};

export type EmbedEventPayload = EmbedReadyPayload | EmbedStatePayload;

export type EmbedSnapshotPayload = EmbedEnvelope & {
  type: "snapshot";
  embed: true;
  activePage: string;
  playViewMode: string;
  animationSpeed: number;
  focusedCardId: string | null;
  timestamp: string;
};

export type EmbedHeightChangedPayload = EmbedEnvelope & {
  type: "heightChanged";
  embed: true;
  height: number;
};

export type EmbedErrorPayload = EmbedEnvelope & {
  type: "error";
  embed: true;
  code: "ORIGIN_MISMATCH" | "INVALID_COMMAND";
  message: string;
};

export type EmbedEventAppliedPayload = EmbedEnvelope & {
  type: "eventApplied";
  embed: true;
  command: EmbedCommandType;
  timestamp: string;
};

export type EmbedCapabilitiesPayload = EmbedEnvelope & {
  type: "capabilities";
  embed: true;
  commands: EmbedCommandType[];
  events: EmbedEventType[];
};
