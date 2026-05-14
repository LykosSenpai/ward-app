import type { CardOwnershipRecord, CardOwnershipVariant } from "./clientTypes";

export const CARD_OWNERSHIP_VARIANTS: CardOwnershipVariant[] = ["DEFAULT", "HOLO", "ZERO", "ZERO_HOLO"];

export function normalizeOwnershipRecord(ownership?: Partial<CardOwnershipRecord> | null): CardOwnershipRecord {
  return {
    DEFAULT: ownership?.DEFAULT ?? 0,
    HOLO: ownership?.HOLO ?? 0,
    ZERO: ownership?.ZERO ?? 0,
    ZERO_HOLO: ownership?.ZERO_HOLO ?? 0
  };
}

export function getOwnershipVariantFromArtworkAndHolo(
  artworkMode: "default" | "zero-art",
  isHolo: boolean
): CardOwnershipVariant {
  if (artworkMode === "zero-art") return isHolo ? "ZERO_HOLO" : "ZERO";
  return isHolo ? "HOLO" : "DEFAULT";
}

export function getOwnedQuantity(ownership: Partial<CardOwnershipRecord> | null | undefined, variant: CardOwnershipVariant): number {
  const normalized = normalizeOwnershipRecord(ownership);
  return normalized[variant];
}

export function getMissingQuantity(ownedQuantity: number, requiredQuantity: number): number {
  return Math.max(0, requiredQuantity - ownedQuantity);
}
