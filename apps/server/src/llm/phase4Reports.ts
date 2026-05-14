import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EffectRuntimeTestStatusRecord } from "../dataStore.js";
import type { LlmEffectTestPlan } from "./types.js";

export type LlmPhase4ReportSummary = {
  fileName: string;
  jsonFileName: string;
  relativePath: string;
  jsonRelativePath: string;
  outputDir: string;
  generatedAt: string;
  totalPlans: number;
  coverageRecordCount: number;
  needsFixCount: number;
};

type SaveLlmPhase4ReportArgs = {
  plans: LlmEffectTestPlan[];
  coverageRecords?: EffectRuntimeTestStatusRecord[];
  savedRegressionFileNames?: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../..");
const REPORT_DIR = path.join(ROOT_DIR, "data", "dev", "llm-phase4-reports");

const NEEDS_FIX_STATUSES = new Set([
  "PARTIAL",
  "BROKEN",
  "BLOCKED",
  "MANUAL"
]);

function ensureReportDir(): void {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
}

function makeTimestampForFile(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function normalizeLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function truncate(value: unknown, maxLength: number): string {
  const text = normalizeLine(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function md(value: unknown): string {
  return normalizeLine(value).replace(/`/g, "\\`");
}

function bulletLines(values: unknown[] | undefined, emptyText: string): string[] {
  if (!values?.length) return [`- ${emptyText}`];
  return values.map(value => `- ${md(value)}`);
}

function getPlanKey(plan: LlmEffectTestPlan): string {
  return `${plan.card.packId}:${plan.card.cardId}:${plan.effect?.effectId ?? "NO_EFFECT"}`;
}

function getCoverageKey(record: EffectRuntimeTestStatusRecord): string {
  return `${record.packId}:${record.cardId}:${record.effectId}`;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function buildEffectReportSection(
  title: string,
  plans: LlmEffectTestPlan[],
  coverageByKey: Map<string, EffectRuntimeTestStatusRecord>
): string[] {
  const lines: string[] = [`## ${title}`, ""];

  if (plans.length === 0) {
    lines.push("No effects in this section.", "");
    return lines;
  }

  for (const plan of plans) {
    const coverage = coverageByKey.get(getPlanKey(plan));
    const status = coverage?.engineStatus ?? coverage?.status ?? plan.coverageSuggestion.status;
    const issueType = coverage?.issueType ?? plan.coverageSuggestion.issueType;
    const notes = coverage?.notes || plan.coverageSuggestion.notes || "No notes entered.";

    lines.push(`### ${md(plan.card.cardName)} — ${md(plan.effect?.effectId ?? "NO_EFFECT")}`);
    lines.push("");
    lines.push(`- Pack/Card: \`${md(plan.card.packId)}:${md(plan.card.cardId)}\``);
    lines.push(`- Card Type: \`${md(plan.card.cardType)}\``);
    if (plan.card.generation || plan.card.cardNumber) {
      lines.push(`- Card Number: \`${md(plan.card.generation ?? "?")} #${md(plan.card.cardNumber ?? "?")}\``);
    }
    lines.push(`- Status: \`${md(status)}\``);
    lines.push(`- Issue Type: \`${md(issueType)}\``);
    lines.push(`- Trigger: \`${md(plan.effect?.trigger ?? "NO_TRIGGER")}\``);
    lines.push(`- Action Type: \`${md(plan.effect?.actionType ?? "NO_ACTION")}\``);
    lines.push(`- Effect Group: \`${md(plan.effect?.effectGroup ?? "NONE")}\``);
    lines.push(`- Reusable Function: \`${md(plan.effect?.reusableFunction ?? "NONE")}\``);
    lines.push(`- Target: \`${md(plan.effect?.target ?? "NONE")}\``);
    lines.push(`- Value: \`${md(plan.effect?.value ?? "NONE")}\``);
    lines.push(`- Duration: \`${md(plan.effect?.durationText ?? "NONE")}\``);
    lines.push("");
    lines.push("**Raw card/effect text**");
    lines.push("");
    lines.push("> " + md(truncate(plan.card.rawText || "No raw text available.", 900)).replace(/\n/g, "\n> "));
    lines.push("");
    lines.push("**LLM plan summary**");
    lines.push("");
    lines.push(md(plan.summary || "No summary."));
    lines.push("");
    lines.push("**Tester notes / coverage notes**");
    lines.push("");
    lines.push(md(notes));
    lines.push("");
    lines.push("**Manual verification steps**");
    lines.push("");
    lines.push(...bulletLines(plan.manualVerification, "No manual verification steps generated."));
    lines.push("");
    lines.push("**Expected assertions**");
    lines.push("");

    if (plan.expectedAssertions.length === 0) {
      lines.push("- No expected assertions generated.");
    } else {
      for (const assertion of plan.expectedAssertions) {
        const valueText = assertion.value === undefined ? "" : ` | value: ${JSON.stringify(assertion.value)}`;
        lines.push(`- ${md(assertion.label)} | path: \`${md(assertion.path)}\` | operator: \`${md(assertion.operator)}\`${valueText}`);
      }
    }

    lines.push("");
    lines.push("**Risk notes**");
    lines.push("");
    lines.push(...bulletLines(plan.riskNotes, "No risk notes generated."));
    lines.push("");
  }

  return lines;
}

export function saveLlmPhase4VerificationReport(args: SaveLlmPhase4ReportArgs): LlmPhase4ReportSummary {
  ensureReportDir();

  const now = new Date();
  const generatedAt = now.toISOString();
  const stamp = makeTimestampForFile(now);
  const fileName = `ward_llm_phase4_verification_${stamp}.md`;
  const jsonFileName = `ward_llm_phase4_verification_${stamp}.json`;
  const filePath = path.join(REPORT_DIR, fileName);
  const jsonFilePath = path.join(REPORT_DIR, jsonFileName);

  const coverageRecords = args.coverageRecords ?? [];
  const coverageByKey = new Map(coverageRecords.map(record => [getCoverageKey(record), record]));
  const plansWithStatus = args.plans.map(plan => {
    const coverage = coverageByKey.get(getPlanKey(plan));
    return {
      plan,
      status: coverage?.engineStatus ?? coverage?.status ?? plan.coverageSuggestion.status,
      issueType: coverage?.issueType ?? plan.coverageSuggestion.issueType
    };
  });

  const needsFixPlans = plansWithStatus
    .filter(item => NEEDS_FIX_STATUSES.has(item.status) || item.issueType !== "NONE")
    .map(item => item.plan);
  const workingPlans = plansWithStatus
    .filter(item => item.status === "WORKING")
    .map(item => item.plan);
  const untestedPlans = plansWithStatus
    .filter(item => item.status === "UNTESTED")
    .map(item => item.plan);

  const statusCounts = countBy(plansWithStatus.map(item => item.status));
  const issueCounts = countBy(plansWithStatus.map(item => item.issueType));

  const lines: string[] = [
    "# WARD LLM Phase 4 Verification Report",
    "",
    `Generated: ${generatedAt}`,
    `Total plans: ${args.plans.length}`,
    `Coverage records included: ${coverageRecords.length}`,
    `Effects needing fix/review: ${needsFixPlans.length}`,
    "",
    "## How to use this file",
    "",
    "Paste the **Effects needing fixes / unsupported / review** section into ChatGPT when you want a targeted code patch. This section includes broken/partial/blocked effects and any draft with a non-NONE issue type, even if it is still untested.",
    "",
    "## Status counts",
    "",
    "```json",
    JSON.stringify(statusCounts, null, 2),
    "```",
    "",
    "## Issue counts",
    "",
    "```json",
    JSON.stringify(issueCounts, null, 2),
    "```",
    "",
    "## Saved regression fixture files",
    ""
  ];

  if (args.savedRegressionFileNames?.length) {
    for (const savedFileName of args.savedRegressionFileNames) {
      lines.push(`- ${md(savedFileName)}`);
    }
  } else {
    lines.push("- No regression fixture file names were provided by the save step.");
  }

  lines.push("");
  lines.push(...buildEffectReportSection("Effects needing fixes / unsupported / review", needsFixPlans, coverageByKey));
  lines.push(...buildEffectReportSection("Untested effects still in this Phase 4 batch", untestedPlans, coverageByKey));
  lines.push(...buildEffectReportSection("Working effects in this Phase 4 batch", workingPlans, coverageByKey));
  lines.push("## Full machine-readable JSON sidecar", "", `See \`${jsonFileName}\` in the same folder.`, "");

  const jsonPayload = {
    schemaVersion: 1,
    generatedAt,
    source: "WARD LLM Test Lab Phase 4",
    summary: {
      totalPlans: args.plans.length,
      coverageRecordCount: coverageRecords.length,
      needsFixCount: needsFixPlans.length,
      statusCounts,
      issueCounts,
      savedRegressionFileNames: args.savedRegressionFileNames ?? []
    },
    coverageRecords,
    plans: args.plans
  };

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
  fs.writeFileSync(jsonFilePath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf-8");

  return {
    fileName,
    jsonFileName,
    relativePath: path.relative(ROOT_DIR, filePath),
    jsonRelativePath: path.relative(ROOT_DIR, jsonFilePath),
    outputDir: path.relative(ROOT_DIR, REPORT_DIR),
    generatedAt,
    totalPlans: args.plans.length,
    coverageRecordCount: coverageRecords.length,
    needsFixCount: needsFixPlans.length
  };
}
