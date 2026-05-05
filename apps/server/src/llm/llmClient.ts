import type { LlmMode, LlmServiceStatus } from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

type ResponsesApiContentItem = {
  type?: string;
  text?: unknown;
  refusal?: unknown;
};

type ResponsesApiOutputItem = {
  type?: string;
  content?: ResponsesApiContentItem[];
};

type ResponsesApiResponse = {
  status?: string;
  error?: { message?: unknown; code?: unknown } | null;
  incomplete_details?: { reason?: unknown } | null;
  output_text?: unknown;
  output?: ResponsesApiOutputItem[];
};

type LegacyChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

function getBaseUrl(): string {
  return (process.env.WARD_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getModel(): string {
  return process.env.WARD_LLM_MODEL?.trim() || DEFAULT_MODEL;
}

function getApiKey(): string {
  return process.env.WARD_LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
}

function isLlmDebugEnabled(): boolean {
  const raw = process.env.WARD_LLM_DEBUG ?? process.env.WARD_ENV_DEBUG;
  return raw === "1" || raw?.toLowerCase() === "true";
}

function getMaxOutputTokens(): number {
  const raw = process.env.WARD_LLM_MAX_OUTPUT_TOKENS?.trim();
  if (!raw) return DEFAULT_MAX_OUTPUT_TOKENS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 256) return DEFAULT_MAX_OUTPUT_TOKENS;

  return parsed;
}

function getReasoningEffort(): "minimal" | "low" | "medium" | "high" | "xhigh" {
  const raw = process.env.WARD_LLM_REASONING_EFFORT?.trim().toLowerCase();

  if (raw === "minimal" || raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") {
    return raw;
  }

  return "low";
}

function supportsReasoningConfig(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith("gpt-5") || /^o\d/.test(normalized) || normalized.startsWith("o-");
}

export function getLlmServiceStatus(): LlmServiceStatus {
  const apiKey = getApiKey();
  const configured = apiKey.length > 0;

  return {
    configured,
    mode: configured ? "openai-compatible" : "local-fallback",
    model: getModel(),
    baseUrl: getBaseUrl(),
    message: configured
      ? "LLM provider is configured on the server using the Responses API."
      : "No WARD_LLM_API_KEY or OPENAI_API_KEY found. The app will use local fallback plans until a server key is configured."
  };
}

function extractTextFromProviderResponse(data: unknown): string {
  const responsesData = data as ResponsesApiResponse;

  if (responsesData.error) {
    const message = typeof responsesData.error.message === "string" ? responsesData.error.message : "Unknown provider error.";
    throw new Error(`LLM provider error: ${message}`);
  }

  if (responsesData.status === "incomplete") {
    const reason = typeof responsesData.incomplete_details?.reason === "string"
      ? responsesData.incomplete_details.reason
      : "unknown";
    throw new Error(`LLM response was incomplete. Reason: ${reason}`);
  }

  if (typeof responsesData.output_text === "string" && responsesData.output_text.trim()) {
    return responsesData.output_text.trim();
  }

  const responseTextParts: string[] = [];

  for (const outputItem of responsesData.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "refusal") {
        const refusal = typeof contentItem.refusal === "string" ? contentItem.refusal : "The model refused the request.";
        throw new Error(`LLM provider refusal: ${refusal}`);
      }

      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        responseTextParts.push(contentItem.text);
      }
    }
  }

  const responsesText = responseTextParts.join("\n").trim();
  if (responsesText) return responsesText;

  // Compatibility only. This lets old saved/debug responses still parse if one is passed in.
  const legacyData = data as LegacyChatResponse;
  const chatContent = legacyData.choices?.[0]?.message?.content;

  if (typeof chatContent === "string") return chatContent.trim();

  if (Array.isArray(chatContent)) {
    return chatContent
      .map(item => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }

    throw new Error("LLM response did not contain a valid JSON object.");
  }
}

export async function requestLlmJson<T>(args: {
  systemPrompt: string;
  userPrompt: string;
  fallback: T;
  timeoutMs?: number;
}): Promise<{ mode: LlmMode; data: T; providerWarning?: string }> {
  const status = getLlmServiceStatus();

  if (!status.configured) {
    return {
      mode: "LOCAL_FALLBACK",
      data: args.fallback,
      providerWarning: status.message
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 90000);

  try {
    const jsonSystemPrompt = [
      args.systemPrompt,
      "",
      "Return exactly one valid JSON object only.",
      "Do not wrap the JSON in Markdown.",
      "Do not include commentary before or after the JSON."
    ].join("\n");

    const requestBody: Record<string, unknown> = {
      model: status.model,
      instructions: jsonSystemPrompt,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${args.userPrompt}\n\nRespond with JSON only.`
            }
          ]
        }
      ],
      text: {
        format: { type: "json_object" },
        verbosity: "low"
      },
      max_output_tokens: getMaxOutputTokens(),
      store: false
    };

    if (supportsReasoningConfig(status.model)) {
      requestBody.reasoning = {
        effort: getReasoningEffort()
      };
    }

    if (isLlmDebugEnabled()) {
      console.log(`[llm] POST ${status.baseUrl}/responses model=${status.model}`);
    }

    const response = await fetch(`${status.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM provider returned ${response.status}: ${errorText.slice(0, 500)}`);
    }

    const responseData = await response.json() as unknown;
    const text = extractTextFromProviderResponse(responseData);

    return {
      mode: "LLM",
      data: parseJsonObject<T>(text)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM provider error.";
    if (isLlmDebugEnabled()) {
      console.warn(`[llm] Provider request failed; using local fallback. ${message}`);
    }
    return {
      mode: "LOCAL_FALLBACK",
      data: args.fallback,
      providerWarning: `LLM provider failed; local fallback used. ${message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}
