#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const packsDir = path.join(rootDir, "data", "cards", "packs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadCards() {
  return fs
    .readdirSync(packsDir)
    .filter(fileName => fileName.endsWith(".json"))
    .flatMap(fileName => {
      const pack = readJson(path.join(packsDir, fileName));
      return pack.cards.map(card => ({ ...card, packId: pack.id }));
    });
}

function assertCardEffect(cards, cardName, expected) {
  const card = cards.find(item => item.name === cardName);

  if (!card) {
    throw new Error(`Missing smoke-test card: ${cardName}`);
  }

  const effect = (card.effects ?? []).find(candidate =>
    (!expected.effectId || candidate.id === expected.effectId) &&
    (!expected.trigger || candidate.trigger === expected.trigger) &&
    (!expected.actionType || candidate.actionType === expected.actionType)
  );

  if (!effect) {
    throw new Error(
      `${cardName} is missing expected effect ${JSON.stringify(expected)}`
    );
  }

  return { card, effect };
}

const cards = loadCards();
const checks = [
  {
    label: "Blue Dragon freeze trigger",
    cardName: "Blue Dragon",
    expected: { effectId: "001-E01", trigger: "ON_HIT", actionType: "APPLY_STATUS" },
    verify: effect => {
      const successValues = effect.condition?.successValues ?? effect.params?.condition?.successValues ?? [];
      if (!successValues.includes(4) || !successValues.includes(5) || !successValues.includes(6)) {
        throw new Error("Blue Dragon effect must succeed on 4-6.");
      }
    }
  },
  {
    label: "Dire Wolf DOT trigger",
    cardName: "Dire Wolf",
    expected: { effectId: "002-E01", trigger: "ON_HIT", actionType: "APPLY_DAMAGE_OVER_TIME" },
    verify: effect => {
      const duration = effect.duration ?? effect.params?.duration ?? {};
      const amount = duration.amount;
      const tickTiming = duration.tickTiming ?? effect.params?.tickTiming;
      if (amount !== 3 || tickTiming !== "END_OF_COMBAT_PHASE") {
        throw new Error("Dire Wolf DOT must last 3 turn cycles and tick at END_OF_COMBAT_PHASE.");
      }
    }
  }
];

let passed = 0;

for (const check of checks) {
  const { effect } = assertCardEffect(cards, check.cardName, check.expected);
  check.verify?.(effect);
  passed += 1;
  console.log(`PASS: ${check.label}`);
}

console.log(`\nEffect runtime smoke data checks passed: ${passed}/${checks.length}`);
console.log("Manual runtime smoke still required in app for target routing, duration, and tick behavior.");
