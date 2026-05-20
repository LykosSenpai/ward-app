import { useEffect, useMemo, useState } from "react";
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { filterCardImageCandidates, useCardImageManifest } from "../cardImageManifest";
import type { CardImageManifest } from "../cardImageManifest";
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
  holoIntensity?: number;
  holoOpacity?: number;
  holoSheenIntensity?: number;
};

const IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg"];
const ZERO_ART_SUFFIX_ALIASES = ["zero-art", "zero_art", "zeroart"];
const DEFAULT_MATCH_HOLO_INTENSITY = 2.6;
const DEFAULT_MATCH_HOLO_OPACITY = 1.45;
const DEFAULT_MATCH_HOLO_SHEEN_INTENSITY = 0.78;

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

function normalizeSpacedFileNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHyphenFileNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    generationDirectory ? `${generationDirectory}/${fileName}` : "",
    fileName
  ]);
}

function normalizeStoredImagePath(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^card-images\//i, "")
    .replace(/^cards\//i, "");
}

function getStoredBucketMatchCardCandidates(match: AppMatchState, card: CardInstance): CardImageCandidate[] {
  const definition = match.cardCatalog[card.cardId];
  const storedCandidates = [
    ...(definition?.image?.bucketCandidates ?? []),
    ...(definition?.image?.localCandidates ?? [])
  ];

  return uniqueCardImageCandidates(storedCandidates
    .map((candidate, index) => {
      const fileName = normalizeStoredImagePath(candidate.fileName ?? candidate.objectKey);
      const url = candidate.url?.trim() || (fileName ? buildCardImageUrl(fileName) : "");

      if (!url) return null;

      return {
        fileName: fileName || `bucket:${card.cardId}:${index}`,
        url
      };
    })
    .filter((candidate): candidate is CardImageCandidate => candidate !== null));
}

function getMatchCardImageStemAliases(match: AppMatchState, card: CardInstance): string[] {
  const definition = match.cardCatalog[card.cardId];
  const aliases: string[] = [];
  const generation = String(definition?.generation ?? "").trim();
  const cardNumber = String(definition?.cardNumber ?? "").trim();
  const cardName = definition?.name?.trim() ?? "";

  if (generation && cardNumber && cardName) {
    const prefix = `gen${generation}_${cardNumber}`;
    const slugName = normalizeFileNamePart(cardName);
    const spacedName = normalizeSpacedFileNamePart(cardName);
    const hyphenName = normalizeHyphenFileNamePart(cardName);
    const trimmedCardNumber = cardNumber.replace(/^0+/, "") || cardNumber;
    const editionSlug = normalizeHyphenFileNamePart(definition?.edition ?? "");

    aliases.push(`${cardNumber}-${hyphenName}`);
    aliases.push(`${trimmedCardNumber}-${hyphenName}`);
    aliases.push(`${prefix}_${slugName}`);
    aliases.push(`${prefix}_${spacedName}`);
    aliases.push(`${prefix} ${slugName}`);
    aliases.push(`${prefix} ${spacedName}`);

    if (editionSlug) {
      aliases.push(`${editionSlug}-${cardNumber}-${hyphenName}`);
      aliases.push(`${editionSlug}-${trimmedCardNumber}-${hyphenName}`);
      aliases.push(`${prefix}_${editionSlug}_${slugName}`);
    }
  }

  aliases.push(card.cardId);

  const idParts = card.cardId.split("_");
  if (idParts.length > 3) {
    aliases.push(`${idParts[0]}_${idParts[1]}_${idParts.slice(2).join(" ")}`);
  }

  return uniqueValues(aliases);
}

function getGeneratedBucketMatchCardImageCandidates(match: AppMatchState, card: CardInstance, artKeyOverride?: CardArtKey): CardImageCandidate[] {
  const definition = match.cardCatalog[card.cardId];
  const artKey = artKeyOverride ?? normalizeCardArtKey(card.artKey);
  const artStems = getMatchCardImageStemAliases(match, card).flatMap(stem => getArtStems(stem, artKey));

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
  return uniqueCardImageCandidates([
    ...getStoredBucketMatchCardCandidates(match, card),
    ...getGeneratedBucketMatchCardImageCandidates(match, card, artKeyOverride),
    ...getRemoteMatchCardCandidates(match, card)
  ]).map(candidate => candidate.url);
}

function getBoardCardImageCandidates(match: AppMatchState, card: CardInstance, artKeyOverride?: CardArtKey): CardImageCandidate[] {
  return uniqueCardImageCandidates([
    ...getStoredBucketMatchCardCandidates(match, card),
    ...getGeneratedBucketMatchCardImageCandidates(match, card, artKeyOverride),
    ...getRemoteMatchCardCandidates(match, card)
  ]);
}

export function getBoardCardImageUrls(
  match: AppMatchState,
  card: CardInstance,
  artKeyOverride?: CardArtKey,
  manifest?: CardImageManifest
): string[] {
  return filterCardImageCandidates(getBoardCardImageCandidates(match, card, artKeyOverride), manifest, "local-first")
    .map(candidate => candidate.url);
}

export function MatchCardImage({
  match,
  card,
  className,
  holoIntensity = DEFAULT_MATCH_HOLO_INTENSITY,
  holoOpacity = DEFAULT_MATCH_HOLO_OPACITY,
  holoSheenIntensity = DEFAULT_MATCH_HOLO_SHEEN_INTENSITY
}: MatchCardImageProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const artKey = normalizeCardArtKey(card.artKey);
  const holoEnabled = isHoloArtKey(artKey);
  const manifest = useCardImageManifest();
  const imageCandidates = useMemo(
    () => filterCardImageCandidates([
      ...getStoredBucketMatchCardCandidates(match, card),
      ...getGeneratedBucketMatchCardImageCandidates(match, card),
      ...getRemoteMatchCardCandidates(match, card)
    ], manifest, "local-first"),
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
        animated={holoEnabled}
        intensity={holoIntensity}
        holoOpacity={holoOpacity}
        sheenIntensity={holoSheenIntensity}
        onError={() => {
          setCandidateIndex(current => current + 1);
        }}
      />
    </div>
  );
}
