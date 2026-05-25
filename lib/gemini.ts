import "server-only";

type GeminiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GeminiJsonOptions = {
  task: "profile" | "match" | "tailor" | "cover_letter";
  messages: GeminiMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs?: number;
};

type PayloadMode = "structured" | "json" | "plain";

const geminiApiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const defaultModel = "gemini-3.5-flash";
const defaultQuotaCooldownMs = 60_000;
const quotaCooldowns = new Map<string, number>();

export async function callGeminiJson<T>({
  task,
  messages,
  schemaName,
  schema,
  maxTokens,
  timeoutMs = 22000
}: GeminiJsonOptions): Promise<T> {
  const apiKey = getEnvValue("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in the server environment.");

  const models = selectModels(task);
  const attempts: string[] = [];

  for (const model of models) {
    const cooldownKey = `${task}:${model}`;
    const cooldownUntil = quotaCooldowns.get(cooldownKey) ?? 0;

    if (cooldownUntil > Date.now()) {
      const secondsRemaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      attempts.push(`${model}: cooling down for ${secondsRemaining}s`);
      continue;
    }

    for (const mode of ["structured", "json", "plain"] satisfies PayloadMode[]) {
      try {
        return await postGeminiJson<T>({
          apiKey,
          model,
          payload: buildPayload({ mode, messages, schemaName, schema, maxTokens }),
          task,
          timeoutMs
        });
      } catch (error) {
        attempts.push(`${model}/${mode}: ${formatGeminiError(error)}`);
        if (error instanceof GeminiRequestError && error.status === 429) {
          quotaCooldowns.set(cooldownKey, Date.now() + (error.retryAfterMs ?? defaultQuotaCooldownMs));
          break;
        }
        if (!shouldTryAnotherMode(error, mode)) break;
      }
    }
  }

  throw new Error(`Gemini ${task} request failed after ${attempts.length} attempts. ${attempts.join(" | ")}`);
}

async function postGeminiJson<T>({
  apiKey,
  model,
  payload,
  task,
  timeoutMs
}: {
  apiKey: string;
  model: string;
  payload: Record<string, unknown>;
  task: GeminiJsonOptions["task"];
  timeoutMs: number;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${geminiApiBaseUrl}/${encodeURIComponent(normalizeModelName(model))}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const details = await response.text();
      throw new GeminiRequestError(task, response.status, details, parseRetryAfterMs(response.headers.get("retry-after")));
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };
    const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!content) throw new Error(`Gemini returned an empty ${task} response.`);

    return parseJsonContent(content) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPayload({
  mode,
  messages,
  schemaName,
  schema,
  maxTokens
}: {
  mode: PayloadMode;
  messages: GeminiMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  const { systemText, userText } = formatMessages(messages);
  const schemaInstruction =
    mode === "structured"
      ? ""
      : `\n\nReturn only raw JSON with no markdown, prose, comments, or code fences. The JSON must match this schema named ${schemaName}: ${JSON.stringify(schema)}.`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    maxOutputTokens: maxTokens
  };

  if (mode === "structured") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiResponseSchema(schema);
  } else if (mode === "json") {
    generationConfig.responseMimeType = "application/json";
  }

  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents: [
      {
        role: "user",
        parts: [{ text: `${userText}${schemaInstruction}` }]
      }
    ],
    generationConfig
  };
}

function formatMessages(messages: GeminiMessage[]) {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const userText = messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:\n${message.content}`)
    .join("\n\n");

  return {
    systemText,
    userText: userText || "Return the requested JSON response."
  };
}

function shouldTryAnotherMode(error: unknown, mode: PayloadMode) {
  if (mode === "plain") return false;
  if (!(error instanceof GeminiRequestError)) return true;
  if (error.status === 429) return false;

  const details = error.details.toLowerCase();
  return (
    error.status === 400 ||
    error.status === 422 ||
    details.includes("responseschema") ||
    details.includes("response_schema") ||
    details.includes("responsemime") ||
    details.includes("schema") ||
    details.includes("json") ||
    details.includes("unsupported") ||
    details.includes("unknown field")
  );
}

function toGeminiResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiResponseSchema);
  if (!value || typeof value !== "object") return value;

  const cleaned: Record<string, unknown> = {};
  const unsupportedKeys = new Set([
    "additionalProperties",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "$schema"
  ]);

  for (const [key, item] of Object.entries(value)) {
    if (unsupportedKeys.has(key)) continue;
    cleaned[key] = toGeminiResponseSchema(item);
  }

  return cleaned;
}

class GeminiRequestError extends Error {
  constructor(
    task: GeminiJsonOptions["task"],
    readonly status: number,
    readonly details: string,
    readonly retryAfterMs?: number
  ) {
    super(`Gemini ${task} request failed (${status}): ${details.slice(0, 240)}`);
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return undefined;
}

function selectModels(task: GeminiJsonOptions["task"]) {
  const taskModel =
    task === "profile"
      ? getEnvValue("GEMINI_PROFILE_MODEL")
      : getEnvValue("GEMINI_MATCH_MODEL");
  const globalModel = getEnvValue("GEMINI_MODEL") ?? defaultModel;
  const fallbackModels = getEnvList("GEMINI_FALLBACK_MODELS");

  return uniqueStrings([taskModel, globalModel, ...fallbackModels, defaultModel]);
}

function normalizeModelName(model: string) {
  return model.replace(/^models\//, "");
}

function getEnvValue(key: string) {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function getEnvList(key: string) {
  return (process.env[key] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Gemini returned malformed JSON.");
  }
}

function formatGeminiError(error: unknown) {
  if (error instanceof GeminiRequestError) return `${error.status} ${error.details.slice(0, 120)}`;
  if (error instanceof Error) return error.message.slice(0, 120);
  return "unknown error";
}
