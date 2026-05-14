function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function sanitizeMarketplaceText(value: string, maxLength: number): string {
  return normalizeWhitespace(stripControlChars(value)).slice(0, maxLength);
}

export function sanitizeDiscordHandle(value: string): string {
  return sanitizeMarketplaceText(value, 40).replace(/\s/g, "").replace(/[^a-zA-Z0-9_.#]/g, "");
}
