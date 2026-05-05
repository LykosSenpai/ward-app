import { v4 as uuidv4 } from "uuid";
import type {
  CardDefinition,
  CardInstance,
  DeckCardLimitMap,
  MatchState,
  PlayerState
} from "@ward/shared";
import { createDeckFromCardIds } from "./cardInstances.js";
import { DEMO_CARD_CATALOG, DEMO_DECK_CARD_IDS } from "./demoCards.js";
import { validateDeckCardIds } from "./deckValidator.js";

function createPlayer(
  id: string,
  displayName: string,
  deck: CardInstance[]
): PlayerState {
  return {
    id,
    displayName,

    deck,
    hand: [],
    cemetery: [],
    removedFromGame: [],

    field: {
      limitedSummons: [],
      magicSlots: []
    },

    cemeteryCreatureHpTotal: 0,

    hasLost: false,

    turnFlags: {
  hasTakenFirstTurn: false,
  drawnThisTurn: false,
  playedCreatureThisTurn: false,
  normalSummonUsed: false,
  killedOwnCreatureThisTurn: false,
  hasBattledThisCombat: false,
  battleUsedCreatureInstanceIds: []
    }
  };
}

export function create1v1MatchFromDeckCardIds(options: {
  cardCatalog: Record<string, CardDefinition>;
  cardLimits?: DeckCardLimitMap;
  player1DeckCardIds: string[];
  player2DeckCardIds: string[];
  player1Name?: string;
  player2Name?: string;
  exactDeckSize?: number | null;
  defaultCopyLimit?: number;
  allowNoCreatures?: boolean;
}): MatchState {
  const player1Id = "player_1";
  const player2Id = "player_2";

  const player1Validation = validateDeckCardIds({
    cardIds: options.player1DeckCardIds,
    cardCatalog: options.cardCatalog,
    cardLimits: options.cardLimits,
    exactDeckSize: options.exactDeckSize,
    defaultCopyLimit: options.defaultCopyLimit,
    allowNoCreatures: options.allowNoCreatures
  });

  const player2Validation = validateDeckCardIds({
    cardIds: options.player2DeckCardIds,
    cardCatalog: options.cardCatalog,
    cardLimits: options.cardLimits,
    exactDeckSize: options.exactDeckSize,
    defaultCopyLimit: options.defaultCopyLimit,
    allowNoCreatures: options.allowNoCreatures
  });

  const deckErrors = [
    ...player1Validation.issues
      .filter(issue => issue.severity === "ERROR")
      .map(issue => `Player 1: ${issue.message}`),
    ...player2Validation.issues
      .filter(issue => issue.severity === "ERROR")
      .map(issue => `Player 2: ${issue.message}`)
  ];

  if (deckErrors.length > 0) {
    throw new Error(deckErrors.join(" | "));
  }

  const player1 = createPlayer(
    player1Id,
    options.player1Name ?? "Player 1",
    createDeckFromCardIds(
      player1Id,
      options.player1DeckCardIds,
      options.cardCatalog
    )
  );

  const player2 = createPlayer(
    player2Id,
    options.player2Name ?? "Player 2",
    createDeckFromCardIds(
      player2Id,
      options.player2DeckCardIds,
      options.cardCatalog
    )
  );

  return {
    matchId: uuidv4(),
    format: "1v1",
    rulesetIds: ["ward_base_rules_2nd_edition"],

    status: "ACTIVE",

    cardCatalog: options.cardCatalog,

    setup: {
  decksShuffled: false,
  firstTurnDrawsByPlayer: {
    [player1Id]: false,
    [player2Id]: false
  },
  primaryReplacementRequiredForPlayerId: undefined,
  handDiscardRequiredForPlayerId: undefined,
  deckValidation: {
    [player1Id]: player1Validation,
    [player2Id]: player2Validation
  }
},

    players: [player1, player2],
    chainZone: [],
    pendingBattle: undefined,
    manualEffectQueue: [],

    turn: {
      activePlayerId: player1.id,
      turnNumber: 1,
      turnCycleNumber: 1,
      phase: "DRAW",
      firstTurnCycleComplete: false,
      currentTurnOrder: [player1.id, player2.id],
      currentTurnIndex: 0,
      turnStartCountsByPlayer: {
        [player1.id]: 1,
        [player2.id]: 0
      }
    },

    settings: {
      cemeteryHpLimit: 300,
      eliminationMode: "called_out",
      tournamentMode: false,
      cannotInflictAttackDamageBattlePolicy: "SKIP_BATTLE"
    },

    devTools: {
      rolls: {
        forcedRollQueue: []
      }
    },

    eventLog: [
      {
        id: uuidv4(),
        sequenceNumber: 1,
        timestamp: new Date().toISOString(),
        type: "MATCH_CREATED",
        payload: {
          format: "1v1"
        }
      }
    ]
  };
}

export function createLocal1v1Match(): MatchState {
  return create1v1MatchFromDeckCardIds({
    cardCatalog: DEMO_CARD_CATALOG,
    player1DeckCardIds: DEMO_DECK_CARD_IDS,
    player2DeckCardIds: DEMO_DECK_CARD_IDS,
    player1Name: "Player 1",
    player2Name: "Player 2"
  });
}