import { v4 as uuidv4 } from "uuid";
import type { CardDefinition, CardInstance } from "@ward/shared";

export const DEMO_CARD_CATALOG: Record<string, CardDefinition> = {
  demo_iron_boar: {
    id: "demo_iron_boar",
    name: "Demo Iron Boar",
    cardType: "CREATURE",
    creatureType: "Beast",
    armorLevel: 5,
    speed: 2,
    hp: 80,
    attackDice: 2,
    modifier: 1
  },
  demo_grave_sprite: {
    id: "demo_grave_sprite",
    name: "Demo Grave Sprite",
    cardType: "CREATURE",
    creatureType: "Undead",
    armorLevel: 4,
    speed: 6,
    hp: 60,
    attackDice: 1,
    modifier: 2
  },
  demo_stone_guard: {
    id: "demo_stone_guard",
    name: "Demo Stone Guard",
    cardType: "CREATURE",
    creatureType: "Mechanical",
    armorLevel: 7,
    speed: 1,
    hp: 100,
    attackDice: 2,
    modifier: 0
  },
  demo_ember_drake: {
    id: "demo_ember_drake",
    name: "Demo Ember Drake",
    cardType: "CREATURE",
    creatureType: "Dragon",
    armorLevel: 8,
    speed: 4,
    hp: 120,
    attackDice: 3,
    modifier: 1
  },

  demo_battle_axe: {
    id: "demo_battle_axe",
    name: "Demo Battle Axe",
    cardType: "MAGIC",
    magicType: "INFINITE",
    magicSubType: "EQUIP",
    text: "Placeholder equip magic."
  },
  demo_minor_heal: {
    id: "demo_minor_heal",
    name: "Demo Minor Heal",
    cardType: "MAGIC",
    magicType: "STANDARD",
    magicSubType: "NONE",
    text: "Placeholder healing magic."
  },
  demo_spark_bolt: {
    id: "demo_spark_bolt",
    name: "Demo Spark Bolt",
    cardType: "MAGIC",
    magicType: "STANDARD",
    magicSubType: "NONE",
    text: "Placeholder instant damage magic."
  },
  demo_guard_field: {
    id: "demo_guard_field",
    name: "Demo Guard Field",
    cardType: "MAGIC",
    magicType: "INFINITE",
    magicSubType: "FIELD",
    text: "Placeholder field magic."
  },
  demo_quick_negate: {
    id: "demo_quick_negate",
    name: "Demo Quick Negate",
    cardType: "MAGIC",
    magicType: "LIGHTNING",
    magicSubType: "NONE",
    text: "Placeholder lightning response."
  },
  demo_shadow_trick: {
    id: "demo_shadow_trick",
    name: "Demo Shadow Trick",
    cardType: "MAGIC",
    magicType: "LIGHTNING",
    magicSubType: "NONE",
    text: "Placeholder lightning trick."
  }
};

export const DEMO_DECK_CARD_IDS = [
  "demo_iron_boar",
  "demo_iron_boar",
  "demo_iron_boar",
  "demo_grave_sprite",
  "demo_grave_sprite",
  "demo_grave_sprite",
  "demo_stone_guard",
  "demo_stone_guard",
  "demo_stone_guard",
  "demo_ember_drake",
  "demo_ember_drake",
  "demo_ember_drake",

  "demo_battle_axe",
  "demo_battle_axe",
  "demo_battle_axe",
  "demo_minor_heal",
  "demo_minor_heal",
  "demo_minor_heal",
  "demo_spark_bolt",
  "demo_spark_bolt",
  "demo_spark_bolt",
  "demo_guard_field",
  "demo_guard_field",
  "demo_guard_field",
  "demo_quick_negate",
  "demo_quick_negate",
  "demo_quick_negate",
  "demo_shadow_trick",
  "demo_shadow_trick",
  "demo_shadow_trick"
];

export function createDemoDeck(playerId: string): CardInstance[] {
  return DEMO_DECK_CARD_IDS.map(cardId => {
    const definition = DEMO_CARD_CATALOG[cardId];

    const baseCard: CardInstance = {
      instanceId: uuidv4(),
      cardId,
      ownerPlayerId: playerId,
      controllerPlayerId: playerId,
      zone: "DECK"
    };

    if (definition.cardType === "CREATURE") {
      return {
        ...baseCard,
        currentHp: definition.hp,
        baseHp: definition.hp
      };
    }

    return baseCard;
  });
}