import "server-only";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterJsonOptions = {
  task: "profile" | "match";
  messages: OpenRouterMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs?: number;
};

const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
const defaultModel = "nvidia/nemotron-3-nano-30b-a3b:free";
const fallbackModels = [
  "openrouter/free",
  "openrouter/owl-alpha",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "z-ai/glm-4.5-air:free"
];
type PayloadMode = "structured" | "json_object" | "plain";

export async function callOpenRouterJson<T>({
  task,
  messages,
  schemaName,
  schema,
  maxTokens,
  timeoutMs = 22000
}: OpenRouterJsonOptions): Promise<T> {
  const apiKey = getEnvValue("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY in the server environment.");

  const attempts: string[] = [];
  for (const model of selectModels(task)) {
    for (const mode of getPayloadModes(model)) {
      try {
        return await postOpenRouterJson<T>({
          apiKey,
          payload: buildPayload({ mode, model, messages, schemaName, schema, maxTokens }),
          task,
          timeoutMs
        });
      } catch (error) {
        attempts.push(`${model} (${mode}): ${formatOpenRouterError(error)}`);
        if (!shouldTryAnotherMode(error, mode)) break;
      }
    }
  }

  throw new Error(`OpenRouter ${task} request failed after ${attempts.length} attempts. ${attempts.slice(0, 4).join(" | ")}`);
}

async function postOpenRouterJson<T>({
  apiKey,
  payload,
  task,
  timeoutMs
}: {
  apiKey: string;
  payload: Record<string, unknown>;
  task: OpenRouterJsonOptions["task"];
  timeoutMs: number;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(openRouterUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Stealth"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const details = await response.text();
      throw new OpenRouterRequestError(task, response.status, details);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`OpenRouter returned an empty ${task} response.`);

    return parseJsonContent(content) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildStructuredPayload({
  model,
  messages,
  schemaName,
  schema,
  maxTokens
}: {
  model: string;
  messages: OpenRouterMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  return {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema
      }
    }
  };
}

function buildPayload({
  mode,
  model,
  messages,
  schemaName,
  schema,
  maxTokens
}: {
  mode: PayloadMode;
  model: string;
  messages: OpenRouterMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  if (mode === "structured") return buildStructuredPayload({ model, messages, schemaName, schema, maxTokens });
  if (mode === "json_object") return buildJsonObjectPayload({ model, messages, schemaName, schema, maxTokens });
  return buildPlainJsonPayload({ model, messages, schemaName, schema, maxTokens });
}

function buildPlainJsonPayload({
  model,
  messages,
  schemaName,
  schema,
  maxTokens
}: {
  model: string;
  messages: OpenRouterMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  const jsonOnlyInstruction: OpenRouterMessage = {
    role: "system",
    content: [
      "Return only raw JSON with no markdown, prose, comments, or code fences.",
      `The JSON must match this schema named ${schemaName}: ${JSON.stringify(schema)}.`,
      `Keep the answer within the original ${maxTokens} token budget.`
    ].join(" ")
  };

  return {
    model,
    messages: [jsonOnlyInstruction, ...messages]
  };
}

function buildJsonObjectPayload({
  model,
  messages,
  schemaName,
  schema,
  maxTokens
}: {
  model: string;
  messages: OpenRouterMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  const jsonOnlyInstruction: OpenRouterMessage = {
    role: "system",
    content: [
      "Return only raw JSON with no markdown, prose, comments, or code fences.",
      `The JSON must match this schema named ${schemaName}: ${JSON.stringify(schema)}.`
    ].join(" ")
  };

  return {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [jsonOnlyInstruction, ...messages],
    response_format: {
      type: "json_object"
    }
  };
}

function shouldTryAnotherMode(error: unknown, mode: PayloadMode) {
  if (mode === "plain") return false;
  if (!(error instanceof OpenRouterRequestError)) return false;

  const details = error.details.toLowerCase();
  return (
    error.status === 400 ||
    error.status === 422 ||
    details.includes("response_format") ||
    details.includes("structured") ||
    details.includes("schema") ||
    details.includes("temperature") ||
    details.includes("max_tokens") ||
    details.includes("unsupported parameter")
  );
}

function isKnownPlainJsonModel(model: string) {
  return [
    "deepseek/deepseek-v4-flash:free",
    "openrouter/free",
    "openai/gpt-oss-120b:free",
    "openai/gpt-oss-20b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "z-ai/glm-4.5-air:free"
  ].includes(model);
}

function isKnownJsonObjectModel(model: string) {
  return (
    model === "nvidia/nemotron-3-nano-30b-a3b:free" ||
    model === "google/gemma-4-26b-a4b-it:free" ||
    model === "google/gemma-4-31b-it:free"
  );
}

function getPayloadModes(model: string): PayloadMode[] {
  if (isKnownPlainJsonModel(model)) return ["plain"];
  if (isKnownJsonObjectModel(model)) return ["json_object", "plain"];
  return ["structured", "json_object", "plain"];
}

class OpenRouterRequestError extends Error {
  constructor(
    task: OpenRouterJsonOptions["task"],
    readonly status: number,
    readonly details: string
  ) {
    super(`OpenRouter ${task} request failed (${status}): ${details.slice(0, 240)}`);
  }
}

function selectModels(task: OpenRouterJsonOptions["task"]) {
  const primary =
    task === "profile"
      ? getEnvValue("OPENROUTER_PROFILE_MODEL") ?? getEnvValue("OPENROUTER_MODEL") ?? defaultModel
      : getEnvValue("OPENROUTER_MATCH_MODEL") ?? getEnvValue("OPENROUTER_MODEL") ?? defaultModel;
  const configuredFallbacks = getEnvValue("OPENROUTER_FALLBACK_MODELS")
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return [...new Set([primary, ...(configuredFallbacks?.length ? configuredFallbacks : fallbackModels)])];
}

function getEnvValue(key: string) {
  const value = process.env[key]?.trim();
  return value || undefined;
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
    throw new Error("OpenRouter returned malformed JSON.");
  }
}

function formatOpenRouterError(error: unknown) {
  if (error instanceof OpenRouterRequestError) return `${error.status} ${error.details.slice(0, 120)}`;
  if (error instanceof Error) return error.message.slice(0, 120);
  return "unknown error";
}
