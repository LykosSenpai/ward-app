const DEFAULT_WINDOW_MS = 10_000;

export class SocketEventRateLimiter {
  private readonly hitsByKey = new Map<string, number[]>();

  checkOrThrow(key: string, maxEvents: number, windowMs = DEFAULT_WINDOW_MS): void {
    const now = Date.now();
    const existing = this.hitsByKey.get(key) ?? [];
    const next = existing.filter(ts => now - ts < windowMs);

    if (next.length >= maxEvents) {
      throw new Error("Too many marketplace actions. Please wait and try again.");
    }

    next.push(now);
    this.hitsByKey.set(key, next);
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function sanitizeMarketplaceText(value: unknown, maxLength: number): string {
  const text = normalizeWhitespace(stripControlChars(String(value ?? "")));
  return text.slice(0, maxLength);
}

export function sanitizeDiscordHandle(value: unknown): string {
  const base = sanitizeMarketplaceText(value, 40).replace(/\s/g, "");
  return base.replace(/[^a-zA-Z0-9_.#]/g, "");
}

export function assertMaxPayloadSize(payload: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(payload ?? {}), "utf8");
  if (bytes > maxBytes) {
    throw new Error(`Marketplace payload too large (${bytes} bytes).`);
  }
}
