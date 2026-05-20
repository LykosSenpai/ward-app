import { useEffect, useMemo, useState } from "react";
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { filterCardImageCandidates, useCardImageManifest } from "../cardImageManifest";
import type { CardImageCandidate } from "../cardImageManifest";
import { buildCardImageUrl, getCardImageGenerationDirectory } from "../cardImagePaths";
import { getCardName } from "../gameViewHelpers";
import type { CardArtKey } from "./CardImagePreview";
import { getBaseArtKey, isHoloArtKey, normalizeCardArtKey } from "./CardImagePreview";
import { HolographicCardImage } from "./HolographicCardImage";

type MatchCardImageProps = {
  match: AppMatchState;
  card: CardInstance;
  className?: string;
};

const IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg"];
const ZERO_ART_SUFFIX_ALIASES = ["zero-art", "zero_art", "zeroart"];

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value.trim() !== "")));
}

function normalizeFileNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getArtStems(stem: string, artKey: CardArtKey): string[] {
  if (getBaseArtKey(artKey) !== "zero-art") {
    return [stem];
  }

  return ZERO_ART_SUFFIX_ALIASES.map(suffix => `${stem}__${suffix}`);
}

function getMatchCardImageFilePaths(generation: string | number | undefined, fileName: string): string[] {
  const generationDirectory = getCardImageGenerationDirectory(generation);

  return uniqueValues([
    fileName,
    generationDirectory ? `${generationDirectory}/${fileName}` : ""
  ]);
}

function getMatchCardImageCandidates(match: AppMatchState, card: CardInstance, artKeyOverride?: CardArtKey): CardImageCandidate[] {
  const definition = match.cardCatalog[card.cardId];
  const stems = [card.cardId];
  const artKey = artKeyOverride ?? normalizeCardArtKey(card.artKey);

  if (definition?.generation && definition.cardNumber && definition.name) {
    stems.push(`gen${definition.generation}_${definition.cardNumber}_${normalizeFileNamePart(definition.name)}`);
  }

  const artStems = uniqueValues(stems).flatMap(stem => getArtStems(stem, artKey));

  return uniqueValues(artStems).flatMap(stem =>
    IMAGE_EXTENSIONS.flatMap(extension => {
      const fileName = `${stem}.${extension}`;

      return getMatchCardImageFilePaths(definition?.generation, fileName).map(filePath => ({
        fileName: filePath,
        url: buildCardImageUrl(filePath)
      }));
    })
  );
}

function uniqueCardImageCandidates(candidates: CardImageCandidate[]): CardImageCandidate[] {
  const seenUrls = new Set<string>();
  return candidates.filter(candidate => {
    if (seenUrls.has(candidate.url)) return false;
    seenUrls.add(candidate.url);
    return true;
  });
}

function getRemoteMatchCardCandidates(match: AppMatchState, card: CardInstance): CardImageCandidate[] {
  const definition = match.cardCatalog[card.cardId];
  const primaryUrl = definition?.image?.remotePrimaryUrl?.trim();
  const primaryCandidates = primaryUrl
    ? [{ fileName: `remote:${card.cardId}:primary`, url: primaryUrl }]
    : [];
  const remoteCandidates = (definition?.image?.remoteCandidates ?? [])
    .map((candidate, index) => {
      const url = candidate.url?.trim();
      if (!url) return null;

      return {
        fileName: candidate.fileName?.trim() || `remote:${card.cardId}:${index}`,
        url
      };
    })
    .filter((candidate): candidate is CardImageCandidate => candidate !== null);

  return uniqueCardImageCandidates([...primaryCandidates, ...remoteCandidates]);
}

export function getMatchCardImageUrls(match: AppMatchState, card: CardInstance, artKeyOverride?: CardArtKey): string[] {
  return [...getRemoteMatchCardCandidates(match, card), ...getMatchCardImageCandidates(match, card, artKeyOverride)].map(candidate => candidate.url);
}

export function getBoardCardImageUrls(match: AppMatchState, card: CardInstance, artKeyOverride?: CardArtKey): string[] {
  return [...getRemoteMatchCardCandidates(match, card), ...getMatchCardImageCandidates(match, card, artKeyOverride)]
    .map(candidate => candidate.url);
}

export function MatchCardImage({ match, card, className }: MatchCardImageProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const artKey = normalizeCardArtKey(card.artKey);
  const holoEnabled = isHoloArtKey(artKey);
  const manifest = useCardImageManifest();
  const imageCandidates = useMemo(
    () => filterCardImageCandidates([
      ...getRemoteMatchCardCandidates(match, card),
      ...getMatchCardImageCandidates(match, card)
    ], manifest),
    [match, card, manifest]
  );
  const displayImageSrc = imageCandidates[candidateIndex]?.url;
  const cardName = getCardName(match, card);
  const classNames = ["match-card-art", className].filter(Boolean).join(" ");

  useEffect(() => {
    setCandidateIndex(0);
  }, [card.cardId, card.instanceId, artKey, imageCandidates[0]?.url]);

  if (!displayImageSrc) {
    return (
      <div className={`${classNames} missing`} aria-hidden="true">
        <strong>{cardName.slice(0, 1)}</strong>
      </div>
    );
  }

  return (
    <div className={classNames}>
      <HolographicCardImage
        key={`${card.instanceId}:${artKey}:${displayImageSrc}`}
        src={displayImageSrc}
        alt={`${cardName} card art`}
        draggable={false}
        seed={`match:${match.matchId}:${card.instanceId}:${artKey}`}
        enabled={holoEnabled}
        intensity={0.55}
        onError={() => {
          setCandidateIndex(current => current + 1);
        }}
      />
    </div>
  );
}
