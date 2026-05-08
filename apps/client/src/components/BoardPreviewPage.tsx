import { useMemo } from "react";
import type { CardDefinition, CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState, CardLibraryCardSummary } from "../clientTypes";
import { CardBoardView } from "./CardBoardView";

type BoardPreviewPageProps = {
  cardLibrary: CardLibraryCardSummary[];
};

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

export function BoardPreviewPage({ cardLibrary }: BoardPreviewPageProps) {
  const previewMatch = useMemo(() => buildPreviewMatch(cardLibrary), [cardLibrary]);

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
          <p>Static layout fixture. No lobby, match, or server action is required.</p>
        </div>
        <span>Preview Only</span>
      </div>

      <section className="match-workspace match-workspace-board board-preview-workspace">
        <CardBoardView
          match={previewMatch}
          players={previewMatch.players}
          controlledPlayerId="player_1"
        />
      </section>
    </section>
  );
}
