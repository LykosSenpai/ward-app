import { useEffect, useMemo, useState } from "react";
import type { WardEngineEffect } from "@ward/shared";
import type { CardLibraryCardSummary, CardPackSummary } from "../clientTypes";
import { buildWardEffectsFromText } from "../effectLogicBuilder";
import {
  EFFECT_BLOCK_PALETTE,
  EFFECT_BLOCK_STATUS_VALUES,
  applyEffectBlockTemplate,
  buildEffectBlockChain,
  clearEffectBlockStatusOverrides,
  clearEffectBlockChainLayout,
  formatLibraryBlockCoverageItemReport,
  formatLibraryBlockCoverageReport,
  getEffectBlockRuntimePreview,
  getEffectBlockStatusOverride,
  getEffectOverallBlockStatusOverride,
  setEffectBlockStatusOverride,
  setEffectBlockVisualOrder,
  removeEffectBlockFromEffect,
  setEffectOverallBlockStatusOverride,
  statusWeight,
  stringifyEffectBlocks,
  summarizeEffectBlockChains,
  summarizeLibraryBlockCoverage,
  writeEffectBlocksToEffects,
  type EffectBlockKind,
  type EffectBlockStatus,
  type EffectBlockTemplate,
  type LibraryBlockCoverageEffectItem
} from "../effectBlockModel";

type EffectDevToolPageProps = {
  cardPacks: CardPackSummary[];
  selectedPackIds: string[];
  cardLibrary: CardLibraryCardSummary[];
  focusedCardKey?: string;
  onSelectedCardKeyChange?: (cardKey: string) => void;
  onOpenSelectedInCoverage?: (cardKey: string) => void;
  onToggleSelectedPack: (packId: string) => void;
  onRefreshCardLibrary: () => void;
  onSaveCardEffects: (data: {
    packId: string;
    cardId: string;
    text: string;
    effects: WardEngineEffect[];
    metadata?: {
      rarity?: string;
      creatureType?: string;
      artworkEffect?: string;
      artworkTags?: string[];
    };
  }) => void;
  onCreateTestMatch: (data: {
    packIds: string[];
    player1CardIds: string[];
    player2CardIds: string[];
    player1StartingHandSize?: number;
    player2StartingHandSize?: number;
  }) => void;
};

type TestDeckOwner = "PLAYER_1" | "PLAYER_2";

type CardTypeFilter = "ALL" | "CREATURE" | "MAGIC";
type EditorTab = "RULES" | "JSON" | "BLOCKS" | "PREVIEW";
type BlockPaletteFilterKind = EffectBlockKind | "ALL";

type BlockDragState =
  | { type: "CHAIN_BLOCK"; effectId: string; blockId: string }
  | { type: "TEMPLATE"; templateId: string };

function getCardKey(card: CardLibraryCardSummary): string {
  return `${card.packId}:${card.id}`;
}

function formatCardLabel(card: CardLibraryCardSummary): string {
  const number = card.cardNumber ? `#${card.cardNumber}` : card.id;
  const generation = card.generation ? `Gen ${card.generation}` : card.packId;
  return `${generation} ${number}  -  ${card.name}`;
}

function getCardRulesSummary(card: CardLibraryCardSummary): string {
  if (card.cardType === "CREATURE") {
    return `${card.creatureType ?? "Creature"}  -  AL ${card.armorLevel ?? "?"}  -  SPD ${card.speed ?? "?"}  -  HP ${card.hp ?? "?"}  -  ${card.attackDice ?? "?"}D6  -  MOD ${card.modifier ?? "?"}`;
  }

  return `${card.magicType ?? "Magic"}  -  ${card.magicSubType ?? "NONE"}`;
}

function normalizeEffectJsonInput(value: string): string {
  let next = value.trim().replace(/^\uFEFF/, "");

  // Common accidental paste: ,{"id": ...}
  next = next.replace(/^,+\s*/, "");

  // Allow a single effect object to be pasted instead of an array.
  if (next.startsWith("{")) {
    next = `[${next}]`;
  }

  // Remove trailing commas before } or ].
  next = next.replace(/,\s*([}\]])/g, "$1");

  return next;
}
function parseEffectJson(value: string): WardEngineEffect[] {
  const parsed = JSON.parse(normalizeEffectJsonInput(value)) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Effect JSON must be an array.");
  }

  for (const [index, effect] of parsed.entries()) {
    if (!effect || typeof effect !== "object") {
      throw new Error(`Effect ${index + 1} must be an object.`);
    }

    const typedEffect = effect as Partial<WardEngineEffect>;

    if (!typedEffect.id || typeof typedEffect.id !== "string") {
      throw new Error(`Effect ${index + 1} is missing a string id.`);
    }

    if (!typedEffect.actionType || typeof typedEffect.actionType !== "string") {
      throw new Error(`Effect ${index + 1} is missing a string actionType.`);
    }
  }

  return parsed as WardEngineEffect[];
}

function blockStatusLabel(status: EffectBlockStatus): string {
  switch (status) {
    case "READY": return "Ready";
    case "PARTIAL": return "Partial";
    case "MISSING": return "Missing";
    case "REVIEW": return "Review";
  }
}

function blockStatusClass(status: EffectBlockStatus): string {
  return `effect-block-status ${status.toLowerCase()}`;
}

function getSearchText(card: CardLibraryCardSummary): string {
  return [
    card.id,
    card.name,
    card.cardNumber,
    card.generation,
    card.edition,
    card.rarity,
    card.cardType,
    card.creatureType,
    card.magicType,
    card.magicSubType,
    card.text,
    ...(card.effectTypes ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function summarizeDeck(cardIds: string[], cardLibrary: CardLibraryCardSummary[]): Array<{
  cardId: string;
  count: number;
  card?: CardLibraryCardSummary;
}> {
  const counts = cardIds.reduce<Record<string, number>>((result, cardId) => {
    result[cardId] = (result[cardId] ?? 0) + 1;
    return result;
  }, {});

  return Object.entries(counts)
    .map(([cardId, count]) => ({
      cardId,
      count,
      card: cardLibrary.find(card => card.id === cardId)
    }))
    .sort((a, b) => (a.card?.name ?? a.cardId).localeCompare(b.card?.name ?? b.cardId));
}

function ensureCreatureFirst(cardIds: string[], cardLibrary: CardLibraryCardSummary[]): string[] {
  const creatureIndex = cardIds.findIndex(cardId => {
    const card = cardLibrary.find(item => item.id === cardId);
    return card?.cardType === "CREATURE";
  });

  if (creatureIndex <= 0) {
    return cardIds;
  }

  const next = [...cardIds];
  const [creatureCardId] = next.splice(creatureIndex, 1);
  return [creatureCardId, ...next];
}


function getEffectById(effects: WardEngineEffect[], effectId: string): WardEngineEffect | undefined {
  return effects.find(effect => effect.id === effectId) ?? effects[0];
}

function getEffectSupportOverrideLabel(effect: WardEngineEffect): string {
  const override = getEffectOverallBlockStatusOverride(effect);
  return override ? blockStatusLabel(override) : "Auto";
}

function getTemplateButtonClass(template: EffectBlockTemplate): string {
  return `effect-block-template-button ${template.kind.toLowerCase()}`;
}

function parseArtworkTagsInput(value: string): string[] {
  return value
    .split(/[\n,;]+/g)
    .map(tag => tag.trim().toUpperCase().replace(/[\s-]+/g, "_"))
    .filter(Boolean);
}

function formatArtworkTagsInput(tags: string[] | undefined): string {
  return Array.isArray(tags) ? tags.join(", ") : "";
}
function getNextEffectId(effects: WardEngineEffect[], baseEffectId: string): string {
  const prefixMatch = baseEffectId.match(/^(.*?-E)(\d+)$/);
  const prefix = prefixMatch?.[1] ?? `${baseEffectId}-S`;
  const existing = new Set(effects.map(effect => effect.id));

  for (let index = 1; index < 100; index++) {
    const candidate = `${prefix}${String(index).padStart(2, "0")}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${baseEffectId}-S${Date.now()}`;
}

export function EffectDevToolPage({
  cardPacks,
  selectedPackIds,
  cardLibrary,
  focusedCardKey = "",
  onSelectedCardKeyChange,
  onOpenSelectedInCoverage,
  onToggleSelectedPack,
  onRefreshCardLibrary,
  onSaveCardEffects,
  onCreateTestMatch
}: EffectDevToolPageProps) {
  const [selectedCardKey, setSelectedCardKey] = useState("");
  const [searchText, setSearchText] = useState("");
  const [cardTypeFilter, setCardTypeFilter] = useState<CardTypeFilter>("ALL");
  const [effectText, setEffectText] = useState("");
  const [effectJson, setEffectJson] = useState("[]");
  const [builderMessage, setBuilderMessage] = useState("");
  const [builderWarnings, setBuilderWarnings] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState("");
  const [player1CardIds, setPlayer1CardIds] = useState<string[]>([]);
  const [player2CardIds, setPlayer2CardIds] = useState<string[]>([]);
  const [player1StartingHandSize, setPlayer1StartingHandSize] = useState(0);
  const [player2StartingHandSize, setPlayer2StartingHandSize] = useState(0);
  const [activeEditorTab, setActiveEditorTab] = useState<EditorTab>("RULES");
  const [selectedBlockEffectId, setSelectedBlockEffectId] = useState("");
  const [pendingBlockEffectId, setPendingBlockEffectId] = useState("");
  const [blockPaletteFilterKind, setBlockPaletteFilterKind] = useState<BlockPaletteFilterKind>("ALL");
  const [blockDragState, setBlockDragState] = useState<BlockDragState | null>(null);
  const [reviewRailExpanded, setReviewRailExpanded] = useState(true);
  const [metadataRarity, setMetadataRarity] = useState("");
  const [metadataCreatureType, setMetadataCreatureType] = useState("");
  const [metadataArtworkEffect, setMetadataArtworkEffect] = useState("");
  const [metadataArtworkTagsText, setMetadataArtworkTagsText] = useState("");

  const sortedCards = useMemo(() => {
    return [...cardLibrary].sort((a, b) => {
      const generationSort = `${a.generation ?? ""}`.localeCompare(`${b.generation ?? ""}`, undefined, { numeric: true });
      if (generationSort !== 0) return generationSort;

      const numberSort = `${a.cardNumber ?? ""}`.localeCompare(`${b.cardNumber ?? ""}`, undefined, { numeric: true });
      if (numberSort !== 0) return numberSort;

      return a.name.localeCompare(b.name);
    });
  }, [cardLibrary]);

  const filteredCards = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return sortedCards.filter(card => {
      if (cardTypeFilter !== "ALL" && card.cardType !== cardTypeFilter) return false;
      if (normalizedSearch && !getSearchText(card).includes(normalizedSearch)) return false;
      return true;
    });
  }, [cardTypeFilter, searchText, sortedCards]);

  const selectedCard = useMemo(() => {
    return sortedCards.find(card => getCardKey(card) === selectedCardKey);
  }, [selectedCardKey, sortedCards]);

  useEffect(() => {
    if (!focusedCardKey) return;
    if (!sortedCards.some(card => getCardKey(card) === focusedCardKey)) return;

    setSelectedCardKey(current => current === focusedCardKey ? current : focusedCardKey);

    // Treat focusedCardKey as a one-time navigation command from Coverage -> Dev Tool.
    // Do not keep mirroring local card picker selections back into this prop, because that
    // creates a feedback loop where the editor can show one card while the text/JSON state
    // is reloaded from a previously focused card.
    onSelectedCardKeyChange?.("");
  }, [focusedCardKey, onSelectedCardKeyChange, sortedCards]);

  const parsedEffects = useMemo(() => {
    try {
      return parseEffectJson(effectJson);
    } catch {
      return [];
    }
  }, [effectJson]);

  const selectedBlockChains = useMemo(() => {
    return parsedEffects.map(effect => buildEffectBlockChain(effect));
  }, [parsedEffects]);

  const selectedBlockEffect = useMemo(() => {
    return getEffectById(parsedEffects, selectedBlockEffectId);
  }, [parsedEffects, selectedBlockEffectId]);

  const filteredBlockTemplates = useMemo(() => {
    return EFFECT_BLOCK_PALETTE.filter(template => blockPaletteFilterKind === "ALL" || template.kind === blockPaletteFilterKind);
  }, [blockPaletteFilterKind]);

  const selectedBlockSummary = useMemo(() => {
    return summarizeEffectBlockChains(selectedBlockChains);
  }, [selectedBlockChains]);


  useEffect(() => {
    if (pendingBlockEffectId) return;

    if (parsedEffects.length === 0) {
      setSelectedBlockEffectId("");
      return;
    }

    if (!parsedEffects.some(effect => effect.id === selectedBlockEffectId)) {
      setSelectedBlockEffectId(parsedEffects[0]?.id ?? "");
    }
  }, [parsedEffects, pendingBlockEffectId, selectedBlockEffectId]);

  useEffect(() => {
    if (!pendingBlockEffectId) return;
    if (!parsedEffects.some(effect => effect.id === pendingBlockEffectId)) return;

    setSelectedBlockEffectId(pendingBlockEffectId);
    setPendingBlockEffectId("");
  }, [parsedEffects, pendingBlockEffectId]);

  const libraryBlockCoverage = useMemo(() => {
    return summarizeLibraryBlockCoverage(cardLibrary);
  }, [cardLibrary]);

  const reviewQueueItems = libraryBlockCoverage.missingActionTypes;
  const reviewQueueEffectCount = reviewQueueItems.reduce((total, item) => total + item.effects.length, 0);

  useEffect(() => {
    if (reviewQueueEffectCount > 0) {
      setReviewRailExpanded(true);
    }
  }, [reviewQueueEffectCount]);

  const player1Summary = useMemo(
    () => summarizeDeck(player1CardIds, cardLibrary),
    [cardLibrary, player1CardIds]
  );

  const player2Summary = useMemo(
    () => summarizeDeck(player2CardIds, cardLibrary),
    [cardLibrary, player2CardIds]
  );

  const player1CreatureCount = player1CardIds.filter(cardId => {
    const card = cardLibrary.find(item => item.id === cardId);
    return card?.cardType === "CREATURE";
  }).length;

  const player2CreatureCount = player2CardIds.filter(cardId => {
    const card = cardLibrary.find(item => item.id === cardId);
    return card?.cardType === "CREATURE";
  }).length;

  useEffect(() => {
    if (sortedCards.length === 0) {
      setSelectedCardKey("");
      return;
    }

    if (focusedCardKey && sortedCards.some(card => getCardKey(card) === focusedCardKey)) {
      setSelectedCardKey(focusedCardKey);
      return;
    }

    if (!selectedCardKey || !sortedCards.some(card => getCardKey(card) === selectedCardKey)) {
      setSelectedCardKey(getCardKey(sortedCards[0]));
    }
  }, [focusedCardKey, selectedCardKey, sortedCards]);

  useEffect(() => {
    if (!selectedCard) {
      setEffectText("");
      setEffectJson("[]");
      setBuilderMessage("");
      setBuilderWarnings([]);
      setJsonError("");
      setMetadataRarity("");
      setMetadataCreatureType("");
      setMetadataArtworkEffect("");
      setMetadataArtworkTagsText("");
      return;
    }

    setEffectText(selectedCard.text ?? "");
    setEffectJson(JSON.stringify(selectedCard.effects ?? [], null, 2));
    setMetadataRarity(selectedCard.rarity ?? "");
    setMetadataCreatureType(selectedCard.creatureType ?? "");
    setMetadataArtworkEffect(selectedCard.artworkEffect ?? "");
    setMetadataArtworkTagsText(formatArtworkTagsInput(selectedCard.artworkTags));
    setBuilderMessage(`Loaded ${selectedCard.name}.`);
    setBuilderWarnings([]);
    setJsonError("");
  }, [selectedCard]);

  function buildLogicFromText() {
    if (!selectedCard) return;

    const result = buildWardEffectsFromText({
      card: selectedCard,
      text: effectText
    });

    setEffectJson(JSON.stringify(result.effects, null, 2));
    setBuilderWarnings(result.warnings);
    setJsonError("");
    setBuilderMessage(`Built ${result.effects.length} effect object${result.effects.length === 1 ? "" : "s"} for ${selectedCard.name}.`);
  }

  function loadSavedEffects() {
    if (!selectedCard) return;

    setEffectText(selectedCard.text ?? "");
    setEffectJson(JSON.stringify(selectedCard.effects ?? [], null, 2));
    setBuilderWarnings([]);
    setJsonError("");
    setBuilderMessage(`Reloaded saved effects for ${selectedCard.name}.`);
  }

  function validateJson(): WardEngineEffect[] | undefined {
    try {
      const effects = parseEffectJson(effectJson);
      setJsonError("");
      setBuilderMessage(`Effect JSON is valid. ${effects.length} effect object${effects.length === 1 ? "" : "s"}.`);
      return effects;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Effect JSON is invalid.";
      setJsonError(message);
      return undefined;
    }
  }

  function normalizeJsonEditor() {
    try {
      const effects = parseEffectJson(effectJson);
      setEffectJson(JSON.stringify(effects, null, 2));
      setJsonError("");
      setBuilderMessage(`Normalized Engine JSON. ${effects.length} effect object${effects.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Effect JSON is invalid.";
      setJsonError(message);
      setBuilderMessage("Could not normalize Engine JSON. Fix the JSON error first.");
    }
  }
  function saveEffects() {
    if (!selectedCard) return;

    const effects = validateJson();
    if (!effects) return;

    onSaveCardEffects({
      packId: selectedCard.packId,
      cardId: selectedCard.id,
      text: effectText,
      effects,
      metadata: {
        rarity: metadataRarity,
        creatureType: metadataCreatureType,
        artworkEffect: metadataArtworkEffect,
        artworkTags: parseArtworkTagsInput(metadataArtworkTagsText)
      }
    });

    setBuilderMessage(`Saving ${selectedCard.name} to ${selectedCard.packId}.json...`);
  }

  function writeBlocksIntoJson() {
    if (!selectedCard) return;

    const effects = validateJson();
    if (!effects) return;

    const nextEffects = writeEffectBlocksToEffects(effects);
    setEffectJson(JSON.stringify(nextEffects, null, 2));
    setBuilderMessage(`Wrote block chains into ${nextEffects.length} effect object${nextEffects.length === 1 ? "" : "s"} for ${selectedCard.name}. Save to persist them.`);
    setJsonError("");
  }

  async function copySelectedBlocks() {
    const value = stringifyEffectBlocks(selectedBlockChains);

    try {
      await navigator.clipboard.writeText(value);
      setBuilderMessage("Copied selected card block logic JSON to clipboard.");
    } catch {
      setBuilderMessage("Block logic JSON is ready in the Block Logic tab. Clipboard copy was blocked by the browser.");
    }
  }

  async function copyLibraryHandlerReport(items = libraryBlockCoverage.missingActionTypes) {
    const value = formatLibraryBlockCoverageReport(items);

    try {
      await navigator.clipboard.writeText(value);
      setBuilderMessage(`Copied ${items.length} handler audit group${items.length === 1 ? "" : "s"} to clipboard.`);
    } catch {
      setBuilderMessage("Handler audit report is visible in the Block Logic tab. Clipboard copy was blocked by the browser.");
    }
  }

  async function copySingleHandlerReport(actionType: string) {
    const item = libraryBlockCoverage.actionTypes.find(entry => entry.actionType === actionType);
    if (!item) return;

    try {
      await navigator.clipboard.writeText(formatLibraryBlockCoverageItemReport(item));
      setBuilderMessage(`Copied ${actionType} affected-card report to clipboard.`);
    } catch {
      setBuilderMessage(`${actionType} affected-card report is visible in the Block Logic tab. Clipboard copy was blocked by the browser.`);
    }
  }


  function getEffectsForBlockEdit(): WardEngineEffect[] | undefined {
    try {
      const effects = parseEffectJson(effectJson);
      setJsonError("");
      return effects;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Effect JSON is invalid.";
      setJsonError(message);
      setBuilderMessage("Fix the Engine JSON before editing block logic.");
      return undefined;
    }
  }

  function updateBlockEffect(effectId: string, updater: (effect: WardEngineEffect) => WardEngineEffect, message: string) {
    const effects = getEffectsForBlockEdit();
    if (!effects) return;

    const nextEffects = effects.map(effect => effect.id === effectId ? updater(effect) : effect);
    setEffectJson(JSON.stringify(nextEffects, null, 2));
    setBuilderMessage(message);
    setActiveEditorTab("BLOCKS");
  }

  function applyBlockTemplate(template: EffectBlockTemplate) {
    const effect = selectedBlockEffect;
    if (!effect) return;

    updateBlockEffect(
      effect.id,
      current => applyEffectBlockTemplate(current, template),
      `Applied ${template.label} ${template.kind.toLowerCase()} block to ${effect.id}. Save to persist it.`
    );
  }

  function addSubEffectFromSelected() {
    const sourceEffect = selectedBlockEffect;
    if (!sourceEffect) return;

    const effects = getEffectsForBlockEdit();
    if (!effects) return;

    const nextId = getNextEffectId(effects, sourceEffect.id);
    const nextEffect: WardEngineEffect = {
      id: nextId,
      trigger: sourceEffect.trigger ?? "ON_PLAY",
      actionType: "MANUAL_REVIEW",
      effectGroup: "Manual Review",
      actionText: "Describe this sub effect.",
      target: sourceEffect.target,
      value: "",
      duration: sourceEffect.duration,
      reusableFunction: "manualReview",
      params: {
        target: sourceEffect.target ?? sourceEffect.params?.target,
        duration: sourceEffect.duration ?? sourceEffect.params?.duration,
        sourceLinked: false,
        usesAnchoring: false,
        blockSupportOverride: {
          overallStatus: "REVIEW",
          tested: false,
          updatedAt: new Date().toISOString(),
          source: "Effect Dev Tool"
        }
      },
      notes: `Sub effect added from ${sourceEffect.id}. Replace MANUAL_REVIEW with the needed action type.`,
      needsReview: true
    };

    const nextEffects = [...effects, nextEffect];
    setEffectJson(JSON.stringify(nextEffects, null, 2));
    setSelectedBlockEffectId(nextId);
    setPendingBlockEffectId(nextId);
    setActiveEditorTab("BLOCKS");
    setBuilderMessage(`Added blank sub effect ${nextId}. Edit its Action/Target/Duration, then Save.`);
  }

  function removeBlockFromChain(effectId: string, blockId: string, kind: EffectBlockKind) {
    if (kind === "ACTION") {
      setBuilderMessage("The Action block is the effect itself. Change the actionType in Engine JSON, or add a sub effect instead of removing it.");
      return;
    }

    updateBlockEffect(
      effectId,
      effect => removeEffectBlockFromEffect(effect, blockId, kind),
      `Removed ${kind.toLowerCase()} block from ${effectId}. Save to persist it.`
    );
  }

  function updateEffectSupportStatus(effectId: string, status: EffectBlockStatus | "AUTO") {
    updateBlockEffect(
      effectId,
      effect => setEffectOverallBlockStatusOverride(effect, status),
      status === "AUTO"
        ? `Cleared manual support status for ${effectId}.`
        : `Marked ${effectId} as ${blockStatusLabel(status)} based on testing. Save to persist it.`
    );
  }

  function updateBlockSupportStatus(effectId: string, blockId: string, status: EffectBlockStatus | "AUTO") {
    updateBlockEffect(
      effectId,
      effect => setEffectBlockStatusOverride(effect, blockId, status),
      status === "AUTO"
        ? `Cleared manual block status for ${blockId}.`
        : `Marked ${blockId} as ${blockStatusLabel(status)} based on testing. Save to persist it.`
    );
  }

  function clearBlockSupport(effectId: string) {
    updateBlockEffect(
      effectId,
      effect => clearEffectBlockStatusOverrides(effect),
      `Cleared all manual support overrides for ${effectId}.`
    );
  }

  function moveBlockInChain(effectId: string, blockId: string, direction: -1 | 1) {
    updateBlockEffect(
      effectId,
      effect => {
        const chain = buildEffectBlockChain(effect);
        const currentOrder = chain.blocks.map(block => block.id);
        const currentIndex = currentOrder.indexOf(blockId);
        if (currentIndex === -1) return effect;

        const targetIndex = Math.max(0, Math.min(currentOrder.length - 1, currentIndex + direction));
        if (targetIndex === currentIndex) return effect;

        const nextOrder = [...currentOrder];
        const [moved] = nextOrder.splice(currentIndex, 1);
        nextOrder.splice(targetIndex, 0, moved);
        return setEffectBlockVisualOrder(effect, nextOrder);
      },
      `Moved ${blockId} ${direction < 0 ? "left" : "right"}. Save to persist the visual chain order.`
    );
  }

  function dropBlockOnChain(effectId: string, targetBlockId?: string) {
    if (!blockDragState) return;

    if (blockDragState.type === "CHAIN_BLOCK") {
      if (blockDragState.effectId !== effectId) {
        setBuilderMessage("Drag/reorder is limited to blocks inside the same effect chain.");
        setBlockDragState(null);
        return;
      }

      updateBlockEffect(
        effectId,
        effect => {
          const chain = buildEffectBlockChain(effect);
          const currentOrder = chain.blocks.map(block => block.id);
          const fromIndex = currentOrder.indexOf(blockDragState.blockId);
          if (fromIndex === -1) return effect;

          const nextOrder = [...currentOrder];
          const [moved] = nextOrder.splice(fromIndex, 1);
          const toIndex = targetBlockId ? nextOrder.indexOf(targetBlockId) : nextOrder.length;
          nextOrder.splice(toIndex < 0 ? nextOrder.length : toIndex, 0, moved);
          return setEffectBlockVisualOrder(effect, nextOrder);
        },
        targetBlockId
          ? `Moved ${blockDragState.blockId} before ${targetBlockId}. Save to persist the visual chain order.`
          : `Moved ${blockDragState.blockId} to the end of the chain. Save to persist the visual chain order.`
      );

      setBlockDragState(null);
      return;
    }

    const template = EFFECT_BLOCK_PALETTE.find(item => item.id === blockDragState.templateId);
    if (!template) {
      setBlockDragState(null);
      return;
    }

    updateBlockEffect(
      effectId,
      effect => {
        const patched = applyEffectBlockTemplate(effect, template);
        const chain = buildEffectBlockChain(patched);
        const templateBlock = chain.blocks.find(block => block.kind === template.kind);
        if (!templateBlock) return patched;

        const currentOrder = chain.blocks.map(block => block.id).filter(blockId => blockId !== templateBlock.id);
        const targetIndex = targetBlockId ? currentOrder.indexOf(targetBlockId) : currentOrder.length;
        currentOrder.splice(targetIndex < 0 ? currentOrder.length : targetIndex, 0, templateBlock.id);
        return setEffectBlockVisualOrder(patched, currentOrder);
      },
      targetBlockId
        ? `Dropped ${template.label} before ${targetBlockId}. Save to persist it.`
        : `Dropped ${template.label} at the end of ${effectId}. Save to persist it.`
    );

    setSelectedBlockEffectId(effectId);
    setBlockDragState(null);
  }

  function resetBlockVisualOrder(effectId: string) {
    updateBlockEffect(
      effectId,
      effect => clearEffectBlockChainLayout(effect),
      `Reset ${effectId} to canonical block layout and restored hidden blocks.`
    );
  }

  function openReviewQueueEffect(effect: LibraryBlockCoverageEffectItem) {
    setSelectedCardKey(`${effect.packId}:${effect.cardId}`);
    setPendingBlockEffectId(effect.effectId);
    setSelectedBlockEffectId(effect.effectId);
    setActiveEditorTab("BLOCKS");
    setBuilderMessage(`Opened ${effect.cardLabel} ${effect.effectId} from the Missing/Review queue.`);
  }

  function addCardToTestDeck(owner: TestDeckOwner, cardId: string) {
    const setter = owner === "PLAYER_1" ? setPlayer1CardIds : setPlayer2CardIds;

    setter(current => [...current, cardId]);
  }

  function addSelectedCardToTestDeck(owner: TestDeckOwner) {
    if (!selectedCard) return;
    addCardToTestDeck(owner, selectedCard.id);
  }

  function removeCardFromTestDeck(owner: TestDeckOwner, cardId: string) {
    const setter = owner === "PLAYER_1" ? setPlayer1CardIds : setPlayer2CardIds;

    setter(current => {
      const index = current.indexOf(cardId);
      if (index === -1) return current;
      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
  }

  function clearTestDeck(owner: TestDeckOwner) {
    if (owner === "PLAYER_1") {
      setPlayer1CardIds([]);
      return;
    }

    setPlayer2CardIds([]);
  }

  function addSelectedToBoth() {
    if (!selectedCard) return;

    addCardToTestDeck("PLAYER_1", selectedCard.id);
    addCardToTestDeck("PLAYER_2", selectedCard.id);
  }

  function autofillDeck(owner: TestDeckOwner) {
    const setter = owner === "PLAYER_1" ? setPlayer1CardIds : setPlayer2CardIds;
    const currentCards = owner === "PLAYER_1" ? player1CardIds : player2CardIds;
    const availableCreatures = sortedCards.filter(card => card.cardType === "CREATURE");
    const availableAny = sortedCards;

    setter(() => {
      const next = [...currentCards].slice(0, 10);

      if (!next.some(cardId => cardLibrary.find(card => card.id === cardId)?.cardType === "CREATURE")) {
        const firstCreature = availableCreatures[0];
        if (firstCreature) next.unshift(firstCreature.id);
      }

      let fillIndex = 0;
      while (next.length < 10 && availableAny.length > 0) {
        next.push(availableAny[fillIndex % availableAny.length].id);
        fillIndex++;
      }

      return ensureCreatureFirst(next.slice(0, 10), cardLibrary);
    });
  }

  function createTenCardTestMatch() {
    const selectedPacks = selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id);

    onCreateTestMatch({
      packIds: selectedPacks,
      player1CardIds: ensureCreatureFirst(player1CardIds, cardLibrary),
      player2CardIds: ensureCreatureFirst(player2CardIds, cardLibrary),
      player1StartingHandSize,
      player2StartingHandSize
    });
  }

  function renderDeck(owner: TestDeckOwner, title: string, cardIds: string[], summary: ReturnType<typeof summarizeDeck>, creatureCount: number) {
    return (
      <section className="effect-dev-test-deck-card">
        <div className="effect-dev-test-deck-header">
          <div>
            <h4>{title}</h4>
            <p>{cardIds.length} cards  -  {creatureCount} creature{creatureCount === 1 ? "" : "s"}</p>
          </div>

          <div className="actions small-actions">
            <button onClick={() => autofillDeck(owner)} disabled={sortedCards.length === 0}>Auto Fill</button>
            <button onClick={() => clearTestDeck(owner)} disabled={cardIds.length === 0}>Clear</button>
          </div>
        </div>

        {summary.length === 0 ? (
          <p className="empty-zone">No test cards selected.</p>
        ) : (
          <div className="builder-card-list current-deck-list unified-current-deck-list effect-dev-compact-deck-list">
            {summary.map(({ cardId, count, card }) => (
              <div className="builder-card-entry current-deck-entry" key={`${owner}-${cardId}`}>
                <div>
                  <strong>{card?.name ?? cardId}</strong>
                  <div className="event-meta">
                    {card?.cardType ?? "UNKNOWN"} | Copies: {count}
                  </div>
                </div>

                <div className="builder-card-actions compact-deck-actions">
                  <button onClick={() => removeCardFromTestDeck(owner, cardId)}>-</button>
                  <button onClick={() => addCardToTestDeck(owner, cardId)}>+</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  const canCreateTestMatch = player1CardIds.length > 0 && player2CardIds.length > 0;
  const activePackCount = selectedPackIds.length > 0 ? selectedPackIds.length : cardPacks.length;

  return (
    <section className="effect-dev-page effect-dev-workspace-page effect-dev-option-a-page">
      <section className="setup-section effect-dev-option-a-toolbar">
        <div className="effect-dev-toolbar-title-row">
          <div className="effect-dev-toolbar-identity">
            <strong>Effect Dev Tool</strong>
            <span>{activePackCount} pack{activePackCount === 1 ? "" : "s"}</span>
            <span>{cardLibrary.length} cards</span>
            <span>{selectedCard ? selectedCard.name : "No card selected"}</span>
          </div>

          <div className="deck-builder-header-actions effect-dev-toolbar-actions">
            <button onClick={onRefreshCardLibrary}>Refresh</button>
            <button onClick={loadSavedEffects} disabled={!selectedCard}>Reload</button>
            <button onClick={buildLogicFromText} disabled={!selectedCard}>Build</button>
            <button onClick={validateJson} disabled={!selectedCard}>Validate</button>
            <button onClick={normalizeJsonEditor} disabled={!selectedCard}>Normalize JSON</button>
            <button onClick={saveEffects} disabled={!selectedCard}>Save</button>
            <button onClick={writeBlocksIntoJson} disabled={!selectedCard || parsedEffects.length === 0}>Write Blocks</button>
            <button onClick={createTenCardTestMatch} disabled={!canCreateTestMatch}>Create Match</button>
          </div>
        </div>

        <div className="effect-dev-toolbar-status-row">
          <details className="effect-dev-pack-chip-drawer">
            <summary>Loaded Packs  -  {activePackCount} active</summary>
            <div className="pack-selector-grid compact-pack-selector-grid">
              {cardPacks.map(pack => (
                <label className="checkbox-label pack-checkbox-label" key={pack.id}>
                  <input
                    type="checkbox"
                    checked={selectedPackIds.includes(pack.id)}
                    onChange={() => onToggleSelectedPack(pack.id)}
                  />
                  {pack.name} ({pack.cardCount})
                </label>
              ))}
            </div>
          </details>

          {(builderMessage || jsonError || builderWarnings.length > 0) && (
            <div className={jsonError ? "effect-dev-inline-status error" : builderWarnings.length > 0 ? "effect-dev-inline-status warning" : "effect-dev-inline-status success"}>
              {jsonError || builderWarnings[0] || builderMessage}
              {builderWarnings.length > 1 ? ` (+${builderWarnings.length - 1} warnings)` : ""}
            </div>
          )}
        </div>
      </section>

      <section className={activeEditorTab === "BLOCKS" ? "effect-dev-three-pane-grid block-layout-mode" : "effect-dev-three-pane-grid"}>
        <aside className="setup-section effect-dev-card-picker effect-dev-option-a-card-picker">
          <div className="effect-dev-pane-header">
            <h3>Card Picker</h3>
            <span>{filteredCards.length} shown</span>
          </div>

          <div className="library-filter-grid effect-dev-filter-grid effect-dev-compact-filter-grid">
            <label>
              Search
              <input
                value={searchText}
                onChange={event => setSearchText(event.target.value)}
                placeholder="Card, effect, action..."
              />
            </label>

            <label>
              Type
              <select value={cardTypeFilter} onChange={event => setCardTypeFilter(event.target.value as CardTypeFilter)}>
                <option value="ALL">All</option>
                <option value="CREATURE">Creatures</option>
                <option value="MAGIC">Magic</option>
              </select>
            </label>
          </div>

          {selectedCard && (
            <section className="effect-dev-selected-mini-card">
              <span>Selected</span>
              <strong>{selectedCard.name}</strong>
              <p>{getCardRulesSummary(selectedCard)}</p>
            </section>
          )}

          <div className="effect-dev-card-list">
            {filteredCards.length === 0 ? (
              <p className="empty-zone">No cards match the current filters.</p>
            ) : (
              filteredCards.map(card => {
                const key = getCardKey(card);
                const cardChains = (card.effects ?? []).map(effect => buildEffectBlockChain(effect));
                const cardBlockSummary = summarizeEffectBlockChains(cardChains);
                const highestStatus = cardChains.reduce<EffectBlockStatus>((result, chain) => {
                  return statusWeight(chain.overallStatus) > statusWeight(result) ? chain.overallStatus : result;
                }, "READY");

                return (
                  <button
                    className={key === selectedCardKey ? "effect-dev-card-select selected" : "effect-dev-card-select"}
                    key={key}
                    onClick={() => setSelectedCardKey(key)}
                  >
                    <strong>{formatCardLabel(card)}</strong>
                    <span>{getCardRulesSummary(card)}</span>
                    <span>{card.effectCount ?? 0} saved effects  -  {card.packId}</span>
                    {(card.effectCount ?? 0) > 0 && (
                      <span className="effect-dev-card-block-summary">
                        <em className={blockStatusClass(highestStatus)}>{blockStatusLabel(highestStatus)}</em>
                        {cardBlockSummary.READY} ready  -  {cardBlockSummary.PARTIAL} partial  -  {cardBlockSummary.MISSING} missing  -  {cardBlockSummary.REVIEW} review
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="setup-section effect-dev-option-a-editor">
          <div className="effect-dev-editor-topline">
            <div>
              <h3>{selectedCard ? selectedCard.name : "Select a card"}</h3>
              {selectedCard && <p>{formatCardLabel(selectedCard)}  -  {getCardRulesSummary(selectedCard)}</p>}
            </div>
          </div>

          {selectedCard && (
            <details className="setup-section effect-dev-metadata-editor" open>
              <summary>Card Metadata</summary>

              <div className="library-filter-grid effect-dev-filter-grid">
                <label>
                  Rarity
                  <input
                    value={metadataRarity}
                    onChange={event => setMetadataRarity(event.target.value)}
                    placeholder="Common, Rare, Legendary..."
                  />
                </label>

                <label>
                  Creature Type
                  <input
                    value={metadataCreatureType}
                    onChange={event => setMetadataCreatureType(event.target.value)}
                    placeholder={selectedCard.cardType === "CREATURE" ? "Dragon, Beast, Undead..." : "Only used by creatures"}
                    disabled={selectedCard.cardType !== "CREATURE"}
                  />
                </label>

                <label>
                  Artwork Tags
                  <input
                    value={metadataArtworkTagsText}
                    onChange={event => setMetadataArtworkTagsText(event.target.value)}
                    placeholder="WATER, WINGS, WEAPON"
                  />
                </label>
              </div>

              <label className="effect-dev-full-width-field">
                Artwork Effect
                <textarea
                  className="effect-dev-textarea"
                  value={metadataArtworkEffect}
                  onChange={event => setMetadataArtworkEffect(event.target.value)}
                  placeholder="Human-readable artwork notes. Example: creature has wings and water in the background."
                  rows={3}
                />
              </label>

              <p className="effect-dev-small-note">
                Artwork Tags are runtime-readable condition tags. Use comma-separated values like WATER, WINGS, WEAPON, SKY.
              </p>
            </details>
          )}
          <div className="effect-dev-tab-row" role="tablist" aria-label="Effect editor tabs">
            <button className={activeEditorTab === "RULES" ? "active" : ""} onClick={() => setActiveEditorTab("RULES")}>Rules Text</button>
            <button className={activeEditorTab === "JSON" ? "active" : ""} onClick={() => setActiveEditorTab("JSON")}>Engine JSON</button>
            <button className={activeEditorTab === "BLOCKS" ? "active" : ""} onClick={() => setActiveEditorTab("BLOCKS")}>Block Logic</button>
            <button className={activeEditorTab === "PREVIEW" ? "active" : ""} onClick={() => setActiveEditorTab("PREVIEW")}>Preview</button>
          </div>

          <div className="effect-dev-editor-tab-body">
            {activeEditorTab === "RULES" && (
              <textarea
                className="effect-dev-textarea effect-dev-option-a-textarea"
                value={effectText}
                onChange={event => setEffectText(event.target.value)}
                placeholder="Type the card effect exactly as it should appear in the library."
              />
            )}

            {activeEditorTab === "JSON" && (
              <textarea
                className="effect-dev-jsonarea effect-dev-option-a-textarea"
                value={effectJson}
                onChange={event => setEffectJson(event.target.value)}
                spellCheck={false}
              />
            )}

            {activeEditorTab === "BLOCKS" && (
              <div className="effect-block-workbench">
                <section className="effect-block-workbench-layout">
                  <div className="effect-block-main-column">
                    <section className="effect-block-summary-grid">
                      <article>
                        <span>Selected Card</span>
                        <strong>{selectedBlockSummary.total}</strong>
                        <p>{selectedBlockSummary.READY} ready  -  {selectedBlockSummary.PARTIAL} partial  -  {selectedBlockSummary.MISSING} missing  -  {selectedBlockSummary.REVIEW} review</p>
                      </article>
                      <article>
                        <span>Loaded Library</span>
                        <strong>{libraryBlockCoverage.effectCount}</strong>
                        <p>{libraryBlockCoverage.summary.READY} ready  -  {libraryBlockCoverage.summary.PARTIAL} partial  -  {libraryBlockCoverage.summary.MISSING} missing  -  {libraryBlockCoverage.summary.REVIEW} review</p>
                      </article>
                      <article>
                        <span>Action Types</span>
                        <strong>{libraryBlockCoverage.actionTypes.length}</strong>
                        <p>{libraryBlockCoverage.missingActionTypes.length} need handler/review work</p>
                      </article>
                    </section>

                    <div className="effect-block-action-row">
                      <button onClick={writeBlocksIntoJson} disabled={!selectedCard || parsedEffects.length === 0}>Write Blocks Into JSON</button>
                      <button onClick={copySelectedBlocks} disabled={selectedBlockChains.length === 0}>Copy Selected Blocks</button>
                      <button onClick={addSubEffectFromSelected} disabled={!selectedBlockEffect}>Add Sub Effect</button>
                    </div>

                    <section className="effect-block-palette-panel">
                      <div className="effect-block-palette-header">
                        <div>
                          <strong>Block Palette</strong>
                          <p>Drag blocks from this left palette into the CHAIN ORDER BOARD to the right. Use the :::: handles or arrows on chain blocks to reorder.</p>
                        </div>
                        <div className="effect-block-palette-controls">
                          <label>
                            Effect
                            <select
                              value={selectedBlockEffect?.id ?? ""}
                              onChange={event => setSelectedBlockEffectId(event.target.value)}
                              disabled={parsedEffects.length === 0}
                            >
                              {parsedEffects.map(effect => (
                                <option value={effect.id} key={effect.id}>{effect.id}  -  {effect.actionType}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Block Kind
                            <select value={blockPaletteFilterKind} onChange={event => setBlockPaletteFilterKind(event.target.value as BlockPaletteFilterKind)}>
                              <option value="ALL">All</option>
                              <option value="TRIGGER">When</option>
                              <option value="CONDITION">If</option>
                              <option value="TARGET">Target</option>
                              <option value="ACTION">Do</option>
                              <option value="VALUE">Value</option>
                              <option value="DURATION">Duration</option>
                              <option value="CLEANUP">Cleanup</option>
                              <option value="VISUAL_CUE">Show</option>
                            </select>
                          </label>
                        </div>
                      </div>

                      <div className="effect-block-template-grid">
                        {filteredBlockTemplates.map(template => (
                          <button
                            className={getTemplateButtonClass(template)}
                            key={template.id}
                            onClick={() => applyBlockTemplate(template)}
                            disabled={!selectedBlockEffect}
                            type="button"
                            draggable={Boolean(selectedBlockEffect)}
                            onDragStart={event => {
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData("text/plain", template.id);
                              setBlockDragState({ type: "TEMPLATE", templateId: template.id });
                            }}
                            onDragEnd={() => setBlockDragState(null)}
                          >
                            <span>{template.kind.replace("_", " ")}</span>
                            <strong>{template.label}</strong>
                            <small>{template.description}</small>
                          </button>
                        ))}
                      </div>
                    </section>

                    {selectedBlockChains.length === 0 ? (
                      <p className="empty-zone">No valid effect JSON to convert into block logic.</p>
                    ) : (
                      <div className="effect-block-chain-list">
                        {selectedBlockChains.map(chain => {
                          const chainEffect = parsedEffects.find(effect => effect.id === chain.effectId) ?? { id: chain.effectId, actionType: chain.actionType, trigger: chain.trigger };
                          const overallOverride = getEffectOverallBlockStatusOverride(chainEffect);
                          const runtimePreview = getEffectBlockRuntimePreview(chainEffect);

                          return (
                            <article className="effect-block-chain-card" key={chain.effectId}>
                              <div className="effect-block-chain-header">
                                <div>
                                  <strong>{chain.effectId}</strong>
                                  <span>{chain.trigger ?? "ON_PLAY"}  -  {chain.actionType}</span>
                                  <small>Test support: {getEffectSupportOverrideLabel(chainEffect)}</small>
                                </div>
                                <div className="effect-block-support-controls">
                                  <span className={blockStatusClass(chain.overallStatus)}>{blockStatusLabel(chain.overallStatus)}</span>
                                  <label>
                                    Tested Status
                                    <select
                                      value={overallOverride ?? "AUTO"}
                                      onChange={event => updateEffectSupportStatus(chain.effectId, event.target.value as EffectBlockStatus | "AUTO")}
                                    >
                                      <option value="AUTO">Auto</option>
                                      {EFFECT_BLOCK_STATUS_VALUES.map(status => <option value={status} key={status}>{blockStatusLabel(status)}</option>)}
                                    </select>
                                  </label>
                                  <button type="button" onClick={() => resetBlockVisualOrder(chain.effectId)}>Reset Order</button>
                                  <button type="button" onClick={() => clearBlockSupport(chain.effectId)}>Clear Overrides</button>
                                </div>
                              </div>

                              <div className={runtimePreview.executable ? "effect-block-runtime ready" : "effect-block-runtime review"}>
                                <strong>{runtimePreview.route}</strong>
                                <span>{runtimePreview.runtimeAspects.length > 0 ? runtimePreview.runtimeAspects.join("  -  ") : "No executable runtime aspects detected yet"}</span>
                                {runtimePreview.missingRuntimeAspects.length > 0 && <small>{runtimePreview.missingRuntimeAspects.slice(0, 3).join("; ")}</small>}
                              </div>

                              <div
                                className={blockDragState ? "effect-block-flow drag-active" : "effect-block-flow"}
                                onDragOver={event => event.preventDefault()}
                                onDrop={event => {
                                  event.preventDefault();
                                  dropBlockOnChain(chain.effectId);
                                }}
                              >
                                {chain.blocks.map((block, blockIndex) => {
                                  const blockOverride = getEffectBlockStatusOverride(chainEffect, block.id, block.kind);
                                  const isDraggingThisBlock = blockDragState?.type === "CHAIN_BLOCK" && blockDragState.blockId === block.id;

                                  return (
                                    <div
                                      className={`effect-block-node ${block.status.toLowerCase()} ${isDraggingThisBlock ? "dragging" : ""}`}
                                      key={block.id}
                                      onDragOver={event => event.preventDefault()}
                                      onDrop={event => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        dropBlockOnChain(chain.effectId, block.id);
                                      }}
                                    >
                                      <div className="effect-block-node-topline">
                                        <span
                                          className="effect-block-drag-handle"
                                          draggable
                                          title="Drag to reorder this block"
                                          onDragStart={event => {
                                            event.dataTransfer.effectAllowed = "move";
                                            event.dataTransfer.setData("text/plain", block.id);
                                            setBlockDragState({ type: "CHAIN_BLOCK", effectId: chain.effectId, blockId: block.id });
                                          }}
                                          onDragEnd={() => setBlockDragState(null)}
                                        >
                                          ::::
                                        </span>
                                        <span>{block.label}</span>
                                        <span className="effect-block-order-index">{blockIndex + 1}</span>
                                      </div>
                                      <strong>{block.summary}</strong>
                                      {block.handler && <em>{block.handler}</em>}
                                      {block.notes && <small>{block.notes}</small>}
                                      <div className="effect-block-node-move-row">
                                        <button type="button" onClick={() => moveBlockInChain(chain.effectId, block.id, -1)} disabled={blockIndex === 0}>Left</button>
                                        <button type="button" onClick={() => moveBlockInChain(chain.effectId, block.id, 1)}>Right</button>
                                        <button type="button" onClick={() => removeBlockFromChain(chain.effectId, block.id, block.kind)}>Remove</button>
                                      </div>
                                      <label className="effect-block-node-status-control">
                                        Tested
                                        <select
                                          value={blockOverride ?? "AUTO"}
                                          onChange={event => updateBlockSupportStatus(chain.effectId, block.id, event.target.value as EffectBlockStatus | "AUTO")}
                                        >
                                          <option value="AUTO">Auto</option>
                                          {EFFECT_BLOCK_STATUS_VALUES.map(status => <option value={status} key={status}>{blockStatusLabel(status)}</option>)}
                                        </select>
                                      </label>
                                    </div>
                                  );
                                })}

                                <div
                                  className="effect-block-drop-tail"
                                  onDragOver={event => event.preventDefault()}
                                  onDrop={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    dropBlockOnChain(chain.effectId);
                                  }}
                                >
                                  Drop at end
                                </div>
                              </div>

                              {(chain.missingHandlers.length > 0 || chain.reviewNotes.length > 0) && (
                                <details className="effect-block-review-notes">
                                  <summary>Handler gaps / review notes</summary>
                                  {chain.missingHandlers.length > 0 && (
                                    <ul>
                                      {chain.missingHandlers.map(note => <li key={note}>{note}</li>)}
                                    </ul>
                                  )}
                                  {chain.reviewNotes.length > 0 && (
                                    <ul>
                                      {chain.reviewNotes.map(note => <li key={note}>{note}</li>)}
                                    </ul>
                                  )}
                                </details>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <aside className={reviewRailExpanded ? "effect-block-review-rail expanded" : "effect-block-review-rail collapsed"}>
                    <button
                      className="effect-block-review-rail-toggle"
                      type="button"
                      onClick={() => setReviewRailExpanded(current => !current)}
                    >
                      <span>Missing / Review Queue</span>
                      <strong>{reviewQueueEffectCount}</strong>
                    </button>

                    {reviewRailExpanded && (
                      <div className="effect-block-review-rail-body">
                        <div className="effect-block-review-rail-actions">
                          <button type="button" onClick={() => copyLibraryHandlerReport(reviewQueueItems)} disabled={reviewQueueItems.length === 0}>
                            Copy Missing/Review Report
                          </button>
                          <button type="button" onClick={() => copyLibraryHandlerReport(libraryBlockCoverage.actionTypes)} disabled={libraryBlockCoverage.actionTypes.length === 0}>
                            Copy Full Handler Report
                          </button>
                        </div>

                        {reviewQueueItems.length === 0 ? (
                          <p className="empty-zone">No missing or review action groups found.</p>
                        ) : (
                          <div className="effect-block-review-group-list">
                            {reviewQueueItems.slice(0, 24).map(item => (
                              <details className="effect-block-review-group" key={item.actionType} open={item.status === "MISSING" || item.status === "REVIEW"}>
                                <summary>
                                  <strong>{item.actionType}</strong>
                                  <span className={blockStatusClass(item.status)}>{blockStatusLabel(item.status)}</span>
                                  <span>{item.count} effect{item.count === 1 ? "" : "s"}</span>
                                  <button type="button" onClick={event => { event.preventDefault(); void copySingleHandlerReport(item.actionType); }}>Copy</button>
                                </summary>

                                <div className="effect-block-review-effect-list">
                                  {item.effects.map(effect => (
                                    <article className="effect-block-review-effect" key={`${item.actionType}:${effect.packId}:${effect.cardId}:${effect.effectId}`}>
                                      <div className="effect-block-review-effect-title">
                                        <strong>{effect.cardLabel}</strong>
                                        <span>{effect.effectId}  -  {effect.trigger ?? "ON_PLAY"}</span>
                                        <span className={blockStatusClass(effect.status)}>{blockStatusLabel(effect.status)}</span>
                                      </div>
                                      {effect.actionText && <p><b>Action:</b> {effect.actionText}</p>}
                                      <p>
                                        {effect.target && <span><b>Target:</b> {effect.target}</span>}
                                        {effect.value && <span><b>Value:</b> {effect.value}</span>}
                                        {effect.durationText && <span><b>Duration:</b> {effect.durationText}</span>}
                                      </p>
                                      {effect.conditionText && <p><b>Condition:</b> {effect.conditionText}</p>}
                                      {effect.missingHandlers.length > 0 && <p><b>Missing:</b> {effect.missingHandlers.join("; ")}</p>}
                                      {effect.reviewNotes.length > 0 && <p><b>Review:</b> {effect.reviewNotes.join("; ")}</p>}
                                      <button type="button" onClick={() => openReviewQueueEffect(effect)}>Open Effect</button>
                                    </article>
                                  ))}
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </aside>
                </section>
              </div>
            )}

            {activeEditorTab === "PREVIEW" && (
              <div className="effect-dev-option-a-preview">
                {parsedEffects.length === 0 ? (
                  <p className="empty-zone">No valid effect JSON to preview.</p>
                ) : (
                  <div className="effect-dev-effect-preview-list">
                    {parsedEffects.map(effect => (
                      <article className={effect.needsReview ? "effect-dev-effect-preview needs-review" : "effect-dev-effect-preview"} key={effect.id}>
                        <div className="effect-dev-effect-title-row">
                          <strong>{effect.id}</strong>
                          <span>{effect.trigger ?? "ON_PLAY"}</span>
                          <span>{effect.actionType}</span>
                          {effect.needsReview && <span className="limit-badge limited">Needs Review</span>}
                        </div>

                        <p>{effect.actionText ?? effect.value ?? "No action text."}</p>
                        <div className="event-meta">
                          Target: {effect.target ?? effect.params?.target ?? "None"}
                          {effect.duration?.text ? ` | Duration: ${effect.duration.text}` : ""}
                          {effect.reusableFunction ? ` | Handler: ${effect.reusableFunction}` : ""}
                        </div>
                        {effect.notes && <p className="effect-dev-note">{effect.notes}</p>}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="setup-section effect-dev-option-a-test-rail">
          <div className="effect-dev-pane-header">
            <h3>Test Decks</h3>
            <span>P1 {player1CardIds.length}  -  P2 {player2CardIds.length}</span>
          </div>

          {selectedCard && (
            <section className="effect-dev-rail-selected-card">
              <div>
                <span className="library-card-kicker">Selected</span>
                <strong>{selectedCard.name}</strong>
              </div>

              <div className="effect-dev-rail-action-grid">
                <button onClick={() => addSelectedCardToTestDeck("PLAYER_1")}>Add P1</button>
                <button onClick={() => addSelectedCardToTestDeck("PLAYER_2")}>Add P2</button>
                <button onClick={addSelectedToBoth}>Add Both</button>
                {onOpenSelectedInCoverage && (
                  <button className="secondary-button" onClick={() => onOpenSelectedInCoverage(selectedCardKey)}>Coverage</button>
                )}
              </div>
            </section>
          )}

          {!canCreateTestMatch && (
            <div className="warning-box effect-dev-rail-warning">
              Add one card to each deck. Current: P1 {player1CardIds.length}; P2 {player2CardIds.length}.
            </div>
          )}

          <div className="effect-dev-hand-size-grid effect-dev-rail-hand-size-grid">
            <label>
              P1 Hand
              <input type="number" min="0" value={player1StartingHandSize} onChange={event => setPlayer1StartingHandSize(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label>
              P2 Hand
              <input type="number" min="0" value={player2StartingHandSize} onChange={event => setPlayer2StartingHandSize(Math.max(0, Number(event.target.value) || 0))} />
            </label>
          </div>

          <div className="effect-dev-rail-create-row">
            <button onClick={createTenCardTestMatch} disabled={!canCreateTestMatch}>Create Test Match</button>
          </div>

          <div className="effect-dev-rail-decks">
            {renderDeck("PLAYER_1", "Player 1", player1CardIds, player1Summary, player1CreatureCount)}
            {renderDeck("PLAYER_2", "Player 2", player2CardIds, player2Summary, player2CreatureCount)}
          </div>
        </aside>
      </section>
    </section>
  );
}





