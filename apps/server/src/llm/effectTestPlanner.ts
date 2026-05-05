import type { CardDefinition, DevRollKind, MatchState, TurnPhase, WardEngineEffect } from "@ward/shared";
import type { LlmEffectResultReview, LlmEffectTestPlan, LlmForcedRollPlan } from "./types.js";
import { requestLlmJson } from "./llmClient.js";
import { getCardEffect, summarizeCard, summarizeMatchForReview, WARD_RULES_SUMMARY } from "./wardLlmContext.js";

const VALID_PHASES = new Set<TurnPhase>(["DRAW", "SUMMON_MAGIC", "COMBAT", "SECOND_MAGIC", "END"]);
const VALID_ROLL_KINDS = new Set<DevRollKind>([
  "HIT_ROLL",
  "ATTACK_DAMAGE_ROLL",
  "EFFECT_ROLL",
  "SPEED_TIE_ROLL",
  "SELF_DAMAGE_ROLL",
  "GENERIC_ROLL"
]);

function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "scenario";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item)).filter(Boolean)
    : [];
}

function normalizeRolls(value: unknown): LlmForcedRollPlan[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(item => {
    const roll = item as Partial<LlmForcedRollPlan>;
    const kind = String(roll.kind ?? "GENERIC_ROLL") as DevRollKind;
    if (!VALID_ROLL_KINDS.has(kind)) return [];

    const dice = Array.isArray(roll.dice)
      ? roll.dice
          .map(die => Number(die))
          .filter(die => Number.isInteger(die) && die >= 1 && die <= 6)
      : [];

    if (dice.length === 0) return [];

    return [{
      kind,
      dice,
      label: roll.label ? String(roll.label) : undefined
    }];
  });
}

function inferPhase(effect?: WardEngineEffect): TurnPhase {
  const text = `${effect?.trigger ?? ""} ${effect?.actionType ?? ""} ${effect?.actionText ?? ""} ${effect?.value ?? ""}`.toUpperCase();

  if (text.includes("BATTLE") || text.includes("HIT") || text.includes("ATTACK") || text.includes("COMBAT") || text.includes("DAMAGE_CALC")) {
    return "COMBAT";
  }

  if (text.includes("DRAW")) return "DRAW";
  if (text.includes("END_OF") || text.includes("END TURN")) return "END";
  return "SUMMON_MAGIC";
}

function inferForcedRolls(effect?: WardEngineEffect): LlmForcedRollPlan[] {
  const text = `${effect?.trigger ?? ""} ${effect?.actionType ?? ""} ${effect?.actionText ?? ""} ${effect?.value ?? ""}`.toUpperCase();
  const rolls: LlmForcedRollPlan[] = [];

  if (text.includes("HIT") || text.includes("BATTLE") || text.includes("ATTACK")) {
    rolls.push({ kind: "HIT_ROLL", dice: [6, 5], label: "LLM test: force hit" });
    rolls.push({ kind: "ATTACK_DAMAGE_ROLL", dice: [4, 4, 3, 3], label: "LLM test: stable attack damage" });
  }

  if (text.includes("ROLL") || text.includes("DIE") || text.includes("DICE")) {
    rolls.push({ kind: "EFFECT_ROLL", dice: [6], label: "LLM test: favorable effect roll" });
  }

  return rolls;
}

function buildLocalPlan(args: {
  packId: string;
  card: CardDefinition;
  effect?: WardEngineEffect;
  providerWarning?: string;
}): LlmEffectTestPlan {
  const metadata = args.card as CardDefinition & {
    generation?: string | number;
    cardNumber?: string | number;
  };
  const phase = inferPhase(args.effect);
  const effectLabel = args.effect ? `${args.effect.id} ${args.effect.actionType}` : "card effect";
  const fixtureName = `${sanitizeIdPart(args.card.id)}-${sanitizeIdPart(args.effect?.id ?? "all-effects")}`;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "LOCAL_FALLBACK",
    providerWarning: args.providerWarning,
    card: {
      packId: args.packId,
      cardId: args.card.id,
      cardName: args.card.name,
      cardType: args.card.cardType,
      cardNumber: metadata.cardNumber === undefined ? undefined : String(metadata.cardNumber).padStart(3, "0"),
      generation: metadata.generation === undefined ? undefined : String(metadata.generation),
      rawText: args.card.text ?? ""
    },
    effect: args.effect
      ? {
          effectId: args.effect.id,
          trigger: args.effect.trigger,
          actionType: args.effect.actionType,
          effectGroup: args.effect.effectGroup,
          target: args.effect.target,
          value: args.effect.value,
          durationText: args.effect.duration?.text,
          reusableFunction: args.effect.reusableFunction
        }
      : undefined,
    title: `Test ${args.card.name}: ${effectLabel}`,
    summary: `Create a deterministic dev scenario for ${args.card.name} and verify that ${effectLabel} resolves according to the parsed effect and WARD rules.`,
    setup: {
      phase,
      activePlayerId: "player_1",
      player1Cards: [args.card.id],
      player2Cards: [],
      forcedRolls: inferForcedRolls(args.effect),
      notes: [
        "Local fallback created this plan because no LLM provider was configured or the provider call failed.",
        "Use the generated scenario match, then verify the expected assertions manually."
      ]
    },
    steps: [
      "Create the effect scenario match from this plan.",
      "Confirm Player 1 controls or can play the source card.",
      phase === "COMBAT" ? "Run a battle or hit sequence using the forced rolls." : "Activate or play the source card through the available effect controls.",
      "Resolve any target, card-selection, chain, battle, or effect-roll prompts.",
      "Review the event log and the affected card/player state."
    ],
    expectedAssertions: [
      {
        label: "Source card exists in the generated match catalog.",
        path: `cardCatalog.${args.card.id}`,
        operator: "exists"
      },
      {
        label: "Event log records the tested card or effect during execution.",
        path: "eventLog",
        operator: "contains",
        value: args.card.name
      }
    ],
    manualVerification: [
      args.effect?.target ? `Verify target behavior: ${args.effect.target}.` : "Verify the correct target, if any, was chosen.",
      args.effect?.value ? `Verify value/effect result: ${args.effect.value}.` : "Verify the visible game state matches the card text.",
      args.effect?.duration?.text ? `Verify duration cleanup: ${args.effect.duration.text}.` : "Verify no extra persistent state remains unless the card says it should."
    ],
    riskNotes: [
      args.effect?.needsReview ? "Parsed effect is marked needsReview; validate card data before trusting test result." : "Fallback plan cannot infer every WARD edge case.",
      "The engine remains source of truth; the LLM/fallback only proposes a QA plan."
    ],
    coverageSuggestion: {
      status: "UNTESTED",
      issueType: "NONE",
      notes: "Run the generated scenario and update after reviewing result."
    },
    regression: {
      fixtureName,
      tags: [args.card.cardType, args.effect?.trigger ?? "NO_TRIGGER", args.effect?.actionType ?? "NO_ACTION"].filter(Boolean)
    }
  };
}

function normalizePlan(args: {
  packId: string;
  card: CardDefinition;
  effect?: WardEngineEffect;
  rawPlan: Partial<LlmEffectTestPlan>;
  mode: "LLM" | "LOCAL_FALLBACK";
  providerWarning?: string;
}): LlmEffectTestPlan {
  const fallback = buildLocalPlan(args);
  const phase = args.rawPlan.setup?.phase && VALID_PHASES.has(args.rawPlan.setup.phase)
    ? args.rawPlan.setup.phase
    : fallback.setup.phase;

  const fixtureName = sanitizeIdPart(args.rawPlan.regression?.fixtureName ?? fallback.regression.fixtureName);
  const status = args.rawPlan.coverageSuggestion?.status ?? fallback.coverageSuggestion.status;
  const issueType = args.rawPlan.coverageSuggestion?.issueType ?? fallback.coverageSuggestion.issueType;

  return {
    ...fallback,
    ...args.rawPlan,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    providerWarning: args.providerWarning,
    card: fallback.card,
    effect: fallback.effect,
    title: String(args.rawPlan.title ?? fallback.title),
    summary: String(args.rawPlan.summary ?? fallback.summary),
    setup: {
      ...fallback.setup,
      ...(args.rawPlan.setup ?? {}),
      phase,
      activePlayerId: args.rawPlan.setup?.activePlayerId === "player_2" ? "player_2" : "player_1",
      player1Cards: asStringArray(args.rawPlan.setup?.player1Cards).length > 0 ? asStringArray(args.rawPlan.setup?.player1Cards) : fallback.setup.player1Cards,
      player2Cards: asStringArray(args.rawPlan.setup?.player2Cards),
      forcedRolls: normalizeRolls(args.rawPlan.setup?.forcedRolls).length > 0
        ? normalizeRolls(args.rawPlan.setup?.forcedRolls)
        : fallback.setup.forcedRolls,
      notes: asStringArray(args.rawPlan.setup?.notes).length > 0 ? asStringArray(args.rawPlan.setup?.notes) : fallback.setup.notes
    },
    steps: asStringArray(args.rawPlan.steps).length > 0 ? asStringArray(args.rawPlan.steps) : fallback.steps,
    expectedAssertions: Array.isArray(args.rawPlan.expectedAssertions) && args.rawPlan.expectedAssertions.length > 0
      ? args.rawPlan.expectedAssertions
      : fallback.expectedAssertions,
    manualVerification: asStringArray(args.rawPlan.manualVerification).length > 0 ? asStringArray(args.rawPlan.manualVerification) : fallback.manualVerification,
    riskNotes: asStringArray(args.rawPlan.riskNotes).length > 0 ? asStringArray(args.rawPlan.riskNotes) : fallback.riskNotes,
    coverageSuggestion: {
      status,
      issueType,
      notes: String(args.rawPlan.coverageSuggestion?.notes ?? fallback.coverageSuggestion.notes)
    },
    regression: {
      fixtureName,
      tags: asStringArray(args.rawPlan.regression?.tags).length > 0 ? asStringArray(args.rawPlan.regression?.tags) : fallback.regression.tags
    }
  };
}

export async function generateEffectTestPlan(args: {
  packId: string;
  card: CardDefinition;
  effectId?: string;
  runtimeSupport?: unknown;
}): Promise<LlmEffectTestPlan> {
  const effect = getCardEffect(args.card, args.effectId);
  const fallback = buildLocalPlan({ packId: args.packId, card: args.card, effect });

  const systemPrompt = `You are the WARD TCG app's senior effect QA planner. Return only valid JSON. Do not mutate game state. The deterministic engine is the source of truth. You only create test plans, expected assertions, and QA notes.\n${WARD_RULES_SUMMARY}`;

  const userPrompt = JSON.stringify({
    task: "Phase 1 and Phase 2 planning: create a deterministic effect test plan for the WARD app. Return JSON matching the provided schema names. Keep assertions checkable against match JSON paths where possible.",
    outputShape: {
      title: "string",
      summary: "string",
      setup: {
        phase: "DRAW|SUMMON_MAGIC|COMBAT|SECOND_MAGIC|END",
        activePlayerId: "player_1|player_2",
        player1Cards: ["card ids to include"],
        player2Cards: ["card ids to include"],
        forcedRolls: [{ kind: "HIT_ROLL|ATTACK_DAMAGE_ROLL|EFFECT_ROLL|SPEED_TIE_ROLL|SELF_DAMAGE_ROLL|GENERIC_ROLL", dice: [1, 2, 3], label: "string" }],
        notes: ["string"]
      },
      steps: ["string"],
      expectedAssertions: [{ label: "string", path: "string", operator: "equals|notEquals|contains|greaterThan|lessThan|exists|notExists", value: "optional" }],
      manualVerification: ["string"],
      riskNotes: ["string"],
      coverageSuggestion: { status: "UNTESTED|WORKING|PARTIAL|BROKEN|BLOCKED_RUNTIME|BLOCKED_DATA|NEEDS_RULES_REVIEW", issueType: "NONE|WRONG_TARGET|WRONG_TIMING|WRONG_DURATION|WRONG_COUNTER|WRONG_DAMAGE|WRONG_STAT_MODIFIER|MISSING_BUTTON|MISSING_PROMPT|MISSING_CHAIN_WINDOW|MISSING_CLEANUP|UNSUPPORTED_ACTION_TYPE", notes: "string" },
      regression: { fixtureName: "safe-kebab-name", tags: ["string"] }
    },
    card: summarizeCard(args.card, args.packId),
    selectedEffectId: args.effectId,
    selectedEffect: effect,
    runtimeSupport: args.runtimeSupport
  }, null, 2);

  const response = await requestLlmJson<Partial<LlmEffectTestPlan>>({
    systemPrompt,
    userPrompt,
    fallback,
    timeoutMs: 60000
  });

  return normalizePlan({
    packId: args.packId,
    card: args.card,
    effect,
    rawPlan: response.data,
    mode: response.mode,
    providerWarning: response.providerWarning
  });
}


type LlmBatchPlanInput = {
  packId: string;
  card: CardDefinition;
  effectId?: string;
  runtimeSupport?: unknown;
};

type LlmBatchProgress = {
  stage: "started" | "chunk" | "provider" | "fallback" | "done";
  completed: number;
  total: number;
  message: string;
};

function getBatchChunkSize(): number {
  const raw = process.env.WARD_LLM_BATCH_CHUNK_SIZE?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 8;

  if (!Number.isFinite(parsed) || parsed < 1) return 8;
  return Math.min(parsed, 15);
}

function getRequestKey(item: { packId: string; card: CardDefinition; effect?: WardEngineEffect; effectId?: string }): string {
  return `${item.packId}:${item.card.id}:${item.effect?.id ?? item.effectId ?? "NO_EFFECT"}`;
}

function summarizeBatchInput(item: LlmBatchPlanInput) {
  const effect = getCardEffect(item.card, item.effectId);

  return {
    requestKey: getRequestKey({ ...item, effect }),
    packId: item.packId,
    card: summarizeCard(item.card, item.packId),
    selectedEffectId: item.effectId,
    selectedEffect: effect,
    runtimeSupport: item.runtimeSupport
  };
}

function buildBatchFallback(items: LlmBatchPlanInput[]): { plans: Array<LlmEffectTestPlan & { requestKey: string }> } {
  return {
    plans: items.map(item => {
      const effect = getCardEffect(item.card, item.effectId);
      const plan = buildLocalPlan({ packId: item.packId, card: item.card, effect });
      return {
        ...plan,
        requestKey: getRequestKey({ ...item, effect })
      };
    })
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function generateEffectTestPlanBatch(args: {
  items: LlmBatchPlanInput[];
  onProgress?: (progress: LlmBatchProgress) => void;
}): Promise<LlmEffectTestPlan[]> {
  const items = args.items;

  if (items.length === 0) return [];

  const total = items.length;
  const chunkSize = getBatchChunkSize();
  const chunks = chunkArray(items, chunkSize);
  const plans: LlmEffectTestPlan[] = [];
  let completed = 0;

  args.onProgress?.({
    stage: "started",
    completed,
    total,
    message: `Starting optimized LLM batch planning for ${total} effect request${total === 1 ? "" : "s"}. Chunk size: ${chunkSize}.`
  });

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const chunkStart = completed + 1;
    const chunkEnd = completed + chunk.length;

    args.onProgress?.({
      stage: "chunk",
      completed,
      total,
      message: `Requesting LLM batch chunk ${chunkIndex + 1}/${chunks.length} for effects ${chunkStart}-${chunkEnd} of ${total}.`
    });

    const fallback = buildBatchFallback(chunk);
    const batchInputs = chunk.map(summarizeBatchInput);

    const systemPrompt = `You are the WARD TCG app's senior effect QA planner. Return only valid JSON. Do not mutate game state. The deterministic engine is the source of truth. You create concise test plans, expected assertions, and QA notes for multiple card effects in one batch.\n${WARD_RULES_SUMMARY}`;

    const userPrompt = JSON.stringify({
      task: "Bulk Phase 1 and Phase 2 planning: create one concise deterministic effect test plan per request. Return exactly one JSON object with a plans array. Each output plan must preserve its requestKey so the app can match it to the card/effect.",
      strictRules: [
        "Return exactly one plan for each request.",
        "Do not omit requestKey.",
        "Keep each plan concise. Avoid long prose.",
        "Do not include full card objects in your output; the app will attach canonical card/effect metadata.",
        "Use UNTESTED unless the plan itself proves a runtime blocker. The human tester will mark WORKING/PARTIAL/BROKEN after checking."
      ],
      outputShape: {
        plans: [{
          requestKey: "must match request.requestKey",
          title: "string",
          summary: "string",
          setup: {
            phase: "DRAW|SUMMON_MAGIC|COMBAT|SECOND_MAGIC|END",
            activePlayerId: "player_1|player_2",
            player1Cards: ["card ids to include"],
            player2Cards: ["card ids to include"],
            forcedRolls: [{ kind: "HIT_ROLL|ATTACK_DAMAGE_ROLL|EFFECT_ROLL|SPEED_TIE_ROLL|SELF_DAMAGE_ROLL|GENERIC_ROLL", dice: [1, 2, 3], label: "string" }],
            notes: ["string"]
          },
          steps: ["string"],
          expectedAssertions: [{ label: "string", path: "string", operator: "equals|notEquals|contains|greaterThan|lessThan|exists|notExists", value: "optional" }],
          manualVerification: ["string"],
          riskNotes: ["string"],
          coverageSuggestion: { status: "UNTESTED|PARTIAL|BLOCKED_RUNTIME|BLOCKED_DATA|NEEDS_RULES_REVIEW", issueType: "NONE|WRONG_TARGET|WRONG_TIMING|WRONG_DURATION|WRONG_COUNTER|WRONG_DAMAGE|WRONG_STAT_MODIFIER|MISSING_BUTTON|MISSING_PROMPT|MISSING_CHAIN_WINDOW|MISSING_CLEANUP|UNSUPPORTED_ACTION_TYPE", notes: "string" },
          regression: { fixtureName: "safe-kebab-name", tags: ["string"] }
        }]
      },
      requests: batchInputs
    }, null, 2);

    const response = await requestLlmJson<{ plans?: Array<Partial<LlmEffectTestPlan> & { requestKey?: string }> }>({
      systemPrompt,
      userPrompt,
      fallback,
      timeoutMs: 90000
    });

    const rawPlansByKey = new Map<string, Partial<LlmEffectTestPlan> & { requestKey?: string }>();
    for (const rawPlan of response.data.plans ?? []) {
      if (rawPlan.requestKey) {
        rawPlansByKey.set(rawPlan.requestKey, rawPlan);
      }
    }

    if (response.providerWarning) {
      args.onProgress?.({
        stage: "fallback",
        completed,
        total,
        message: `LLM provider fallback used for chunk ${chunkIndex + 1}/${chunks.length}: ${response.providerWarning}`
      });
    } else {
      args.onProgress?.({
        stage: "provider",
        completed,
        total,
        message: `LLM provider returned chunk ${chunkIndex + 1}/${chunks.length}. Normalizing ${chunk.length} plan(s).`
      });
    }

    for (const item of chunk) {
      const effect = getCardEffect(item.card, item.effectId);
      const requestKey = getRequestKey({ ...item, effect });
      const rawPlan = rawPlansByKey.get(requestKey);
      const providerWarning = rawPlan
        ? response.providerWarning
        : response.providerWarning ?? `LLM batch response did not include requestKey ${requestKey}; local fallback used for this effect.`;

      plans.push(normalizePlan({
        packId: item.packId,
        card: item.card,
        effect,
        rawPlan: rawPlan ?? buildLocalPlan({ packId: item.packId, card: item.card, effect }),
        mode: rawPlan ? response.mode : "LOCAL_FALLBACK",
        providerWarning
      }));
    }

    completed += chunk.length;
    args.onProgress?.({
      stage: "chunk",
      completed,
      total,
      message: `Finished ${completed}/${total} LLM batch plan(s).`
    });
  }

  args.onProgress?.({
    stage: "done",
    completed: total,
    total,
    message: `Generated ${plans.length} LLM batch test plan${plans.length === 1 ? "" : "s"}.`
  });

  return plans;
}

function normalizeReview(args: {
  rawReview: Partial<LlmEffectResultReview>;
  fallback: LlmEffectResultReview;
  mode: "LLM" | "LOCAL_FALLBACK";
  providerWarning?: string;
}): LlmEffectResultReview {
  const status = args.rawReview.passFailSuggestion ?? args.rawReview.coverageSuggestion?.status ?? args.fallback.passFailSuggestion;
  const issueType = args.rawReview.issueType ?? args.rawReview.coverageSuggestion?.issueType ?? args.fallback.issueType;

  return {
    ...args.fallback,
    ...args.rawReview,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    providerWarning: args.providerWarning,
    summary: String(args.rawReview.summary ?? args.fallback.summary),
    passFailSuggestion: status,
    issueType,
    evidence: asStringArray(args.rawReview.evidence).length > 0 ? asStringArray(args.rawReview.evidence) : args.fallback.evidence,
    suspectedIssues: asStringArray(args.rawReview.suspectedIssues),
    suggestedNextSteps: asStringArray(args.rawReview.suggestedNextSteps).length > 0 ? asStringArray(args.rawReview.suggestedNextSteps) : args.fallback.suggestedNextSteps,
    coverageSuggestion: {
      status: args.rawReview.coverageSuggestion?.status ?? status,
      issueType: args.rawReview.coverageSuggestion?.issueType ?? issueType,
      notes: String(args.rawReview.coverageSuggestion?.notes ?? args.fallback.coverageSuggestion.notes)
    }
  };
}

export async function reviewEffectTestResult(args: {
  plan: LlmEffectTestPlan;
  match: MatchState;
}): Promise<LlmEffectResultReview> {
  const fallback: LlmEffectResultReview = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "LOCAL_FALLBACK",
    cardId: args.plan.card.cardId,
    effectId: args.plan.effect?.effectId,
    matchId: args.match.matchId,
    summary: "Local fallback review created. Check expected assertions, visible match state, and event log manually.",
    passFailSuggestion: "PARTIAL",
    issueType: "NONE",
    evidence: [
      `Match ${args.match.matchId} reviewed with ${args.match.eventLog.length} event log entries.`,
      `Current phase: ${args.match.turn.phase}; active player: ${args.match.turn.activePlayerId}.`
    ],
    suspectedIssues: [],
    suggestedNextSteps: [
      "Compare actual state to each expected assertion in the plan.",
      "If the effect result is correct, mark Working. If not, set the most specific issue type and note the missing handler."
    ],
    coverageSuggestion: {
      status: "PARTIAL",
      issueType: "NONE",
      notes: "Fallback review only. Manually confirm pass/fail before saving coverage."
    }
  };

  const systemPrompt = `You are the WARD TCG app's effect test reviewer. Return only valid JSON. Review the provided plan against the match summary/event log. Do not invent state not present in the match summary. Suggest coverage status, issue type, evidence, suspected issues, and next steps.\n${WARD_RULES_SUMMARY}`;

  const userPrompt = JSON.stringify({
    task: "Phase 3 review: determine whether the test result appears to match the plan. Return JSON only.",
    outputShape: {
      summary: "string",
      passFailSuggestion: "WORKING|PARTIAL|BROKEN|BLOCKED_RUNTIME|BLOCKED_DATA|NEEDS_RULES_REVIEW",
      issueType: "NONE|WRONG_TARGET|WRONG_TIMING|WRONG_DURATION|WRONG_COUNTER|WRONG_DAMAGE|WRONG_STAT_MODIFIER|MISSING_BUTTON|MISSING_PROMPT|MISSING_CHAIN_WINDOW|MISSING_CLEANUP|UNSUPPORTED_ACTION_TYPE",
      evidence: ["string"],
      suspectedIssues: ["string"],
      suggestedNextSteps: ["string"],
      coverageSuggestion: { status: "string", issueType: "string", notes: "string" }
    },
    plan: args.plan,
    matchSummary: summarizeMatchForReview(args.match)
  }, null, 2);

  const response = await requestLlmJson<Partial<LlmEffectResultReview>>({
    systemPrompt,
    userPrompt,
    fallback,
    timeoutMs: 60000
  });

  return normalizeReview({
    rawReview: response.data,
    fallback,
    mode: response.mode,
    providerWarning: response.providerWarning
  });
}
