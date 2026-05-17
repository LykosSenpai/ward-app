import { useEffect, useState } from "react";

export type CardImageCandidate = {
  fileName: string;
  url: string;
};

export type CardImageManifest = ReadonlySet<string> | null | undefined;

type CardImageManifestFile = {
  version?: number;
  files?: unknown;
};

let cardImageManifestPromise: Promise<ReadonlySet<string> | null> | undefined;

export function loadCardImageManifest(): Promise<ReadonlySet<string> | null> {
  if (!cardImageManifestPromise) {
    cardImageManifestPromise = fetch("/card-images/manifest.json", { cache: "force-cache" })
      .then(async response => {
        if (!response.ok) return null;
        return await response.json() as CardImageManifestFile;
      })
      .then(data => {
        if (!data || !Array.isArray(data.files)) return null;

        return new Set(
          data.files.filter((fileName): fileName is string =>
            typeof fileName === "string" && fileName.trim() !== ""
          )
        );
      })
      .catch(() => null);
  }

  return cardImageManifestPromise;
}

export function useCardImageManifest(): CardImageManifest {
  const [manifest, setManifest] = useState<CardImageManifest>(undefined);

  useEffect(() => {
    let active = true;

    void loadCardImageManifest().then(nextManifest => {
      if (active) {
        setManifest(nextManifest);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return manifest;
}

export function filterCardImageCandidates(
  candidates: CardImageCandidate[],
  manifest: CardImageManifest
): CardImageCandidate[] {
  if (candidates.length <= 1) return candidates;
  if (manifest === undefined) return candidates.slice(0, 1);
  if (manifest === null) return candidates;

  const knownCandidates = candidates.filter(candidate => manifest.has(candidate.fileName));

  return knownCandidates.length > 0 ? knownCandidates : candidates.slice(0, 1);
}
