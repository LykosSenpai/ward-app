import { useEffect, useMemo, useState } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import { useZeroCardSrc } from "../hooks/useZeroCardSrc";
import { HolographicCardImage } from "./HolographicCardImage";
import { ModalPanel } from "./ui/ModalPanel";

export type CardArtKey =
  | "default"
  | "holo"
  | "zero-art"
  | "zero-art-holo"
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
  holoIntensity?: number;
  onSelectedArtKeyChange?: (artKey: CardArtKey) => void;
};

type CardImageThumbnailProps = {
  card: CardLibraryCardSummary;
  className?: string;
  artKey?: CardArtKey;
  holoIntensity?: number;
};

type ImageCandidate = {
  fileName: string;
  url: string;
};

type ExpandedCardImageProps = {
  card: CardLibraryCardSummary;
  activeArtKey: CardArtKey;
  selectedArtLabel: string;
  holoSeed: string;
  holoEnabled: boolean;
  holoIntensity: number;
  onArtChange: (artKey: CardArtKey) => void;
};

function formatCardStats(card: CardLibraryCardSummary): string {
  if (card.cardType === "CREATURE") {
    return [
      card.creatureType ?? "Creature",
      `AL ${card.armorLevel ?? "?"}`,
      `SPD ${card.speed ?? "?"}`,
      `HP ${card.hp ?? "?"}`,
      `${card.attackDice ?? "?"}D6`,
      `MOD ${card.modifier ?? "?"}`
    ].join(" | ");
  }

  const magicType = card.magicType === "BATTLE_LIGHTNING" ? "LIGHTNING" : card.magicType ?? "MAGIC";
  return [magicType, card.magicSubType ?? "NONE"].join(" | ");
}

function formatCardIdentity(card: CardLibraryCardSummary): string {
  const generation = card.generation ? `Gen ${card.generation}` : card.packId;
  const number = card.cardNumber ? `#${card.cardNumber}` : card.id;
  return `${generation} ${number} | ${card.rarity ?? "Unknown"} | ${card.cardType}`;
}

export const CARD_ART_OPTIONS: CardArtOption[] = [
  { key: "default", label: "Default", suffixAliases: [""] },
  { key: "holo", label: "Holo", suffixAliases: ["holo", "foil", "holographic"] },
  { key: "zero-art", label: "Zero", suffixAliases: ["zero-art", "zero_art", "zeroart"] },
  { key: "zero-art-holo", label: "Zero Holo", suffixAliases: ["zero-art-holo", "zero_art_holo", "zero-holo"] },
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

export const ACTIVE_CARD_ART_OPTIONS = CARD_ART_OPTIONS.filter(option =>
  option.key === "default" || option.key === "holo" || option.key === "zero-art" || option.key === "zero-art-holo"
);

export function normalizeCardArtKey(value: string | undefined): CardArtKey {
  return value === "holo" || value === "zero-art" || value === "zero-art-holo" ? value : "default";
}

export function getBaseArtKey(artKey: CardArtKey): "default" | "zero-art" {
  return artKey === "zero-art" || artKey === "zero-art-holo" ? "zero-art" : "default";
}

export function isHoloArtKey(artKey: CardArtKey): boolean {
  return artKey === "holo" || artKey === "zero-art-holo";
}

function composeArtKey(baseArtKey: "default" | "zero-art", holoEnabled: boolean): CardArtKey {
  if (baseArtKey === "zero-art") {
    return holoEnabled ? "zero-art-holo" : "zero-art";
  }
  return holoEnabled ? "holo" : "default";
}

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

function ExpandedCardImage({
  card,
  activeArtKey,
  selectedArtLabel,
  holoSeed,
  holoEnabled,
  holoIntensity,
  onArtChange
}: ExpandedCardImageProps) {
  const [expandedCandidateIndex, setExpandedCandidateIndex] = useState(0);
  const [expandedZeroFallbackCandidateIndex, setExpandedZeroFallbackCandidateIndex] = useState(0);
  const imageArtKey = getBaseArtKey(activeArtKey);
  const imageCandidates = useMemo(
    () => getImageCandidates(card, imageArtKey),
    [card, imageArtKey]
  );
  const imageCandidate = imageCandidates[expandedCandidateIndex];
  const defaultImageCandidates = useMemo(() => getImageCandidates(card, "default"), [card]);
  const defaultImageCandidate = defaultImageCandidates[expandedZeroFallbackCandidateIndex];
  const selectedImageSrc = imageCandidate?.url;
  const regularImageSrc = defaultImageCandidate?.url;
  const shouldGenerateZero = imageArtKey === "zero-art" && !selectedImageSrc && Boolean(regularImageSrc);
  const generatedZeroSrc = useZeroCardSrc(regularImageSrc, shouldGenerateZero);
  const displayImageSrc = shouldGenerateZero ? generatedZeroSrc : selectedImageSrc;

  useEffect(() => {
    setExpandedCandidateIndex(0);
    setExpandedZeroFallbackCandidateIndex(0);
  }, [card.id, imageArtKey]);

  return (
    <div className="expanded-card-image-wrap">
      {displayImageSrc ? (
        <HolographicCardImage
          key={`${card.id}:${activeArtKey}:${displayImageSrc}:expanded`}
          src={displayImageSrc}
          alt={`${card.name} expanded ${selectedArtLabel} card`}
          seed={holoSeed}
          enabled={holoEnabled}
          intensity={holoIntensity}
          className="expanded-card-holo-image"
          onError={() => {
            if (shouldGenerateZero) {
              setExpandedZeroFallbackCandidateIndex(current => current + 1);
              return;
            }

            setExpandedCandidateIndex(current => current + 1);
          }}
        />
      ) : (
        <div className="card-image-placeholder">
          <strong>No image</strong>
          <span>{imageCandidates[0]?.fileName ?? `${card.id}.webp`}</span>
          <span>This art variant can still be tracked as owned.</span>
        </div>
      )}

      <label className="card-art-select-label expanded-card-art-select-label">
        Art / Card Type
        <select
          value={getBaseArtKey(activeArtKey)}
          onChange={event => onArtChange(composeArtKey(event.target.value as "default" | "zero-art", isHoloArtKey(activeArtKey)))}
        >
          {ACTIVE_CARD_ART_OPTIONS.filter(option => option.key === "default" || option.key === "zero-art").map(option => (
            <option value={option.key} key={option.key}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="card-art-select-label expanded-card-art-select-label">
        <input
          type="checkbox"
          checked={isHoloArtKey(activeArtKey)}
          onChange={event => onArtChange(composeArtKey(getBaseArtKey(activeArtKey), event.target.checked))}
        />
        {" "}Holo Finish
      </label>
      <small className="card-art-select-label expanded-card-art-select-label">Variant: {getCardArtLabel(activeArtKey)}</small>
    </div>
  );
}

export function CardImageThumbnail({ card, className, artKey = "default", holoIntensity = 0.55 }: CardImageThumbnailProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [zeroFallbackCandidateIndex, setZeroFallbackCandidateIndex] = useState(0);
  const imageArtKey = getBaseArtKey(artKey);
  const holoEnabled = isHoloArtKey(artKey);
  const imageCandidates = useMemo(() => getImageCandidates(card, imageArtKey), [card, imageArtKey]);
  const defaultImageCandidates = useMemo(() => getImageCandidates(card, "default"), [card]);
  const imageCandidate = imageCandidates[candidateIndex];
  const defaultImageCandidate = defaultImageCandidates[zeroFallbackCandidateIndex];
  const selectedImageSrc = imageCandidate?.url;
  const regularImageSrc = defaultImageCandidate?.url;
  const shouldGenerateZero = imageArtKey === "zero-art" && !selectedImageSrc && Boolean(regularImageSrc);
  const generatedZeroSrc = useZeroCardSrc(regularImageSrc, shouldGenerateZero);
  const displayImageSrc = shouldGenerateZero ? generatedZeroSrc : selectedImageSrc;

  useEffect(() => {
    setCandidateIndex(0);
    setZeroFallbackCandidateIndex(0);
  }, [card.id, imageArtKey]);

  if (!displayImageSrc) {
    return (
      <span className={className ? `card-image-thumb missing ${className}` : "card-image-thumb missing"} aria-hidden="true">
        {card.name.slice(0, 1)}
      </span>
    );
  }

  return (
    <span className={className ? `card-image-thumb ${className}` : "card-image-thumb"} aria-hidden="true">
      <HolographicCardImage
        key={`${card.id}:${artKey}:${displayImageSrc}:thumb`}
        src={displayImageSrc}
        alt=""
        seed={`thumbnail:${card.packId}:${card.id}:${artKey}`}
        enabled={holoEnabled}
        intensity={holoIntensity}
        onError={() => {
          if (shouldGenerateZero) {
            setZeroFallbackCandidateIndex(current => current + 1);
            return;
          }

          setCandidateIndex(current => current + 1);
        }}
      />
    </span>
  );
}

export function CardImagePreview({ card, selectedArtKey, holoIntensity = 0.55, onSelectedArtKeyChange }: CardImagePreviewProps) {
  const [internalSelectedArtKey, setInternalSelectedArtKey] = useState<CardArtKey>("default");
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [zeroFallbackCandidateIndex, setZeroFallbackCandidateIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  const activeArtKey = selectedArtKey ?? internalSelectedArtKey;
  const imageArtKey = getBaseArtKey(activeArtKey);
  const holoEnabled = isHoloArtKey(activeArtKey);
  const baseArtKey = getBaseArtKey(activeArtKey);
  const holoSeed = `${card.packId}:${card.id}:${card.name}`;

  const imageCandidates = useMemo(
    () => getImageCandidates(card, imageArtKey),
    [card, imageArtKey]
  );
  const defaultImageCandidates = useMemo(() => getImageCandidates(card, "default"), [card]);

  useEffect(() => {
    setCandidateIndex(0);
    setZeroFallbackCandidateIndex(0);
  }, [card.id, imageArtKey]);

  useEffect(() => {
    setPreviewOpen(false);
  }, [card.id]);

  function handleArtChange(nextArtKey: CardArtKey) {
    setCandidateIndex(0);
    setZeroFallbackCandidateIndex(0);

    if (onSelectedArtKeyChange) {
      onSelectedArtKeyChange(nextArtKey);
      return;
    }

    setInternalSelectedArtKey(nextArtKey);
  }

  const imageCandidate = imageCandidates[candidateIndex];
  const defaultImageCandidate = defaultImageCandidates[zeroFallbackCandidateIndex];
  const selectedImageSrc = imageCandidate?.url;
  const regularImageSrc = defaultImageCandidate?.url;
  const shouldGenerateZero = baseArtKey === "zero-art" && !selectedImageSrc && Boolean(regularImageSrc);
  const generatedZeroSrc = useZeroCardSrc(regularImageSrc, shouldGenerateZero);
  const displayImageSrc = shouldGenerateZero ? generatedZeroSrc : selectedImageSrc;
  const primaryExpectedFileName = imageCandidates[0]?.fileName ?? `${card.id}.webp`;
  const selectedArtLabel = getCardArtLabel(activeArtKey);

  return (
    <div className="card-image-preview-shell">
      <div className="card-image-frame">
        {displayImageSrc ? (
          <button
            className="card-image-button"
            onClick={() => setPreviewOpen(true)}
            title={`Expand ${card.name} image`}
          >
            <HolographicCardImage
              key={`${card.id}:${activeArtKey}:${displayImageSrc}:thumbnail`}
              src={displayImageSrc}
              alt={`${card.name} ${selectedArtLabel} card art`}
              seed={holoSeed}
              enabled={holoEnabled}
              intensity={holoIntensity}
              onError={() => {
                if (shouldGenerateZero) {
                  setZeroFallbackCandidateIndex(current => current + 1);
                  return;
                }

                setCandidateIndex(current => current + 1);
              }}
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
        Art / Card Type
        <select
          value={baseArtKey}
          onChange={event => handleArtChange(composeArtKey(event.target.value as "default" | "zero-art", holoEnabled))}
        >
          {ACTIVE_CARD_ART_OPTIONS.filter(option => option.key === "default" || option.key === "zero-art").map(option => (
            <option value={option.key} key={option.key}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="card-art-select-label card-art-holo-label">
        <input
          type="checkbox"
          checked={holoEnabled}
          onChange={event => handleArtChange(composeArtKey(baseArtKey, event.target.checked))}
        />
        {" "}Holo Finish
      </label>
      <small className="card-art-select-label">Variant: {selectedArtLabel}</small>

      {previewOpen && displayImageSrc && (
        <ModalPanel title={`${card.name}  -  ${selectedArtLabel}`} onClose={() => setPreviewOpen(false)}>
          <div className="expanded-card-detail-layout">
            <ExpandedCardImage
              card={card}
              activeArtKey={activeArtKey}
              selectedArtLabel={selectedArtLabel}
              holoSeed={holoSeed}
              holoEnabled={holoEnabled}
              holoIntensity={holoIntensity}
              onArtChange={handleArtChange}
            />

            <div className="expanded-card-info">
              <div>
                <span className="label">Name</span>
                <strong>{card.name}</strong>
              </div>

              <div>
                <span className="label">ID</span>
                <span>{card.id}</span>
              </div>

              <div>
                <span className="label">Card</span>
                <span>{formatCardIdentity(card)}</span>
              </div>

              <div>
                <span className="label">Stats</span>
                <span>{formatCardStats(card)}</span>
              </div>

              <div>
                <span className="label">Skill Description</span>
                <p>{card.text?.trim() || "No rules text."}</p>
              </div>

              <div>
                <span className="label">Artwork Tags</span>
                {card.artworkTags && card.artworkTags.length > 0 ? (
                  <div className="expanded-card-tag-row">
                    {card.artworkTags.map(tag => <span key={tag}>{tag}</span>)}
                  </div>
                ) : (
                  <span>No artwork tags yet.</span>
                )}
              </div>

              <div>
                <span className="label">Skill Notes</span>
                <p>Detailed skill explanation can be added here once rules notes are authored.</p>
              </div>
            </div>
          </div>
        </ModalPanel>
      )}
    </div>
  );
}
