import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CardLibraryCardSummary } from "../clientTypes";
import { filterCardImageCandidates, useCardImageManifest } from "../cardImageManifest";
import type { CardImageCandidate } from "../cardImageManifest";
import { buildCardImageUrl, getCardImageGenerationDirectory } from "../cardImagePaths";
import {
  DEFAULT_IMAGE_SOURCE_CONTROLS,
  loadImageSourceControls,
  subscribeImageSourceControls
} from "../imageSourceControls";
import { buildRailwayObjectKeyFromFileName, fetchSignedRailwayImageUrls } from "../railwayImageSigning";
import { getGithubCdnCandidates } from "../cardImageRemoteCandidates";
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
  hideInlineControls?: boolean;
  onSelectedArtKeyChange?: (artKey: CardArtKey) => void;
  expandedActions?: ReactNode;
};

type CardImageThumbnailProps = {
  card: CardLibraryCardSummary;
  className?: string;
  artKey?: CardArtKey;
  holoIntensity?: number;
};

type ExpandedCardImageProps = {
  card: CardLibraryCardSummary;
  activeArtKey: CardArtKey;
  selectedArtLabel: string;
  holoSeed: string;
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
  const stats = [magicType, card.magicSubType ?? "NONE"];

  if (card.attackDice !== undefined) {
    stats.push(`ATK ${card.attackDice}D6`);
  }

  if (card.modifier !== undefined) {
    stats.push(`MOD ${card.modifier >= 0 ? "+" : ""}${card.modifier}`);
  }

  return stats.join(" | ");
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

export function cardSupportsZeroArt(card: Pick<CardLibraryCardSummary, "hasZeroArtVariant">): boolean {
  return card.hasZeroArtVariant === true;
}

export function coerceCardArtKeyForCard(card: Pick<CardLibraryCardSummary, "hasZeroArtVariant">, artKey: CardArtKey): CardArtKey {
  if (cardSupportsZeroArt(card) || getBaseArtKey(artKey) !== "zero-art") {
    return artKey;
  }

  return isHoloArtKey(artKey) ? "holo" : "default";
}

export function getBaseArtOptionsForCard(card: Pick<CardLibraryCardSummary, "hasZeroArtVariant">): CardArtOption[] {
  return ACTIVE_CARD_ART_OPTIONS.filter(option =>
    option.key === "default" || (option.key === "zero-art" && cardSupportsZeroArt(card))
  );
}

export function normalizeCardArtKey(value: string | undefined): CardArtKey {
  switch (value?.trim()) {
    case "holo":
    case "HOLO":
      return "holo";
    case "zero-art":
    case "ZERO":
      return "zero-art";
    case "zero-art-holo":
    case "ZERO_HOLO":
      return "zero-art-holo";
    default:
      return "default";
  }
}

export function getBaseArtKey(artKey: CardArtKey): "default" | "zero-art" {
  return artKey === "zero-art" || artKey === "zero-art-holo" ? "zero-art" : "default";
}

export function isHoloArtKey(artKey: CardArtKey): boolean {
  return artKey === "holo" || artKey === "zero-art-holo";
}

export function composeArtKey(baseArtKey: "default" | "zero-art", holoEnabled: boolean): CardArtKey {
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

function normalizeHyphenFileNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    const hyphenName = normalizeHyphenFileNamePart(card.name);
    const trimmedCardNumber = card.cardNumber.replace(/^0+/, "") || card.cardNumber;
    const editionSlug = normalizeHyphenFileNamePart(card.edition ?? "");

    aliases.push(`${prefix}_${slugName}`);
    aliases.push(`${prefix}_${spacedName}`);
    aliases.push(`${prefix} ${slugName}`);
    aliases.push(`${prefix} ${spacedName}`);

    // Support current source-file-style naming:
    // - hyphen-separated stems (e.g., 001-blue-dragon.webp)
    // - no generation prefix
    aliases.push(`${card.cardNumber}-${hyphenName}`);
    aliases.push(`${trimmedCardNumber}-${hyphenName}`);
    aliases.push(hyphenName);

    // Support edition-specific variants when card art differs between editions.
    if (editionSlug) {
      aliases.push(`${editionSlug}-${card.cardNumber}-${hyphenName}`);
      aliases.push(`${editionSlug}-${trimmedCardNumber}-${hyphenName}`);
      aliases.push(`${editionSlug}-${hyphenName}`);
    }
  }

  return uniqueValues(aliases);
}

function getCardImageFilePaths(card: CardLibraryCardSummary, fileName: string): string[] {
  const generationDirectory = getCardImageGenerationDirectory(card.generation);

  return uniqueValues([
    fileName,
    generationDirectory ? `${generationDirectory}/${fileName}` : ""
  ]);
}

function uniqueCardImageCandidates(candidates: CardImageCandidate[]): CardImageCandidate[] {
  const seenUrls = new Set<string>();
  return candidates.filter(candidate => {
    if (seenUrls.has(candidate.url)) return false;
    seenUrls.add(candidate.url);
    return true;
  });
}

function isRemoteImageCandidate(candidate: CardImageCandidate): boolean {
  return /^https?:\/\//i.test(candidate.url);
}

function getRemoteImageCandidates(card: CardLibraryCardSummary): CardImageCandidate[] {
  const primaryUrl = card.image?.remotePrimaryUrl?.trim();
  const primaryCandidates = primaryUrl
    ? [{ fileName: `remote:${card.id}:primary`, url: primaryUrl }]
    : [];
  const remoteCandidates = (card.image?.remoteCandidates ?? [])
    .map((candidate, index) => {
      const url = candidate.url?.trim();
      if (!url) return null;

      return {
        fileName: candidate.fileName?.trim() || `remote:${card.id}:${index}`,
        url
      };
    })
    .filter((candidate): candidate is CardImageCandidate => candidate !== null);

  return uniqueCardImageCandidates([...primaryCandidates, ...remoteCandidates]);
}

export function getImageCandidates(card: CardLibraryCardSummary, artKey: CardArtKey): CardImageCandidate[] {
  const stems = getStemAliases(card).flatMap(stem => getArtStems(stem, artKey));

  return uniqueValues(stems).flatMap(stem =>
    IMAGE_EXTENSIONS.flatMap(extension => {
      const fileName = `${stem}.${extension}`;

      return getCardImageFilePaths(card, fileName).map(filePath => ({
        fileName: filePath,
        url: buildCardImageUrl(filePath)
      }));
    })
  );
}

export function useTargetedCardImageCandidates(card: CardLibraryCardSummary, artKey: CardArtKey): CardImageCandidate[] {
  const manifest = useCardImageManifest();
  const candidates = useMemo(() => {
    const remote = getRemoteImageCandidates(card);
    const local = getImageCandidates(card, artKey);
    return [...remote, ...local];
  }, [card, artKey]);

  return useMemo(() => filterCardImageCandidates(candidates, manifest), [candidates, manifest]);
}

function useCardLibraryImageControls() {
  const [controls, setControls] = useState(() => loadImageSourceControls().cardLibrary);

  useEffect(() => {
    const refresh = () => setControls(loadImageSourceControls().cardLibrary);
    return subscribeImageSourceControls(refresh);
  }, []);

  return controls ?? DEFAULT_IMAGE_SOURCE_CONTROLS.cardLibrary;
}

function useExpandedImageControls() {
  const [controls, setControls] = useState(() => loadImageSourceControls().expandedView);

  useEffect(() => {
    const refresh = () => setControls(loadImageSourceControls().expandedView);
    return subscribeImageSourceControls(refresh);
  }, []);

  return controls ?? DEFAULT_IMAGE_SOURCE_CONTROLS.expandedView;
}

function selectCandidatesByPriority(
  candidates: CardImageCandidate[],
  controls: { priority: string[] },
  railwayCandidates: CardImageCandidate[]
): CardImageCandidate[] {
  const remoteCandidates = candidates.filter(isRemoteImageCandidate);
  const localCandidates = candidates.filter(candidate => !isRemoteImageCandidate(candidate));
  const githubCdnCandidates = getGithubCdnCandidates(localCandidates);
  const signedRailwayCandidates = railwayCandidates;
  const candidatesBySource: Record<string, CardImageCandidate[]> = {
    excelRemote: remoteCandidates,
    githubCdn: githubCdnCandidates,
    railwayBucket: signedRailwayCandidates,
    localBundled: localCandidates
  };

  const orderedCandidates = controls.priority.flatMap(source => candidatesBySource[source] ?? []);
  return uniqueCardImageCandidates(orderedCandidates);
}

function useRailwaySignedCandidates(baseCandidates: CardImageCandidate[]): CardImageCandidate[] {
  const [signedCandidates, setSignedCandidates] = useState<CardImageCandidate[]>([]);

  useEffect(() => {
    let active = true;
    const localCandidates = baseCandidates.filter(candidate => !isRemoteImageCandidate(candidate));
    const keys = localCandidates.map(candidate => buildRailwayObjectKeyFromFileName(candidate.fileName));
    void fetchSignedRailwayImageUrls(keys).then(signedByKey => {
      if (!active) return;
      const signed = localCandidates
        .map(candidate => {
          const key = buildRailwayObjectKeyFromFileName(candidate.fileName);
          const signedItem = signedByKey.get(key);
          return signedItem
            ? { fileName: candidate.fileName, url: signedItem.url }
            : null;
        })
        .filter((item): item is CardImageCandidate => item !== null);
      setSignedCandidates(signed);
    });
    return () => {
      active = false;
    };
  }, [baseCandidates]);

  return signedCandidates;
}

export function getCardArtLabel(artKey: CardArtKey): string {
  return CARD_ART_OPTIONS.find(option => option.key === artKey)?.label ?? "Default";
}

function ExpandedCardImage({
  card,
  activeArtKey,
  selectedArtLabel,
  holoSeed,
  holoIntensity,
  onArtChange
}: ExpandedCardImageProps) {
  const [expandedCandidateIndex, setExpandedCandidateIndex] = useState(0);
  const expandedControls = useExpandedImageControls();
  const effectiveActiveArtKey = coerceCardArtKeyForCard(card, activeArtKey);
  const imageArtKey = getBaseArtKey(effectiveActiveArtKey);
  const baseImageCandidates = useTargetedCardImageCandidates(card, imageArtKey);
  const railwayCandidates = useRailwaySignedCandidates(baseImageCandidates);
  const imageCandidates = useMemo(
    () => selectCandidatesByPriority(baseImageCandidates, expandedControls, railwayCandidates),
    [baseImageCandidates, expandedControls, railwayCandidates]
  );
  const displayImageSrc = imageCandidates[expandedCandidateIndex]?.url;

  useEffect(() => {
    setExpandedCandidateIndex(0);
  }, [card.id, imageArtKey, imageCandidates[0]?.url]);

  return (
    <div className="expanded-card-image-wrap">
      {displayImageSrc ? (
        <HolographicCardImage
          key={`${card.id}:${effectiveActiveArtKey}:${displayImageSrc}:expanded`}
          src={displayImageSrc}
          alt={`${card.name} expanded ${selectedArtLabel} card`}
          seed={holoSeed}
          enabled={isHoloArtKey(effectiveActiveArtKey)}
          intensity={holoIntensity}
          className="expanded-card-holo-image"
          onError={() => {
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

      <div className="expanded-card-art-controls" aria-label="Expanded card art controls">
        <label className="card-art-select-label expanded-card-art-select-label">
          Art / Card Type
          <select
            value={getBaseArtKey(effectiveActiveArtKey)}
            onChange={event => onArtChange(composeArtKey(event.target.value as "default" | "zero-art", isHoloArtKey(effectiveActiveArtKey)))}
          >
            {getBaseArtOptionsForCard(card).map(option => (
              <option value={option.key} key={option.key}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="expanded-card-holo-toggle">
          <input
            type="checkbox"
            checked={isHoloArtKey(effectiveActiveArtKey)}
            onChange={event => onArtChange(composeArtKey(getBaseArtKey(effectiveActiveArtKey), event.target.checked))}
          />
          <span>Holo Finish</span>
        </label>
      </div>
      <small className="card-art-select-label expanded-card-art-select-label">Variant: {getCardArtLabel(activeArtKey)}</small>
    </div>
  );
}

export function CardImageThumbnail({ card, className, artKey = "default", holoIntensity = 0.55 }: CardImageThumbnailProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const cardLibraryControls = useCardLibraryImageControls();
  const effectiveArtKey = coerceCardArtKeyForCard(card, artKey);
  const imageArtKey = getBaseArtKey(effectiveArtKey);
  const holoEnabled = isHoloArtKey(effectiveArtKey);
  const baseImageCandidates = useTargetedCardImageCandidates(card, imageArtKey);
  const railwayCandidates = useRailwaySignedCandidates(baseImageCandidates);
  const imageCandidates = useMemo(
    () => selectCandidatesByPriority(baseImageCandidates, cardLibraryControls, railwayCandidates),
    [baseImageCandidates, cardLibraryControls, railwayCandidates]
  );
  const displayImageSrc = imageCandidates[candidateIndex]?.url;

  useEffect(() => {
    setCandidateIndex(0);
  }, [card.id, imageArtKey, imageCandidates[0]?.url]);

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
        key={`${card.id}:${effectiveArtKey}:${displayImageSrc}:thumb`}
        src={displayImageSrc}
        alt=""
        seed={`thumbnail:${card.packId}:${card.id}:${artKey}`}
        enabled={holoEnabled}
        intensity={holoIntensity}
        onError={() => {
          setCandidateIndex(current => current + 1);
        }}
      />
    </span>
  );
}

export function CardImagePreview({ card, selectedArtKey, holoIntensity = 0.55, hideInlineControls = false, onSelectedArtKeyChange, expandedActions }: CardImagePreviewProps) {
  const [internalSelectedArtKey, setInternalSelectedArtKey] = useState<CardArtKey>("default");
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  const requestedArtKey = selectedArtKey ?? internalSelectedArtKey;
  const activeArtKey = coerceCardArtKeyForCard(card, requestedArtKey);
  const imageArtKey = getBaseArtKey(activeArtKey);
  const holoEnabled = isHoloArtKey(activeArtKey);
  const baseArtKey = getBaseArtKey(activeArtKey);
  const holoSeed = `${card.packId}:${card.id}:${card.name}`;
  const expandedControls = useExpandedImageControls();

  const baseImageCandidates = useTargetedCardImageCandidates(card, imageArtKey);
  const railwayCandidates = useRailwaySignedCandidates(baseImageCandidates);
  const imageCandidates = useMemo(
    () => selectCandidatesByPriority(baseImageCandidates, expandedControls, railwayCandidates),
    [baseImageCandidates, expandedControls, railwayCandidates]
  );

  useEffect(() => {
    setCandidateIndex(0);
  }, [card.id, imageArtKey, imageCandidates[0]?.url]);

  useEffect(() => {
    if (requestedArtKey === activeArtKey) return;

    if (onSelectedArtKeyChange) {
      onSelectedArtKeyChange(activeArtKey);
      return;
    }

    setInternalSelectedArtKey(activeArtKey);
  }, [activeArtKey, onSelectedArtKeyChange, requestedArtKey]);

  useEffect(() => {
    setPreviewOpen(false);
  }, [card.id]);

  function handleArtChange(nextArtKey: CardArtKey) {
    const allowedArtKey = coerceCardArtKeyForCard(card, nextArtKey);
    setCandidateIndex(0);

    if (onSelectedArtKeyChange) {
      onSelectedArtKeyChange(allowedArtKey);
      return;
    }

    setInternalSelectedArtKey(allowedArtKey);
  }

  const displayImageSrc = imageCandidates[candidateIndex]?.url;
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

      {!hideInlineControls ? (
        <>
          <label className="card-art-select-label">
            Art / Card Type
            <select
              value={baseArtKey}
              onChange={event => handleArtChange(composeArtKey(event.target.value as "default" | "zero-art", holoEnabled))}
            >
              {getBaseArtOptionsForCard(card).map(option => (
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
        </>
      ) : null}

      {previewOpen && displayImageSrc && (
        <ModalPanel title={`${card.name}  -  ${selectedArtLabel}`} onClose={() => setPreviewOpen(false)}>
          <div className="expanded-card-detail-layout">
            <ExpandedCardImage
              card={card}
              activeArtKey={activeArtKey}
              selectedArtLabel={selectedArtLabel}
              holoSeed={holoSeed}
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

              {expandedActions ? (
                <div className="expanded-card-actions-panel">
                  <span className="label">Card Actions</span>
                  <div className="expanded-card-actions-content">
                    {expandedActions}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </ModalPanel>
      )}
    </div>
  );
}
