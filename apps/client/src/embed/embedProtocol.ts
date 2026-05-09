import type { EmbedCommandType } from "./embedTypes";

export const EMBED_CHANNEL = "ward-embed";
export const EMBED_VERSION = 1;

export function parseEmbedMode(search: string): boolean {
  const embedValue = new URLSearchParams(search).get("embed");
  if (!embedValue) {
    return false;
  }

  return embedValue === "1" || embedValue.toLowerCase() === "true";
}

export function parseEmbedParentOrigin(search: string): string | null {
  const origin = new URLSearchParams(search).get("parentOrigin");
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function parseReferrerOrigin(referrer: string): string | null {
  if (!referrer) {
    return null;
  }

  try {
    return new URL(referrer).origin;
  } catch {
    return null;
  }
}

export function isEmbedCommandType(type: string): type is EmbedCommandType {
  return type === "set-page"
    || type === "set-view"
    || type === "set-animation-speed"
    || type === "focus-card"
    || type === "request-state"
    || type === "request-snapshot"
    || type === "request-capabilities";
}
