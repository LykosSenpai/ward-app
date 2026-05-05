param(
  [string]$ProjectRoot = "$env:USERPROFILE\Documents\ward-app"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}

$PatchJs = @'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
  throw new Error('Project root not found: ' + root);
}

function file(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(file(rel), 'utf8');
}

function write(rel, text) {
  fs.writeFileSync(file(rel), text);
}

function replaceOnce(text, find, replacement, label) {
  if (!text.includes(find)) {
    throw new Error('Could not find patch location for: ' + label);
  }
  return text.replace(find, replacement);
}

function backup(rel) {
  const backupRoot =
    path.join(root, '_patch_backups', 'nozip-silence-epicloot-' + new Date().toISOString().replace(/[:.]/g, '-'));

  if (!backup.root) backup.root = backupRoot;

  const src = file(rel);
  const dst = path.join(backup.root, rel);

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function patch(rel, mutate) {
  backup(rel);

  const before = read(rel);
  const after = mutate(before);

  if (after === before) {
    console.log('No changes needed: ' + rel);
  } else {
    write(rel, after);
    console.log('Patched: ' + rel);
  }
}

console.log('Project root: ' + root);

patch('packages/engine/src/magicChainActions.ts', s => {
  s = s.replace(
    'import type { CardInstance, MagicChainLink, MagicChainState, MatchState, WardEngineEffect } from "@ward/shared";',
    'import type { CardInstance, EffectTargetOption, MagicChainLink, MagicChainState, MatchState, PendingEffectTargetPrompt, WardEngineEffect } from "@ward/shared";'
  );

  if (!s.includes('function isSilenceFromTheGraveDefinition(')) {
    s = replaceOnce(
      s,
`function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
}

`,
`function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
}

function isSilenceFromTheGraveDefinition(definition: { id?: string; name?: string; cardNumber?: string }): boolean {
  const id = String(definition.id ?? "").trim().toLowerCase();
  const name = String(definition.name ?? "").trim().toLowerCase();
  const cardNumber = String(definition.cardNumber ?? "").trim();

  return id.includes("silence-from-the-grave") ||
    id.includes("silence_from_the_grave") ||
    name === "silence from the grave" ||
    (cardNumber === "151" && name.includes("silence"));
}

function getSilenceFromTheGravePreChainCostOptions(
  state: MatchState,
  playerId: string,
  silenceCardInstanceId: string
): EffectTargetOption[] {
  const player = getPlayer(state, playerId);

  return player.hand
    .filter(card => card.instanceId !== silenceCardInstanceId)
    .filter(card => state.cardCatalog[card.cardId]?.cardType === "MAGIC")
    .map(card => {
      const definition = getCardDefinition(state, card);
      return {
        id: card.instanceId,
        label: definition.name + " (hand)",
        targetKind: "CARD_IN_HAND" as const,
        playerId,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        cardName: definition.name,
        zone: "HAND" as const
      };
    });
}

function createSilenceFromTheGravePreChainCostPrompt(args: {
  state: MatchState;
  playerId: string;
  card: CardInstance;
  cardName: string;
}): PendingEffectTargetPrompt {
  return {
    id: uuidv4(),
    sourceCardInstanceId: args.card.instanceId,
    sourceCardId: args.card.cardId,
    sourceCardName: args.cardName,
    controllerPlayerId: args.playerId,
    effectId: "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST",
    actionType: "PAY_SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST",
    effectGroup: "Cost",
    actionText: "Discard 1 other Magic card from your hand before playing Silence From The Grave.",
    promptText: "Discard 1 other Magic card from your hand to play Silence From The Grave.",
    targetKind: "CARD_IN_HAND",
    options: getSilenceFromTheGravePreChainCostOptions(args.state, args.playerId, args.card.instanceId)
  };
}

`,
      'Silence From The Grave helper insertion'
    );
  }

  if (!s.includes('SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_PROMPT_CREATED')) {
    s = replaceOnce(
      s,
`  if (definition.magicType === "INFINITE" && player.field.magicSlots.length >= 5) {
    throw new Error("You already have 5 Infinite Magic cards on your side of the field.");
  }

  player.hand.splice(handIndex, 1);
`,
`  if (definition.magicType === "INFINITE" && player.field.magicSlots.length >= 5) {
    throw new Error("You already have 5 Infinite Magic cards on your side of the field.");
  }

  if (isSilenceFromTheGraveDefinition(definition)) {
    const options = getSilenceFromTheGravePreChainCostOptions(nextState, playerId, card.instanceId);

    if (options.length === 0) {
      throw new Error("Silence From The Grave requires discarding 1 other Magic card from your hand before it can be played.");
    }

    nextState.pendingEffectTargetPrompt = createSilenceFromTheGravePreChainCostPrompt({
      state: nextState,
      playerId,
      card,
      cardName: definition.name
    });

    addEvent(nextState, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_PROMPT_CREATED", playerId, {
      cardInstanceId,
      cardName: definition.name,
      optionCount: options.length,
      note: "Silence From The Grave stays in hand until its discard-Magic cost is paid. Opponent cannot respond until the card enters the Magic Chain."
    });

    return nextState;
  }

  player.hand.splice(handIndex, 1);
`,
      'pre-chain cost check before moving Magic to chain'
    );
  }

  return s;
});

patch('packages/engine/src/effectPrompts.ts', s => {
  if (!s.includes('function getOpponentPlayerId(state: MatchState')) {
    s = replaceOnce(
      s,
`export type ChainLinkEffectSource = {
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  playerId: string;
};

`,
`export type ChainLinkEffectSource = {
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  playerId: string;
};

function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
}

`,
      'effectPrompts opponent helper'
    );
  }

  if (!s.includes('SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_PAID')) {
    s = replaceOnce(
      s,
`  const sourceDefinition = nextState.cardCatalog[prompt.sourceCardId];
  const effect = sourceDefinition?.effects?.find(item => item.id === prompt.effectId);

  if (!effect) {
`,
`  const sourceDefinition = nextState.cardCatalog[prompt.sourceCardId];

  if (prompt.actionType === "PAY_SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST") {
    const selectedCardOption = requireSelectedCardOption(selectedOption);

    if (selectedCardOption.cardInstanceId === prompt.sourceCardInstanceId) {
      throw new Error("Silence From The Grave cannot discard itself for its own play cost.");
    }

    const result = discardSelectedCardToCemetery(nextState, selectedCardOption);
    const controller = getPlayer(nextState, prompt.controllerPlayerId);
    const sourceHandIndex = controller.hand.findIndex(card => card.instanceId === prompt.sourceCardInstanceId);

    if (sourceHandIndex === -1) {
      throw new Error("Silence From The Grave is no longer in hand after paying its pre-chain cost.");
    }

    const [sourceCard] = controller.hand.splice(sourceHandIndex, 1);
    const chainSourceDefinition = getCardDefinition(nextState, sourceCard);

    if (chainSourceDefinition.cardType !== "MAGIC") {
      throw new Error("Silence From The Grave source card is not a Magic card.");
    }

    sourceCard.zone = "CHAIN";
    nextState.chainZone.push(sourceCard);
    nextState.pendingEffectTargetPrompt = undefined;

    const chainLink = {
      id: uuidv4(),
      playerId: prompt.controllerPlayerId,
      cardInstanceId: sourceCard.instanceId,
      cardId: sourceCard.cardId,
      cardName: chainSourceDefinition.name,
      magicType: chainSourceDefinition.magicType,
      magicSubType: chainSourceDefinition.magicSubType,
      text: chainSourceDefinition.text ?? "",
      isLightningResponse: false,
      status: "PENDING" as const
    };

    const pendingChain = {
      id: uuidv4(),
      startedByPlayerId: prompt.controllerPlayerId,
      links: [chainLink],
      respondedPlayerIds: [],
      priorityPlayerId: getOpponentPlayerId(nextState, prompt.controllerPlayerId),
      lastLinkPlayerId: prompt.controllerPlayerId,
      passesSinceLastResponse: 0
    };

    nextState.pendingChain = pendingChain;

    addEvent(nextState, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_PAID", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      discardedCardName: result.cardName,
      discardedCardInstanceId: result.card.instanceId,
      note: "Cost paid before Silence From The Grave entered the Magic Chain. Opponent may now respond before it resolves."
    });

    addEvent(nextState, "MAGIC_CHAIN_STARTED", prompt.controllerPlayerId, {
      chainId: pendingChain.id,
      cardInstanceId: sourceCard.instanceId,
      cardName: chainSourceDefinition.name,
      magicType: chainSourceDefinition.magicType,
      magicSubType: chainSourceDefinition.magicSubType
    });

    return nextState;
  }

  const effect = sourceDefinition?.effects?.find(item => item.id === prompt.effectId);

  if (!effect) {
`,
      'Silence pre-chain cost resolution branch'
    );
  }

  return s;
});

patch('apps/client/src/components/player/HandZone.tsx', s => {
  if (!s.includes('function isSilenceFromTheGraveCard(')) {
    s = replaceOnce(
      s,
`} from "../../gameViewHelpers";

export function HandZone({
`,
`} from "../../gameViewHelpers";

function isSilenceFromTheGraveCard(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];
  const name = String(definition?.name ?? "").trim().toLowerCase();
  const id = String(definition?.id ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return isMagic(match, card) && (
    name === "silence from the grave" ||
    id.includes("silence-from-the-grave") ||
    id.includes("silence_from_the_grave") ||
    (cardNumber === "151" && name.includes("silence"))
  );
}

function canPaySilenceFromTheGraveCost(match: AppMatchState, player: PlayerState, card: CardInstance): boolean {
  return player.hand.some(candidate => candidate.instanceId !== card.instanceId && isMagic(match, candidate));
}

export function HandZone({
`,
      'HandZone Silence helpers'
    );
  }

  if (!s.includes('silenceCanPayCost')) {
    s = replaceOnce(
      s,
`  const isPlayableCreature =
    isCreature(match, card) &&
    canPlayPrimaryNow &&
    canSummonCreatureFromHand(match, player, card) &&
    (!primarySacrificeRequired || selectedPrimarySacrifice) &&
    selectedSacrifices.length === requiredSacrifices;

  return (
`,
`  const isPlayableCreature =
    isCreature(match, card) &&
    canPlayPrimaryNow &&
    canSummonCreatureFromHand(match, player, card) &&
    (!primarySacrificeRequired || selectedPrimarySacrifice) &&
    selectedSacrifices.length === requiredSacrifices;
  const isSilenceCard = isSilenceFromTheGraveCard(match, card);
  const silenceCanPayCost = !isSilenceCard || canPaySilenceFromTheGraveCost(match, player, card);

  return (
`,
      'HandZone Silence playable constants'
    );
  }

  if (!s.includes('Silence From The Grave requires 1 other Magic card')) {
    s = replaceOnce(
      s,
`      {isMagic(match, card) && canPlayMagicNow && (
        <button onClick={() => onPlayMagic(card.instanceId)}>Play Magic</button>
      )}
`,
`      {isMagic(match, card) && canPlayMagicNow && (
        <>
          {isSilenceCard && !silenceCanPayCost && (
            <div className="warning-box compact-warning">
              Silence From The Grave requires 1 other Magic card in hand to discard before it can enter the Magic Chain.
            </div>
          )}
          <button onClick={() => onPlayMagic(card.instanceId)} disabled={!silenceCanPayCost}>
            Play Magic
          </button>
        </>
      )}
`,
      'HandZone Play Magic button replacement'
    );
  }

  return s;
});

patch('apps/client/src/components/MatchStatePanel.tsx', s => {
  s = s.replace(
    'import type { AppMatchState } from "../clientTypes";',
    'import type { CardInstance } from "@ward/shared";\nimport type { AppMatchState } from "../clientTypes";'
  );

  if (!s.includes('function getRuntimeEffectRows(')) {
    s = replaceOnce(
      s,
`type MatchStatePanelProps = {
  match: AppMatchState;
`,
`type RuntimeEffectRow = {
  id: string;
  owner: string;
  cardName: string;
  label: string;
  actionType: string;
  duration: string;
};

function getRuntimeEffectRows(match: AppMatchState): RuntimeEffectRow[] {
  const rows: RuntimeEffectRow[] = [];

  const addCard = (playerName: string, card: CardInstance | undefined) => {
    if (!card) return;
    const definition = match.cardCatalog[card.cardId];
    const cardName = definition?.name ?? card.cardId;

    for (const effect of card.activeEffectInstances ?? []) {
      const counterText = effect.turnCyclesRemaining !== undefined
        ? String(effect.turnCyclesRemaining) + " turn cycle(s) remaining"
        : effect.ticksRemaining !== undefined
          ? String(effect.ticksRemaining) + " tick(s) remaining"
          : effect.expiresAtPlayerTurnStartCount !== undefined
            ? "expires at turn-start count " + String(effect.expiresAtPlayerTurnStartCount)
            : "Active";

      rows.push({
        id: effect.id,
        owner: playerName,
        cardName,
        label: effect.label || effect.status || effect.actionType,
        actionType: effect.actionType,
        duration: effect.durationText || counterText
      });
    }
  };

  for (const player of match.players) {
    addCard(player.displayName, player.field.primaryCreature);
    for (const card of player.field.limitedSummons) addCard(player.displayName, card);
    for (const card of player.field.magicSlots) addCard(player.displayName, card);
    for (const card of player.hand) addCard(player.displayName, card);
    for (const card of player.cemetery) addCard(player.displayName, card);
  }

  return rows;
}

type MatchStatePanelProps = {
  match: AppMatchState;
`,
      'MatchStatePanel runtime effect rows helper'
    );
  }

  if (!s.includes('const runtimeEffectRows = getRuntimeEffectRows(match);')) {
    s = s.replace(
`}: MatchStatePanelProps) {
  return (`,
`}: MatchStatePanelProps) {
  const runtimeEffectRows = getRuntimeEffectRows(match);

  return (`
    );
  }

  if (!s.includes('Active Runtime Effects')) {
    s = replaceOnce(
      s,
`      {advanceBlockReason && (
`,
`      {runtimeEffectRows.length > 0 && (
        <div className="runtime-effects-panel">
          <h3>Active Runtime Effects</h3>
          <div className="mini-table">
            {runtimeEffectRows.map(effect => (
              <div className="mini-table-row" key={effect.id}>
                <strong>{effect.cardName}</strong>
                <span>{effect.owner}</span>
                <span>{effect.label}</span>
                <span>{effect.actionType}</span>
                <span>{effect.duration}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {advanceBlockReason && (
`,
      'MatchStatePanel Active Runtime Effects block'
    );
  }

  return s;
});

patch('packages/engine/src/battleEffectAdapter.ts', s => {
  if (!s.includes('const statChangeSuggestions = statChanges')) {
    s = replaceOnce(
      s,
`  for (let statIndex = 0; statIndex < statChanges.length; statIndex++) {
    const suggestion = suggestionFromStatChange(source, effect, creature, statChanges[statIndex], statIndex);
    if (suggestion) return suggestion;
  }

`,
`  const statChangeSuggestions = statChanges
    .map((change, statIndex) => suggestionFromStatChange(source, effect, creature, change, statIndex))
    .filter((suggestion): suggestion is BattleEffectSuggestion => Boolean(suggestion));

  if (statChangeSuggestions.length === 1) return statChangeSuggestions[0];
  if (statChangeSuggestions.length > 1) return statChangeSuggestions;

`,
      'BattleEffectAdapter multi-stat suggestion fix'
    );
  }

  return s;
});

patch('packages/engine/src/effectRollActions.ts', s => {
  return s.replace(
    'reason: "Limited Summons lose creature effects."',
    'reason: "Source creature effects are currently suppressed (Limited Summon, Silence From The Grave, or another negation effect)."'
  );
});

console.log('No-zip Silence + Epic Loot QA patch complete.');
console.log('Backup root: ' + backup.root);
'@

$PatchFile = Join-Path $ProjectRoot "_nozip_silence_epicloot_patch.cjs"
Set-Content -Path $PatchFile -Value $PatchJs -Encoding UTF8

Push-Location $ProjectRoot
try {
  node $PatchFile $ProjectRoot

  if (Test-Path ".\tools\card-generation\build-card-packs.mjs") {
    pnpm.cmd cards:check
  }

  if ((Get-Content .\package.json -Raw) -match '"effects:audit"') {
    pnpm.cmd effects:audit
  }

  pnpm.cmd check
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Patch complete. Restart server/client and hard refresh browser." -ForegroundColor Green