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
const defaultModel = "openai/gpt-4o-mini";

export async function callOpenRouterJson<T>({
  task,
  messages,
  schemaName,
  schema,
  maxTokens,
  timeoutMs = 22000
}: OpenRouterJsonOptions): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY in .env.local.");

  const model = selectModel(task);
  const payload = {
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

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
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
        throw new Error(`OpenRouter ${task} request failed (${response.status}): ${details.slice(0, 240)}`);
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
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`OpenRouter ${task} request failed.`);
}

function selectModel(task: OpenRouterJsonOptions["task"]) {
  if (task === "profile") return process.env.OPENROUTER_PROFILE_MODEL ?? process.env.OPENROUTER_MODEL ?? defaultModel;
  return process.env.OPENROUTER_MATCH_MODEL ?? process.env.OPENROUTER_MODEL ?? defaultModel;
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
