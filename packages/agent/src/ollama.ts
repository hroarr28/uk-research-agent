import { createHttpClient, type FetchLike, type Logger } from "@uk-research/http";
import { z } from "zod";
import { DEFAULT_OLLAMA_MODEL } from "./prices.js";
import { ModelProviderError } from "./scripted.js";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelMessage,
  ModelProvider,
  TokenUsage,
  ToolCall,
} from "./types.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000;

const messageSchema = z.object({
  content: z.string().optional(),
  thinking: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string().optional(),
        function: z
          .object({
            name: z.string().optional(),
            arguments: z.unknown().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const responseSchema = z.object({
  model: z.string().optional(),
  message: messageSchema.optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

type Interpreted =
  | { ok: true; response: CompletionResponse }
  | { ok: false; error: string; usage: TokenUsage; model: string };

export function createOllamaProvider(options?: {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}): ModelProvider {
  const baseUrl = (options?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  const http = createHttpClient({
    fetchFn: options?.fetchFn,
    sleep: options?.sleep,
    logger: options?.logger,
    timeoutMs: options?.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS,
    maxRetries: 0,
  });
  const url = `${baseUrl}/api/chat`;

  async function post(request: CompletionRequest): Promise<unknown> {
    const result = await http.postJson(url, ollamaBody(request));
    if (!result.ok) throw new ModelProviderError(result.code, result.message);
    return result.data;
  }

  return {
    id: "ollama",
    local: true,
    async complete(request) {
      const model = request.model || DEFAULT_OLLAMA_MODEL;
      const first = interpretOllamaResponse(await post(request), model);
      if (first.ok) return first.response;
      const retry = interpretOllamaResponse(
        await post({
          ...request,
          model,
          messages: [
            ...request.messages,
            {
              role: "user",
              content: `The previous response was not a valid tool call. ${first.error} Return a tool call whose arguments are a JSON object, or a final answer with no tool call.`,
            },
          ],
        }),
        model,
      );
      if (retry.ok) {
        return {
          ...retry.response,
          usage: addUsage(first.usage, retry.response.usage),
        };
      }
      throw new ModelProviderError(
        "invalid_tool_call",
        `Ollama returned a malformed tool call after one retry. ${retry.error}`,
      );
    },
  };
}

export function ollamaBody(request: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    stream: false,
    messages: request.messages.map(ollamaMessage),
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
  return body;
}

function ollamaMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "system" || message.role === "user") {
    return { role: message.role, content: message.content };
  }
  if (message.role === "tool") {
    return { role: "tool", tool_name: message.name, content: message.content };
  }
  const body: Record<string, unknown> = { role: "assistant", content: message.content };
  if (message.toolCalls.length > 0) {
    body.tool_calls = message.toolCalls.map((call) => ({
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return body;
}

export function interpretOllamaResponse(payload: unknown, fallbackModel: string): Interpreted {
  const parsed = responseSchema.safeParse(payload);
  const usage = usageFrom(parsed.success ? parsed.data : {});
  const model = (parsed.success ? parsed.data.model : undefined) || fallbackModel;
  if (!parsed.success || !parsed.data.message) {
    return { ok: false, error: "Ollama response did not include a message.", usage, model };
  }
  const message = parsed.data.message;
  const rawCalls = message.tool_calls ?? [];
  const toolCalls: ToolCall[] = [];
  const problems: string[] = [];
  rawCalls.forEach((call, index) => {
    const name = call.function?.name;
    if (!name) {
      problems.push(`Tool call ${index + 1} is missing a function name.`);
      return;
    }
    const args = objectArguments(call.function?.arguments);
    if (!args.ok) {
      problems.push(`${name}: ${args.error}`);
      return;
    }
    toolCalls.push({ id: call.id ?? `ollama_${index + 1}`, name, arguments: args.value });
  });
  if (problems.length > 0) {
    return { ok: false, error: problems.join(" "), usage, model };
  }
  const content = message.content?.trim()
    ? message.content
    : toolCalls.length === 0
      ? (message.thinking ?? "")
      : "";
  return {
    ok: true,
    response: { content, toolCalls, usage, model },
  };
}

function objectArguments(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (typeof value === "string") {
    try {
      return objectArguments(JSON.parse(value) as unknown);
    } catch {
      return { ok: false, error: "arguments were not valid JSON." };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "arguments must be a JSON object." };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function usageFrom(payload: { prompt_eval_count?: number; eval_count?: number }): TokenUsage {
  return {
    inputTokens: payload.prompt_eval_count ?? 0,
    outputTokens: payload.eval_count ?? 0,
  };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}
