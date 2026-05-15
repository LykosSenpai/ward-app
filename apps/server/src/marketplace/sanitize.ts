const scriptTagPattern = /<\s*\/??\s*script\b[^>]*>/gi;

export function sanitizeMarketplaceText(value: unknown, options?: { maxLength?: number }): string {
  const maxLength = options?.maxLength ?? 500;
  const raw = String(value ?? "").trim();
  const withoutScripts = raw.replace(scriptTagPattern, "");
  const withoutAngles = withoutScripts.replace(/[<>]/g, "");
  return withoutAngles.slice(0, maxLength);
}
