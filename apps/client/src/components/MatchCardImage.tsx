import { useEffect, useMemo, useState } from "react";
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { getCardName } from "../gameViewHelpers";

type MatchCardImageProps = {
  match: AppMatchState;
  card: CardInstance;
  className?: string;
};

const IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg"];

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

function getMatchCardImageUrls(match: AppMatchState, card: CardInstance): string[] {
  const definition = match.cardCatalog[card.cardId];
  const stems = [card.cardId];

  if (definition?.generation && definition.cardNumber && definition.name) {
    stems.push(`gen${definition.generation}_${definition.cardNumber}_${normalizeFileNamePart(definition.name)}`);
  }

  return uniqueValues(stems).flatMap(stem =>
    IMAGE_EXTENSIONS.map(extension => `/card-images/${encodeURIComponent(`${stem}.${extension}`)}`)
  );
}

export function MatchCardImage({ match, card, className }: MatchCardImageProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const imageUrls = useMemo(() => getMatchCardImageUrls(match, card), [match, card]);
  const imageUrl = imageUrls[candidateIndex];
  const cardName = getCardName(match, card);
  const classNames = ["match-card-art", className].filter(Boolean).join(" ");

  useEffect(() => {
    setCandidateIndex(0);
  }, [card.cardId, card.instanceId]);

  if (!imageUrl) {
    return (
      <div className={`${classNames} missing`} aria-hidden="true">
        <strong>{cardName.slice(0, 1)}</strong>
      </div>
    );
  }

  return (
    <div className={classNames}>
      <img
        src={imageUrl}
        alt={`${cardName} card art`}
        draggable={false}
        loading="lazy"
        onError={() => setCandidateIndex(current => current + 1)}
      />
    </div>
  );
}
