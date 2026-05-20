import type { CardImageCandidate } from "./cardImageManifest";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getGithubCdnCandidates(localCandidates: CardImageCandidate[]): CardImageCandidate[] {
  const base = (import.meta.env.VITE_CARD_IMAGE_GITHUB_CDN_BASE as string | undefined)?.trim();
  if (!base) return [];
  const normalizedBase = trimTrailingSlash(base);
  return localCandidates.map(candidate => ({
    fileName: candidate.fileName,
    url: `${normalizedBase}/${encodeURIComponent(candidate.fileName)}`
  }));
}

