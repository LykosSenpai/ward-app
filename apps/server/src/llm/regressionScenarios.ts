import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmEffectResultReview, LlmEffectTestPlan, LlmRegressionScenarioSummary } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../..");
const SCENARIO_DIR = path.join(ROOT_DIR, "data", "dev", "effect-test-scenarios");

function ensureScenarioDir(): void {
  if (!fs.existsSync(SCENARIO_DIR)) {
    fs.mkdirSync(SCENARIO_DIR, { recursive: true });
  }
}

function safeFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "llm-effect-scenario";
}

export function saveLlmRegressionScenario(args: {
  plan: LlmEffectTestPlan;
  review?: LlmEffectResultReview;
}): LlmRegressionScenarioSummary {
  ensureScenarioDir();

  const baseName = safeFileName(args.plan.regression.fixtureName || `${args.plan.card.cardId}-${args.plan.effect?.effectId ?? "effect"}`);
  const fileName = `${baseName}.json`;
  const filePath = path.join(SCENARIO_DIR, fileName);
  const now = new Date().toISOString();

  const data = {
    schemaVersion: 1,
    generatedAt: now,
    source: "WARD LLM Test Lab",
    cardId: args.plan.card.cardId,
    effectId: args.plan.effect?.effectId,
    title: args.plan.title,
    plan: args.plan,
    review: args.review,
    runnerNotes: [
      "Create a dev match from plan.setup, execute plan.steps, then verify plan.expectedAssertions.",
      "The LLM only proposes the fixture. The deterministic engine and manual QA status remain source of truth."
    ]
  };

  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");

  return {
    fileName,
    cardId: args.plan.card.cardId,
    effectId: args.plan.effect?.effectId,
    title: args.plan.title,
    updatedAt: now
  };
}

export function listLlmRegressionScenarios(): LlmRegressionScenarioSummary[] {
  ensureScenarioDir();

  return fs
    .readdirSync(SCENARIO_DIR)
    .filter(fileName => fileName.endsWith(".json"))
    .map(fileName => {
      const filePath = path.join(SCENARIO_DIR, fileName);
      const stats = fs.statSync(filePath);

      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
          cardId?: string;
          effectId?: string;
          title?: string;
          generatedAt?: string;
        };

        return {
          fileName,
          cardId: parsed.cardId ?? "UNKNOWN",
          effectId: parsed.effectId,
          title: parsed.title ?? fileName,
          updatedAt: parsed.generatedAt ?? stats.mtime.toISOString()
        };
      } catch {
        return {
          fileName,
          cardId: "UNKNOWN",
          title: fileName,
          updatedAt: stats.mtime.toISOString()
        };
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
