export function encodeCardImagePath(path: string): string {
  return path
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

export function buildCardImageUrl(path: string): string {
  return `/card-images/${encodeCardImagePath(path)}`;
}

export function getCardImageGenerationDirectory(generation: string | number | undefined): string | undefined {
  const normalized = String(generation ?? "").trim().toLowerCase();

  if (!normalized) return undefined;
  if (normalized === "promo" || normalized === "promos") return "promos";

  const genMatch = normalized.match(/^gen\s*([0-9]+)$/) ?? normalized.match(/^([0-9]+)$/);

  if (genMatch) return `gen${genMatch[1]}`;

  const slug = normalized
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || undefined;
}
