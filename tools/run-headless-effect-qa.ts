import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCardCatalog } from "../apps/server/src/dataStore.js";
import { runLlmHeadlessEffectTest } from "../apps/server/src/llm/headlessEffectRunner.js";
import type { LlmEffectTestPlan } from "../apps/server/src/llm/types.js";

type ScenarioFile = {
  plan?: LlmEffectTestPlan;
};

type StatusRecord = {
  key: string;
  packId: string;
  cardId: string;
  cardName: string;
  effectId?: string;
  trigger?: string;
  actionType?: string;
  status: string;
  issueType: string;
  notes: string;
  lastTestedAt: string;
  testedBy: string;
};

type StatusFile = {
  version: number;
  records: StatusRecord[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const scenarioDir = path.join(rootDir, "data", "dev", "effect-test-scenarios");
const statusPath = path.join(rootDir, "data", "dev", "effect-runtime-test-status.json");

const args = process.argv.slice(2);
const shouldUpdate = args.includes("--update");
const verbose = args.includes("--verbose");
const showEvents = args.includes("--events");
const limitArg = args.find(arg => arg.startsWith("--limit="));
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1] ?? "", 10) : undefined;
const requestedNames = args.filter(arg => !arg.startsWith("--"));

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function loadScenarioFiles(): string[] {
  const files = fs
    .readdirSync(scenarioDir)
    .filter(fileName => fileName.endsWith(".json"))
    .sort();

  const selected = requestedNames.length > 0
    ? files.filter(fileName => requestedNames.some(name => fileName === name || fileName.startsWith(name)))
    : files;

  return Number.isFinite(limit) && limit && limit > 0 ? selected.slice(0, limit) : selected;
}

function toStatus(resultStatus: string): string {
  return resultStatus === "BLOCKED_RUNTIME" ? "BROKEN" : resultStatus;
}

function summarizeEvidence(evidence: string[]): string {
  const useful = evidence.find(line => /expected-success:/i.test(line)) ?? evidence[0] ?? "";
  return useful.replace(/\s+/g, " ").trim();
}

const statusFile = readJson<StatusFile>(statusPath);
const recordsByKey = new Map(statusFile.records.map(record => [record.key, record]));
const scenarioFiles = loadScenarioFiles();
const plans = scenarioFiles.map(fileName => {
  const scenario = readJson<ScenarioFile>(path.join(scenarioDir, fileName));
  if (!scenario.plan) {
    throw new Error(`Scenario file has no plan: ${fileName}`);
  }
  return { fileName, plan: scenario.plan };
});

const packIds = Array.from(new Set(plans.map(({ plan }) => plan.card.packId)));
const cardCatalog = loadCardCatalog(packIds);
const results = plans.map(({ fileName, plan }) => {
  const { result } = runLlmHeadlessEffectTest({ cardCatalog, plan });
  return { fileName, plan, result };
});

let updated = 0;

for (const item of results) {
  const status = toStatus(item.result.status);
  const issueType = item.result.issueType ?? "NONE";
  const key = item.result.key;
  const existing = recordsByKey.get(key);

  if (shouldUpdate && existing) {
    existing.status = status;
    existing.issueType = issueType;
    existing.notes = `${item.result.summary} ${summarizeEvidence(item.result.evidence)}`.trim();
    existing.lastTestedAt = item.result.generatedAt;
    existing.testedBy = "Headless Engine QA";
    updated += 1;
  }

  console.log([
    item.fileName,
    item.result.cardName,
    item.result.effectId ?? "NO_EFFECT",
    status,
    issueType,
    item.result.summary
  ].join(" | "));

  if (verbose) {
    for (const assertion of item.result.assertionResults ?? []) {
      if (assertion.status === "FAIL") {
        console.log(`  assertion failed: ${assertion.label} (${assertion.path})`);
      }
    }
    for (const line of item.result.evidence.slice(0, 10)) {
      console.log(`  ${line}`);
    }
  }

  if (showEvents) {
    for (const variant of item.result.variantResults ?? []) {
      console.log(`  events for ${variant.name}: ${variant.eventTypes.join(", ") || "none"}`);
    }
  }
}

if (shouldUpdate) {
  writeJson(statusPath, statusFile);
}

console.log("");
console.log(`Headless QA complete: ${results.length} scenario(s), ${updated} status record(s) updated.`);
