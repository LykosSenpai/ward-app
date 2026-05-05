import { useEffect, useMemo, useState } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import { ModalPanel } from "./ui/ModalPanel";

export type CardArtKey =
  | "default"
  | "holo"
  | "zero-art"
  | "alt-1"
  | "alt-2"
  | "alt-3"
  | "alt-4"
  | "alt-5"
  | "alt-6"
  | "future-1"
  | "future-2"
  | "future-3"
  | "future-4";

export type CardArtOption = {
  key: CardArtKey;
  label: string;
  suffixAliases: string[];
};

type CardImagePreviewProps = {
  card: CardLibraryCardSummary;
  selectedArtKey?: CardArtKey;
  onSelectedArtKeyChange?: (artKey: CardArtKey) => void;
};

type CardImageThumbnailProps = {
  card: CardLibraryCardSummary;
  className?: string;
};

type ImageCandidate = {
  fileName: string;
  url: string;
};

export const CARD_ART_OPTIONS: CardArtOption[] = [
  { key: "default", label: "Default", suffixAliases: [""] },
  { key: "holo", label: "Holo", suffixAliases: ["holo", "foil", "holographic"] },
  { key: "zero-art", label: "Zero Art", suffixAliases: ["zero-art", "zero_art", "zeroart"] },
  { key: "alt-1", label: "Alt 1", suffixAliases: ["alt-1", "alt_1", "alternate-1", "alternate_art_1"] },
  { key: "alt-2", label: "Alt 2", suffixAliases: ["alt-2", "alt_2", "alternate-2", "alternate_art_2"] },
  { key: "alt-3", label: "Alt 3", suffixAliases: ["alt-3", "alt_3", "alternate-3", "alternate_art_3"] },
  { key: "alt-4", label: "Alt 4", suffixAliases: ["alt-4", "alt_4", "alternate-4", "alternate_art_4"] },
  { key: "alt-5", label: "Alt 5", suffixAliases: ["alt-5", "alt_5", "alternate-5", "alternate_art_5"] },
  { key: "alt-6", label: "Alt 6", suffixAliases: ["alt-6", "alt_6", "alternate-6", "alternate_art_6"] },
  { key: "future-1", label: "Future 1", suffixAliases: ["future-1", "future_1", "future_art_1"] },
  { key: "future-2", label: "Future 2", suffixAliases: ["future-2", "future_2", "future_art_2"] },
  { key: "future-3", label: "Future 3", suffixAliases: ["future-3", "future_3", "future_art_3"] },
  { key: "future-4", label: "Future 4", suffixAliases: ["future-4", "future_4", "future_art_4"] }
];

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

function getArtSuffixAliases(artKey: CardArtKey): string[] {
  return CARD_ART_OPTIONS.find(option => option.key === artKey)?.suffixAliases ?? [artKey];
}

function getArtStems(stem: string, artKey: CardArtKey): string[] {
  return getArtSuffixAliases(artKey).map(suffix => suffix ? `${stem}__${suffix}` : stem);
}

function getStemAliases(card: CardLibraryCardSummary): string[] {
  const aliases: string[] = [card.id];
  const idParts = card.id.split("_");

  if (idParts.length > 3) {
    aliases.push(`${idParts[0]}_${idParts[1]}_${idParts.slice(2).join(" ")}`);
  }

  if (card.generation && card.cardNumber && card.name) {
    const prefix = `gen${card.generation}_${card.cardNumber}`;
    const slugName = normalizeFileNamePart(card.name);
    const spacedName = normalizeSpacedFileNamePart(card.name);

    aliases.push(`${prefix}_${slugName}`);
    aliases.push(`${prefix}_${spacedName}`);
    aliases.push(`${prefix} ${slugName}`);
    aliases.push(`${prefix} ${spacedName}`);
  }

  return uniqueValues(aliases);
}

export function getImageCandidates(card: CardLibraryCardSummary, artKey: CardArtKey): ImageCandidate[] {
  const stems = getStemAliases(card).flatMap(stem => getArtStems(stem, artKey));

  return uniqueValues(stems).flatMap(stem =>
    IMAGE_EXTENSIONS.map(extension => {
      const fileName = `${stem}.${extension}`;

      return {
        fileName,
        url: `/card-images/${encodeURIComponent(fileName)}`
      };
    })
  );
}

export function getCardArtLabel(artKey: CardArtKey): string {
  return CARD_ART_OPTIONS.find(option => option.key === artKey)?.label ?? "Default";
}

export function CardImageThumbnail({ card, className }: CardImageThumbnailProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const imageCandidates = useMemo(() => getImageCandidates(card, "default"), [card]);
  const imageCandidate = imageCandidates[candidateIndex];

  useEffect(() => {
    setCandidateIndex(0);
  }, [card.id]);

  if (!imageCandidate) {
    return (
      <span className={className ? `card-image-thumb missing ${className}` : "card-image-thumb missing"} aria-hidden="true">
        {card.name.slice(0, 1)}
      </span>
    );
  }

  return (
    <span className={className ? `card-image-thumb ${className}` : "card-image-thumb"} aria-hidden="true">
      <img
        src={imageCandidate.url}
        alt=""
        loading="lazy"
        onError={() => setCandidateIndex(current => current + 1)}
      />
    </span>
  );
}

export function CardImagePreview({ card, selectedArtKey, onSelectedArtKeyChange }: CardImagePreviewProps) {
  const [internalSelectedArtKey, setInternalSelectedArtKey] = useState<CardArtKey>("default");
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  const activeArtKey = selectedArtKey ?? internalSelectedArtKey;

  const imageCandidates = useMemo(
    () => getImageCandidates(card, activeArtKey),
    [card, activeArtKey]
  );

  useEffect(() => {
    setCandidateIndex(0);
    setPreviewOpen(false);
  }, [card.id, activeArtKey]);

  function handleArtChange(nextArtKey: CardArtKey) {
    if (onSelectedArtKeyChange) {
      onSelectedArtKeyChange(nextArtKey);
      return;
    }

    setInternalSelectedArtKey(nextArtKey);
  }

  const imageCandidate = imageCandidates[candidateIndex];
  const primaryExpectedFileName = imageCandidates[0]?.fileName ?? `${card.id}.webp`;
  const selectedArtLabel = getCardArtLabel(activeArtKey);

  return (
    <div className="card-image-preview-shell">
      <div className="card-image-frame">
        {imageCandidate ? (
          <button
            className="card-image-button"
            onClick={() => setPreviewOpen(true)}
            title={`Expand ${card.name} image`}
          >
            <img
              src={imageCandidate.url}
              alt={`${card.name} ${selectedArtLabel} card art`}
              onError={() => setCandidateIndex(current => current + 1)}
            />
          </button>
        ) : (
          <div className="card-image-placeholder">
            <strong>No image</strong>
            <span>{primaryExpectedFileName}</span>
            <span>This art variant can still be tracked as owned.</span>
          </div>
        )}
      </div>

      <label className="card-art-select-label">
        Art
        <select
          value={activeArtKey}
          onChange={event => handleArtChange(event.target.value as CardArtKey)}
        >
          {CARD_ART_OPTIONS.map(option => (
            <option value={option.key} key={option.key}>{option.label}</option>
          ))}
        </select>
      </label>

      {previewOpen && imageCandidate && (
        <ModalPanel title={`${card.name}  -  ${selectedArtLabel}`} onClose={() => setPreviewOpen(false)}>
          <div className="expanded-card-image-wrap">
            <img src={imageCandidate.url} alt={`${card.name} expanded ${selectedArtLabel} card`} />
          </div>
        </ModalPanel>
      )}
    </div>
  );
}

