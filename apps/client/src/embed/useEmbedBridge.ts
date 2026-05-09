import { useEffect, useRef } from "react";
import type { EmbedEventType, EmbedPage, EmbedView } from "./embedTypes";
import {
  EMBED_CHANNEL,
  EMBED_VERSION,
  isEmbedCommandType
} from "./embedProtocol";

const SUPPORTED_COMMANDS = [
  "set-page",
  "set-view",
  "set-animation-speed",
  "focus-card",
  "request-state",
  "request-snapshot",
  "request-capabilities"
] as const;

const SUPPORTED_EVENTS = [
  "ready",
  "state",
  "snapshot",
  "heightChanged",
  "eventApplied",
  "capabilities",
  "error"
] as const;

type UseEmbedBridgeOptions = {
  embedModeEnabled: boolean;
  messagingOrigin: string | null;
  activePage: string;
  playViewMode: string;
  canApplyEmbedPage: (page: string) => page is EmbedPage;
  canApplyEmbedView: (view: string) => view is EmbedView;
  onSetPage: (page: EmbedPage) => void;
  onSetView: (view: EmbedView) => void;
};

export function useEmbedBridge({
  embedModeEnabled,
  messagingOrigin,
  activePage,
  playViewMode,
  canApplyEmbedPage,
  canApplyEmbedView,
  onSetPage,
  onSetView
}: UseEmbedBridgeOptions): void {
  const animationSpeedRef = useRef(1);
  const focusedCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!embedModeEnabled) {
      return;
    }

    const emitToParent = (message: Record<string, unknown>) => {
      if (window.parent === window) {
        return;
      }

      window.parent.postMessage(
        {
          channel: EMBED_CHANNEL,
          version: EMBED_VERSION,
          ...message
        },
        messagingOrigin ?? window.location.origin
      );
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      const isAllowedOrigin = messagingOrigin
        ? event.origin === messagingOrigin
        : event.origin === window.location.origin;
      if (!isAllowedOrigin) {
        emitToParent({
          type: "error" satisfies EmbedEventType,
          embed: true,
          code: "ORIGIN_MISMATCH",
          message: `Rejected message from origin ${event.origin}`
        });
        return;
      }

      if (!event.data || typeof event.data !== "object") {
        return;
      }

      const payload = event.data as {
        channel?: string;
        type?: string;
        page?: string;
        view?: string;
        speed?: number;
        cardId?: string;
      };

      if (payload.channel !== EMBED_CHANNEL || !payload.type || !isEmbedCommandType(payload.type)) {
        if (payload.channel === EMBED_CHANNEL) {
          emitToParent({
            type: "error" satisfies EmbedEventType,
            embed: true,
            code: "INVALID_COMMAND",
            message: "Rejected embed command due to invalid or unsupported type."
          });
        }
        return;
      }

      if (payload.type === "set-page" && payload.page && canApplyEmbedPage(payload.page)) {
        onSetPage(payload.page);
        emitToParent({
          type: "eventApplied" satisfies EmbedEventType,
          embed: true,
          command: payload.type,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (payload.type === "set-view" && payload.view && canApplyEmbedView(payload.view)) {
        onSetView(payload.view);
        emitToParent({
          type: "eventApplied" satisfies EmbedEventType,
          embed: true,
          command: payload.type,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (payload.type === "request-state") {
        emitToParent({
          type: "state",
          embed: true,
          activePage,
          playViewMode,
          animationSpeed: animationSpeedRef.current,
          focusedCardId: focusedCardIdRef.current
        });
        return;
      }

      if (payload.type === "set-animation-speed" && typeof payload.speed === "number") {
        const normalizedSpeed = Number.isFinite(payload.speed)
          ? Math.min(Math.max(payload.speed, 0.25), 4)
          : 1;
        animationSpeedRef.current = normalizedSpeed;
        emitToParent({
          type: "eventApplied" satisfies EmbedEventType,
          embed: true,
          command: payload.type,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (payload.type === "focus-card" && typeof payload.cardId === "string") {
        focusedCardIdRef.current = payload.cardId.trim() || null;
        emitToParent({
          type: "eventApplied" satisfies EmbedEventType,
          embed: true,
          command: payload.type,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (payload.type === "request-snapshot") {
        emitToParent({
          type: "snapshot",
          embed: true,
          activePage,
          playViewMode,
          animationSpeed: animationSpeedRef.current,
          focusedCardId: focusedCardIdRef.current,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (payload.type === "request-capabilities") {
        emitToParent({
          type: "capabilities",
          embed: true,
          commands: [...SUPPORTED_COMMANDS],
          events: [...SUPPORTED_EVENTS]
        });
      }
    };

    emitToParent({
      type: "ready",
      embed: true,
      activePage,
      playViewMode,
      animationSpeed: animationSpeedRef.current,
      focusedCardId: focusedCardIdRef.current
    });

    let resizeObserver: ResizeObserver | undefined;
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        emitToParent({
          type: "heightChanged" satisfies EmbedEventType,
          embed: true,
          height: Math.ceil(entry.contentRect.height)
        });
      });
      resizeObserver.observe(document.body);
    }
    window.addEventListener("message", handleMessage);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("message", handleMessage);
    };
  }, [
    activePage,
    canApplyEmbedPage,
    canApplyEmbedView,
    embedModeEnabled,
    messagingOrigin,
    onSetPage,
    onSetView,
    playViewMode
  ]);
}
