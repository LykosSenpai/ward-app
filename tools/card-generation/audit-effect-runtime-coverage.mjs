import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "data", "cards", "src");
const OUT_DIR = path.join(ROOT, "docs");
const OUT_CSV = path.join(OUT_DIR, "effect-action-type-audit-20260505.csv");
const OUT_MD = path.join(OUT_DIR, "effect-action-type-audit-20260505.md");

const SUPPORTED = new Set(["ADD_CEMETERY_HP_ADJUSTMENT", "ADJUST_CEMETERY_HP", "APPLY_ATTACK_DAMAGE_MULTIPLIER", "APPLY_CONDITIONAL_DICE_MODIFIER", "APPLY_DAMAGE_IMMUNITY", "APPLY_DAMAGE_MULTIPLIER", "APPLY_DAMAGE_OVER_TIME", "APPLY_DICE_LIMIT", "APPLY_DICE_MODIFIER", "APPLY_DYNAMIC_STAT_MODIFIER", "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER", "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION", "APPLY_HEALING_OVER_TIME", "APPLY_HEAL_OVER_TIME", "APPLY_MULTI_MODIFIER", "APPLY_OPPONENT_MAGIC_PLAY_LOCK", "APPLY_REGENERATING_HEAL", "APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT", "APPLY_STATUS", "APPLY_STATUS_WITH_ESCAPE_ROLL", "APPLY_STAT_MODIFIER", "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION", "DAMAGE", "DAMAGE_CREATURE", "DEAL_INSTANT_DAMAGE", "DEAL_PERCENTAGE_DAMAGE", "DESTROY_ALL_MAGIC", "DESTROY_LINKED_SUMMONED_CREATURE", "DESTROY_MAGIC", "DESTROY_MAGIC_CARDS", "DISCARD_CARD", "DISCARD_CARDS", "DRAW_CARDS", "FORCE_DISCARD", "FORCE_SUMMON_FROM_HAND", "HEAL", "HEAL_BY_ROLL", "HEAL_CREATURE", "HEAL_TO_FULL", "LIMITED_SUMMON", "MOVE_CARD", "NEGATE_ATTACK", "NEGATE_ATTACK_DAMAGE", "NEGATE_CARD_EFFECT", "NEGATE_LIGHTNING_AND_SEND_TO_CEMETERY", "NEGATE_MAGIC_AND_SEND_TO_CEMETERY", "PAY_CARD_COST", "PAY_DAMAGE_COST", "PAY_DISCARD_COST", "PAY_DISCARD_MAGIC_COST", "ROLL_AND_DAMAGE", "ROLL_AND_HEAL", "ROLL_DAMAGE_TABLE", "ROLL_FOR_EFFECT", "ROLL_TABLE", "SEARCH_DECK_TO_HAND", "SHUFFLE_DECK", "SUMMON_FROM_CEMETERY", "SUMMON_FROM_CEMETERY_AND_EQUIP", "SUMMON_FROM_DECK", "SUMMON_FROM_HAND", "SUMMON_LIMITED_CREATURE", "SUMMON_LIMITED_CREATURE_AND_EQUIP", "SUMMON_LIMITED_CREATURE_FROM_CEMETERY", "SUMMON_LIMITED_CREATURE_FROM_DECK", "SUMMON_LIMITED_CREATURE_FROM_HAND", "SUPPRESS_MODIFIER_LAYER"]);
const PARTIAL = new Set(["ADD_NEXT_ATTACK_SHIELD", "ADD_NEXT_MAGIC_SHIELD", "ADD_ONCE_PER_FIELD_SHIELD", "APPLY_ATTACK_PRIORITY_OVERRIDE", "APPLY_BATTLE_LOCK", "APPLY_BATTLE_REQUIREMENT", "APPLY_CEMETERY_SEND_COUNTER_MODIFIER", "APPLY_CONDITIONAL_DAMAGE_IMMUNITY", "APPLY_CONDITIONAL_DAMAGE_REDUCTION", "APPLY_CREATURE_EFFECT_NEGATION", "APPLY_DAMAGE_MULTIPLIER_AURA", "APPLY_DAMAGE_REDUCTION", "APPLY_DAMAGE_TYPE_IMMUNITY", "APPLY_EFFECT_IMMUNITY", "APPLY_FIELD_AURA_MODIFIERS", "APPLY_HIT_OUTCOME_OVERRIDE", "APPLY_IMMUNITY", "APPLY_MAGIC_IMMUNITY", "APPLY_NEGATION_WINDOW_RESTRICTION", "APPLY_PERMANENT_CREATURE_FLAG", "APPLY_PLAY_RESTRICTION", "APPLY_PRE_BATTLE_ROLL_DEFENSE", "APPLY_PRE_BATTLE_ROLL_GATE", "APPLY_RECURRING_STAT_MODIFIER", "APPLY_REROLL_PERMISSION", "APPLY_SACRIFICE_VALUE", "APPLY_SKIP_TURN", "APPLY_SOURCE_LINKED_CLEANUP", "APPLY_SOURCE_LINKED_STAT_SET_AURA", "APPLY_START_TURN_HP_LOSS", "APPLY_STATUS_AURA", "APPLY_STAT_AND_DICE_MULTIPLIER", "APPLY_STAT_SET_AURA", "APPLY_SUMMON_REQUIREMENT_OVERRIDE", "APPLY_TEMPORARY_HIT_OVERRIDE", "APPLY_TEMPORARY_STAT_SET", "APPLY_ZONE_LOCK", "APPLY_ZONE_RESTRICTION", "APPLY_ZONE_RETURN_RESTRICTION", "ATTACH_CARDS_UNDER_SOURCE", "ATTACH_NAMED_CARD_UNDER_SOURCE", "CHANGE_CREATURE_TYPE", "CLEAR_SOURCE_LINKED_MODIFIERS", "CONVERT_CREATURE_TO_EQUIP_ON_DEATH", "DEAL_DAMAGE_ON_DRAW", "DESTROY_EQUIPPED_CARDS", "DESTROY_IF_NO_DAMAGE_THIS_TURN", "DESTROY_SELF", "DETACH_ATTACHED_CARDS_TO_FIELD", "FORCE_LIMITED_SUMMONS_TO_BATTLE_PRIMARY", "NEGATE_ATTACK_AND_HEAL", "NEGATE_ATTACK_AND_REFLECT_DAMAGE", "NEGATE_ATTACK_OR_MAGIC", "NEGATE_CREATURE_EFFECTS", "NEGATE_HEALING_AND_CONVERT_TO_DAMAGE", "OVERRIDE_SUMMON_SACRIFICE_REQUIREMENT", "PREVENT_CARD_PLAY", "PREVENT_DAMAGE", "REFLECT_PREVENTED_DAMAGE", "REPLACE_ATTACK_PROFILE", "REROLL_DICE", "RESOLVE_FIELD_ROLL_OUTCOME", "RESOLVE_STATUS_ESCAPE_ROLL", "RESOLVE_STATUS_TICK", "RETURN_LINKED_CARDS", "RETURN_LINKED_SUMMON", "RETURN_SELF_TO_DECK_AND_SHUFFLE", "RETURN_SELF_TO_HAND", "ROLL_DAMAGE_DICE", "SCHEDULE_RETURN_TO_HAND", "SEARCH_DECK_TO_EQUIP", "SEND_NAMED_CARD_TO_CEMETERY", "SEND_TO_CEMETERY", "SEND_TO_ORIGINAL_OWNER_CEMETERY", "SET_CAN_BE_NEGATED", "SET_CARD_TYPE", "SET_TEMPORARY_CARD_BEHAVIOR", "SUMMON_REQUIREMENT", "SUMMON_SELF_AS_LIMITED_CREATURE", "SUMMON_TO_OPPONENT_SIDE", "UNAFFECTED_BY_MAGIC", "VALIDATE_SUMMON_REQUIREMENT"]);
const MANUAL = new Set(["APPLY_SOURCE_LINKED_STAT_SET_AURA", "FORCE_PLAY_STOLEN_CARD", "HEAL_BY_CEMETERY_EVENT", "HEAL_BY_DAMAGE_DEALT", "HEAL_BY_SENT_CREATURE_HP", "LOOK_AND_REORDER_DECK_TOP", "MANUAL_FALLBACK", "MOVE_CARDS", "RESET_CURRENT_TURN", "RETURN_LINKED_CONTROLLED_CREATURE", "REVEAL_HAND_AND_CHOOSE_CARD", "STEAL_EQUIP_CARD", "STEAL_MAGIC_CARD", "SWAP_PRIMARY_CREATURES", "TAKE_CONTROL_AS_LIMITED_SUMMON", "TRADE_CARD_WITH_CEMETERY"]);

function classify(actionType) {
  if (SUPPORTED.has(actionType)) return "SUPPORTED";
  if (PARTIAL.has(actionType)) return "PARTIAL";
  if (MANUAL.has(actionType)) return "MANUAL";
  if (actionType.includes("STEAL") || actionType.includes("TAKE_CONTROL") || actionType.includes("SWAP")) return "MANUAL";
  if (actionType.includes("NEGATE") || actionType.includes("PREVENT") || actionType.includes("IMMUNITY") || actionType.includes("RESTRICTION") || actionType.includes("LOCK")) return "PARTIAL";
  if (actionType.includes("SUMMON") || actionType.includes("DAMAGE") || actionType.includes("HEAL") || actionType.includes("MODIFIER")) return "PARTIAL";
  return "MANUAL";
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(full);
    if (!entry.name.endsWith(".json") || entry.name === "_pack.json") return [];
    return [full];
  });
}

const rowsByAction = new Map();
for (const file of listJsonFiles(SRC_ROOT)) {
  const card = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const effect of card.effects ?? []) {
    const actionType = String(effect.actionType ?? "").trim().toUpperCase();
    if (!actionType) continue;
    if (!rowsByAction.has(actionType)) {
      rowsByAction.set(actionType, {
        actionType,
        count: 0,
        support: classify(actionType),
        examples: []
      });
    }
    const row = rowsByAction.get(actionType);
    row.count += 1;
    if (row.examples.length < 3) {
      row.examples.push(`${card.name ?? card.cardName ?? path.basename(file)} ${effect.id ?? ""}`.trim());
    }
  }
}

const rows = [...rowsByAction.values()].sort((a, b) => a.support.localeCompare(b.support) || b.count - a.count || a.actionType.localeCompare(b.actionType));
fs.mkdirSync(OUT_DIR, { recursive: true });

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

fs.writeFileSync(OUT_CSV, [
  ["Action Type", "Effect Count", "Support", "Examples"].join(","),
  ...rows.map(row => [row.actionType, row.count, row.support, row.examples.join(" | ")].map(csv).join(","))
].join("\n") + "\n");

const totals = rows.reduce((acc, row) => {
  acc[row.support] = (acc[row.support] ?? 0) + 1;
  return acc;
}, {});

fs.writeFileSync(OUT_MD, `# WARD Effect Action Type Audit - 2026-05-05\n\n` +
  `Generated from \`data/cards/src/**\`. This is an action-type work queue, not a card-by-card Working confirmation.\n\n` +
  `## Summary\n\n` +
  `- Total unique action types: ${rows.length}\n` +
  `- Supported/cataloged as runtime-supported: ${totals.SUPPORTED ?? 0}\n` +
  `- Partial / needs QA or deeper handler: ${totals.PARTIAL ?? 0}\n` +
  `- Manual / needs dedicated resolver: ${totals.MANUAL ?? 0}\n\n` +
  `## Action Types\n\n` +
  `| Support | Count | Action Type | Examples |\n|---|---:|---|---|\n` +
  rows.map(row => `| ${row.support} | ${row.count} | \`${row.actionType}\` | ${row.examples.join("<br>")} |`).join("\n") +
  `\n`);

console.log(`Wrote ${path.relative(ROOT, OUT_CSV)}`);
console.log(`Wrote ${path.relative(ROOT, OUT_MD)}`);
