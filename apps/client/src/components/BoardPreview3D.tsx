import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEventHandler, type PointerEventHandler, type ReactNode, type WheelEventHandler } from "react";
import type { CardInstance, PendingBattleSession, PendingEffectRollSession, TurnPhase } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { BOARD_SLOTS, BOARD_ZONES, type BoardZone } from "./boardPreview3dLayout";
import { BoardPreview3DControls } from "./boardPreview3d/BoardPreview3DControls";
import { BoardPreview3DDebugPanel, type BoardZoneAdjustment } from "./boardPreview3d/BoardPreview3DDebugPanel";
import { BoardPreview3DMiniMap } from "./boardPreview3d/BoardPreview3DMiniMap";
import { BoardPreview3DTable, type BoardAttackAnimation } from "./boardPreview3d/BoardPreview3DTable";
import { BoardCardInspector } from "./boardPreview3d/BoardCardInspector";
import { MatchCardImage } from "./MatchCardImage";
import { ForcedAlSummonPromptCard } from "./ForcedAlSummonPromptCard";
import { parseLayoutSnapshotJson, resolveSlotPosition, toLayoutSnapshot } from "./boardPreview3dAdapter";
import { buildEffectTargetBoardOptions, slotIdFromTargetZoneRef } from "./boardTargetPromptMapping";
import { buildBoardInteractionContext, buildBoardRenderModel, translateGameEventsToBoardRenderEvents } from "./boardRenderAdapter";
import { createBoardAnimationQueueState, enqueueBoardRenderEvents, resetBoardAnimationQueueToSequence, settleActiveBoardAnimation, startNextBoardAnimation } from "./boardAnimationQueue";
import { getBoardAnimationProfile } from "./boardAnimationProfiles";
import { decideBoardReconciliation } from "./boardRenderReconciliation";
import { resolveBoardRuntimeMode } from "./boardRuntimeHealth";
import { getAdvanceBlockReason, getBattleBlockReason, getCardName, getPrimarySummonSacrificeCandidates, getRequiredSacrificesForCard, isCreature, isEquipMagic, isPendingEffectRollPhaseBlocking, playerHasSummonableCreatureInHand } from "../gameViewHelpers";
import { mapPointerGestureToIntent } from "./boardInteractionIntents";
import type { PointerGestureIntent } from "./boardInteractionIntents";
import type { BoardIntentCommand } from "./boardIntentCommands";
import { resolveBoardIntentCommand } from "./boardIntentCommands";
import type { BoardPieceFocusEvent, BoardPlayerId, BoardSlotFocusEvent, BoardSlotId, BoardSlotOffsetMap } from "./boardPreview3dTypes";
import { buildBattleAffordances, buildCardEffectAffordances, buildHandPlacementAffordances, buildMagicChainAffordances, buildPendingEffectTargetAffordances, buildPlayerGlobalAffordances } from "./boardAffordances";
import type { BoardAffordance } from "@ward/shared";

const BOARD_PREVIEW_STORAGE_KEY = "ward.boardPreview3D.settings";
const BOARD_PREVIEW_STORAGE_VERSION = 11;
const BOARD_PREVIEW_LAYOUT_STORAGE_VERSION = 10;
const BOARD_PREVIEW_VISIBILITY_DEFAULTS_VERSION = 11;
const BOARD_PREVIEW_CAMERA_DEFAULTS_VERSION = 1;

type FloatingDockPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type ActionDockPosition = "bottom" | "left" | "right";
type AttachTargetKind = "PRIMARY_CREATURE" | "LIMITED_SUMMON";

const FLOATING_DOCK_POSITIONS: FloatingDockPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const ACTION_DOCK_POSITIONS: ActionDockPosition[] = ["bottom", "left", "right"];
const TURN_PHASES: TurnPhase[] = ["DRAW", "SUMMON_MAGIC", "COMBAT", "SECOND_MAGIC", "END"];
const EMPTY_ZONE_ADJUSTMENT: BoardZoneAdjustment = { x: 0, z: 0, width: 0, height: 0 };
const DEFAULT_CAMERA_SETTINGS = {
  tiltDegrees: 0,
  zoomScale: 0.95,
  heightScale: 0.6,
  boardScaleX: 0.7,
  boardScaleZ: 0.7,
  boardOffsetX: 0,
  boardOffsetZ: -1,
  cameraPanX: 0,
  cameraPanY: -3
};
type VisibleSlotLayers = {
  primary: boolean;
  limited: boolean;
  magic: boolean;
  stacks: boolean;
  hand: boolean;
};
const DEFAULT_VISIBLE_SLOT_LAYERS: VisibleSlotLayers = {
  primary: false,
  limited: false,
  magic: false,
  stacks: false,
  hand: false
};

function getBrowserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function setBrowserStorageItem(key: string, value: string): void {
  try {
    getBrowserStorage()?.setItem(key, value);
  } catch {
    // Browsers can expose localStorage but reject writes in privacy modes.
  }
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    if (!globalThis.navigator?.clipboard?.writeText) return false;
    await globalThis.navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function sumDice(values: number[] | undefined): number {
  return (values ?? []).reduce((total, value) => total + value, 0);
}

function formatPhaseLabel(phase: string): string {
  return phase
    .split("_")
    .map(part => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" / ");
}

function getNextBoardPhaseLabel(match: AppMatchState): string {
  const phase = match.turn.phase as TurnPhase;
  const phaseIndex = TURN_PHASES.indexOf(phase);
  const nextPhase = phaseIndex >= 0 ? TURN_PHASES[phaseIndex + 1] : undefined;

  if (!nextPhase) {
    const activeIndex = match.players.findIndex(player => player.id === match.turn.activePlayerId);
    const nextPlayer = match.players[(activeIndex + 1) % match.players.length];
    return `${nextPlayer?.displayName ?? "next player"} Draw`;
  }

  if (phase === "SUMMON_MAGIC" && nextPhase === "COMBAT" && !match.turn.firstTurnCycleComplete) {
    return formatPhaseLabel("SECOND_MAGIC");
  }

  return formatPhaseLabel(nextPhase);
}

function getBattleStepLabel(battle: PendingBattleSession, effectRoll?: PendingEffectRollSession): string {
  if (effectRoll) return effectRoll.status === "AWAITING_ROLL" ? "Effect Roll" : "Apply Effect";
  if (battle.status === "AWAITING_SPEED_CHECK") return "Speed Check";
  if (battle.status === "AWAITING_HIT_ROLL") return "Hit Roll";
  if (battle.status === "AWAITING_DAMAGE_ROLL") return "Damage Roll";
  if (battle.status === "AWAITING_DAMAGE_APPLICATION") return "Apply Damage";
  if (battle.status === "COMPLETE") return "Finish Battle";
  return "Battle";
}

function getCurrentStrike(battle: PendingBattleSession) {
  return battle.strikes[battle.currentStrikeIndex];
}

function getLatestDiceRollVisual(match: AppMatchState): { id: string; label: string; values: number[] } | null {
  const battle = match.pendingBattle;
  const effectRoll = match.pendingEffectRoll;

  if (effectRoll?.rolledDice?.length) {
    return {
      id: `effect-${effectRoll.id}-${effectRoll.rolledDice.join("-")}`,
      label: "Effect Roll",
      values: effectRoll.rolledDice
    };
  }

  if (battle) {
    const currentStrike = getCurrentStrike(battle);
    if (currentStrike?.damageRollDice?.length) {
      return {
        id: `battle-damage-${battle.id}-${currentStrike.id}-${currentStrike.damageRollDice.join("-")}`,
        label: "Damage Roll",
        values: currentStrike.damageRollDice
      };
    }
    if (currentStrike?.selfDamageDice?.length) {
      return {
        id: `battle-self-${battle.id}-${currentStrike.id}-${currentStrike.selfDamageDice.join("-")}`,
        label: "Self Damage Roll",
        values: currentStrike.selfDamageDice
      };
    }
    if (currentStrike?.hitRollDice?.length) {
      return {
        id: `battle-hit-${battle.id}-${currentStrike.id}-${currentStrike.hitRollDice.join("-")}`,
        label: "Hit Roll",
        values: currentStrike.hitRollDice
      };
    }
    const latestSpeedTie = battle.speedTieRolls[battle.speedTieRolls.length - 1];
    if (latestSpeedTie) {
      const values = [latestSpeedTie.attackingCreatureRoll, latestSpeedTie.defendingCreatureRoll];
      return {
        id: `battle-speed-${battle.id}-${battle.speedTieRolls.length}-${values.join("-")}`,
        label: "Speed Tie Roll",
        values
      };
    }
  }

  const latestDamageEvent = [...match.eventLog].reverse().find(event => {
    if (event.type !== "BATTLE_DAMAGE_APPLIED" || !event.payload || typeof event.payload !== "object") return false;
    const payload = event.payload as Record<string, unknown>;
    return Array.isArray(payload.damageRollDice) && payload.damageRollDice.some(value => typeof value === "number");
  });
  if (latestDamageEvent?.payload && typeof latestDamageEvent.payload === "object") {
    const payload = latestDamageEvent.payload as Record<string, unknown>;
    const values = (payload.damageRollDice as unknown[]).filter((value): value is number => typeof value === "number");
    if (values.length > 0) {
      return {
        id: `battle-damage-applied-${latestDamageEvent.sequenceNumber}-${values.join("-")}`,
        label: "Damage Roll",
        values
      };
    }
  }

  const openingRoll = match.setup.openingRoll;
  if (openingRoll) {
    const values = Object.values(openingRoll.rolls).filter((value): value is number => typeof value === "number");
    if (values.length > 0) {
      return {
        id: `opening-${openingRoll.round}-${openingRoll.status}-${values.join("-")}`,
        label: "Opening Roll",
        values
      };
    }
  }

  return null;
}

function getAttackAnimationTheme(creatureType: string | undefined): BoardAttackAnimation["theme"] {
  switch ((creatureType ?? "").toLowerCase()) {
    case "beast":
    case "dinosaur":
      return "beast";
    case "bug":
      return "bug";
    case "cosmic":
      return "cosmic";
    case "demon":
      return "demon";
    case "dragon":
      return "dragon";
    case "elemental":
      return "elemental";
    case "humanoid":
    case "human":
      return "humanoid";
    case "mechanical":
      return "mechanical";
    case "undead":
      return "undead";
    default:
      return "generic";
  }
}

function BoardBattleResolverHud({
  battle,
  effectRoll,
  canAdvanceStep,
  controllerLabel,
  onApplyDamage,
  onFinish,
  onApplyEffect,
  onSkipEffect
}: {
  battle: PendingBattleSession;
  effectRoll?: PendingEffectRollSession;
  canAdvanceStep: boolean;
  controllerLabel: string;
  onApplyDamage?: (battleSessionId: string) => void;
  onFinish?: (battleSessionId: string) => void;
  onApplyEffect?: (effectRollSessionId: string) => void;
  onSkipEffect?: (effectRollSessionId: string) => void;
}) {
  const currentStrike = getCurrentStrike(battle);
  const actionLabel = getBattleStepLabel(battle, effectRoll);
  const hitTotal = currentStrike?.hitRollTotal ?? sumDice(currentStrike?.hitRollDice);
  const damageTotal = currentStrike?.damageDealt ?? sumDice(currentStrike?.damageRollDice);
  const canSkipEffectRoll = effectRoll ? !isPendingEffectRollPhaseBlocking(effectRoll) : false;

  return (
    <aside className="board-battle-hud" aria-label="3D battle resolver">
      <div className="board-battle-hud__header">
        <span>Battle Resolver</span>
        <strong>{actionLabel}</strong>
      </div>

      <div className="board-battle-hud__combatants">
        <div>
          <span>Attacker</span>
          <strong>{currentStrike?.attacker.creatureName ?? battle.declaredAttacker.creatureName}</strong>
          <small>SPD {currentStrike?.attacker.speed ?? battle.declaredAttacker.speed} / MOD {currentStrike?.attacker.modifier ?? battle.declaredAttacker.modifier}</small>
        </div>
        <div>
          <span>Target</span>
          <strong>{currentStrike?.defender.creatureName ?? battle.declaredDefender.creatureName}</strong>
          <small>SPD {currentStrike?.defender.speed ?? battle.declaredDefender.speed} / AL {currentStrike?.defenderArmorLevel ?? currentStrike?.defender.armorLevel ?? battle.declaredDefender.armorLevel}</small>
        </div>
      </div>

      <div className="board-battle-hud__steps" aria-hidden="true">
        {["SPD", "HIT", "FX", "DMG", "APPLY", "RET"].map(step => {
          const active =
            (step === "SPD" && battle.status === "AWAITING_SPEED_CHECK") ||
            (step === "HIT" && battle.status === "AWAITING_HIT_ROLL") ||
            (step === "FX" && Boolean(effectRoll)) ||
            (step === "DMG" && battle.status === "AWAITING_DAMAGE_ROLL") ||
            (step === "APPLY" && battle.status === "AWAITING_DAMAGE_APPLICATION") ||
            (step === "RET" && currentStrike?.role === "RETALIATION");
          return <i className={active ? "is-active" : undefined} key={step}>{step}</i>;
        })}
      </div>

      {battle.status !== "AWAITING_SPEED_CHECK" ? (
        <div className="board-battle-hud__speed">
          <span>{battle.declaredAttacker.creatureName}: {battle.effectiveAttackingSpeed ?? battle.declaredAttacker.speed}</span>
          <span>{battle.declaredDefender.creatureName}: {battle.effectiveDefendingSpeed ?? battle.declaredDefender.speed}</span>
        </div>
      ) : null}

      {currentStrike ? (
        <div className="board-battle-hud__rolls">
          {currentStrike.hitRollDice?.length ? <span>Hit {currentStrike.hitRollDice.join(", ")} = {hitTotal}</span> : null}
          {currentStrike.damageRollDice?.length ? <span>Damage {currentStrike.damageRollDice.join(", ")} = {damageTotal}</span> : null}
          {currentStrike.message ? <small>{currentStrike.message}</small> : null}
        </div>
      ) : null}

      {effectRoll ? (
        <div className="board-battle-hud__effect">
          <span>{effectRoll.sourceCardName}</span>
          <strong>{effectRoll.status === "ROLLED" ? `${effectRoll.rollTotal ?? sumDice(effectRoll.rolledDice)} ${effectRoll.success ? "success" : "fail"}` : `${effectRoll.diceCount}D6 effect`}</strong>
        </div>
      ) : null}

      {!canAdvanceStep ? (
        <div className="board-battle-hud__locked">
          Waiting for {controllerLabel}
        </div>
      ) : null}

      {battle.status === "AWAITING_SPEED_CHECK" || (battle.status === "AWAITING_HIT_ROLL" && !effectRoll) || (battle.status === "AWAITING_DAMAGE_ROLL" && !effectRoll) || effectRoll?.status === "AWAITING_ROLL" ? (
        <div className="board-battle-hud__dice-note">
          Use the board dice beside the deck.
        </div>
      ) : null}

      <div className="board-battle-hud__actions">
        {effectRoll?.status === "ROLLED" ? (
          <button type="button" disabled={!canAdvanceStep} onClick={() => onApplyEffect?.(effectRoll.id)}>{effectRoll.success ? "Apply Effect" : "Close Roll"}</button>
        ) : null}
        {effectRoll && canSkipEffectRoll ? (
          <button type="button" className="ghost" disabled={!canAdvanceStep} onClick={() => onSkipEffect?.(effectRoll.id)}>Skip</button>
        ) : null}
        {battle.status === "AWAITING_DAMAGE_APPLICATION" && !effectRoll ? (
          <button type="button" disabled={!canAdvanceStep} onClick={() => onApplyDamage?.(battle.id)}>Apply Damage</button>
        ) : null}
        {battle.status === "COMPLETE" ? (
          <button type="button" disabled={!canAdvanceStep} onClick={() => onFinish?.(battle.id)}>Finish</button>
        ) : null}
      </div>
    </aside>
  );
}

function BoardEffectRollHud({
  effectRoll,
  canAdvanceStep,
  controllerLabel,
  onApplyEffect,
  onSkipEffect
}: {
  effectRoll: PendingEffectRollSession;
  canAdvanceStep: boolean;
  controllerLabel: string;
  onApplyEffect?: (effectRollSessionId: string) => void;
  onSkipEffect?: (effectRollSessionId: string) => void;
}) {
  const total = effectRoll.rollTotal ?? sumDice(effectRoll.rolledDice);
  const canSkipEffectRoll = !isPendingEffectRollPhaseBlocking(effectRoll);

  return (
    <aside className="board-battle-hud board-battle-hud--effect" aria-label="3D effect roll resolver">
      <div className="board-battle-hud__header">
        <span>Effect Roll</span>
        <strong>{effectRoll.sourceCardName}</strong>
      </div>
      <div className="board-battle-hud__effect">
        <span>{effectRoll.targetCardName ?? "Effect target"}</span>
        <strong>{effectRoll.status === "ROLLED" ? `${total} ${effectRoll.success ? "success" : "fail"}` : `${effectRoll.diceCount}D6`}</strong>
        {effectRoll.message ? <small>{effectRoll.message}</small> : null}
      </div>
      {!canAdvanceStep ? (
        <div className="board-battle-hud__locked">
          Waiting for {controllerLabel}
        </div>
      ) : null}
      {effectRoll.status === "AWAITING_ROLL" ? (
        <div className="board-battle-hud__dice-note">
          Use the board dice beside the deck.
        </div>
      ) : null}
      <div className="board-battle-hud__actions">
        {effectRoll.status === "ROLLED" ? (
          <button type="button" disabled={!canAdvanceStep || !onApplyEffect} onClick={() => onApplyEffect?.(effectRoll.id)}>
            {effectRoll.success ? "Apply Effect" : "Close Roll"}
          </button>
        ) : null}
        {canSkipEffectRoll ? (
          <button type="button" className="ghost" disabled={!canAdvanceStep || !onSkipEffect} onClick={() => onSkipEffect?.(effectRoll.id)}>Skip</button>
        ) : null}
      </div>
    </aside>
  );
}

function BoardMagicChainHud({
  match,
  controlledPlayerId,
  onPassPriority,
  onResolve
}: {
  match: AppMatchState;
  controlledPlayerId?: string | null;
  onPassPriority?: (playerId: BoardPlayerId) => void;
  onResolve?: () => void;
}) {
  const chain = match.pendingChain;
  if (!chain) return null;

  const priorityPlayerId = chain.priorityPlayerId as BoardPlayerId | undefined;
  const priorityPlayerName = priorityPlayerId
    ? match.players.find(player => player.id === priorityPlayerId)?.displayName ?? priorityPlayerId
    : "No priority";
  const latestLink = chain.links[chain.links.length - 1];
  const latestLinkPlayerName = latestLink
    ? match.players.find(player => player.id === latestLink.playerId)?.displayName ?? latestLink.playerId
    : undefined;
  const chainStatusText = latestLink && priorityPlayerId
    ? `${latestLinkPlayerName} played ${latestLink.cardName}. Waiting for ${priorityPlayerName} to respond or pass.`
    : priorityPlayerId
      ? `Waiting for ${priorityPlayerName} to respond or pass.`
      : "Waiting for the chain to resolve.";
  const canAct = !controlledPlayerId || !priorityPlayerId || controlledPlayerId === priorityPlayerId;

  return (
    <aside className="board-battle-hud board-battle-hud--prompt" aria-label="Magic chain prompt">
      <div className="board-battle-hud__header">
        <div>
          <span>Magic Chain</span>
          <strong>{priorityPlayerName}</strong>
        </div>
        <small>{chain.links.length} link{chain.links.length === 1 ? "" : "s"}</small>
      </div>

      <div className="board-battle-hud__effect">
        <span>Latest Link</span>
        <strong>{latestLink?.cardName ?? "Pending chain"}</strong>
        <small>{latestLink ? `${latestLink.status} by ${latestLinkPlayerName}` : "Waiting"}</small>
        <small>{chainStatusText}</small>
      </div>

      <div className="board-battle-hud__actions">
        {priorityPlayerId ? (
          <button type="button" disabled={!canAct || !onPassPriority} onClick={() => onPassPriority?.(priorityPlayerId)}>
            Pass Priority
          </button>
        ) : null}
        <button type="button" disabled={!canAct || !onResolve} onClick={() => onResolve?.()}>
          Resolve Chain
        </button>
      </div>
    </aside>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type BoardPreview3DProps = {
  match: AppMatchState;
  adminView?: boolean;
  presentation?: "lab" | "game";
  defaultIntegrationMode?: boolean;
  actionDock?: ReactNode;
  onDeckSlotClick?: (slotId: string) => void;
  controlledPlayerId?: "player_1" | "player_2" | null;
  onAdvancePhase?: () => void;
  onUndoLastAction?: () => void;
  onRequestNoCreatureRedraw?: (playerId: "player_1" | "player_2") => void;
  onSetHandRevealed?: (playerId: "player_1" | "player_2", revealed: boolean) => void;
  onApproveRevealRedraw?: () => void;
  onResolveForcedAlSummon?: (cardInstanceId: string) => void;
  onMulliganForcedAlSummon?: () => void;
  onOpeningRoll?: (playerId: "player_1" | "player_2") => void;
  onOpenDiceRoller?: () => void;
  onPlayHandCardToSlot?: (cardInstanceId: string, slotId: string, sacrificeCardInstanceIds?: string[]) => void;
  onPlayLightningResponse?: (playerId: BoardPlayerId, cardInstanceId: string) => void;
  onPlayBattleResponse?: (battleSessionId: string, strikeId: string, playerId: BoardPlayerId, cardInstanceId: string) => void;
  onResolveMagicChain?: () => void;
  onPassMagicChainPriority?: (playerId: BoardPlayerId) => void;
  onDiscardHandCardToCemetery?: (playerId: BoardPlayerId, cardInstanceId: string) => void;
  onCallCemeteryHpLoss?: (losingPlayerId: BoardPlayerId, callingPlayerId: BoardPlayerId) => void;
  onEndTurn?: () => void;
  onAttachEquipMagicToCreature?: (
    fieldOwnerPlayerId: BoardPlayerId,
    magicCardInstanceId: string,
    targetPlayerId: BoardPlayerId,
    targetCreatureInstanceId: string,
    targetKind: AttachTargetKind
  ) => void;
  onStartBattleFromPiece?: (cardInstanceId: string, defenderCreatureInstanceId?: string) => void;
  onRunBattleSpeedCheck?: (battleSessionId: string) => void;
  onRollBattleHit?: (battleSessionId: string) => void;
  onRollBattleDamage?: (battleSessionId: string) => void;
  onApplyBattleDamage?: (battleSessionId: string) => void;
  onFinishBattle?: (battleSessionId: string) => void;
  onRollEffectRoll?: (effectRollSessionId: string) => void;
  onApplyEffectRoll?: (effectRollSessionId: string) => void;
  onSkipEffectRoll?: (effectRollSessionId: string) => void;
  onActivateCardEffect?: (sourceInstanceId: string, effectId: string) => void;
  onOpenBoardReport?: () => void;
  onSaveAndQuit?: () => void;
  intentLabel?: string;
  commandLabel?: string;
  onSlotFocus?: (event: BoardSlotFocusEvent) => void;
  onPieceFocus?: (event: BoardPieceFocusEvent) => void;
  onIntent?: (intent: PointerGestureIntent) => void;
  onIntentCommand?: (command: BoardIntentCommand) => void;
  onResolveEffectTarget?: (promptId: string, selectedOptionId: string) => void;
};

function DiceFace({ value }: { value?: number }) {
  const normalizedValue = value && value >= 1 && value <= 6 ? value : 1;

  return (
    <span className={`board-opening-roll__die board-opening-roll__die--${normalizedValue}`} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

type BoardDiceRollAction = {
  id: string;
  label: string;
  detail: string;
  owner: BoardPlayerId;
  disabled?: boolean;
  disabledLabel?: string;
  onClick: () => void;
};

function BoardDiceRollControl({ action }: { action: BoardDiceRollAction }) {
  return (
    <aside className={`board-dice-control board-dice-control--${action.owner}${action.disabled ? " is-disabled" : " is-ready"}`} aria-label="3D board dice roller">
      <button
        type="button"
        className="board-dice-control__event"
        disabled={action.disabled}
        onClick={action.onClick}
        title={action.disabled ? action.disabledLabel : action.detail}
      >
        <strong>{action.label}</strong>
        <span>{action.disabled ? action.disabledLabel ?? "Waiting" : action.detail}</span>
      </button>
      <button
        type="button"
        className="board-dice-control__die"
        disabled={action.disabled}
        onClick={action.onClick}
        title={action.disabled ? action.disabledLabel : `Roll dice: ${action.label}`}
      >
        <DiceFace value={6} />
      </button>
    </aside>
  );
}

function getOpeningRollViewState(match: AppMatchState) {
  if (match.setup.openingRoll) return match.setup.openingRoll;

  const noOpeningCardsDrawn =
    match.players.every(player => player.hand.length === 0) &&
    match.players.every(player => !match.setup.firstTurnDrawsByPlayer[player.id]);
  const appearsToBeFreshOpening =
    match.status !== "COMPLETE" &&
    noOpeningCardsDrawn &&
    match.turn.turnNumber === 1 &&
    match.turn.phase === "DRAW";

  if (!appearsToBeFreshOpening) return null;

  return {
    status: "AWAITING_ROLL" as const,
    round: 1,
    rolls: Object.fromEntries(match.players.map(player => [player.id, undefined])) as Record<string, number | undefined>
  };
}

function OpeningRollBoardControl({
  match,
  controlledPlayerId,
  onOpeningRoll
}: {
  match: AppMatchState;
  controlledPlayerId: BoardPlayerId | null;
  onOpeningRoll?: (playerId: BoardPlayerId) => void;
}) {
  const openingRoll = getOpeningRollViewState(match);
  if (!openingRoll) return null;

  const isComplete = openingRoll.status === "COMPLETE";
  const isResolverDiceActive = Boolean(match.pendingBattle || match.pendingEffectRoll);
  const rollPlayer = controlledPlayerId
    ? match.players.find(player => player.id === controlledPlayerId)
    : match.players.find(player => openingRoll.rolls[player.id] === undefined) ?? match.players[0];
  const canRoll = !isComplete && Boolean(rollPlayer) && openingRoll.rolls[rollPlayer!.id] === undefined;
  const hasCurrentRoundRoll = Object.values(openingRoll.rolls).some(value => value !== undefined);
  const displayedRolls = hasCurrentRoundRoll || !openingRoll.lastRolls
    ? openingRoll.rolls
    : openingRoll.lastRolls;
  const winnerName = openingRoll.winnerPlayerId
    ? match.players.find(player => player.id === openingRoll.winnerPlayerId)?.displayName ?? openingRoll.winnerPlayerId
    : null;

  if (isComplete) {
    if (isResolverDiceActive) return null;

    const winnerRoll = openingRoll.winnerPlayerId ? displayedRolls[openingRoll.winnerPlayerId] : undefined;

    return (
      <aside className="board-opening-roll board-opening-roll--mini is-complete" aria-label="Opening roll result">
        <DiceFace value={winnerRoll ?? 1} />
        <span className="board-opening-roll__mini-label">
          <strong>{winnerName ?? "First player"}</strong>
          <small>first set</small>
        </span>
      </aside>
    );
  }

  return (
    <aside className="board-opening-roll is-pending" aria-label="Opening low-roll control">
      <button
        type="button"
        className="board-opening-roll__trigger"
        onClick={() => {
          if (rollPlayer) onOpeningRoll?.(rollPlayer.id as BoardPlayerId);
        }}
        disabled={!canRoll}
        title={canRoll ? `Roll 1D6 for ${rollPlayer?.displayName ?? "player"}` : "Waiting for the other opening roll"}
      >
        <DiceFace value={displayedRolls[rollPlayer?.id ?? ""] ?? 1} />
        <span>Roll First</span>
      </button>

      <div className="board-opening-roll__lanes">
        {match.players.map(player => {
          const roll = displayedRolls[player.id];
          const hasRolled = roll !== undefined;
          return (
            <div className={`board-opening-roll__lane board-opening-roll__lane--${player.id}${hasRolled ? " has-roll" : ""}`} key={player.id}>
              <span>{player.displayName}</span>
              <DiceFace value={roll ?? 1} />
              <strong>{hasRolled ? roll : "-"}</strong>
            </div>
          );
        })}
      </div>

      <p>
        {openingRoll.lastRolls
          ? `Tie on round ${openingRoll.round - 1}. Roll again.`
          : `Low roll wins. Round ${openingRoll.round}.`}
      </p>
    </aside>
  );
}

export function BoardPreview3D({
  match,
  adminView = false,
  presentation = "lab",
  defaultIntegrationMode = false,
  actionDock,
  onDeckSlotClick,
  controlledPlayerId = null,
  onAdvancePhase,
  onUndoLastAction,
  onRequestNoCreatureRedraw,
  onSetHandRevealed,
  onApproveRevealRedraw,
  onResolveForcedAlSummon,
  onMulliganForcedAlSummon,
  onOpeningRoll,
  onOpenDiceRoller,
  onPlayHandCardToSlot,
  onPlayLightningResponse,
  onPlayBattleResponse,
  onResolveMagicChain,
  onPassMagicChainPriority,
  onDiscardHandCardToCemetery,
  onCallCemeteryHpLoss,
  onEndTurn,
  onAttachEquipMagicToCreature,
  onStartBattleFromPiece,
  onRunBattleSpeedCheck,
  onRollBattleHit,
  onRollBattleDamage,
  onApplyBattleDamage,
  onFinishBattle,
  onRollEffectRoll,
  onApplyEffectRoll,
  onSkipEffectRoll,
  onActivateCardEffect,
  onOpenBoardReport,
  onSaveAndQuit,
  intentLabel = "",
  commandLabel = "",
  onSlotFocus,
  onPieceFocus,
  onIntent,
  onIntentCommand,
  onResolveEffectTarget
}: BoardPreview3DProps) {
  const focusedPlayerId: BoardPlayerId = controlledPlayerId ?? (match.turn.activePlayerId === "player_1" ? "player_1" : "player_2");
  const [locallyRevealedHands, setLocallyRevealedHands] = useState<Partial<Record<BoardPlayerId, boolean>>>({});
  const revealedHandPlayerIds = match.setup.revealedHandPlayerIds ?? [];
  const handRevealMode = (() => {
    if (adminView && presentation === "lab") return "all";
    const revealedOwners = new Set<BoardPlayerId>();
    if (locallyRevealedHands.player_1 || revealedHandPlayerIds.includes("player_1")) revealedOwners.add("player_1");
    if (locallyRevealedHands.player_2 || revealedHandPlayerIds.includes("player_2")) revealedOwners.add("player_2");
    if (revealedOwners.size === 0) return null;
    return revealedOwners.size > 1 ? "all" : [...revealedOwners][0]!;
  })();
  const renderModel = useMemo(
    () => buildBoardRenderModel(match, { revealHandsForPlayerId: handRevealMode }),
    [handRevealMode, match]
  );
  const interactionContext = useMemo(() => buildBoardInteractionContext(match), [match]);
  const boardObjects = renderModel.boardObjects;
  const storageKey = presentation === "game" ? `${BOARD_PREVIEW_STORAGE_KEY}.game` : BOARD_PREVIEW_STORAGE_KEY;
  const [tiltDegrees, setTiltDegrees] = useState(DEFAULT_CAMERA_SETTINGS.tiltDegrees);
  const [zoomScale, setZoomScale] = useState(DEFAULT_CAMERA_SETTINGS.zoomScale);
  const [heightScale, setHeightScale] = useState(DEFAULT_CAMERA_SETTINGS.heightScale);
  const [boardScaleX, setBoardScaleX] = useState(DEFAULT_CAMERA_SETTINGS.boardScaleX);
  const [boardScaleZ, setBoardScaleZ] = useState(DEFAULT_CAMERA_SETTINGS.boardScaleZ);
  const [boardOffsetX, setBoardOffsetX] = useState(DEFAULT_CAMERA_SETTINGS.boardOffsetX);
  const [boardOffsetZ, setBoardOffsetZ] = useState(DEFAULT_CAMERA_SETTINGS.boardOffsetZ);
  const [cameraPanX, setCameraPanX] = useState(DEFAULT_CAMERA_SETTINGS.cameraPanX);
  const [cameraPanY, setCameraPanY] = useState(DEFAULT_CAMERA_SETTINGS.cameraPanY);
  const [showDebugPanel, setShowDebugPanel] = useState(() =>
    presentation === "game" ? false : (globalThis.innerHeight ? globalThis.innerHeight > 980 : true)
  );
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>("player_1-primary");
  const [slotOffsets, setSlotOffsets] = useState<BoardSlotOffsetMap>({});
  const [selectedZoneId, setSelectedZoneId] = useState(BOARD_ZONES[0]?.id ?? "");
  const [zoneAdjustments, setZoneAdjustments] = useState<Record<string, BoardZoneAdjustment>>({});
  const [nudgeStep, setNudgeStep] = useState(1);
  const [showAnchors, setShowAnchors] = useState(false);
  const [showZoneRects, setShowZoneRects] = useState(false);
  const [visibleSlotLayers, setVisibleSlotLayers] = useState<VisibleSlotLayers>(DEFAULT_VISIBLE_SLOT_LAYERS);
  const [layoutDraft, setLayoutDraft] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [layoutDraftError, setLayoutDraftError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastCopiedLabel, setLastCopiedLabel] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "player_1" | "player_2">("all");
  const [integrationMode, setIntegrationMode] = useState(defaultIntegrationMode);
  const [animationQueue, setAnimationQueue] = useState(createBoardAnimationQueueState);
  const [runtimeMode, setRuntimeMode] = useState<"ANIMATED" | "FAST_FORWARD">("ANIMATED");
  const renderEvents = useMemo(
    () => translateGameEventsToBoardRenderEvents(match, { afterSequenceNumber: animationQueue.cursor }),
    [animationQueue.cursor, match]
  );
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | null>(null);
  const [selectedEquipMagicCardId, setSelectedEquipMagicCardId] = useState<string | null>(null);
  const [pendingEquipMagicCardId, setPendingEquipMagicCardId] = useState<string | null>(null);
  const [selectedCreatureCardId, setSelectedCreatureCardId] = useState<string | null>(null);
  const [selectedBattleAttackerId, setSelectedBattleAttackerId] = useState<string | null>(null);
  const [selectedSacrificeIdsByCard, setSelectedSacrificeIdsByCard] = useState<Record<string, string[]>>({});
  const [hoveredHandCardId, setHoveredHandCardId] = useState<string | null>(null);
  const [selectedOpponentRevealCardId, setSelectedOpponentRevealCardId] = useState<string | null>(null);
  const [hoveredOpponentRevealCardId, setHoveredOpponentRevealCardId] = useState<string | null>(null);
  const [handInspectorDetailsExpanded, setHandInspectorDetailsExpanded] = useState(false);
  const [opponentRevealInspectorDetailsExpanded, setOpponentRevealInspectorDetailsExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [controlsDockPosition, setControlsDockPosition] = useState<FloatingDockPosition>("top-right");
  const [actionDockPosition, setActionDockPosition] = useState<ActionDockPosition>("right");
  const [actionDockCollapsed, setActionDockCollapsed] = useState(false);
  const [deckHandControlsOwner, setDeckHandControlsOwner] = useState<BoardPlayerId | null>(null);
  const [deckActionsExpanded, setDeckActionsExpanded] = useState(false);
  const [cemeteryViewerOwner, setCemeteryViewerOwner] = useState<BoardPlayerId | null>(null);
  const [hoveredCemeteryCardId, setHoveredCemeteryCardId] = useState<string | null>(null);
  const [selectedCemeteryCardId, setSelectedCemeteryCardId] = useState<string | null>(null);
  const [cemeteryInspectorDetailsExpanded, setCemeteryInspectorDetailsExpanded] = useState(false);
  const [isCameraDragging, setIsCameraDragging] = useState(false);
  const previousRenderModelRef = useRef<typeof renderModel | null>(null);
  const cameraDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const currentAttackAnimationKeyRef = useRef<string | null>(null);
  const playedAttackAnimationKeysRef = useRef<Set<string>>(new Set());
  const seenUnattachedEquipMagicIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    currentAttackAnimationKeyRef.current = null;
    playedAttackAnimationKeysRef.current.clear();
    seenUnattachedEquipMagicIdsRef.current = null;
  }, [match.matchId]);

  useEffect(() => {
    setAnimationQueue(current => {
      const decision = decideBoardReconciliation({
        previousModel: previousRenderModelRef.current,
        nextModel: renderModel,
        queueCursor: current.cursor
      });
      if (!previousRenderModelRef.current) {
        previousRenderModelRef.current = renderModel;
        return resetBoardAnimationQueueToSequence(current, renderModel.sequenceNumber);
      }
      previousRenderModelRef.current = renderModel;
      if (decision.shouldResetQueue) {
        return resetBoardAnimationQueueToSequence(current, renderModel.sequenceNumber);
      }
      return enqueueBoardRenderEvents(current, renderEvents);
    });
  }, [renderEvents, renderModel]);

  useEffect(() => {
    setAnimationQueue(current => startNextBoardAnimation(current));
  }, [animationQueue.activeEvent?.eventId, animationQueue.queue.length, renderEvents]);

  useEffect(() => {
    const updateRuntimeMode = () => {
      setRuntimeMode(resolveBoardRuntimeMode({
        queue: animationQueue,
        isDocumentHidden: Boolean(globalThis.document?.hidden)
      }));
    };
    updateRuntimeMode();
    globalThis.document?.addEventListener("visibilitychange", updateRuntimeMode);
    return () => globalThis.document?.removeEventListener("visibilitychange", updateRuntimeMode);
  }, [animationQueue]);

  useEffect(() => {
    if (!animationQueue.activeEvent) return;
    const profile = getBoardAnimationProfile(animationQueue.activeEvent.type);
    const plannedDurationMs = animationQueue.activeEvent.usesPlannerOutput
      ? Math.max(profile.durationMs, ...animationQueue.activeEvent.animationSteps.map(step => "durationMs" in step ? step.durationMs : 0))
      : profile.durationMs;
    if (runtimeMode === "FAST_FORWARD") {
      setAnimationQueue(current => settleActiveBoardAnimation(current));
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      setAnimationQueue(current => settleActiveBoardAnimation(current));
    }, plannedDurationMs);
    return () => globalThis.clearTimeout(timeout);
  }, [animationQueue.activeEvent, runtimeMode]);

  useEffect(() => {
    const storage = getBrowserStorage();
    const saved = storage?.getItem(storageKey);
    if (!saved) {
      setHydrated(true);
      return;
    }

    try {
      const parsedRaw = JSON.parse(saved) as Record<string, unknown>;
      const parsed = (typeof parsedRaw.version === "number"
        ? parsedRaw
        : { version: 1, ...parsedRaw }) as {
        version: number;
        cameraDefaultsVersion?: number;
        tiltDegrees?: number;
        zoomScale?: number;
        heightScale?: number;
        boardScaleX?: number;
        boardScaleZ?: number;
        boardOffsetX?: number;
        boardOffsetZ?: number;
        cameraPanX?: number;
        cameraPanY?: number;
        showDebugPanel?: boolean;
        selectedSlotId?: string | null;
        slotOffsets?: BoardSlotOffsetMap;
        selectedZoneId?: string;
        zoneAdjustments?: Record<string, BoardZoneAdjustment>;
        nudgeStep?: number;
        showAnchors?: boolean;
        showZoneRects?: boolean;
        visibleSlotLayers?: Partial<VisibleSlotLayers>;
        ownerFilter?: "all" | "player_1" | "player_2";
        showDiagnostics?: boolean;
        integrationMode?: boolean;
        controlsDockPosition?: FloatingDockPosition;
        actionDockPosition?: ActionDockPosition;
        actionDockCollapsed?: boolean;
      };
      if (parsed.cameraDefaultsVersion === BOARD_PREVIEW_CAMERA_DEFAULTS_VERSION) {
        if (typeof parsed.tiltDegrees === "number") setTiltDegrees(parsed.tiltDegrees);
        if (typeof parsed.zoomScale === "number") setZoomScale(parsed.zoomScale);
        if (typeof parsed.heightScale === "number") setHeightScale(parsed.heightScale);
        if (typeof parsed.boardScaleX === "number") setBoardScaleX(parsed.boardScaleX);
        if (typeof parsed.boardScaleZ === "number") setBoardScaleZ(parsed.boardScaleZ);
        if (typeof parsed.boardOffsetX === "number") setBoardOffsetX(parsed.boardOffsetX);
        if (typeof parsed.boardOffsetZ === "number") setBoardOffsetZ(parsed.boardOffsetZ);
        if (typeof parsed.cameraPanX === "number") setCameraPanX(parsed.cameraPanX);
        if (typeof parsed.cameraPanY === "number") setCameraPanY(parsed.cameraPanY);
      }
      if (typeof parsed.showDebugPanel === "boolean") setShowDebugPanel(parsed.showDebugPanel);
      if (typeof parsed.selectedSlotId === "string" || parsed.selectedSlotId === null) setSelectedSlotId(parsed.selectedSlotId);
      if (parsed.version >= BOARD_PREVIEW_LAYOUT_STORAGE_VERSION && parsed.slotOffsets) setSlotOffsets(parsed.slotOffsets);
      if (typeof parsed.selectedZoneId === "string" && BOARD_ZONES.some(zone => zone.id === parsed.selectedZoneId)) {
        setSelectedZoneId(parsed.selectedZoneId);
      }
      if (parsed.zoneAdjustments) setZoneAdjustments(parsed.zoneAdjustments);
      if (typeof parsed.nudgeStep === "number") setNudgeStep(parsed.nudgeStep);
      if (parsed.version >= BOARD_PREVIEW_VISIBILITY_DEFAULTS_VERSION && typeof parsed.showAnchors === "boolean") setShowAnchors(parsed.showAnchors);
      if (parsed.version >= BOARD_PREVIEW_VISIBILITY_DEFAULTS_VERSION && typeof parsed.showZoneRects === "boolean") setShowZoneRects(parsed.showZoneRects);
      if (parsed.version >= BOARD_PREVIEW_VISIBILITY_DEFAULTS_VERSION && parsed.visibleSlotLayers && typeof parsed.visibleSlotLayers === "object") {
        setVisibleSlotLayers({ ...DEFAULT_VISIBLE_SLOT_LAYERS, ...parsed.visibleSlotLayers });
      }
      if (parsed.ownerFilter === "all" || parsed.ownerFilter === "player_1" || parsed.ownerFilter === "player_2") setOwnerFilter(parsed.ownerFilter);
      if (typeof parsed.showDiagnostics === "boolean") setShowDiagnostics(parsed.showDiagnostics);
      if (typeof parsed.integrationMode === "boolean") setIntegrationMode(defaultIntegrationMode || parsed.integrationMode);
      if (FLOATING_DOCK_POSITIONS.includes(parsed.controlsDockPosition as FloatingDockPosition)) {
        setControlsDockPosition(parsed.controlsDockPosition as FloatingDockPosition);
      }
      if (parsed.version >= BOARD_PREVIEW_LAYOUT_STORAGE_VERSION && ACTION_DOCK_POSITIONS.includes(parsed.actionDockPosition as ActionDockPosition)) {
        setActionDockPosition(parsed.actionDockPosition as ActionDockPosition);
      }
      if (typeof parsed.actionDockCollapsed === "boolean") setActionDockCollapsed(parsed.actionDockCollapsed);

      if (parsed.version < BOARD_PREVIEW_STORAGE_VERSION) {
        const migratedSettings = {
          ...parsed,
          version: BOARD_PREVIEW_STORAGE_VERSION,
          showDiagnostics: false,
          ...(parsed.version < BOARD_PREVIEW_LAYOUT_STORAGE_VERSION ? { slotOffsets: {} } : {}),
          ...(parsed.version < BOARD_PREVIEW_VISIBILITY_DEFAULTS_VERSION
            ? { showAnchors: false, showZoneRects: false, visibleSlotLayers: DEFAULT_VISIBLE_SLOT_LAYERS }
            : {})
        };
        setBrowserStorageItem(
          storageKey,
          JSON.stringify(migratedSettings)
        );
      }
    } catch {
      // ignore malformed saved settings
    } finally {
      setHydrated(true);
    }
  }, [defaultIntegrationMode, presentation, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    setBrowserStorageItem(
      storageKey,
      JSON.stringify({ version: BOARD_PREVIEW_STORAGE_VERSION, cameraDefaultsVersion: BOARD_PREVIEW_CAMERA_DEFAULTS_VERSION, tiltDegrees, zoomScale, heightScale, boardScaleX, boardScaleZ, boardOffsetX, boardOffsetZ, cameraPanX, cameraPanY, showDebugPanel, selectedSlotId, slotOffsets, selectedZoneId, zoneAdjustments, nudgeStep, showAnchors, showZoneRects, visibleSlotLayers, ownerFilter, showDiagnostics, integrationMode, controlsDockPosition, actionDockPosition, actionDockCollapsed })
    );
  }, [actionDockCollapsed, actionDockPosition, boardOffsetX, boardOffsetZ, boardScaleX, boardScaleZ, cameraPanX, cameraPanY, controlsDockPosition, heightScale, hydrated, integrationMode, nudgeStep, ownerFilter, selectedSlotId, selectedZoneId, showAnchors, showDebugPanel, showDiagnostics, showZoneRects, slotOffsets, storageKey, tiltDegrees, visibleSlotLayers, zoneAdjustments, zoomScale]);

  const slotById = useMemo(() => new Map(BOARD_SLOTS.map((slot) => [slot.id, slot])), []);
  const handCards = useMemo(() => {
    const player = match.players.find((item) => item.id === focusedPlayerId);
    return player?.hand ?? [];
  }, [focusedPlayerId, match.players]);
  const cardByInstanceId = useMemo(() => {
    const cards = match.players.flatMap(player => [
      ...player.hand,
      ...player.deck,
      ...player.cemetery,
      ...player.field.limitedSummons,
      ...player.field.magicSlots.filter(Boolean),
      ...(player.field.primaryCreature ? [player.field.primaryCreature] : [])
    ]);
    return new Map(cards.map(card => [card.instanceId, card]));
  }, [match.players]);
  const inspectedHandCardId = hoveredHandCardId ?? selectedHandCardId;
  const inspectedHandCard = inspectedHandCardId
    ? handCards.find(card => card.instanceId === inspectedHandCardId) ?? null
    : null;
  const selectedHandCard = selectedHandCardId
    ? handCards.find(card => card.instanceId === selectedHandCardId) ?? null
    : null;
  const focusedPlayer = useMemo(
    () => match.players.find((player) => player.id === focusedPlayerId) ?? null,
    [focusedPlayerId, match.players]
  );
  const opponentPlayer = useMemo(
    () => match.players.find((player) => player.id !== focusedPlayerId) ?? null,
    [focusedPlayerId, match.players]
  );
  const opponentPlayerId: BoardPlayerId | null = opponentPlayer
    ? opponentPlayer.id === "player_1" ? "player_1" : "player_2"
    : null;
  const canControlPlayer = useCallback(
    (playerId: string) => !controlledPlayerId || controlledPlayerId === playerId,
    [controlledPlayerId]
  );
  const opponentHandIsRevealed = opponentPlayerId
    ? Boolean(locallyRevealedHands[opponentPlayerId]) || revealedHandPlayerIds.includes(opponentPlayerId)
    : false;
  const noCreatureRevealPrompt = match.pendingPrompt?.type === "NO_CREATURE_REDRAW_REVEAL"
    ? match.pendingPrompt
    : undefined;
  const canApprovePendingReveal = Boolean(
    noCreatureRevealPrompt &&
    (!controlledPlayerId || controlledPlayerId === noCreatureRevealPrompt.approvingPlayerId)
  );
  const opponentPromptRevealCards = opponentPlayer && canApprovePendingReveal && noCreatureRevealPrompt?.requestingPlayerId === opponentPlayer.id
    ? noCreatureRevealPrompt.revealedCards.map(card => ({
      instanceId: card.cardInstanceId,
      cardId: card.cardId,
      ownerPlayerId: opponentPlayer.id,
      controllerPlayerId: opponentPlayer.id,
      zone: "HAND" as const
    }))
    : [];

  useEffect(() => {
    setHandInspectorDetailsExpanded(false);
  }, [inspectedHandCardId]);

  const cemeteryViewerPlayer = cemeteryViewerOwner
    ? match.players.find(player => player.id === cemeteryViewerOwner) ?? null
    : null;
  const cemeteryCards = cemeteryViewerPlayer?.cemetery ?? [];
  const inspectedCemeteryCardId = hoveredCemeteryCardId ?? selectedCemeteryCardId ?? cemeteryCards[cemeteryCards.length - 1]?.instanceId ?? null;
  const inspectedCemeteryCard = inspectedCemeteryCardId
    ? cemeteryCards.find(card => card.instanceId === inspectedCemeteryCardId) ?? null
    : null;

  useEffect(() => {
    if (!cemeteryViewerOwner) return;
    const player = match.players.find(item => item.id === cemeteryViewerOwner);
    if (!player) {
      setCemeteryViewerOwner(null);
      setSelectedCemeteryCardId(null);
      setHoveredCemeteryCardId(null);
      return;
    }
    setSelectedCemeteryCardId(current => current && player.cemetery.some(card => card.instanceId === current) ? current : player.cemetery[player.cemetery.length - 1]?.instanceId ?? null);
  }, [cemeteryViewerOwner, match.players]);

  useEffect(() => {
    setCemeteryInspectorDetailsExpanded(false);
  }, [inspectedCemeteryCardId]);

  const visibleOpponentHandCards = opponentPromptRevealCards.length > 0
    ? opponentPromptRevealCards
    : opponentHandIsRevealed
      ? opponentPlayer?.hand ?? []
      : [];
  const opponentHandHasPrompt = Boolean(noCreatureRevealPrompt && canApprovePendingReveal && opponentPromptRevealCards.length > 0);
  const canInspectOpponentHand = visibleOpponentHandCards.length > 0;
  const inspectedOpponentRevealCardId = opponentHandHasPrompt
    ? hoveredOpponentRevealCardId ?? selectedOpponentRevealCardId
    : canInspectOpponentHand
      ? hoveredOpponentRevealCardId ?? selectedOpponentRevealCardId
    : null;
  const inspectedOpponentRevealCard = inspectedOpponentRevealCardId
    ? visibleOpponentHandCards.find(card => card.instanceId === inspectedOpponentRevealCardId) ?? null
    : null;

  useEffect(() => {
    setOpponentRevealInspectorDetailsExpanded(false);
  }, [inspectedOpponentRevealCardId]);

  useEffect(() => {
    if (!canInspectOpponentHand) {
      setSelectedOpponentRevealCardId(null);
      setHoveredOpponentRevealCardId(null);
      return;
    }
    setSelectedOpponentRevealCardId(current =>
      current && visibleOpponentHandCards.some(card => card.instanceId === current) ? current : null
    );
  }, [canInspectOpponentHand, visibleOpponentHandCards]);
  const occupiedSlotIds = useMemo(
    () => new Set<string>(boardObjects.filter((object) => object.lane !== "hand").map((object) => object.slotId)),
    [boardObjects]
  );
  const selectedSummonRequiredSacrifices =
    selectedHandCard && isCreature(match, selectedHandCard)
      ? getRequiredSacrificesForCard(match, selectedHandCard)
      : 0;
  const sacrificeCandidates = useMemo(() => {
    if (!selectedHandCard || !focusedPlayer || !isCreature(match, selectedHandCard)) return [] as CardInstance[];
    if (selectedSummonRequiredSacrifices <= 0) return [] as CardInstance[];
    return getPrimarySummonSacrificeCandidates(match, focusedPlayer, selectedHandCard);
  }, [focusedPlayer, match, selectedHandCard, selectedSummonRequiredSacrifices]);
  const sacrificeCandidateIds = useMemo(
    () => new Set(sacrificeCandidates.map(card => card.instanceId)),
    [sacrificeCandidates]
  );
  const selectedSacrificeIds = selectedHandCardId
    ? (selectedSacrificeIdsByCard[selectedHandCardId] ?? []).filter(id => sacrificeCandidateIds.has(id)).slice(0, selectedSummonRequiredSacrifices)
    : [];
  const selectedSacrificeIdSet = useMemo(() => new Set(selectedSacrificeIds), [selectedSacrificeIds]);
  const sacrificeSelectionActive = Boolean(selectedHandCard && selectedSummonRequiredSacrifices > 0);
  const sacrificeSelectionComplete = selectedSacrificeIds.length >= selectedSummonRequiredSacrifices;
  const sacrificeDropSlotId = `${focusedPlayerId}-cemetery`;
  const discardRequiredForFocusedPlayer =
    match.setup.handDiscardRequiredForPlayerId === focusedPlayerId &&
    canControlPlayer(focusedPlayerId);

  const toggleSacrificeSelection = useCallback((cardInstanceId: string) => {
    if (!selectedHandCardId || !sacrificeCandidateIds.has(cardInstanceId) || selectedSummonRequiredSacrifices <= 0) return;
    setSelectedSacrificeIdsByCard(current => {
      const currentIds = current[selectedHandCardId] ?? [];
      const nextIds = currentIds.includes(cardInstanceId)
        ? currentIds.filter(id => id !== cardInstanceId)
        : [...currentIds, cardInstanceId].slice(0, selectedSummonRequiredSacrifices);
      return {
        ...current,
        [selectedHandCardId]: nextIds
      };
    });
  }, [sacrificeCandidateIds, selectedHandCardId, selectedSummonRequiredSacrifices]);

  const occupiedMagicSlotIndexes = useMemo(
    () => Array.from({ length: 5 }, (_, index) => index)
      .filter(index => occupiedSlotIds.has(`${focusedPlayerId}-magic-${index + 1}`)),
    [focusedPlayerId, occupiedSlotIds]
  );
  const handPlacementAffordances = useMemo(() => buildHandPlacementAffordances({
    match,
    playerId: focusedPlayerId,
    controlledPlayerId,
    selectedHandCardId,
    selectedSacrificeIdsByCard,
    occupiedMagicSlotIndexes
  }), [controlledPlayerId, focusedPlayerId, match, occupiedMagicSlotIndexes, selectedHandCardId, selectedSacrificeIdsByCard]);
  const magicChainAffordances = useMemo(
    () => buildMagicChainAffordances(match, controlledPlayerId),
    [controlledPlayerId, match]
  );
  const battleAffordances = useMemo(
    () => buildBattleAffordances(match, controlledPlayerId),
    [controlledPlayerId, match]
  );
  const cardEffectAffordances = useMemo(
    () => buildCardEffectAffordances(match, controlledPlayerId),
    [controlledPlayerId, match]
  );
  const playerGlobalAffordances = useMemo(
    () => buildPlayerGlobalAffordances(match, controlledPlayerId),
    [controlledPlayerId, match]
  );
  const combinedHandAffordances = useMemo(
    () => [
      ...handPlacementAffordances,
      ...playerGlobalAffordances,
      ...(match.pendingChain ? magicChainAffordances : []),
      ...battleAffordances
    ],
    [battleAffordances, handPlacementAffordances, magicChainAffordances, match.pendingChain, playerGlobalAffordances]
  );
  const getDropZoneSlotIdsForCard = useCallback((cardInstanceId: string) => {
    return combinedHandAffordances.flatMap(affordance => {
      if (
        affordance.kind !== "VALID_DROP_ZONE" ||
        affordance.sourceCardInstanceId !== cardInstanceId ||
        affordance.highlightStyle !== "VALID"
      ) {
        return [] as string[];
      }
      const slotId = slotIdFromTargetZoneRef(affordance.targetZoneRef);
      return slotId ? [slotId] : [];
    });
  }, [combinedHandAffordances]);
  const getLegalTargetSlotIdsForCard = useCallback((cardInstanceId: string) => {
    if (
      match.setup.handDiscardRequiredForPlayerId === focusedPlayerId &&
      canControlPlayer(focusedPlayerId) &&
      onDiscardHandCardToCemetery
    ) {
      return [`${focusedPlayerId}-cemetery`];
    }
    return getDropZoneSlotIdsForCard(cardInstanceId);
  }, [focusedPlayerId, getDropZoneSlotIdsForCard, match.setup.handDiscardRequiredForPlayerId, onDiscardHandCardToCemetery]);
  const playableHandCardIds = useMemo(
    () => new Set(combinedHandAffordances
      .filter(affordance => (affordance.kind === "PLAYABLE_CARD" || affordance.kind === "VALID_CHAIN_RESPONSE" || affordance.kind === "VALID_BATTLE_RESPONSE") && affordance.sourceCardInstanceId)
      .map(affordance => affordance.sourceCardInstanceId!)),
    [combinedHandAffordances]
  );
  const playableChainResponseCardIds = useMemo(
    () => new Set(magicChainAffordances
      .filter(affordance => affordance.kind === "VALID_CHAIN_RESPONSE" && affordance.actionId === "PLAY_LIGHTNING_RESPONSE" && affordance.sourceCardInstanceId)
      .map(affordance => affordance.sourceCardInstanceId!)),
    [magicChainAffordances]
  );
  const playableBattleResponseCardIds = useMemo(
    () => new Set(battleAffordances
      .filter(affordance => affordance.kind === "VALID_BATTLE_RESPONSE" && affordance.actionId === "PLAY_BATTLE_RESPONSE" && affordance.sourceCardInstanceId)
      .map(affordance => affordance.sourceCardInstanceId!)),
    [battleAffordances]
  );
  const disabledHandCardReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const affordance of combinedHandAffordances) {
      if (
        affordance.kind === "DISABLED_ACTION" &&
        affordance.sourceCardInstanceId &&
        !playableHandCardIds.has(affordance.sourceCardInstanceId) &&
        !affordance.targetZoneRef &&
        affordance.disabledReason
      ) {
        reasons.set(affordance.sourceCardInstanceId, affordance.disabledReason);
      }
    }
    return reasons;
  }, [combinedHandAffordances, playableHandCardIds]);
  const visualTargetSlotIds = useMemo(() => {
    if (!selectedHandCardId) return [] as string[];
    return getDropZoneSlotIdsForCard(selectedHandCardId);
  }, [getDropZoneSlotIdsForCard, selectedHandCardId]);
  const playerGlobalSlotIds = useMemo(() => {
    return playerGlobalAffordances.flatMap(affordance => {
      if (affordance.kind !== "AFFECTED_PLAYER_SIDE" && affordance.kind !== "DISABLED_ACTION") return [] as string[];
      const playerId = affordance.playerId === "player_1" || affordance.playerId === "player_2" ? affordance.playerId : null;
      if (!playerId) return [] as string[];
      return [`${playerId}-primary`, `${playerId}-limited-1`, `${playerId}-limited-2`, `${playerId}-magic-1`, `${playerId}-magic-2`, `${playerId}-magic-3`, `${playerId}-magic-4`, `${playerId}-magic-5`, `${playerId}-cemetery`];
    });
  }, [playerGlobalAffordances]);
  const sacrificeTargetSlotIds = sacrificeSelectionActive ? [sacrificeDropSlotId] : [];
  const sacrificeCandidatePieceIds = useMemo(() => {
    if (!sacrificeCandidateIds.size) return [] as string[];
    return boardObjects
      .filter(object => object.cardInstanceId && sacrificeCandidateIds.has(object.cardInstanceId))
      .map(object => object.id);
  }, [boardObjects, sacrificeCandidateIds]);
  const selectedCreatureEquipmentFocusPieceIds = useMemo(() => {
    if (!selectedCreatureCardId) return [] as string[];
    const creatureObject = boardObjects.find(object =>
      object.cardInstanceId === selectedCreatureCardId &&
      (object.lane === "primary" || object.lane === "limited")
    );
    if (!creatureObject) return [] as string[];

    const attachedEquipmentPieceIds = boardObjects.flatMap(object => {
      if (!object.cardInstanceId || object.lane !== "magic") return [] as string[];
      const card = cardByInstanceId.get(object.cardInstanceId);
      return card?.attachedToInstanceId === selectedCreatureCardId ? [object.id] : [];
    });

    return [creatureObject.id, ...attachedEquipmentPieceIds];
  }, [boardObjects, cardByInstanceId, selectedCreatureCardId]);
  const selectedEquipMagic = useMemo(() => {
    if (!selectedEquipMagicCardId) return null;
    const object = boardObjects.find(candidate => candidate.cardInstanceId === selectedEquipMagicCardId);
    if (!object || object.lane !== "magic") return null;
    const card = cardByInstanceId.get(selectedEquipMagicCardId);
    if (!card || !isEquipMagic(match, card) || card.attachedToInstanceId) return null;
    return { card, object };
  }, [boardObjects, cardByInstanceId, match, selectedEquipMagicCardId]);
  const canAttachSelectedEquipMagic = Boolean(
    selectedEquipMagic &&
    canControlPlayer(selectedEquipMagic.object.owner) &&
    !match.pendingPrompt &&
    !match.pendingChain &&
    !match.pendingEffectTargetPrompt &&
    !match.setup.handDiscardRequiredForPlayerId &&
    !match.setup.primaryReplacementRequiredForPlayerId
  );
  const equipAttachTargetOptions = useMemo(() => {
    if (!selectedEquipMagic || !canAttachSelectedEquipMagic) {
      return [] as Array<{ pieceId: string; playerId: BoardPlayerId; creatureInstanceId: string; targetKind: AttachTargetKind }>;
    }

    return boardObjects.flatMap(object => {
      if (!object.cardInstanceId || (object.lane !== "primary" && object.lane !== "limited")) return [];
      return [{
        pieceId: object.id,
        playerId: object.owner,
        creatureInstanceId: object.cardInstanceId,
        targetKind: object.lane === "primary" ? "PRIMARY_CREATURE" as const : "LIMITED_SUMMON" as const
      }];
    });
  }, [boardObjects, canAttachSelectedEquipMagic, selectedEquipMagic]);
  const equipAttachTargetPieceIds = useMemo(
    () => equipAttachTargetOptions.map(option => option.pieceId),
    [equipAttachTargetOptions]
  );
  const equipAttachSourcePieceIds = selectedEquipMagic ? [selectedEquipMagic.object.id] : [];
  const draggableEquipMagicCardIds = useMemo(() => {
    if (
      match.pendingPrompt ||
      match.pendingChain ||
      match.pendingEffectTargetPrompt ||
      match.setup.handDiscardRequiredForPlayerId ||
      match.setup.primaryReplacementRequiredForPlayerId
    ) {
      return [] as string[];
    }

    return boardObjects.flatMap(object => {
      if (object.lane !== "magic" || !object.cardInstanceId || !canControlPlayer(object.owner)) return [];
      const card = cardByInstanceId.get(object.cardInstanceId);
      if (!card || !isEquipMagic(match, card) || card.attachedToInstanceId) return [];
      return [card.instanceId];
    });
  }, [boardObjects, cardByInstanceId, canControlPlayer, match]);
  const pendingEffectTargetAffordances = useMemo(() => {
    const prompt = match.pendingEffectTargetPrompt;
    if (!prompt) return [] as BoardAffordance[];
    if (controlledPlayerId && controlledPlayerId !== prompt.controllerPlayerId) return [] as BoardAffordance[];
    return buildPendingEffectTargetAffordances(prompt, controlledPlayerId);
  }, [controlledPlayerId, match.pendingEffectTargetPrompt]);

  const effectTargetBoardOptions = useMemo(() => buildEffectTargetBoardOptions({
    pendingEffectTargetAffordances,
    boardObjects,
    prompt: match.pendingEffectTargetPrompt,
    controlledPlayerId
  }), [boardObjects, controlledPlayerId, match.pendingEffectTargetPrompt, pendingEffectTargetAffordances]);
  const effectTargetSlotIds = useMemo(
    () => [...new Set(effectTargetBoardOptions.map(option => option.slotId).filter((slotId): slotId is string => !!slotId))],
    [effectTargetBoardOptions]
  );
  const effectTargetPieceIds = useMemo(
    () => [...new Set(effectTargetBoardOptions.map(option => option.pieceId).filter((pieceId): pieceId is string => !!pieceId))],
    [effectTargetBoardOptions]
  );
  const effectSourcePieceIds = useMemo(() => {
    const prompt = match.pendingEffectTargetPrompt;
    if (!prompt) return [] as string[];
    const sourceObject = boardObjects.find(object => object.cardInstanceId === prompt.sourceCardInstanceId);
    return sourceObject ? [sourceObject.id] : [];
  }, [boardObjects, match.pendingEffectTargetPrompt]);
  const validCardEffectAffordances = useMemo(
    () => cardEffectAffordances.filter(affordance =>
      affordance.kind === "VALID_CARD_EFFECT" &&
      affordance.actionId?.startsWith("ACTIVATE_CARD_EFFECT:") &&
      affordance.sourceCardInstanceId
    ),
    [cardEffectAffordances]
  );
  const cardEffectSourcePieceIds = useMemo(() => {
    const sourceIds = new Set(validCardEffectAffordances.map(affordance => affordance.sourceCardInstanceId));
    if (sourceIds.size === 0) return [] as string[];
    return boardObjects
      .filter(object => object.cardInstanceId && sourceIds.has(object.cardInstanceId))
      .map(object => object.id);
  }, [boardObjects, validCardEffectAffordances]);
  const selectedCardEffectAffordance = useMemo(() => {
    if (selectedCreatureCardId) {
      const selected = validCardEffectAffordances.find(affordance =>
        affordance.sourceCardInstanceId === selectedCreatureCardId
      );
      if (selected) return selected;
    }

    return validCardEffectAffordances.find(affordance => affordance.playerId === focusedPlayerId) ??
      validCardEffectAffordances[0] ??
      null;
  }, [focusedPlayerId, selectedCreatureCardId, validCardEffectAffordances]);
  const effectTargetOptionByCardId = useMemo(() => {
    const prompt = match.pendingEffectTargetPrompt;
    const options = new Map<string, string>();
    for (const affordance of pendingEffectTargetAffordances) {
      if (
        (
          affordance.kind === "VALID_TARGET_CARD" ||
          affordance.kind === "VALID_DISCARD_CARD" ||
          affordance.kind === "REVEALED_HAND_CARD"
        ) &&
        affordance.targetCardInstanceId &&
        affordance.actionId
      ) {
        options.set(affordance.targetCardInstanceId, affordance.actionId);
      }
    }
    if (!prompt || options.size > 0) return options;
    if (controlledPlayerId && controlledPlayerId !== prompt.controllerPlayerId) return options;
    for (const option of prompt.options) {
      if (option.cardInstanceId) options.set(option.cardInstanceId, option.id);
    }
    return options;
  }, [controlledPlayerId, match.pendingEffectTargetPrompt, pendingEffectTargetAffordances]);
  const resolveBoardEffectTarget = (optionId: string) => {
    const prompt = match.pendingEffectTargetPrompt;
    if (!prompt) return;
    onResolveEffectTarget?.(prompt.id, optionId);
  };
  const resolveBoardEffectTargetFromPiece = (pieceId: string) => {
    const effectTarget = effectTargetBoardOptions.find(option => option.pieceId === pieceId);
    if (!effectTarget) return false;
    resolveBoardEffectTarget(effectTarget.optionId);
    return true;
  };
  const resolveBoardEffectTargetFromSlot = (slotId: string) => {
    const effectTarget = effectTargetBoardOptions.find(option => option.slotId === slotId);
    if (!effectTarget) return false;
    resolveBoardEffectTarget(effectTarget.optionId);
    return true;
  };

  useEffect(() => {
    const prompt = match.pendingEffectTargetPrompt;
    if (!prompt || prompt.targetKind !== "CARD_IN_CEMETERY") return;
    if (controlledPlayerId && controlledPlayerId !== prompt.controllerPlayerId) return;
    const firstCemeteryOption = prompt.options.find(option => option.zone === "CEMETERY" && option.playerId);
    const owner = firstCemeteryOption?.playerId === "player_1" || firstCemeteryOption?.playerId === "player_2"
      ? firstCemeteryOption.playerId
      : null;
    if (!owner) return;
    setCemeteryViewerOwner(owner);
    setSelectedCemeteryCardId(firstCemeteryOption?.cardInstanceId ?? null);
  }, [controlledPlayerId, match.pendingEffectTargetPrompt]);

  useEffect(() => {
    setSelectedSacrificeIdsByCard(current => {
      const handIds = new Set(handCards.map(card => card.instanceId));
      const candidateIds = new Set<string>();
      for (const player of match.players) {
        if (player.field.primaryCreature) candidateIds.add(player.field.primaryCreature.instanceId);
        for (const card of player.hand) candidateIds.add(card.instanceId);
      }

      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [cardId, sacrificeIds] of Object.entries(current)) {
        if (!handIds.has(cardId)) {
          changed = true;
          continue;
        }
        const filtered = sacrificeIds.filter(id => candidateIds.has(id));
        if (filtered.length !== sacrificeIds.length) changed = true;
        if (filtered.length > 0) next[cardId] = filtered;
      }

      if (!changed && Object.keys(next).length === Object.keys(current).length) return current;
      return next;
    });
  }, [handCards, match.players]);

  useEffect(() => {
    if (!selectedEquipMagicCardId) return;
    const card = cardByInstanceId.get(selectedEquipMagicCardId);
    const object = boardObjects.find(candidate => candidate.cardInstanceId === selectedEquipMagicCardId);
    if (!card || card.attachedToInstanceId || !isEquipMagic(match, card)) {
      setSelectedEquipMagicCardId(null);
      if (pendingEquipMagicCardId === selectedEquipMagicCardId) setPendingEquipMagicCardId(null);
      return;
    }
    if (!object || object.lane !== "magic") {
      if (pendingEquipMagicCardId === selectedEquipMagicCardId && (!object || object.lane === "hand")) return;
      setSelectedEquipMagicCardId(null);
      if (pendingEquipMagicCardId === selectedEquipMagicCardId) setPendingEquipMagicCardId(null);
    }
  }, [boardObjects, cardByInstanceId, match, pendingEquipMagicCardId, selectedEquipMagicCardId]);

  useEffect(() => {
    if (!pendingEquipMagicCardId) return;
    const card = cardByInstanceId.get(pendingEquipMagicCardId);
    const object = boardObjects.find(candidate => candidate.cardInstanceId === pendingEquipMagicCardId);
    if (!card || card.attachedToInstanceId || !isEquipMagic(match, card)) {
      setPendingEquipMagicCardId(null);
      if (selectedEquipMagicCardId === pendingEquipMagicCardId) setSelectedEquipMagicCardId(null);
      return;
    }
    if (!object || object.lane === "hand") return;
    if (object.lane !== "magic") {
      setPendingEquipMagicCardId(null);
      if (selectedEquipMagicCardId === pendingEquipMagicCardId) setSelectedEquipMagicCardId(null);
      return;
    }
    setSelectedEquipMagicCardId(pendingEquipMagicCardId);
    setPendingEquipMagicCardId(null);
  }, [boardObjects, cardByInstanceId, match, pendingEquipMagicCardId, selectedEquipMagicCardId]);

  useEffect(() => {
    const currentUnattachedEquipMagicIds = new Set<string>();
    const newlySeenEquipMagicIds: string[] = [];
    const previousUnattachedEquipMagicIds = seenUnattachedEquipMagicIdsRef.current;

    for (const object of boardObjects) {
      if (object.lane !== "magic" || !object.cardInstanceId || !canControlPlayer(object.owner)) continue;
      const card = cardByInstanceId.get(object.cardInstanceId);
      if (!card || card.attachedToInstanceId || !isEquipMagic(match, card)) continue;

      currentUnattachedEquipMagicIds.add(card.instanceId);
      if (previousUnattachedEquipMagicIds && !previousUnattachedEquipMagicIds.has(card.instanceId)) {
        newlySeenEquipMagicIds.push(card.instanceId);
      }
    }

    seenUnattachedEquipMagicIdsRef.current = currentUnattachedEquipMagicIds;
    const nextEquipMagicCardId = newlySeenEquipMagicIds[newlySeenEquipMagicIds.length - 1];
    if (!nextEquipMagicCardId || selectedEquipMagicCardId === nextEquipMagicCardId) return;

    setSelectedCreatureCardId(null);
    setPendingEquipMagicCardId(null);
    setSelectedEquipMagicCardId(nextEquipMagicCardId);
    setStatusMessage("Select a creature on the 3D board to attach this Equip Magic.");
  }, [boardObjects, cardByInstanceId, canControlPlayer, match, selectedEquipMagicCardId]);

  useEffect(() => {
    if (!selectedCreatureCardId) return;
    const creatureStillOnBoard = boardObjects.some(object =>
      object.cardInstanceId === selectedCreatureCardId &&
      (object.lane === "primary" || object.lane === "limited")
    );
    if (!creatureStillOnBoard) setSelectedCreatureCardId(null);
  }, [boardObjects, selectedCreatureCardId]);

  const activeBattlePlayer = useMemo(
    () => match.players.find(player => player.id === match.turn.activePlayerId) ?? null,
    [match.players, match.turn.activePlayerId]
  );
  const battleBlockReason = getBattleBlockReason(match);
  const battleControlEnabled = Boolean(
    activeBattlePlayer &&
    !battleBlockReason &&
    canControlPlayer(activeBattlePlayer.id)
  );
  const legalBattleAttackerIds = useMemo(() => {
    if (!activeBattlePlayer || !battleControlEnabled) return new Set<string>();
    return new Set(
      battleAffordances
        .filter(affordance => affordance.kind === "VALID_BATTLE_ATTACKER" && affordance.sourceCardInstanceId)
        .map(affordance => affordance.sourceCardInstanceId!)
    );
  }, [activeBattlePlayer, battleAffordances, battleControlEnabled]);
  const battleDefender = useMemo(() => {
    if (!activeBattlePlayer || !battleControlEnabled) return null;
    const defenderPlayer = match.players.find(player => player.id !== activeBattlePlayer.id);
    const defenderCard = defenderPlayer?.field.primaryCreature;
    if (!defenderPlayer || !defenderCard) return null;
    const defenderObject = boardObjects.find(object => object.cardInstanceId === defenderCard.instanceId);
    return defenderObject
      ? { card: defenderCard, object: defenderObject, playerId: defenderPlayer.id as BoardPlayerId }
      : null;
  }, [activeBattlePlayer, battleControlEnabled, boardObjects, match.players]);
  const selectedBattleAttacker = useMemo(() => {
    if (!selectedBattleAttackerId || !legalBattleAttackerIds.has(selectedBattleAttackerId)) return null;
    const object = boardObjects.find(item => item.cardInstanceId === selectedBattleAttackerId);
    return object?.cardInstanceId ? object : null;
  }, [boardObjects, legalBattleAttackerIds, selectedBattleAttackerId]);
  const battleAttackerPieceIds = useMemo(() => {
    if (!legalBattleAttackerIds.size) return [] as string[];
    return boardObjects
      .filter(object => object.cardInstanceId && legalBattleAttackerIds.has(object.cardInstanceId))
      .map(object => object.id);
  }, [boardObjects, legalBattleAttackerIds]);
  const battleTargetSlotIds = selectedBattleAttacker && battleDefender ? [battleDefender.object.slotId] : [];
  const battleTargetPieceIds = selectedBattleAttacker && battleDefender ? [battleDefender.object.id] : [];
  const pendingBattle = match.pendingBattle;
  const pendingBattleStrike = pendingBattle ? getCurrentStrike(pendingBattle) : undefined;
  const pendingBattlePieceIds = useMemo(() => {
    if (!pendingBattle) return [] as string[];
    const participantIds = new Set([
      pendingBattle.declaredAttacker.creatureInstanceId,
      pendingBattle.declaredDefender.creatureInstanceId,
      pendingBattleStrike?.attacker.creatureInstanceId,
      pendingBattleStrike?.defender.creatureInstanceId
    ].filter((value): value is string => !!value));
    return boardObjects
      .filter(object => object.cardInstanceId && participantIds.has(object.cardInstanceId))
      .map(object => object.id);
  }, [boardObjects, pendingBattle, pendingBattleStrike]);
  const battleSpeedBadges = useMemo(() => {
    if (!pendingBattle || pendingBattle.status === "AWAITING_SPEED_CHECK") return {};
    const attackerSpeed = pendingBattle.effectiveAttackingSpeed ?? pendingBattle.declaredAttacker.speed;
    const defenderSpeed = pendingBattle.effectiveDefendingSpeed ?? pendingBattle.declaredDefender.speed;
    const highSpeed = Math.max(attackerSpeed, defenderSpeed);
    const badges: Record<string, { label: string; tone: "winner" | "neutral" }> = {};
    for (const object of boardObjects) {
      if (object.cardInstanceId === pendingBattle.declaredAttacker.creatureInstanceId) {
        badges[object.id] = { label: `SPD ${attackerSpeed}`, tone: attackerSpeed === highSpeed ? "winner" : "neutral" };
      }
      if (object.cardInstanceId === pendingBattle.declaredDefender.creatureInstanceId) {
        badges[object.id] = { label: `SPD ${defenderSpeed}`, tone: defenderSpeed === highSpeed ? "winner" : "neutral" };
      }
    }
    return badges;
  }, [boardObjects, pendingBattle]);
  const completedBattleParticipantPlayerIds = useMemo(() => {
    if (!pendingBattle || pendingBattle.status !== "COMPLETE") return new Set<string>();

    return new Set([
      pendingBattle.attackingPlayerId,
      pendingBattle.defendingPlayerId,
      pendingBattle.declaredAttacker.playerId,
      pendingBattle.declaredDefender.playerId,
      ...pendingBattle.strikes.flatMap(strike => [
        strike.attacker.playerId,
        strike.defender.playerId
      ])
    ].filter((playerId): playerId is string => Boolean(playerId)));
  }, [pendingBattle]);
  const pendingEffectRollControllerPlayerId = match.pendingEffectRoll
    ? match.pendingEffectRoll.rollPlayerId ?? match.pendingEffectRoll.sourcePlayerId
    : null;
  const battleStepControllerPlayerId = pendingBattle
    ? match.pendingEffectTargetPrompt?.controllerPlayerId ??
      pendingEffectRollControllerPlayerId ??
      (pendingBattle.status === "AWAITING_SPEED_CHECK" || pendingBattle.status === "COMPLETE"
      ? pendingBattle.attackingPlayerId
      : pendingBattleStrike?.attacker.playerId ?? pendingBattle.attackingPlayerId)
    : null;
  const standaloneEffectRollControllerPlayerId = !pendingBattle && match.pendingEffectRoll
    ? pendingEffectRollControllerPlayerId
    : null;
  const canAdvanceBattleResolver = pendingBattle?.status === "COMPLETE"
    ? !match.pendingEffectTargetPrompt &&
      (!controlledPlayerId || completedBattleParticipantPlayerIds.has(controlledPlayerId))
    : Boolean(
      battleStepControllerPlayerId &&
      !match.pendingEffectTargetPrompt &&
      (!controlledPlayerId || controlledPlayerId === battleStepControllerPlayerId)
    );
  const canAdvanceStandaloneEffectRoll = Boolean(
    standaloneEffectRollControllerPlayerId &&
    !match.pendingEffectTargetPrompt &&
    (!controlledPlayerId || controlledPlayerId === standaloneEffectRollControllerPlayerId)
  );
  const battleStepControllerLabel = battleStepControllerPlayerId
    ? pendingBattle?.status === "COMPLETE"
      ? "either battle participant"
      : match.players.find(player => player.id === battleStepControllerPlayerId)?.displayName ?? battleStepControllerPlayerId
    : standaloneEffectRollControllerPlayerId
      ? match.players.find(player => player.id === standaloneEffectRollControllerPlayerId)?.displayName ?? standaloneEffectRollControllerPlayerId
    : "the current player";
  const diceRollVisual = useMemo(() => getLatestDiceRollVisual(match), [match]);
  const boardDiceRollAction = useMemo<BoardDiceRollAction | null>(() => {
    const openingRoll = getOpeningRollViewState(match);
    if (openingRoll && openingRoll.status !== "COMPLETE") {
      const rollPlayer = controlledPlayerId
        ? match.players.find(player => player.id === controlledPlayerId)
        : match.players.find(player => openingRoll.rolls[player.id] === undefined) ?? match.players[0];
      if (!rollPlayer) return null;
      const owner = rollPlayer.id as BoardPlayerId;
      const alreadyRolled = openingRoll.rolls[owner] !== undefined;
      return {
        id: `opening-roll-${openingRoll.round}-${owner}`,
        label: "Roll First",
        detail: `${rollPlayer.displayName} rolls 1D6`,
        owner,
        disabled: alreadyRolled || !onOpeningRoll,
        disabledLabel: alreadyRolled ? "Waiting for opponent" : "Opening roll unavailable",
        onClick: () => onOpeningRoll?.(owner)
      };
    }

    if (match.pendingEffectRoll?.status === "AWAITING_ROLL") {
      const owner = (match.pendingEffectRoll.rollPlayerId ?? match.pendingEffectRoll.sourcePlayerId ?? focusedPlayerId) as BoardPlayerId;
      const rollPlayerLabel = match.players.find(player => player.id === owner)?.displayName ?? owner;
      const canRoll = !controlledPlayerId || controlledPlayerId === owner;
      return {
        id: `effect-roll-${match.pendingEffectRoll.id}`,
        label: "Roll Effect",
        detail: `${match.pendingEffectRoll.sourceCardName} ${match.pendingEffectRoll.diceCount}D6`,
        owner,
        disabled: !canRoll || !onRollEffectRoll,
        disabledLabel: `Waiting for ${rollPlayerLabel}`,
        onClick: () => onRollEffectRoll?.(match.pendingEffectRoll!.id)
      };
    }

    if (!pendingBattle && match.pendingEffectRoll?.status === "ROLLED") {
      const owner = (match.pendingEffectRoll.rollPlayerId ?? match.pendingEffectRoll.sourcePlayerId ?? focusedPlayerId) as BoardPlayerId;
      const rollPlayerLabel = match.players.find(player => player.id === owner)?.displayName ?? owner;
      const canApply = !controlledPlayerId || controlledPlayerId === owner;
      return {
        id: `effect-apply-${match.pendingEffectRoll.id}`,
        label: match.pendingEffectRoll.success ? "Apply Effect" : "Close Roll",
        detail: `${match.pendingEffectRoll.sourceCardName} ${match.pendingEffectRoll.rollTotal ?? sumDice(match.pendingEffectRoll.rolledDice)}`,
        owner,
        disabled: !canApply || !onApplyEffectRoll,
        disabledLabel: `Waiting for ${rollPlayerLabel}`,
        onClick: () => onApplyEffectRoll?.(match.pendingEffectRoll!.id)
      };
    }

    if (!pendingBattle && selectedCardEffectAffordance?.sourceCardInstanceId && selectedCardEffectAffordance.actionId) {
      const effectId = selectedCardEffectAffordance.actionId.slice("ACTIVATE_CARD_EFFECT:".length);
      const owner = selectedCardEffectAffordance.playerId as BoardPlayerId;
      const canActivate = !controlledPlayerId || controlledPlayerId === owner;
      const sourceCard = cardByInstanceId.get(selectedCardEffectAffordance.sourceCardInstanceId);

      return {
        id: selectedCardEffectAffordance.id,
        label: "Use Effect",
        detail: selectedCardEffectAffordance.label.replace(/^Use effect:\s*/, ""),
        owner,
        disabled: !canActivate || !onActivateCardEffect,
        disabledLabel: !canActivate
          ? `Waiting for ${match.players.find(player => player.id === owner)?.displayName ?? owner}`
          : sourceCard
            ? `${getCardName(match, sourceCard)} effect unavailable`
            : "Effect unavailable",
        onClick: () => onActivateCardEffect?.(selectedCardEffectAffordance.sourceCardInstanceId!, effectId)
      };
    }

    if (!pendingBattle) {
      if (match.status === "COMPLETE" || !onOpenDiceRoller) return null;

      return {
        id: `manual-dice-${focusedPlayerId}`,
        label: "Dice Roller",
        detail: "Open manual dice tray",
        owner: focusedPlayerId,
        onClick: onOpenDiceRoller
      };
    }

    const controller = (battleStepControllerPlayerId ?? pendingBattle.attackingPlayerId) as BoardPlayerId;
    const disabledLabel = `Waiting for ${battleStepControllerLabel}`;
    const baseAction = {
      owner: controller,
      disabled: !canAdvanceBattleResolver,
      disabledLabel
    };

    if (pendingBattle.status === "AWAITING_SPEED_CHECK") {
      return {
        ...baseAction,
        id: `battle-speed-${pendingBattle.id}`,
        label: "Run Speed",
        detail: "Compare creature speed",
        disabled: baseAction.disabled || !onRunBattleSpeedCheck,
        onClick: () => onRunBattleSpeedCheck?.(pendingBattle.id)
      };
    }

    if (pendingBattle.status === "AWAITING_HIT_ROLL" && !match.pendingEffectRoll) {
      return {
        ...baseAction,
        id: `battle-hit-${pendingBattle.id}`,
        label: "Roll Hit",
        detail: "Roll to hit target",
        disabled: baseAction.disabled || !onRollBattleHit,
        onClick: () => onRollBattleHit?.(pendingBattle.id)
      };
    }

    if (pendingBattle.status === "AWAITING_DAMAGE_ROLL" && !match.pendingEffectRoll) {
      return {
        ...baseAction,
        id: `battle-damage-${pendingBattle.id}`,
        label: "Roll Damage",
        detail: "Roll attack damage",
        disabled: baseAction.disabled || !onRollBattleDamage,
        onClick: () => onRollBattleDamage?.(pendingBattle.id)
      };
    }

    if (match.status === "COMPLETE" || !onOpenDiceRoller) return null;

    return {
      id: `manual-dice-${focusedPlayerId}`,
      label: "Dice Roller",
      detail: "Open manual dice tray",
      owner: focusedPlayerId,
      onClick: onOpenDiceRoller
    };
  }, [
    battleStepControllerLabel,
    battleStepControllerPlayerId,
    canAdvanceBattleResolver,
    controlledPlayerId,
    cardByInstanceId,
    focusedPlayerId,
    match,
    onActivateCardEffect,
    onApplyEffectRoll,
    onOpeningRoll,
    onOpenDiceRoller,
    onRollBattleDamage,
    onRollBattleHit,
    onRollEffectRoll,
    onRunBattleSpeedCheck,
    pendingBattle,
    selectedCardEffectAffordance
  ]);

  useEffect(() => {
    if (!selectedBattleAttackerId) return;
    if (!legalBattleAttackerIds.has(selectedBattleAttackerId) || !battleDefender) {
      setSelectedBattleAttackerId(null);
    }
  }, [battleDefender, legalBattleAttackerIds, selectedBattleAttackerId]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = globalThis.setTimeout(() => setStatusMessage(null), 2200);
    return () => globalThis.clearTimeout(timeout);
  }, [statusMessage]);

  const nudgeSelectedSlot = (axis: "x" | "z", delta: number) => {
    if (!selectedSlotId) return;
    setSlotOffsets((current) => {
      const previous = current[selectedSlotId] ?? { x: 0, z: 0 };
      return {
        ...current,
        [selectedSlotId]: {
          ...previous,
          [axis]: Number((previous[axis] + delta * nudgeStep).toFixed(2))
        }
      };
    });
  };

  const resetSlotOffsets = () => setSlotOffsets({});
  const resetSelectedSlotOffset = () => {
    if (!selectedSlotId) return;
    setSlotOffsets((current) => {
      const next = { ...current };
      delete next[selectedSlotId];
      return next;
    });
  };

  const resetCamera = () => {
    setTiltDegrees(DEFAULT_CAMERA_SETTINGS.tiltDegrees);
    setZoomScale(DEFAULT_CAMERA_SETTINGS.zoomScale);
    setHeightScale(DEFAULT_CAMERA_SETTINGS.heightScale);
    setBoardScaleX(DEFAULT_CAMERA_SETTINGS.boardScaleX);
    setBoardScaleZ(DEFAULT_CAMERA_SETTINGS.boardScaleZ);
    setBoardOffsetX(DEFAULT_CAMERA_SETTINGS.boardOffsetX);
    setBoardOffsetZ(DEFAULT_CAMERA_SETTINGS.boardOffsetZ);
    setCameraPanX(DEFAULT_CAMERA_SETTINGS.cameraPanX);
    setCameraPanY(DEFAULT_CAMERA_SETTINGS.cameraPanY);
  };

  const resetAllEditorState = () => {
    resetCamera();
    setSlotOffsets({});
    setZoneAdjustments({});
    setShowAnchors(true);
    setShowDebugPanel(true);
    setNudgeStep(1);
    setSelectedSlotId("player_1-primary");
    setStatusMessage("Editor state reset.");
  };

  const copyLayoutSnapshot = async () => {
    const snapshot = toLayoutSnapshot(slotOffsets);
    const payload = JSON.stringify(snapshot, null, 2);
    setLayoutDraft(payload);
    if (await writeClipboardText(payload)) {
      setLastCopiedLabel("Layout snapshot");
      setStatusMessage("Copied layout snapshot.");
      return;
    }

    const file = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "board-layout-snapshot.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatusMessage("Clipboard unavailable. Downloaded layout snapshot JSON.");
  };

  const applyLayoutDraft = () => {
    try {
      const parsedResult = parseLayoutSnapshotJson(layoutDraft);
      if (parsedResult.ok === false) {
        throw new Error(parsedResult.error);
      }

      const nextOffsets: BoardSlotOffsetMap = {};
      for (const slot of BOARD_SLOTS) {
        const override = parsedResult.value.find((item) => item.id === slot.id);
        if (!override) continue;
        nextOffsets[slot.id] = {
          x: Number((Math.max(0, Math.min(100, override.xPercent)) - slot.xPercent).toFixed(2)),
          z: Number((Math.max(0, Math.min(100, override.zPercent)) - slot.zPercent).toFixed(2))
        };
      }
      setSlotOffsets(nextOffsets);
      setLayoutDraftError(null);
      setStatusMessage("Layout JSON applied.");
    } catch (error) {
      setLayoutDraftError(error instanceof Error ? error.message : "Unable to apply layout JSON.");
    }
  };

  const shouldMirrorBoardForViewer = presentation === "game" && focusedPlayerId === "player_2";

  const resolveBoardPoint = useCallback((xPercent: number, zPercent: number) => {
    const orientedX = shouldMirrorBoardForViewer ? 100 - xPercent : xPercent;
    const orientedZ = shouldMirrorBoardForViewer ? 100 - zPercent : zPercent;
    return {
      xPercent: Math.max(0, Math.min(100, 50 + (orientedX - 50) * boardScaleX + boardOffsetX)),
      zPercent: Math.max(0, Math.min(100, 50 + (orientedZ - 50) * boardScaleZ + boardOffsetZ))
    };
  }, [boardOffsetX, boardOffsetZ, boardScaleX, boardScaleZ, shouldMirrorBoardForViewer]);

  const resolvePosition = useCallback((slotId: string, fallbackX: number, fallbackZ: number) => {
    const raw = resolveSlotPosition(slotId, slotOffsets, fallbackX, fallbackZ);
    return resolveBoardPoint(raw.xPercent, raw.zPercent);
  }, [resolveBoardPoint, slotOffsets]);

  const resolveZoneRect = useCallback((zone: BoardZone): BoardZone => {
    const adjustment = zoneAdjustments[zone.id] ?? EMPTY_ZONE_ADJUSTMENT;
    const point = resolveBoardPoint(zone.xPercent + adjustment.x, zone.zPercent + adjustment.z);
    return {
      ...zone,
      xPercent: point.xPercent,
      zPercent: point.zPercent,
      widthPercent: Math.max(2, Math.min(100, zone.widthPercent + adjustment.width)),
      heightPercent: Math.max(2, Math.min(100, zone.heightPercent + adjustment.height))
    };
  }, [resolveBoardPoint, zoneAdjustments]);

  const slotOccupancy = BOARD_SLOTS.map((slot) => ({
    slot,
    occupant: boardObjects.find((object) => object.slotId === slot.id)
  }));

  const selectedSlot = slotOccupancy.find(({ slot }) => slot.id === selectedSlotId) ?? null;
  const selectedZone = BOARD_ZONES.find(zone => zone.id === selectedZoneId) ?? BOARD_ZONES[0]!;
  const selectedZoneAdjustment = zoneAdjustments[selectedZone.id] ?? EMPTY_ZONE_ADJUSTMENT;
  const occupiedSlotCount = slotOccupancy.filter((entry) => Boolean(entry.occupant)).length;
  const selectedSlotIndex = selectedSlotId ? BOARD_SLOTS.findIndex((slot) => slot.id === selectedSlotId) : -1;

  const selectRelativeSlot = (delta: number) => {
    if (BOARD_SLOTS.length === 0) return;
    const currentIndex = selectedSlotIndex >= 0 ? selectedSlotIndex : 0;
    const nextIndex = (currentIndex + delta + BOARD_SLOTS.length) % BOARD_SLOTS.length;
    const nextSlotId = BOARD_SLOTS[nextIndex].id;
    setSelectedSlotId(nextSlotId);
    onSlotFocus?.({ slotId: nextSlotId, source: "keyboard" });
  };

  const selectSlot = (slotId: string, source: "mini-map" | "table" | "debug") => {
    if (resolveBoardEffectTargetFromSlot(slotId)) return;

    const intent = mapPointerGestureToIntent({ interaction: interactionContext, slotId });
    const command = resolveBoardIntentCommand(intent, boardObjects);
    onIntent?.(intent);
    onIntentCommand?.(command);
    if (intent.kind === "NO_OP") {
      setStatusMessage(intent.reason);
      return;
    }
    setSelectedSlotId(slotId);
    onSlotFocus?.({ slotId, source });
  };

  const focusCreatureEquipment = (creatureInstanceId: string) => {
    const nextCreatureCardId = selectedCreatureCardId === creatureInstanceId ? null : creatureInstanceId;
    setSelectedCreatureCardId(nextCreatureCardId);
    if (!nextCreatureCardId) {
      setStatusMessage("Equipment highlights cleared.");
      return;
    }

    const attachedCount = boardObjects.filter(object => {
      if (!object.cardInstanceId || object.lane !== "magic") return false;
      return cardByInstanceId.get(object.cardInstanceId)?.attachedToInstanceId === nextCreatureCardId;
    }).length;
    setStatusMessage(
      attachedCount > 0
        ? `Showing ${attachedCount} equipped card${attachedCount === 1 ? "" : "s"}.`
        : "No Equip Magic is attached to this creature."
    );
  };

  const selectPiece = (pieceId: string, source: "mini-map" | "table") => {
    if (resolveBoardEffectTargetFromPiece(pieceId)) return;

    const attachTarget = equipAttachTargetOptions.find(option => option.pieceId === pieceId);
    if (selectedEquipMagic) {
      if (attachTarget) {
        if (!onAttachEquipMagicToCreature) {
          setStatusMessage("Equip attachment is unavailable in this preview.");
          return;
        }
        onAttachEquipMagicToCreature?.(
          selectedEquipMagic.object.owner,
          selectedEquipMagic.card.instanceId,
          attachTarget.playerId,
          attachTarget.creatureInstanceId,
          attachTarget.targetKind
        );
        setStatusMessage("Attaching Equip Magic.");
        setSelectedEquipMagicCardId(null);
        setPendingEquipMagicCardId(null);
        setSelectedCreatureCardId(attachTarget.creatureInstanceId);
        return;
      }

      const clickedSource = selectedEquipMagic.object.id === pieceId;
      if (clickedSource) {
        setSelectedEquipMagicCardId(null);
        setPendingEquipMagicCardId(null);
        setStatusMessage("Equip attachment canceled.");
        return;
      }
    }

    const piece = boardObjects.find(item => item.id === pieceId);
    const pieceCard = piece?.cardInstanceId ? cardByInstanceId.get(piece.cardInstanceId) : null;
    if (
      piece?.lane === "magic" &&
      pieceCard &&
      isEquipMagic(match, pieceCard) &&
      !pieceCard.attachedToInstanceId
    ) {
      if (!canControlPlayer(piece.owner)) {
        setStatusMessage("You cannot attach that Equip Magic.");
        return;
      }
      if (match.pendingPrompt || match.pendingChain || match.pendingEffectTargetPrompt || match.setup.handDiscardRequiredForPlayerId || match.setup.primaryReplacementRequiredForPlayerId) {
        setStatusMessage("Resolve the current prompt before attaching Equip Magic.");
        return;
      }
      setSelectedCreatureCardId(null);
      setPendingEquipMagicCardId(null);
      setSelectedEquipMagicCardId(pieceCard.instanceId);
      setStatusMessage("Select a creature on the 3D board to attach this Equip Magic.");
      onPieceFocus?.({ pieceId, source });
      return;
    }

    if (selectedBattleAttacker && battleDefender?.object.id === pieceId) {
      onStartBattleFromPiece?.(selectedBattleAttacker.cardInstanceId!, battleDefender.card.instanceId);
      setSelectedBattleAttackerId(null);
      return;
    }

    if (piece?.cardInstanceId && legalBattleAttackerIds.has(piece.cardInstanceId)) {
      setSelectedBattleAttackerId(current => current === piece.cardInstanceId ? null : piece.cardInstanceId!);
      setSelectedCreatureCardId(piece.cardInstanceId);
      setStatusMessage("Select the defending primary creature to start battle.");
      onPieceFocus?.({ pieceId, source });
      return;
    }

    if (piece?.cardInstanceId && (piece.lane === "primary" || piece.lane === "limited")) {
      focusCreatureEquipment(piece.cardInstanceId);
      onPieceFocus?.({ pieceId, source });
      return;
    }

    if (piece?.lane === "magic" && pieceCard?.attachedToInstanceId) {
      setSelectedCreatureCardId(pieceCard.attachedToInstanceId);
      setStatusMessage("Showing the creature this Equip Magic is attached to.");
      onPieceFocus?.({ pieceId, source });
      return;
    }

    const intent = mapPointerGestureToIntent({ interaction: interactionContext, pieceId });
    const command = resolveBoardIntentCommand(intent, boardObjects);
    onIntent?.(intent);
    onIntentCommand?.(command);
    if (intent.kind === "NO_OP") {
      setStatusMessage(intent.reason);
      return;
    }
    onPieceFocus?.({ pieceId, source });
  };

  const focusRelatedBoardCard = useCallback((cardInstanceId: string) => {
    const object = boardObjects.find(item => item.cardInstanceId === cardInstanceId);
    const card = cardByInstanceId.get(cardInstanceId);

    if (!card) return;

    if (object) {
      setSelectedSlotId(object.slotId);
      onPieceFocus?.({ pieceId: object.id, source: "table" });
    }

    if (object?.lane === "primary" || object?.lane === "limited") {
      setSelectedCreatureCardId(card.instanceId);
      setStatusMessage(`Showing ${getCardName(match, card)} and equipped cards.`);
      return;
    }

    if (object?.lane === "magic" && card.attachedToInstanceId) {
      setSelectedCreatureCardId(card.attachedToInstanceId);
      setStatusMessage(`Showing ${getCardName(match, card)} and attached creature.`);
      return;
    }

    setStatusMessage(`Showing ${getCardName(match, card)}.`);
  }, [boardObjects, cardByInstanceId, match, onPieceFocus]);

  const activeEvent = animationQueue.activeEvent;
  useEffect(() => {
    if (activeEvent?.type === "BATTLE_DAMAGE_APPLIED") return;
    currentAttackAnimationKeyRef.current = null;
  }, [activeEvent?.eventId, activeEvent?.type]);
  const activeAttackAnimation = useMemo<BoardAttackAnimation | null>(() => {
    if (activeEvent?.type !== "BATTLE_DAMAGE_APPLIED" || !activeEvent.payload || typeof activeEvent.payload !== "object") {
      return null;
    }
    const attackAnimationKey = `${activeEvent.matchId}:${activeEvent.sequenceNumber}:${activeEvent.rawType}`;
    if (currentAttackAnimationKeyRef.current !== attackAnimationKey) {
      if (playedAttackAnimationKeysRef.current.has(attackAnimationKey)) {
        return null;
      }
      currentAttackAnimationKeyRef.current = attackAnimationKey;
      playedAttackAnimationKeysRef.current.add(attackAnimationKey);
    }

    const payload = activeEvent.payload as Record<string, unknown>;
    const attackerCreatureInstanceId = typeof payload.attackerCreatureInstanceId === "string" ? payload.attackerCreatureInstanceId : null;
    const targetCreatureInstanceId = typeof payload.targetCreatureInstanceId === "string" ? payload.targetCreatureInstanceId : null;
    if (!attackerCreatureInstanceId || !targetCreatureInstanceId) return null;

    const sourceObject = boardObjects.find(object => object.cardInstanceId === attackerCreatureInstanceId);
    const targetObject = boardObjects.find(object => object.cardInstanceId === targetCreatureInstanceId);
    if (!sourceObject || !targetObject) return null;

    const attackerCard = cardByInstanceId.get(attackerCreatureInstanceId);
    const attackerDefinition = attackerCard ? match.cardCatalog[attackerCard.cardId] : undefined;
    const creatureType = attackerDefinition?.cardType === "CREATURE"
      ? attackerDefinition.creatureType
      : "Creature";
    const rawDamageAmount = payload.damageAmount;
    const damageAmount = typeof rawDamageAmount === "number" ? rawDamageAmount : 0;
    const damageRollDice = Array.isArray(payload.damageRollDice)
      ? payload.damageRollDice.filter((value): value is number => typeof value === "number")
      : [];

    return {
      id: activeEvent.eventId,
      sourcePieceId: sourceObject.id,
      targetPieceId: targetObject.id,
      creatureType,
      theme: getAttackAnimationTheme(creatureType),
      damageAmount,
      damageRollDice,
      killed: payload.killed === true
    };
  }, [activeEvent, boardObjects, cardByInstanceId, match.cardCatalog]);
  const animationHighlights = useMemo(() => {
    if (!activeEvent) return { slotIds: [] as string[], pieceIds: [] as string[] };
    const candidateSlotIds = activeEvent.visualTargets.slotIds.filter(value =>
      BOARD_SLOTS.some(slot => slot.id === value)
    );
    if (
      (
        activeEvent.type === "PLAYER_STAT_CHANGED" ||
        activeEvent.type === "CEMETERY_HP_CHANGED" ||
        activeEvent.type === "PLAYER_LOCK_APPLIED" ||
        activeEvent.type === "PLAYER_LOCK_REMOVED" ||
        activeEvent.type === "TURN_SKIPPED"
      ) &&
      (activeEvent.playerId === "player_1" || activeEvent.playerId === "player_2")
    ) {
      candidateSlotIds.push(
        `${activeEvent.playerId}-primary`,
        `${activeEvent.playerId}-limited-1`,
        `${activeEvent.playerId}-limited-2`,
        `${activeEvent.playerId}-magic-1`,
        `${activeEvent.playerId}-magic-2`,
        `${activeEvent.playerId}-magic-3`,
        `${activeEvent.playerId}-magic-4`,
        `${activeEvent.playerId}-magic-5`,
        `${activeEvent.playerId}-cemetery`
      );
    }
    const instanceIds = activeEvent.visualTargets.cardInstanceIds;
    const pieceIds = boardObjects
      .filter(object => instanceIds.some(instanceId => object.id.includes(instanceId)))
      .map(object => object.id);
    return { slotIds: [...new Set(candidateSlotIds)], pieceIds: [...new Set(pieceIds)] };
  }, [activeEvent, boardObjects]);

  const copySelectedSlotSnapshot = async () => {
    if (!selectedSlotId) return;
    const slot = slotById.get(selectedSlotId);
    if (!slot) return;
    const resolved = resolveSlotPosition(slot.id, slotOffsets, slot.xPercent, slot.zPercent);
    const payload = JSON.stringify({ id: slot.id, xPercent: resolved.xPercent, zPercent: resolved.zPercent }, null, 2);
    if (await writeClipboardText(payload)) {
      setLastCopiedLabel("Selected slot");
      setStatusMessage("Copied selected slot JSON.");
      return;
    }
    const file = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = `${slot.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatusMessage("Clipboard unavailable. Downloaded selected slot JSON.");
  };

  const safeResetSlotOffsets = () => {
    resetSlotOffsets();
  };

  const adjustSelectedZone = (axis: keyof BoardZoneAdjustment, value: number) => {
    if (!selectedZone) return;
    setZoneAdjustments(current => ({
      ...current,
      [selectedZone.id]: {
        ...(current[selectedZone.id] ?? EMPTY_ZONE_ADJUSTMENT),
        [axis]: Number(value.toFixed(2))
      }
    }));
  };

  const resetSelectedZoneAdjustment = () => {
    if (!selectedZone) return;
    setZoneAdjustments(current => {
      const next = { ...current };
      delete next[selectedZone.id];
      return next;
    });
  };

  const resetZoneAdjustments = () => {
    setZoneAdjustments({});
  };
  const setVisibleSlotLayer = (layer: keyof VisibleSlotLayers, value: boolean) => {
    setVisibleSlotLayers(current => ({ ...current, [layer]: value }));
  };

  const emptySlotCount = slotOccupancy.length - occupiedSlotCount;
  const selectedOffset = selectedSlotId ? slotOffsets[selectedSlotId as BoardSlotId] ?? { x: 0, z: 0 } : { x: 0, z: 0 };
  const unresolvedBoardObjects = boardObjects.filter((object) => !slotById.has(object.slotId));
  const effectiveOwnerFilter = presentation === "game" ? "all" : ownerFilter;
  const filteredBoardObjects = useMemo(
    () => (effectiveOwnerFilter === "all" ? boardObjects : boardObjects.filter((object) => object.owner === effectiveOwnerFilter))
      .filter(object => object.lane !== "hand"),
    [boardObjects, effectiveOwnerFilter]
  );
  const pendingRevealPrompt = noCreatureRevealPrompt;
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const advanceBlockReason = getAdvanceBlockReason(match);
  const canControlActivePlayer = canControlPlayer(match.turn.activePlayerId);
  const canUseTurnControls =
    match.status !== "COMPLETE" &&
    canControlActivePlayer &&
    !advanceBlockReason;
  const canEndTurnFromBoard =
    canUseTurnControls &&
    (match.turn.phase !== "DRAW" || Boolean(activePlayer?.turnFlags.drawnThisTurn));
  const currentPhaseLabel = formatPhaseLabel(match.turn.phase);
  const nextPhaseLabel = getNextBoardPhaseLabel(match);
  const shouldShowAdvancePhaseButton = match.turn.phase !== "DRAW";
  const boardDeckActions = match.players.filter(player => player.id === focusedPlayerId).map(player => {
    const owner: BoardPlayerId = player.id === "player_1" ? "player_1" : "player_2";
    const opponent = match.players.find(candidate => candidate.id !== player.id);
    const opponentOwner: BoardPlayerId | null = opponent
      ? opponent.id === "player_1" ? "player_1" : "player_2"
      : null;
    const opponentCemeteryHp = Number(opponent?.cemeteryCreatureHpTotal ?? 0);
    const cemeteryHpLimit = Number(match.settings.cemeteryHpLimit ?? 300);
    const canControlThisPlayer = canControlPlayer(player.id);
    const isActivePlayer = match.turn.activePlayerId === player.id;
    const isForcedPrimaryReplacement = match.setup.primaryReplacementRequiredForPlayerId === player.id;
    const hasSummonableCreature = playerHasSummonableCreatureInHand(match, player);
    const canRequestNoCreatureRedraw =
      canControlThisPlayer &&
      !pendingRevealPrompt &&
      !hasSummonableCreature &&
      (
        (isActivePlayer && match.turn.phase === "SUMMON_MAGIC") ||
        (isForcedPrimaryReplacement && player.field.limitedSummons.length === 0)
      );
    const isApprovingReveal = pendingRevealPrompt?.approvingPlayerId === player.id && canControlThisPlayer;
    const isRequestingReveal = pendingRevealPrompt?.requestingPlayerId === player.id;
    const handIsLocallyRevealed = Boolean(locallyRevealedHands[owner]) || revealedHandPlayerIds.includes(owner);
    const shouldShowHandControls =
      deckHandControlsOwner === owner ||
      handIsLocallyRevealed ||
      canRequestNoCreatureRedraw ||
      isApprovingReveal ||
      isRequestingReveal;
    const canCallCemeteryHpLoss =
      match.status !== "COMPLETE" &&
      canControlThisPlayer &&
      Boolean(opponentOwner) &&
      opponentCemeteryHp >= cemeteryHpLimit &&
      Boolean(onCallCemeteryHpLoss);
    const cemeteryHpLossTitle = opponent
      ? opponentCemeteryHp >= cemeteryHpLimit
        ? `Call cemetery HP loss against ${opponent.displayName}.`
        : `${opponent.displayName} has ${opponentCemeteryHp}/${cemeteryHpLimit} cemetery HP.`
      : "No opponent found.";

    return {
      player,
      owner,
      opponentOwner,
      canControlThisPlayer,
      canUndo: canControlThisPlayer && Boolean(onUndoLastAction),
      canCallCemeteryHpLoss,
      cemeteryHpLossTitle,
      canRequestNoCreatureRedraw,
      isApprovingReveal,
      isRequestingReveal,
      handIsLocallyRevealed,
      shouldShowHandControls
    };
  });
  const blockedReasonsBySlotId = useMemo<Record<string, string>>(() => {
    if (!selectedHandCardId) return {};
    const reasons: Record<string, string> = {};
    for (const affordance of handPlacementAffordances) {
      if (
        affordance.kind !== "DISABLED_ACTION" ||
        affordance.sourceCardInstanceId !== selectedHandCardId ||
        !affordance.targetZoneRef ||
        !affordance.disabledReason
      ) {
        continue;
      }
      const slotId = slotIdFromTargetZoneRef(affordance.targetZoneRef);
      if (slotId && !sacrificeTargetSlotIds.includes(slotId)) {
        reasons[slotId] = affordance.disabledReason;
      }
    }
    return reasons;
  }, [handPlacementAffordances, sacrificeTargetSlotIds, selectedHandCardId]);

  const layoutDraftIsValid = (() => {
    if (!layoutDraft.trim()) return false;
    try {
      return Array.isArray(JSON.parse(layoutDraft));
    } catch {
      return false;
    }
  })();

  const isTextInputTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  };

  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (isTextInputTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "w") setClampedCameraPan("y", cameraPanY - 4);
    if (key === "s") setClampedCameraPan("y", cameraPanY + 4);
    if (key === "a") setClampedCameraPan("x", cameraPanX - 4);
    if (key === "d") setClampedCameraPan("x", cameraPanX + 4);
    if (event.key === "+" || event.key === "=") setClampedZoomScale(zoomScale + 0.08);
    if (event.key === "-" || event.key === "_") setClampedZoomScale(zoomScale - 0.08);
    if (event.key === "0") resetCamera();
    if (["w", "a", "s", "d", "+", "=", "-", "_", "0"].includes(key) || event.key === "+" || event.key === "=") {
      event.preventDefault();
      return;
    }
    if (!selectedSlotId) return;
    if (event.key === "ArrowLeft") nudgeSelectedSlot("x", -1);
    if (event.key === "ArrowRight") nudgeSelectedSlot("x", 1);
    if (event.key === "ArrowUp") nudgeSelectedSlot("z", -1);
    if (event.key === "ArrowDown") nudgeSelectedSlot("z", 1);
    if (event.key.startsWith("Arrow")) event.preventDefault();
    if (!event.shiftKey && event.key.toLowerCase() === "r") resetAllEditorState();
  };

  const handleIntegrationModeChange = (value: boolean) => {
    setIntegrationMode(value);
  };

  const setClampedZoomScale = (value: number) => {
    setZoomScale(clampNumber(Math.round(value * 100) / 100, 0.6, 2.2));
  };

  const setClampedCameraPan = (axis: "x" | "y", value: number) => {
    const clamped = clampNumber(Math.round(value * 10) / 10, -90, 90);
    if (axis === "x") {
      setCameraPanX(clamped);
      return;
    }
    setCameraPanY(clamped);
  };

  const cycleControlsDockPosition = () => {
    const currentIndex = FLOATING_DOCK_POSITIONS.indexOf(controlsDockPosition);
    setControlsDockPosition(FLOATING_DOCK_POSITIONS[(currentIndex + 1) % FLOATING_DOCK_POSITIONS.length]);
  };

  const cycleActionDockPosition = () => {
    const currentIndex = ACTION_DOCK_POSITIONS.indexOf(actionDockPosition);
    setActionDockPosition(ACTION_DOCK_POSITIONS[(currentIndex + 1) % ACTION_DOCK_POSITIONS.length]);
  };

  const isCameraControlTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("button, input, select, textarea, a, .board-dice-control, .board-preview-3d__cemetery-viewer, .board-preview-3d__hand-rail, .board-preview-3d__action-dock, .board-preview-3d__floating-controls, .board-preview-3d__debug-drawer"));
  };

  const handleBoardPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (event.button !== 0 || isCameraControlTarget(event.target)) return;
    cameraDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setIsCameraDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBoardPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = cameraDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    cameraDragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    setClampedCameraPan("x", cameraPanX + deltaX / 8);
    setClampedCameraPan("y", cameraPanY + deltaY / 8);
  };

  const stopBoardPointerDrag: PointerEventHandler<HTMLElement> = (event) => {
    if (cameraDragRef.current?.pointerId === event.pointerId) {
      cameraDragRef.current = null;
      setIsCameraDragging(false);
    }
  };

  const handleBoardWheel: WheelEventHandler<HTMLElement> = (event) => {
    if (isCameraControlTarget(event.target)) return;
    event.preventDefault();
    setClampedZoomScale(zoomScale + (event.deltaY < 0 ? 0.06 : -0.06));
  };

  return (
    <section className={`board-preview-3d board-preview-3d--${presentation}`} aria-label={presentation === "game" ? "Live 3D game board" : "Prototype 3D board space"} tabIndex={0} onKeyDown={handleKeyDown}>
      <header className="board-preview-3d__hud">
        <details className="board-preview-3d__hud-tab">
          <summary>{presentation === "game" ? "3D game board" : "3D board lab"}</summary>
          <div className="board-preview-3d__hud-tab-panel">
            {presentation === "lab" ? <p>Left: placement map. Right: 3D board prototype.</p> : null}
            <p>Occupied slots: {occupiedSlotCount} | Empty slots: {emptySlotCount} | Unresolved pieces: {unresolvedBoardObjects.length}</p>
            <p>Event queue: {animationQueue.queue.length} | Active: {animationQueue.activeEvent?.type ?? "none"} ({animationQueue.activeEvent?.usesPlannerOutput ? "planner" : getBoardAnimationProfile(animationQueue.activeEvent?.type).label}) | Mode: {runtimeMode}</p>
            <p>Drag to pan | Wheel to zoom | WASD to move | +/- zoom | 0 reset</p>
            {intentLabel ? <p>Intent: {intentLabel}</p> : null}
            {commandLabel ? <p>Command: {commandLabel}</p> : null}
            <div>
              <button
                type="button"
                className={`ghost${controlsCollapsed ? "" : " is-active"}`}
                aria-pressed={!controlsCollapsed}
                onClick={() => setControlsCollapsed(value => !value)}
              >
                HUD Controls
              </button>
              {actionDock ? (
                <button
                  type="button"
                  className={`ghost${actionDockCollapsed ? "" : " is-active"}`}
                  aria-pressed={!actionDockCollapsed}
                  onClick={() => setActionDockCollapsed(value => !value)}
                >
                  Action Dock
                </button>
              ) : null}
              <button
                type="button"
                className={`ghost${showDebugPanel ? " is-active" : ""}`}
                aria-pressed={showDebugPanel}
                onClick={() => setShowDebugPanel(value => !value)}
              >
                Debug HUD
              </button>
            </div>
          </div>
        </details>
      </header>
      {!controlsCollapsed ? (
        <aside className={`board-preview-3d__floating-controls board-preview-3d__floating-controls--${controlsDockPosition}`}>
          <div className="board-preview-3d__floating-title">
            <strong>HUD Controls</strong>
            <button type="button" className="ghost" onClick={cycleControlsDockPosition}>Move</button>
          </div>
          <BoardPreview3DControls
            tiltDegrees={tiltDegrees}
            setTiltDegrees={setTiltDegrees}
            zoomScale={zoomScale}
            setZoomScale={setClampedZoomScale}
            heightScale={heightScale}
            setHeightScale={setHeightScale}
            boardScaleX={boardScaleX}
            setBoardScaleX={setBoardScaleX}
            boardScaleZ={boardScaleZ}
            setBoardScaleZ={setBoardScaleZ}
            boardOffsetX={boardOffsetX}
            setBoardOffsetX={setBoardOffsetX}
            boardOffsetZ={boardOffsetZ}
            setBoardOffsetZ={setBoardOffsetZ}
            cameraPanX={cameraPanX}
            setCameraPanX={(value) => setClampedCameraPan("x", value)}
            cameraPanY={cameraPanY}
            setCameraPanY={(value) => setClampedCameraPan("y", value)}
            ownerFilter={ownerFilter}
            setOwnerFilter={setOwnerFilter}
            showDebugPanel={showDebugPanel}
            setShowDebugPanel={setShowDebugPanel}
            showAnchors={showAnchors}
            setShowAnchors={setShowAnchors}
            adminView={adminView}
            showDiagnostics={showDiagnostics}
            setShowDiagnostics={setShowDiagnostics}
            integrationMode={integrationMode}
            setIntegrationMode={handleIntegrationModeChange}
            onResetAll={resetAllEditorState}
          />
        </aside>
      ) : null}
      {integrationMode ? <p className="board-preview-3d__status">Integration mode enabled: gameplay dispatch wiring is active.</p> : null}

      {statusMessage ? <p className="board-preview-3d__status">{statusMessage}</p> : null}
      {lastCopiedLabel ? <p className="board-preview-3d__status">Last copied: {lastCopiedLabel}</p> : null}

      <div className="board-preview-3d__layout">
        {presentation === "lab" ? (
          <BoardPreview3DMiniMap
            showAnchors={showAnchors}
            selectedSlotId={selectedSlotId}
            filteredBoardObjects={filteredBoardObjects}
            resolveSlotPosition={resolvePosition}
            resolveBoardPoint={resolveBoardPoint}
            resolveZoneRect={resolveZoneRect}
            onSelectSlot={(slotId) => selectSlot(slotId, "mini-map")}
            onSelectPiece={(pieceId) => selectPiece(pieceId, "mini-map")}
          />
        ) : null}
        <section
          className={`board-preview-3d__board-column${isCameraDragging ? " is-panning" : ""}`}
          onPointerDown={handleBoardPointerDown}
          onPointerMove={handleBoardPointerMove}
          onPointerUp={stopBoardPointerDrag}
          onPointerCancel={stopBoardPointerDrag}
          onWheel={handleBoardWheel}
        >
          <BoardPreview3DTable
            zoomScale={zoomScale}
            cameraPanX={cameraPanX}
            cameraPanY={cameraPanY}
            tiltDegrees={tiltDegrees}
            heightScale={heightScale}
            showAnchors={showAnchors}
            showZoneRects={showZoneRects}
            visibleSlotLayers={visibleSlotLayers}
            selectedSlotId={selectedSlotId}
            filteredBoardObjects={filteredBoardObjects}
            resolveSlotPosition={resolvePosition}
            resolveBoardPoint={resolveBoardPoint}
            resolveZoneRect={resolveZoneRect}
            onSelectSlot={(slotId) => selectSlot(slotId, "table")}
            onDeckSlotClick={onDeckSlotClick}
            onPlayHandCardToSlot={(slotId) => {
              if (!selectedHandCardId) return;
              if (!getLegalTargetSlotIdsForCard(selectedHandCardId).includes(slotId)) {
                setStatusMessage("That card cannot be played to that 3D board slot right now.");
                return;
              }
              const card = cardByInstanceId.get(selectedHandCardId);
              const shouldChooseEquipTarget = Boolean(card && slotId.includes("-magic-") && isEquipMagic(match, card));
              onPlayHandCardToSlot?.(selectedHandCardId, slotId, selectedSacrificeIds);
              setSelectedSacrificeIdsByCard(current => {
                const next = { ...current };
                delete next[selectedHandCardId];
                return next;
              });
              const playedCardInstanceId = selectedHandCardId;
              setSelectedHandCardId(null);
              if (shouldChooseEquipTarget) {
                setSelectedCreatureCardId(null);
                setPendingEquipMagicCardId(playedCardInstanceId);
                setSelectedEquipMagicCardId(playedCardInstanceId);
                setStatusMessage("Choose a blue creature target to attach this Equip Magic.");
              }
            }}
            onDropHandCardToSlot={(slotId, cardInstanceId) => {
              if (
                slotId === `${focusedPlayerId}-cemetery` &&
                discardRequiredForFocusedPlayer &&
                handCards.some(card => card.instanceId === cardInstanceId)
              ) {
                onDiscardHandCardToCemetery?.(focusedPlayerId, cardInstanceId);
                setSelectedHandCardId(null);
                setStatusMessage("Discarding to hand size.");
                return;
              }
              if (!getLegalTargetSlotIdsForCard(cardInstanceId).includes(slotId)) {
                setStatusMessage("That card cannot be dropped there right now.");
                return;
              }
              const card = cardByInstanceId.get(cardInstanceId);
              const shouldChooseEquipTarget = Boolean(card && slotId.includes("-magic-") && isEquipMagic(match, card));
              const sacrificeIds = (selectedSacrificeIdsByCard[cardInstanceId] ?? []).filter(id => sacrificeCandidateIds.has(id));
              onPlayHandCardToSlot?.(cardInstanceId, slotId, sacrificeIds);
              setSelectedSacrificeIdsByCard(current => {
                const next = { ...current };
                delete next[cardInstanceId];
                return next;
              });
              setSelectedHandCardId(null);
              if (shouldChooseEquipTarget) {
                setSelectedCreatureCardId(null);
                setPendingEquipMagicCardId(cardInstanceId);
                setSelectedEquipMagicCardId(cardInstanceId);
                setStatusMessage("Choose a blue creature target to attach this Equip Magic.");
              }
            }}
            onSelectPiece={(pieceId) => selectPiece(pieceId, "table")}
            onInspectRelatedCard={focusRelatedBoardCard}
            onSelectHandCard={(cardInstanceId) => setSelectedHandCardId(current => current === cardInstanceId ? null : cardInstanceId)}
            onHandCardDragStart={(cardInstanceId) => setSelectedHandCardId(cardInstanceId)}
            onToggleSacrificeCard={toggleSacrificeSelection}
            onSelectBattleTargetPiece={(targetPieceId) => {
              if (!selectedBattleAttacker?.cardInstanceId || !battleDefender || battleDefender.object.id !== targetPieceId) {
                setStatusMessage("That creature cannot attack that target right now.");
                return;
              }
              onStartBattleFromPiece?.(selectedBattleAttacker.cardInstanceId, battleDefender.card.instanceId);
              setSelectedBattleAttackerId(null);
            }}
            onDropBattleAttackerToPiece={(targetPieceId, attackerCreatureInstanceId) => {
              if (!battleDefender || battleDefender.object.id !== targetPieceId || !legalBattleAttackerIds.has(attackerCreatureInstanceId)) {
                setStatusMessage("That creature cannot attack that target right now.");
                return;
              }
              onStartBattleFromPiece?.(attackerCreatureInstanceId, battleDefender.card.instanceId);
              setSelectedBattleAttackerId(null);
            }}
            onDropEquipMagicToPiece={(targetPieceId, magicCardInstanceId) => {
              const magicObject = boardObjects.find(object => object.cardInstanceId === magicCardInstanceId);
              const magicCard = cardByInstanceId.get(magicCardInstanceId);
              const attachTarget = equipAttachTargetOptions.find(option => option.pieceId === targetPieceId);

              if (!magicObject || !magicCard || !attachTarget || !isEquipMagic(match, magicCard)) {
                setStatusMessage("That Equip Magic cannot attach to that target.");
                return;
              }
              if (!onAttachEquipMagicToCreature) {
                setStatusMessage("Equip attachment is unavailable in this preview.");
                return;
              }

              onAttachEquipMagicToCreature(
                magicObject.owner,
                magicCard.instanceId,
                attachTarget.playerId,
                attachTarget.creatureInstanceId,
                attachTarget.targetKind
              );
              setSelectedEquipMagicCardId(null);
              setPendingEquipMagicCardId(null);
              setSelectedCreatureCardId(attachTarget.creatureInstanceId);
              setStatusMessage("Attaching Equip Magic.");
            }}
            onDropEffectSourceToPiece={(targetPieceId) => {
              if (!resolveBoardEffectTargetFromPiece(targetPieceId)) {
                setStatusMessage("That is not a valid effect target.");
              }
            }}
            onDropEffectSourceToSlot={(targetSlotId) => {
              if (!resolveBoardEffectTargetFromSlot(targetSlotId)) {
                setStatusMessage("That is not a valid effect target.");
              }
            }}
            onCemeteryStackClick={(owner) => {
              setCemeteryViewerOwner(current => current === owner ? null : owner);
              const ownerCemetery = match.players.find(player => player.id === owner)?.cemetery ?? [];
              setSelectedCemeteryCardId(ownerCemetery[ownerCemetery.length - 1]?.instanceId ?? null);
              setHoveredCemeteryCardId(null);
            }}
            sacrificeCandidateCardIds={discardRequiredForFocusedPlayer ? [] : [...sacrificeCandidateIds]}
            selectedSacrificeCardIds={discardRequiredForFocusedPlayer ? [] : selectedSacrificeIds}
            onDeckStackContextMenu={(owner) => {
              if (owner !== focusedPlayerId) return;
              setDeckActionsExpanded(true);
              setDeckHandControlsOwner(owner);
            }}
            draggableHandCardIds={[...playableHandCardIds]}
            draggableBattleAttackerCardIds={[...legalBattleAttackerIds]}
            draggableEquipMagicCardIds={draggableEquipMagicCardIds}
            validBattleTargetPieceIds={battleDefender ? [battleDefender.object.id] : battleTargetPieceIds}
            validEquipTargetPieceIds={equipAttachTargetPieceIds}
            validEffectTargetPieceIds={effectTargetPieceIds}
            validEffectTargetSlotIds={effectTargetSlotIds}
            effectSourcePieceIds={[...effectSourcePieceIds, ...cardEffectSourcePieceIds]}
            highlightedSlotIds={[...animationHighlights.slotIds, ...visualTargetSlotIds, ...playerGlobalSlotIds, ...sacrificeTargetSlotIds, ...(discardRequiredForFocusedPlayer ? [`${focusedPlayerId}-cemetery`] : []), ...battleTargetSlotIds, ...effectTargetSlotIds]}
            highlightedPieceIds={[...animationHighlights.pieceIds, ...sacrificeCandidatePieceIds, ...selectedCreatureEquipmentFocusPieceIds, ...effectTargetPieceIds, ...cardEffectSourcePieceIds, ...battleAttackerPieceIds, ...battleTargetPieceIds, ...pendingBattlePieceIds]}
            equipAttachSourcePieceIds={equipAttachSourcePieceIds}
            battleSpeedBadges={battleSpeedBadges}
            diceRollVisual={diceRollVisual}
            attackAnimation={activeAttackAnimation}
            activeEventType={activeEvent?.type ?? null}
            match={match}
            cardByInstanceId={cardByInstanceId}
            blockedReasonsBySlotId={blockedReasonsBySlotId}
          />
          <OpeningRollBoardControl
            match={match}
            controlledPlayerId={controlledPlayerId}
            onOpeningRoll={onOpeningRoll}
          />
          <aside className="board-preview-3d__turn-controls" aria-label="Board turn and dice controls">
            <section className="board-phase-control" aria-label="Turn phase controls">
              <div className="board-phase-control__status">
                <span>Current Phase</span>
                <strong>{currentPhaseLabel}</strong>
                <small>{activePlayer?.displayName ?? match.turn.activePlayerId} | Turn {match.turn.turnNumber}</small>
              </div>
              <div className="board-phase-control__actions">
                {shouldShowAdvancePhaseButton ? (
                  <button
                    type="button"
                    disabled={!canUseTurnControls || !onAdvancePhase}
                    onClick={onAdvancePhase}
                    title={advanceBlockReason || `Move to ${nextPhaseLabel}`}
                  >
                    Move to {nextPhaseLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  disabled={!canEndTurnFromBoard || !onEndTurn}
                  onClick={onEndTurn}
                  title={
                    advanceBlockReason ||
                    (match.turn.phase === "DRAW" && !activePlayer?.turnFlags.drawnThisTurn ? "Draw before ending your turn" : "End your turn")
                  }
                >
                  End Turn
                </button>
              </div>
            </section>
            {boardDiceRollAction ? <BoardDiceRollControl action={boardDiceRollAction} /> : null}
            {match.pendingChain?.priorityPlayerId && onPassMagicChainPriority && (!controlledPlayerId || controlledPlayerId === match.pendingChain.priorityPlayerId) ? (
              <aside className="board-dice-control board-dice-control--player_1 is-ready" aria-label="Magic Chain priority">
                <button
                  type="button"
                  className="board-dice-control__event"
                  onClick={() => onPassMagicChainPriority(match.pendingChain!.priorityPlayerId as BoardPlayerId)}
                >
                  <strong>Chain Priority</strong>
                  <span>Pass response priority</span>
                </button>
              </aside>
            ) : null}
            {boardDeckActions.map(action => (
              <div
                key={`${action.owner}-deck-actions`}
                className={`board-preview-3d__deck-actions board-preview-3d__deck-actions--${action.owner}${action.shouldShowHandControls ? " has-hand-controls" : ""}${deckActionsExpanded ? " is-expanded" : " is-collapsed"}`}
              >
                <button
                  type="button"
                  className="board-preview-3d__deck-actions-menu"
                  onClick={() => {
                    setDeckActionsExpanded(current => !current);
                    setDeckHandControlsOwner(action.owner);
                  }}
                  aria-expanded={deckActionsExpanded}
                >
                  <span aria-hidden="true"><i /><i /><i /></span>
                  Menu
                </button>
                <div className="board-preview-3d__deck-actions-panel">
                  <button type="button" disabled={!action.canUndo} onClick={onUndoLastAction}>
                    Undo
                  </button>
                  {onOpenBoardReport ? (
                    <button type="button" className="is-report" onClick={onOpenBoardReport}>
                      Report
                    </button>
                  ) : null}
                  {onSaveAndQuit ? (
                    <button type="button" className="is-save-exit" onClick={onSaveAndQuit}>
                      Save & Quit
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={action.canCallCemeteryHpLoss ? "is-emphasis" : undefined}
                    disabled={!action.canCallCemeteryHpLoss}
                    onClick={() => {
                      if (!action.opponentOwner) return;
                      onCallCemeteryHpLoss?.(action.opponentOwner, action.owner);
                    }}
                    title={action.cemeteryHpLossTitle}
                  >
                    Call Cemetery Loss
                  </button>
                  {action.shouldShowHandControls ? (
                    <>
                      <button
                        type="button"
                        className="is-hand-control"
                        onClick={() => {
                          const nextRevealed = !action.handIsLocallyRevealed;
                          setLocallyRevealedHands(current => ({
                            ...current,
                            [action.owner]: nextRevealed
                          }));
                          onSetHandRevealed?.(action.owner, nextRevealed);
                        }}
                        title="Toggle this hand face-up on the 3D board for manual reveal effects."
                      >
                        {action.handIsLocallyRevealed ? "Hide Hand" : "Reveal Hand"}
                      </button>
                      {action.isApprovingReveal ? (
                        <button type="button" className="is-emphasis is-hand-control" onClick={onApproveRevealRedraw} disabled={!onApproveRevealRedraw}>
                          Accept Hand
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`${action.canRequestNoCreatureRedraw ? "is-emphasis " : ""}is-hand-control`}
                          disabled={!action.canRequestNoCreatureRedraw}
                          onClick={() => {
                            setLocallyRevealedHands(current => ({
                              ...current,
                              [action.owner]: true
                            }));
                            onRequestNoCreatureRedraw?.(action.owner);
                          }}
                          title="Reveal this hand and request a no-creature redraw."
                        >
                          {action.isRequestingReveal ? "Mulligan Pending" : "Mulligan Reveal"}
                        </button>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </aside>
          {actionDock && !actionDockCollapsed ? (
            <div className={`board-preview-3d__action-dock board-preview-3d__action-dock--${actionDockPosition}`}>
              <div className="board-preview-3d__floating-title">
                <strong>Action Dock</strong>
                <button type="button" className="ghost" onClick={cycleActionDockPosition}>Move</button>
                <button type="button" className="ghost" onClick={() => setActionDockCollapsed(true)}>Hide</button>
              </div>
              {actionDock}
            </div>
          ) : null}
          {handCards.length > 0 ? (
            <section className="board-preview-3d__hand-rail" aria-label="3D board hand rail">
              <div className="board-preview-3d__hand-rail-tab">Hand {handCards.length}</div>
              <div className="board-preview-3d__hand-rail-cards">
                {handCards.map(card => {
                  const disabledReason = disabledHandCardReasons.get(card.instanceId);
                  return (
                  <button
                    key={card.instanceId}
                    type="button"
                    draggable={playableHandCardIds.has(card.instanceId) || sacrificeCandidateIds.has(card.instanceId)}
                    className={[
                      selectedHandCardId === card.instanceId ? "is-selected" : "",
                      playableHandCardIds.has(card.instanceId) ? "is-playable" : "",
                      disabledReason ? "is-disabled-action" : "",
                      sacrificeCandidateIds.has(card.instanceId) ? "is-sacrifice-candidate" : "",
                      selectedSacrificeIdSet.has(card.instanceId) ? "is-selected-sacrifice" : ""
                    ].filter(Boolean).join(" ") || undefined}
                    title={disabledReason ?? undefined}
                    onClick={() => {
                      if (playableChainResponseCardIds.has(card.instanceId) && onPlayLightningResponse) {
                        onPlayLightningResponse(focusedPlayerId, card.instanceId);
                        return;
                      }
                      if (playableBattleResponseCardIds.has(card.instanceId) && match.pendingBattle && pendingBattleStrike && onPlayBattleResponse) {
                        onPlayBattleResponse(match.pendingBattle.id, pendingBattleStrike.id, focusedPlayerId, card.instanceId);
                        return;
                      }
                      if (sacrificeCandidateIds.has(card.instanceId) && selectedHandCardId !== card.instanceId) {
                        toggleSacrificeSelection(card.instanceId);
                        return;
                      }
                      setSelectedHandCardId(current => current === card.instanceId ? null : card.instanceId);
                    }}
                    onFocus={() => setHoveredHandCardId(card.instanceId)}
                    onMouseEnter={() => setHoveredHandCardId(card.instanceId)}
                    onBlur={() => setHoveredHandCardId(current => current === card.instanceId ? null : current)}
                    onMouseLeave={() => setHoveredHandCardId(current => current === card.instanceId ? null : current)}
                    onDragStart={(event) => {
                      if (!playableHandCardIds.has(card.instanceId) && !sacrificeCandidateIds.has(card.instanceId)) {
                        event.preventDefault();
                        setStatusMessage(disabledReason ?? "That card cannot be played right now.");
                        return;
                      }
                      if (!sacrificeCandidateIds.has(card.instanceId)) {
                        setSelectedHandCardId(card.instanceId);
                      }
                      event.dataTransfer.setData("application/x-ward-board-hand-card", card.instanceId);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <MatchCardImage match={match} card={card} className="board-preview-3d__hand-card-art" />
                    <span>{match.cardCatalog[card.cardId]?.name ?? card.cardId}</span>
                  </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          {cemeteryViewerPlayer ? (
            <section className="board-preview-3d__cemetery-viewer" aria-label={`${cemeteryViewerPlayer.displayName} cemetery`}>
              <div className="board-preview-3d__cemetery-viewer-header">
                <div>
                  <strong>{cemeteryViewerPlayer.displayName} Cemetery</strong>
                  <span className={Number(cemeteryViewerPlayer.cemeteryHpAdjustment ?? 0) !== 0 ? "is-cemetery-hp-adjusted" : undefined}>
                    {cemeteryCards.length} cards / {cemeteryViewerPlayer.cemeteryCreatureHpTotal} HP
                    {Number(cemeteryViewerPlayer.cemeteryHpAdjustment ?? 0) !== 0 ? ` (${Number(cemeteryViewerPlayer.cemeteryHpAdjustment ?? 0) > 0 ? "+" : ""}${cemeteryViewerPlayer.cemeteryHpAdjustment} effect)` : ""}
                  </span>
                </div>
                <button type="button" onClick={() => {
                  setCemeteryViewerOwner(null);
                  setHoveredCemeteryCardId(null);
                  setSelectedCemeteryCardId(null);
                }}>Close</button>
              </div>
              {cemeteryCards.length > 0 ? (
                <div className="board-preview-3d__cemetery-viewer-body">
                  <div className="board-preview-3d__cemetery-card-list">
                    {cemeteryCards.map(card => {
                      const isSelected = inspectedCemeteryCardId === card.instanceId;
                      const effectOptionId = effectTargetOptionByCardId.get(card.instanceId);
                      return (
                        <button
                          type="button"
                          key={card.instanceId}
                          className={`${isSelected ? "is-selected" : ""}${effectOptionId ? " is-effect-target" : ""}`}
                          onClick={() => {
                            if (effectOptionId) {
                              resolveBoardEffectTarget(effectOptionId);
                              return;
                            }
                            setSelectedCemeteryCardId(card.instanceId);
                          }}
                          onFocus={() => setHoveredCemeteryCardId(card.instanceId)}
                          onMouseEnter={() => setHoveredCemeteryCardId(card.instanceId)}
                          onBlur={() => setHoveredCemeteryCardId(current => current === card.instanceId ? null : current)}
                          onMouseLeave={() => setHoveredCemeteryCardId(current => current === card.instanceId ? null : current)}
                        >
                          <MatchCardImage match={match} card={card} className="board-preview-3d__cemetery-card-art" />
                          <span>{getCardName(match, card)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="board-preview-3d__cemetery-empty">No cards in cemetery.</p>
              )}
            </section>
          ) : null}
          {inspectedCemeteryCard ? (
            <BoardCardInspector
              ariaLabel="Cemetery card preview"
              card={inspectedCemeteryCard}
              className="board-preview-3d__card-inspector--cemetery"
              detailsExpanded={cemeteryInspectorDetailsExpanded}
              match={match}
              onToggleDetails={() => setCemeteryInspectorDetailsExpanded(current => !current)}
            />
          ) : null}
          {inspectedOpponentRevealCard ? (
            <BoardCardInspector
              ariaLabel="Revealed hand card preview"
              card={inspectedOpponentRevealCard}
              className="board-preview-3d__card-inspector--hand"
              detailsExpanded={opponentRevealInspectorDetailsExpanded}
              match={match}
              onToggleDetails={() => setOpponentRevealInspectorDetailsExpanded(current => !current)}
            />
          ) : null}
          {inspectedHandCard ? (
            <BoardCardInspector
              ariaLabel="Hand card preview"
              card={inspectedHandCard}
              className="board-preview-3d__card-inspector--hand"
              detailsExpanded={handInspectorDetailsExpanded}
              extraHeader={selectedHandCardId === inspectedHandCard.instanceId && sacrificeSelectionActive ? (
                  <small className={sacrificeSelectionComplete ? "is-complete" : undefined}>
                    Sacrifice {selectedSacrificeIds.length}/{selectedSummonRequiredSacrifices}
                  </small>
              ) : null}
              match={match}
              onToggleDetails={() => setHandInspectorDetailsExpanded(current => !current)}
            >
              {selectedHandCardId === inspectedHandCard.instanceId && sacrificeSelectionActive ? (
                <div className="board-preview-3d__sacrifice-tracker">
                  <div className="board-preview-3d__sacrifice-tracker-title">
                    <span>Sacrifices</span>
                    <strong>{selectedSacrificeIds.length}/{selectedSummonRequiredSacrifices}</strong>
                  </div>
                  <div className="board-preview-3d__sacrifice-meter" aria-hidden="true">
                    {Array.from({ length: selectedSummonRequiredSacrifices }, (_, index) => (
                      <i key={index} className={index < selectedSacrificeIds.length ? "is-filled" : undefined} />
                    ))}
                  </div>
                  <div className="board-preview-3d__sacrifice-candidates">
                    {sacrificeCandidates.map(candidate => {
                      const selected = selectedSacrificeIdSet.has(candidate.instanceId);
                      return (
                        <button
                          type="button"
                          key={candidate.instanceId}
                          className={selected ? "is-selected" : undefined}
                          onClick={() => toggleSacrificeSelection(candidate.instanceId)}
                        >
                          <span>{getCardName(match, candidate)}</span>
                          <small>{candidate.zone === "PRIMARY_CREATURE" ? "Primary" : "Hand"}</small>
                        </button>
                      );
                    })}
                  </div>
                  <p>Drag valid sacrifices to your cemetery or tap them here, then play this creature to Primary.</p>
                </div>
              ) : null}
            </BoardCardInspector>
          ) : null}
          {opponentPlayer && opponentPlayer.hand.length > 0 ? (
            <section className={`board-preview-3d__hand-rail board-preview-3d__hand-rail--opponent${opponentHandHasPrompt ? " is-prompt-open" : ""}`} aria-label={`${opponentPlayer.displayName} ${visibleOpponentHandCards.length > 0 ? "revealed" : "hidden"} hand`}>
              <div className="board-preview-3d__hand-rail-tab">
                {opponentHandHasPrompt ? "Action Required" : `Opponent Hand ${opponentPlayer.hand.length}${visibleOpponentHandCards.length > 0 ? " Revealed" : ""}`}
              </div>
              {opponentHandHasPrompt && noCreatureRevealPrompt ? (
                <div className="board-preview-3d__hand-prompt">
                  <div>
                    <strong>{opponentPlayer.displayName} requests a no-creature redraw.</strong>
                    <span>Review the revealed hand, then accept the redraw.</span>
                  </div>
                  <button type="button" onClick={onApproveRevealRedraw} disabled={!onApproveRevealRedraw}>
                    Accept Redraw {noCreatureRevealPrompt.redrawCount}
                  </button>
                </div>
              ) : null}
              <div className="board-preview-3d__hand-rail-cards" aria-hidden={visibleOpponentHandCards.length === 0 ? "true" : undefined}>
                {visibleOpponentHandCards.length > 0
                  ? visibleOpponentHandCards.slice(0, 10).map(card => (
                    <button
                      type="button"
                      className={`board-preview-3d__revealed-hand-card${inspectedOpponentRevealCardId === card.instanceId ? " is-selected" : ""}`}
                      key={card.instanceId}
                      onClick={() => setSelectedOpponentRevealCardId(current => current === card.instanceId ? null : card.instanceId)}
                      onFocus={() => setHoveredOpponentRevealCardId(card.instanceId)}
                      onMouseEnter={() => setHoveredOpponentRevealCardId(card.instanceId)}
                      onBlur={() => setHoveredOpponentRevealCardId(current => current === card.instanceId ? null : current)}
                      onMouseLeave={() => setHoveredOpponentRevealCardId(current => current === card.instanceId ? null : current)}
                      title={`Inspect ${match.cardCatalog[card.cardId]?.name ?? card.cardId}`}
                    >
                      <MatchCardImage match={match} card={card} className="board-preview-3d__hand-card-art" />
                    </button>
                  ))
                  : opponentPlayer.hand.slice(0, 10).map((card, index) => (
                    <div className="board-preview-3d__hidden-hand-card" key={`${card.instanceId}-${index}`}>
                      <span>Ward<br />Nexus</span>
                    </div>
                  ))}
              </div>
            </section>
          ) : null}
          {selectedBattleAttacker ? (
            <section className="board-preview-3d__quick-actions">
              <button type="button" disabled={!battleDefender} onClick={() => {
                if (!selectedBattleAttacker.cardInstanceId || !battleDefender) return;
                onStartBattleFromPiece?.(selectedBattleAttacker.cardInstanceId, battleDefender.card.instanceId);
                setSelectedBattleAttackerId(null);
              }}>
                Start Battle ({selectedBattleAttacker.label})
              </button>
              <small>Target: {battleDefender?.object.label ?? "No valid defender"}</small>
            </section>
          ) : null}
          {match.pendingChain ? (
            <BoardMagicChainHud
              match={match}
              controlledPlayerId={controlledPlayerId}
              onPassPriority={onPassMagicChainPriority}
              onResolve={onResolveMagicChain}
            />
          ) : null}
          {match.pendingBattle ? (
            <BoardBattleResolverHud
              battle={match.pendingBattle}
              effectRoll={match.pendingEffectRoll}
              canAdvanceStep={canAdvanceBattleResolver}
              controllerLabel={battleStepControllerLabel}
              onApplyDamage={onApplyBattleDamage}
              onFinish={onFinishBattle}
              onApplyEffect={onApplyEffectRoll}
              onSkipEffect={onSkipEffectRoll}
            />
          ) : null}
          {!match.pendingBattle && match.pendingEffectRoll ? (
            <BoardEffectRollHud
              effectRoll={match.pendingEffectRoll}
              canAdvanceStep={canAdvanceStandaloneEffectRoll}
              controllerLabel={battleStepControllerLabel}
              onApplyEffect={onApplyEffectRoll}
              onSkipEffect={onSkipEffectRoll}
            />
          ) : null}
          {match.pendingPrompt?.type === "FORCED_AL_SUMMON" ? (
            <aside className="board-battle-hud board-battle-hud--prompt" aria-label="Forced summon prompt">
              <ForcedAlSummonPromptCard
                match={match}
                controlledPlayerId={controlledPlayerId ?? undefined}
                compact
                onSummon={onResolveForcedAlSummon}
                onMulligan={onMulliganForcedAlSummon}
              />
            </aside>
          ) : null}
        </section>
        {showDebugPanel ? (
          <aside className="board-preview-3d__debug-drawer">
            <BoardPreview3DDebugPanel
              show={showDebugPanel}
              showZoneRects={showZoneRects}
              setShowZoneRects={setShowZoneRects}
              showAnchors={showAnchors}
              setShowAnchors={setShowAnchors}
              visibleSlotLayers={visibleSlotLayers}
              setVisibleSlotLayer={setVisibleSlotLayer}
              selectedSlot={selectedSlot}
              selectedSlotId={selectedSlotId}
              selectedSlotIndex={selectedSlotIndex}
              slotCount={BOARD_SLOTS.length}
              selectedOffset={selectedOffset}
              selectedZoneId={selectedZone.id}
              selectedZone={selectedZone}
              selectedZoneAdjustment={selectedZoneAdjustment}
              nudgeStep={nudgeStep}
              setNudgeStep={setNudgeStep}
              onNudge={nudgeSelectedSlot}
              onSelectZone={setSelectedZoneId}
              onZoneAdjust={adjustSelectedZone}
              onResetSelectedZone={resetSelectedZoneAdjustment}
              onResetZoneAdjustments={resetZoneAdjustments}
              onSelectRelative={selectRelativeSlot}
              onCopySelected={() => void copySelectedSlotSnapshot()}
              onResetCamera={resetCamera}
              onResetOffsets={safeResetSlotOffsets}
              onResetSelectedOffset={resetSelectedSlotOffset}
              onCopyLayout={() => void copyLayoutSnapshot()}
              layoutDraft={layoutDraft}
              setLayoutDraft={setLayoutDraft}
              layoutDraftError={layoutDraftError}
              layoutDraftIsValid={layoutDraftIsValid}
              onApplyLayout={applyLayoutDraft}
              slotOccupancy={slotOccupancy}
              onSelectSlot={(slotId) => selectSlot(slotId, "debug")}
              readOnly={false}
            />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
