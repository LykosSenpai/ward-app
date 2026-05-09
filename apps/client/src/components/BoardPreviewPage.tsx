import { useEffect, useMemo, useRef, useState } from "react";
import type { CardDefinition, CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState, CardLibraryCardSummary } from "../clientTypes";
import { BoardPreview3D } from "./BoardPreview3D";
import {
  buildBoardObjects,
  buildInteractionIntentFromPieceFocus,
  buildInteractionIntentFromSlotFocus,
  canDispatchBattle,
  canDispatchMagic,
  canDispatchSummon,
  ensureDispatchReady,
  getDispatchBlockedReason
} from "./boardPreview3dAdapter";
import { BOARD_SLOTS } from "./boardPreview3dLayout";
import { socket } from "../socket";
import { canSummonCreatureFromHand, getMatchStatus, getRequiredSacrificesForCard, isCreature, isMagic } from "../gameViewHelpers";

type BoardPreviewPageProps = {
  cardLibrary: CardLibraryCardSummary[];
  controlledPlayerId?: "player_1" | "player_2" | null;
  liveMatch?: AppMatchState | null;
};

const MAX_DISPATCH_HISTORY = 5;
const DISPATCH_ACK_TIMEOUT_MS = 8000;

function toCardDefinition(card: CardLibraryCardSummary): CardDefinition {
  if (card.cardType === "CREATURE") {
    return {
      id: card.id,
      name: card.name,
      cardType: "CREATURE",
      creatureType: card.creatureType ?? "Beast",
      armorLevel: card.armorLevel ?? 1,
      speed: card.speed ?? 1,
      hp: card.hp ?? 30,
      attackDice: card.attackDice ?? 1,
      modifier: card.modifier ?? 0,
      generation: card.generation,
      edition: card.edition,
      rarity: card.rarity,
      cardNumber: card.cardNumber,
      artworkEffect: card.artworkEffect,
      artworkTags: card.artworkTags,
      text: card.text,
      effects: card.effects
    };
  }

  return {
    id: card.id,
    name: card.name,
    cardType: "MAGIC",
    magicType: card.magicType ?? "STANDARD",
    magicSubType: card.magicSubType ?? "NONE",
    generation: card.generation,
    edition: card.edition,
    rarity: card.rarity,
    cardNumber: card.cardNumber,
    artworkEffect: card.artworkEffect,
    artworkTags: card.artworkTags,
    text: card.text,
    effects: card.effects
  };
}

function makeInstance(
  card: CardLibraryCardSummary,
  ownerPlayerId: "player_1" | "player_2",
  zone: CardInstance["zone"],
  suffix: string,
  currentHp?: number,
  extras: Partial<CardInstance> = {}
): CardInstance {
  const baseHp = card.cardType === "CREATURE" ? card.hp ?? 30 : undefined;

  return {
    instanceId: `${ownerPlayerId}_${card.id}_${suffix}`,
    cardId: card.id,
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    zone,
    baseHp,
    currentHp: currentHp ?? baseHp,
    ...extras
  };
}

function makeDeck(
  cards: CardLibraryCardSummary[],
  ownerPlayerId: "player_1" | "player_2",
  count: number
): CardInstance[] {
  return Array.from({ length: count }, (_, index) =>
    makeInstance(cards[index % cards.length], ownerPlayerId, "DECK", `deck_${index + 1}`)
  );
}

function makePlayer({
  playerId,
  displayName,
  creatures,
  magics,
  offset
}: {
  playerId: "player_1" | "player_2";
  displayName: string;
  creatures: CardLibraryCardSummary[];
  magics: CardLibraryCardSummary[];
  offset: number;
}): PlayerState {
  const pickCreature = (index: number) => creatures[(offset + index) % creatures.length];
  const pickMagic = (index: number) => magics[(offset + index) % magics.length];

  const primaryCard = pickCreature(0);
  const limitedOneCard = pickCreature(1);
  const limitedTwoCard = pickCreature(2);
  const equipMagicCard = pickMagic(0);
  const fieldMagicCard = pickMagic(1);

  const primary = makeInstance(
    primaryCard,
    playerId,
    "PRIMARY_CREATURE",
    "primary",
    Math.max(1, Math.floor((primaryCard.hp ?? 30) * 0.78))
  );

  const limitedOne = makeInstance(
    limitedOneCard,
    playerId,
    "LIMITED_SUMMON",
    "limited_1",
    limitedOneCard.hp ?? 30,
    {
      isLimitedSummon: true,
      effectsSuppressed: true
    }
  );

  const limitedTwo = makeInstance(
    limitedTwoCard,
    playerId,
    "LIMITED_SUMMON",
    "limited_2",
    limitedTwoCard.hp ?? 30,
    {
      isLimitedSummon: true,
      effectsSuppressed: true
    }
  );

  const equipMagic = makeInstance(equipMagicCard, playerId, "MAGIC_SLOT", "magic_1", undefined, {
    attachedToInstanceId: primary.instanceId
  });

  const fieldMagic = makeInstance(fieldMagicCard, playerId, "MAGIC_SLOT", "magic_2");

  return {
    id: playerId,
    displayName,
    teamId: playerId,
    deck: makeDeck(creatures, playerId, playerId === "player_1" ? 22 : 24),
    hand: [
      makeInstance(pickCreature(3), playerId, "HAND", "hand_1"),
      makeInstance(pickMagic(2), playerId, "HAND", "hand_2"),
      makeInstance(pickMagic(3), playerId, "HAND", "hand_3"),
      makeInstance(pickCreature(4), playerId, "HAND", "hand_4")
    ],
    cemetery: [
      makeInstance(pickCreature(5), playerId, "CEMETERY", "cemetery_1", 0),
      makeInstance(pickCreature(6), playerId, "CEMETERY", "cemetery_2", 0)
    ],
    removedFromGame: [],
    field: {
      primaryCreature: primary,
      limitedSummons: [limitedOne, limitedTwo],
      magicSlots: [equipMagic, fieldMagic]
    },
    cemeteryCreatureHpTotal: 70,
    hasLost: false,
    turnFlags: {
      hasTakenFirstTurn: true,
      drawnThisTurn: true,
      playedCreatureThisTurn: false,
      normalSummonUsed: false,
      killedOwnCreatureThisTurn: false,
      hasBattledThisCombat: false,
      battleUsedCreatureInstanceIds: []
    }
  };
}

function buildPreviewMatch(cardLibrary: CardLibraryCardSummary[]): AppMatchState | null {
  const creatures = cardLibrary.filter(card => card.cardType === "CREATURE");
  const magics = cardLibrary.filter(card => card.cardType === "MAGIC");

  if (creatures.length < 8 || magics.length < 4) {
    return null;
  }

  const cardCatalog = Object.fromEntries(
    cardLibrary.map(card => [card.id, toCardDefinition(card)])
  );

  const players = [
    makePlayer({
      playerId: "player_1",
      displayName: "Preview Player 1",
      creatures,
      magics,
      offset: 0
    }),
    makePlayer({
      playerId: "player_2",
      displayName: "Preview Player 2",
      creatures,
      magics,
      offset: 8
    })
  ];

  return {
    matchId: "board-preview",
    format: "1v1",
    rulesetIds: ["preview"],
    status: "ACTIVE",
    cardCatalog,
    setup: {
      decksShuffled: true,
      firstTurnDrawsByPlayer: {
        player_1: true,
        player_2: true
      },
      deckValidation: {}
    },
    manualEffectQueue: [],
    players,
    chainZone: [],
    turn: {
      activePlayerId: "player_1",
      turnNumber: 3,
      turnCycleNumber: 2,
      phase: "SUMMON_MAGIC",
      firstTurnCycleComplete: true,
      currentTurnOrder: ["player_1", "player_2"],
      currentTurnIndex: 0,
      turnStartCountsByPlayer: {
        player_1: 2,
        player_2: 1
      }
    },
    settings: {
      cemeteryHpLimit: 300,
      eliminationMode: "called_out",
      tournamentMode: false,
      cannotInflictAttackDamageBattlePolicy: "DAMAGE_ONLY"
    },
    devTools: {
      rolls: {
        forcedRollQueue: []
      }
    },
    eventLog: []
  };
}

export function BoardPreviewPage({ cardLibrary, controlledPlayerId, liveMatch = null }: BoardPreviewPageProps) {
  const previewMatch = useMemo(() => liveMatch ?? buildPreviewMatch(cardLibrary), [cardLibrary, liveMatch]);
  const previewBoardObjects = useMemo(() => (previewMatch ? buildBoardObjects(previewMatch) : []), [previewMatch]);
  const dedicatedBoardUrl = `${window.location.origin}${window.location.pathname}?page=board-preview&boardWindow=1`;
  const openDedicatedBoardWindow = () => {
    window.open(dedicatedBoardUrl, "ward-3d-board", "popup,width=1440,height=900");
  };
  const [lastInteraction, setLastInteraction] = useState<string>("None");
  const [dispatchHistory, setDispatchHistory] = useState<string[]>([]);
  const [pendingDispatches, setPendingDispatches] = useState<Array<{ requestId: string; label: string }>>([]);
  const pendingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const pushDispatchHistory = (entry: string) => {
    setDispatchHistory((current) => [`${new Date().toISOString()} ${entry}`, ...current].slice(0, MAX_DISPATCH_HISTORY));
  };

  const newDispatchRequestId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const clearPendingDispatch = (requestId: string) => {
    const timeout = pendingTimeoutsRef.current[requestId];
    if (timeout) {
      clearTimeout(timeout);
      delete pendingTimeoutsRef.current[requestId];
    }
    setPendingDispatches((current) => current.filter((item) => item.requestId !== requestId));
  };

  const recordBridgeDispatch = (params: { requestId: string; label: string; interactionLabel: string }) => {
    const { requestId, label, interactionLabel } = params;
    setLastInteraction(interactionLabel);
    pushDispatchHistory(`dispatch:${requestId} ${label}`);
    setPendingDispatches((current) => [{ requestId, label }, ...current].slice(0, MAX_DISPATCH_HISTORY));
    pendingTimeoutsRef.current[requestId] = setTimeout(() => {
      setLastInteraction(`dispatch-timeout:${requestId} ${label}`);
      pushDispatchHistory(`timeout:${requestId} ${label}`);
      clearPendingDispatch(requestId);
    }, DISPATCH_ACK_TIMEOUT_MS);
  };

  useEffect(() => {
    const handleMatchError = (data: { message: string; clientRequestId?: string }) => {
      setLastInteraction(`server-error:${data.message}`);
      pushDispatchHistory(`server-error: ${data.message}`);
      if (data.clientRequestId) {
        clearPendingDispatch(data.clientRequestId);
        pushDispatchHistory(`server-reject:${data.clientRequestId}`);
        return;
      }
      setPendingDispatches((current) => {
        current.forEach((item) => clearPendingDispatch(item.requestId));
        return [];
      });
    };

    const handleMatchState = (data?: { clientRequestId?: string }) => {
      pushDispatchHistory("server-state: updated");
      if (data?.clientRequestId) {
        setPendingDispatches((current) => {
          const matched = current.find((item) => item.requestId === data.clientRequestId);
          if (matched) {
            setLastInteraction(`server-ack:${matched.requestId} ${matched.label}`);
            pushDispatchHistory(`server-ack:${matched.requestId} ${matched.label}`);
            clearPendingDispatch(matched.requestId);
          }
          return current;
        });
        return;
      }
      setPendingDispatches((current) => {
        const next = current[0];
        if (!next) return current;
        setLastInteraction(`server-ack:${next.requestId} ${next.label}`);
        pushDispatchHistory(`server-ack:${next.requestId} ${next.label}`);
        clearPendingDispatch(next.requestId);
        return current;
      });
    };

    socket.on("match:error", handleMatchError);
    socket.on("match:state", handleMatchState);

    return () => {
      socket.off("match:error", handleMatchError);
      socket.off("match:state", handleMatchState);
      Object.values(pendingTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
      pendingTimeoutsRef.current = {};
    };
  }, []);
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);
  const [summonPlayerId, setSummonPlayerId] = useState<"player_1" | "player_2">(controlledPlayerId ?? "player_1");
  const [summonCardInstanceId, setSummonCardInstanceId] = useState("");
  const [magicCardInstanceId, setMagicCardInstanceId] = useState("");
  const [battleAttackerInstanceId, setBattleAttackerInstanceId] = useState("");
  const [sacrificeIdsDraft, setSacrificeIdsDraft] = useState("");

  const summonCandidateCardInstanceIds = useMemo(() => {
    if (!previewMatch) return [];
    const player = previewMatch.players.find((item) => item.id === summonPlayerId);
    if (!player) return [];
    return player.hand.filter((card) => card.ownerPlayerId === summonPlayerId).map((card) => card.instanceId);
  }, [previewMatch, summonPlayerId]);
  const magicCandidateCardInstanceIds = useMemo(() => {
    if (!previewMatch) return [];
    const player = previewMatch.players.find((item) => item.id === summonPlayerId);
    if (!player) return [];
    return player.hand.filter((card) => card.ownerPlayerId === summonPlayerId && isMagic(previewMatch, card)).map((card) => card.instanceId);
  }, [previewMatch, summonPlayerId]);
  const battleAttackerCandidateIds = useMemo(() => {
    if (!previewMatch) return [];
    const player = previewMatch.players.find((item) => item.id === summonPlayerId);
    if (!player) return [];
    const limited = player.field.limitedSummons.map((card) => card.instanceId);
    const primary = player.field.primaryCreature ? [player.field.primaryCreature.instanceId] : [];
    return [...primary, ...limited];
  }, [previewMatch, summonPlayerId]);

  useEffect(() => {
    if (controlledPlayerId) {
      setSummonPlayerId(controlledPlayerId);
    }
  }, [controlledPlayerId]);

  useEffect(() => {
    if (!summonCandidateCardInstanceIds.length) {
      setSummonCardInstanceId("");
      return;
    }
    if (!summonCandidateCardInstanceIds.includes(summonCardInstanceId)) {
      setSummonCardInstanceId(summonCandidateCardInstanceIds[0]);
    }
  }, [summonCandidateCardInstanceIds, summonCardInstanceId]);

  useEffect(() => {
    if (!magicCandidateCardInstanceIds.length) {
      setMagicCardInstanceId("");
      return;
    }
    if (!magicCandidateCardInstanceIds.includes(magicCardInstanceId)) {
      setMagicCardInstanceId(magicCandidateCardInstanceIds[0]);
    }
  }, [magicCandidateCardInstanceIds, magicCardInstanceId]);

  useEffect(() => {
    if (!battleAttackerCandidateIds.length) {
      setBattleAttackerInstanceId("");
      return;
    }
    if (!battleAttackerCandidateIds.includes(battleAttackerInstanceId)) {
      setBattleAttackerInstanceId(battleAttackerCandidateIds[0]);
    }
  }, [battleAttackerCandidateIds, battleAttackerInstanceId]);

  const focusedSlot = focusedSlotId ? BOARD_SLOTS.find((slot) => slot.id === focusedSlotId) ?? null : null;
  const summonPlayer = previewMatch?.players.find((item) => item.id === summonPlayerId);
  const selectedSummonCard = summonPlayer?.hand.find((card) => card.instanceId === summonCardInstanceId) ?? null;
  const selectedMagicCard = summonPlayer?.hand.find((card) => card.instanceId === magicCardInstanceId) ?? null;
  const isMatchComplete = previewMatch ? getMatchStatus(previewMatch) === "COMPLETE" : false;
  const canControlSelectedPlayer = !controlledPlayerId || controlledPlayerId === summonPlayerId;
  const isActiveSelectedPlayer = previewMatch?.turn.activePlayerId === summonPlayerId;
  const anyDiscardRequired = !!previewMatch?.setup.handDiscardRequiredForPlayerId;
  const canPlayMagicNowForSelected =
    !!previewMatch &&
    !isMatchComplete &&
    canControlSelectedPlayer &&
    isActiveSelectedPlayer &&
    !previewMatch.pendingPrompt &&
    !previewMatch.pendingChain &&
    !anyDiscardRequired &&
    !previewMatch.setup.primaryReplacementRequiredForPlayerId &&
    (previewMatch.turn.phase === "SUMMON_MAGIC" || previewMatch.turn.phase === "SECOND_MAGIC");
  const summonDispatchAllowed = canDispatchSummon({
    focusedSlotId: focusedSlot?.id,
    focusedSlotOwner: focusedSlot?.owner,
    summonPlayerId,
    cardInstanceId: summonCardInstanceId,
    isSummonableCard: Boolean(
      summonPlayer &&
        selectedSummonCard &&
        canSummonCreatureFromHand(previewMatch, summonPlayer, selectedSummonCard)
    )
  });
  const magicDispatchAllowed = canDispatchMagic({
    focusedSlotId: focusedSlot?.id,
    focusedSlotOwner: focusedSlot?.owner,
    summonPlayerId,
    cardInstanceId: magicCardInstanceId,
    isPlayableMagicCard: Boolean(selectedMagicCard && isMagic(previewMatch, selectedMagicCard) && canPlayMagicNowForSelected)
  });
  const battleDispatchAllowed = Boolean(battleAttackerInstanceId.trim());
  const requiredSacrifices = selectedSummonCard ? getRequiredSacrificesForCard(previewMatch, selectedSummonCard) : 0;
  const availableSacrificeIds = useMemo(() => {
    if (!previewMatch || !summonPlayer) return [];
    const limited = summonPlayer.field.limitedSummons.map((card) => card.instanceId);
    const primary = summonPlayer.field.primaryCreature ? [summonPlayer.field.primaryCreature.instanceId] : [];
    return [...primary, ...limited];
  }, [previewMatch, summonPlayer]);
  const battleAttackerCard = summonPlayer
    ? [summonPlayer.field.primaryCreature, ...summonPlayer.field.limitedSummons].find(
        (card): card is NonNullable<typeof summonPlayer.field.primaryCreature> => Boolean(card && card.instanceId === battleAttackerInstanceId)
      ) ?? null
    : null;
  const battleDefenderPlayer = previewMatch?.players.find((player) => player.id !== summonPlayerId);
  const battleDefenderCreatureId = battleDefenderPlayer?.field.primaryCreature?.instanceId;
  const canStartBattleNowForSelected =
    !!previewMatch &&
    !isMatchComplete &&
    canControlSelectedPlayer &&
    isActiveSelectedPlayer &&
    !previewMatch.pendingPrompt &&
    !previewMatch.pendingChain &&
    previewMatch.turn.phase === "COMBAT";
  const battleDispatchAllowedStrict = canDispatchBattle({
    attackerInstanceId: battleAttackerInstanceId,
    defenderInstanceId: battleDefenderCreatureId,
    canStartBattleNow: canStartBattleNowForSelected,
    hasDefenderPrimary: Boolean(battleDefenderCreatureId),
    hasValidAttacker: Boolean(battleDispatchAllowed && battleAttackerCard && isCreature(previewMatch, battleAttackerCard))
  });
  const summonDisabledReason = !focusedSlot
    ? "Focus a primary slot for the selected player"
    : !summonDispatchAllowed
      ? "Summon guard denied for current slot/card/turn"
      : null;
  const magicDisabledReason = !focusedSlot
    ? "Focus a magic slot for the selected player"
    : !magicDispatchAllowed
      ? "Magic guard denied for current slot/card/turn"
      : null;
  const battleDisabledReason = !battleDispatchAllowedStrict
    ? "Battle guard denied for attacker/defender/phase"
    : null;


  const dispatchSummonToFocusedSlot = () => {
    if (!previewMatch) return;
    const preflight = ensureDispatchReady({
      hasFocusedSlot: Boolean(focusedSlot),
      allowedByGuard: summonDispatchAllowed,
      isSocketConnected: socket.connected,
      blockedReason: "summon guard denied"
    });
    if (!preflight.ok) {
      const reason = getDispatchBlockedReason(preflight);
      setLastInteraction(`dispatch-blocked: ${reason}`);
      pushDispatchHistory(`blocked: ${reason}`);
      return;
    }
    const sacrificeCardInstanceIds = sacrificeIdsDraft
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (sacrificeCardInstanceIds.length < requiredSacrifices) {
      setLastInteraction(`dispatch-blocked: needs ${requiredSacrifices} sacrifices`);
      pushDispatchHistory(`blocked: needs ${requiredSacrifices} sacrifices`);
      return;
    }
    if (requiredSacrifices > 0 && sacrificeCardInstanceIds.length > requiredSacrifices) {
      setLastInteraction(`dispatch-blocked: too many sacrifices (max ${requiredSacrifices})`);
      pushDispatchHistory("blocked: too many sacrifices");
      return;
    }
    const requestId = newDispatchRequestId();
    socket.emit("match:playPrimaryCreature", {
      clientRequestId: requestId,
      matchId: previewMatch.matchId,
      playerId: summonPlayerId,
      cardInstanceId: summonCardInstanceId.trim(),
      sacrificeCardInstanceIds
    });
    recordBridgeDispatch({
      requestId,
      label: `summon ${summonCardInstanceId.trim()} -> ${focusedSlotId}`,
      interactionLabel: `summon-dispatch:${summonCardInstanceId.trim()} -> ${focusedSlotId}`
    });
  };

  const dispatchMagicToFocusedSlot = () => {
    if (!previewMatch) return;
    const preflight = ensureDispatchReady({
      hasFocusedSlot: Boolean(focusedSlot),
      allowedByGuard: magicDispatchAllowed,
      isSocketConnected: socket.connected,
      blockedReason: "magic guard denied"
    });
    if (!preflight.ok) {
      const reason = getDispatchBlockedReason(preflight);
      setLastInteraction(`magic-dispatch-blocked: ${reason}`);
      pushDispatchHistory(`magic blocked: ${reason}`);
      return;
    }
    const requestId = newDispatchRequestId();
    socket.emit("match:playMagic", {
      clientRequestId: requestId,
      matchId: previewMatch.matchId,
      playerId: summonPlayerId,
      cardInstanceId: magicCardInstanceId.trim()
    });
    recordBridgeDispatch({
      requestId,
      label: `magic ${magicCardInstanceId.trim()} -> ${focusedSlot.id}`,
      interactionLabel: `magic-dispatch:${magicCardInstanceId.trim()} -> ${focusedSlot.id}`
    });
  };

  const dispatchBattleStart = () => {
    if (!previewMatch) return;
    const preflight = ensureDispatchReady({
      hasFocusedSlot: true,
      allowedByGuard: battleDispatchAllowedStrict,
      isSocketConnected: socket.connected,
      blockedReason: "battle guard denied"
    });
    if (!preflight.ok) {
      const reason = getDispatchBlockedReason(preflight);
      setLastInteraction(`battle-dispatch-blocked: ${reason}`);
      pushDispatchHistory(`battle blocked: ${reason}`);
      return;
    }
    const requestId = newDispatchRequestId();
    socket.emit("match:startManualBattle", {
      clientRequestId: requestId,
      matchId: previewMatch.matchId,
      playerId: summonPlayerId,
      attackerCreatureInstanceId: battleAttackerInstanceId.trim(),
      defenderCreatureInstanceId: battleDefenderCreatureId
    });
    recordBridgeDispatch({
      requestId,
      label: `battle ${battleAttackerInstanceId.trim()}`,
      interactionLabel: `battle-dispatch:${battleAttackerInstanceId.trim()}`
    });
  };

  if (!previewMatch) {
    return (
      <section className="board-preview-page">
        <div className="board-preview-header">
          <div>
            <h2>Interactive Board Preview</h2>
            <p>Load at least one card pack with creatures and magic cards to render the preview board.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="board-preview-page">
      <div className="board-preview-header">
        <div>
          <h2>Interactive Board Preview</h2>
          <p>{liveMatch ? "Live match integration mode." : "Static layout fixture. No lobby, match, or server action is required."}</p>
        </div>
        <div className="board-preview-header-actions">
          <button type="button" onClick={openDedicatedBoardWindow}>Dedicated Window</button>
          <span>{liveMatch ? "Live Integration" : "Preview Only"}</span>
        </div>
      </div>

      <p className="board-preview-3d__status">Last interaction: {lastInteraction}</p>
      {liveMatch ? (
          <div className="board-preview-3d__controls" aria-label="Summon targeting bridge">
            <p className="board-preview-3d__status">
              Focused slot: {focusedSlot ? `${focusedSlot.label} (${focusedSlot.id})` : "none"}
            </p>
            <label>
              Summon player
              <select value={summonPlayerId} onChange={(event) => setSummonPlayerId(event.target.value as "player_1" | "player_2")} disabled={Boolean(controlledPlayerId)}>
                <option value="player_1">Player 1</option>
                <option value="player_2">Player 2</option>
              </select>
            </label>
            <label>
              Card instance id
              <input
                type="text"
                list="board-preview-summon-candidates"
                value={summonCardInstanceId}
                onChange={(event) => setSummonCardInstanceId(event.target.value)}
                placeholder="hand-card-instance-id"
              />
              <datalist id="board-preview-summon-candidates">
                {summonCandidateCardInstanceIds.map((instanceId) => (
                  <option key={instanceId} value={instanceId} />
                ))}
              </datalist>
            </label>
            <label>
              Sacrifice ids (comma)
              <input
                type="text"
                value={sacrificeIdsDraft}
                onChange={(event) => setSacrificeIdsDraft(event.target.value)}
                placeholder="instance-a,instance-b"
              />
            </label>
            {requiredSacrifices > 0 ? (
              <div className="board-preview-3d__slot-nav-controls">
                {availableSacrificeIds.map((instanceId) => (
                  <button
                    key={instanceId}
                    type="button"
                    onClick={() => {
                      const parts = sacrificeIdsDraft.split(",").map((item) => item.trim()).filter(Boolean);
                      if (parts.includes(instanceId)) return;
                      setSacrificeIdsDraft([...parts, instanceId].join(","));
                    }}
                  >
                    + {instanceId}
                  </button>
                ))}
                <button type="button" onClick={() => setSacrificeIdsDraft("")}>Clear</button>
                <button
                  type="button"
                  onClick={() => setSacrificeIdsDraft(availableSacrificeIds.slice(0, requiredSacrifices).join(","))}
                  disabled={requiredSacrifices <= 0 || availableSacrificeIds.length < requiredSacrifices}
                >
                  Auto-fill Required
                </button>
              </div>
            ) : null}
            <button type="button" onClick={dispatchSummonToFocusedSlot} disabled={!summonDispatchAllowed} title={summonDisabledReason ?? undefined}>
              Dispatch Summon to Focused Slot
            </button>
            {summonDisabledReason ? <p className="board-preview-3d__status">Summon disabled: {summonDisabledReason}</p> : null}
            <p className="board-preview-3d__status">Required sacrifices for selected card: {requiredSacrifices}</p>
            <label>
              Magic card instance id
              <input
                type="text"
                list="board-preview-magic-candidates"
                value={magicCardInstanceId}
                onChange={(event) => setMagicCardInstanceId(event.target.value)}
                placeholder="magic-card-instance-id"
              />
              <datalist id="board-preview-magic-candidates">
                {magicCandidateCardInstanceIds.map((instanceId) => (
                  <option key={instanceId} value={instanceId} />
                ))}
              </datalist>
            </label>
            <button type="button" onClick={dispatchMagicToFocusedSlot} disabled={!magicDispatchAllowed} title={magicDisabledReason ?? undefined}>
              Dispatch Magic to Focused Slot
            </button>
            {magicDisabledReason ? <p className="board-preview-3d__status">Magic disabled: {magicDisabledReason}</p> : null}
            <label>
              Battle attacker instance id
              <input
                type="text"
                list="board-preview-battle-attackers"
                value={battleAttackerInstanceId}
                onChange={(event) => setBattleAttackerInstanceId(event.target.value)}
                placeholder="attacker-instance-id"
              />
              <datalist id="board-preview-battle-attackers">
                {battleAttackerCandidateIds.map((instanceId) => (
                  <option key={instanceId} value={instanceId} />
                ))}
              </datalist>
            </label>
            <button type="button" onClick={dispatchBattleStart} disabled={!battleDispatchAllowedStrict} title={battleDisabledReason ?? undefined}>
              Dispatch Battle Start
            </button>
            {battleDisabledReason ? <p className="board-preview-3d__status">Battle disabled: {battleDisabledReason}</p> : null}
            <p className="board-preview-3d__status">Socket: {socket.connected ? "connected" : "disconnected"}</p>
            {controlledPlayerId ? <p className="board-preview-3d__status">Player selection is locked by controlledPlayerId: {controlledPlayerId}</p> : null}
            {pendingDispatches.length ? <p className="board-preview-3d__status">Pending server ack: {pendingDispatches[0].requestId} {pendingDispatches[0].label} (+{Math.max(0, pendingDispatches.length - 1)} more)</p> : null}
            {dispatchHistory.length > 0 ? (
              <>
              <ul className="board-preview-3d__slot-nav-controls">
                {dispatchHistory.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <button type="button" onClick={() => setDispatchHistory([])}>Clear Dispatch History</button>
              </>
            ) : null}
          </div>
          ) : (
            <p className="board-preview-3d__status">Dispatch bridge controls are only enabled when a live match is active.</p>
          )}
      <BoardPreview3D
        match={previewMatch}
        adminView
        onSlotFocus={(event) => {
          const intent = buildInteractionIntentFromSlotFocus(event);
          setLastInteraction(JSON.stringify(intent));
          setFocusedSlotId(intent.slotId ?? null);
          if (intent.owner) {
            setSummonPlayerId(intent.owner);
          }
        }}
        onPieceFocus={(event) => {
          const intent = buildInteractionIntentFromPieceFocus(event, previewBoardObjects);
          setLastInteraction(JSON.stringify(intent));
        }}
      />
    </section>
  );
}
