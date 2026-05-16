import { useEffect, useMemo, useState } from "react";
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { getCardName } from "../gameViewHelpers";
import { useZeroCardSrc } from "../hooks/useZeroCardSrc";
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

export function getMatchCardImageUrls(match: AppMatchState, card: CardInstance, artKeyOverride?: CardArtKey): string[] {
  const definition = match.cardCatalog[card.cardId];
  const stems = [card.cardId];
  const artKey = artKeyOverride ?? normalizeCardArtKey(card.artKey);

  if (definition?.generation && definition.cardNumber && definition.name) {
    stems.push(`gen${definition.generation}_${definition.cardNumber}_${normalizeFileNamePart(definition.name)}`);
  }

  const artStems = uniqueValues(stems).flatMap(stem => getArtStems(stem, artKey));

  return uniqueValues(artStems).flatMap(stem =>
    IMAGE_EXTENSIONS.map(extension => `/card-images/${encodeURIComponent(`${stem}.${extension}`)}`)
  );
}

export function MatchCardImage({ match, card, className }: MatchCardImageProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [zeroFallbackCandidateIndex, setZeroFallbackCandidateIndex] = useState(0);
  const artKey = normalizeCardArtKey(card.artKey);
  const imageArtKey = getBaseArtKey(artKey);
  const holoEnabled = isHoloArtKey(artKey);
  const imageUrls = useMemo(() => getMatchCardImageUrls(match, card), [match, card]);
  const regularImageUrls = useMemo(() => getMatchCardImageUrls(match, card, "default"), [match, card]);
  const imageUrl = imageUrls[candidateIndex];
  const regularImageUrl = regularImageUrls[zeroFallbackCandidateIndex];
  const shouldGenerateZero = imageArtKey === "zero-art" && !imageUrl && Boolean(regularImageUrl);
  const generatedZeroSrc = useZeroCardSrc(regularImageUrl, shouldGenerateZero);
  const displayImageSrc = shouldGenerateZero ? generatedZeroSrc : imageUrl;
  const cardName = getCardName(match, card);
  const classNames = ["match-card-art", className].filter(Boolean).join(" ");

  useEffect(() => {
    setCandidateIndex(0);
    setZeroFallbackCandidateIndex(0);
  }, [card.cardId, card.instanceId, imageArtKey]);

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
          if (shouldGenerateZero) {
            setZeroFallbackCandidateIndex(current => current + 1);
            return;
          }

          setCandidateIndex(current => current + 1);
        }}
      />
    </div>
  );
}
