import { createHttpClient, type FetchLike, type Logger } from "@uk-research/http";
import { z } from "zod";
import { ModelProviderError } from "./scripted.js";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelMessage,
  ModelProvider,
  ToolCall,
} from "./types.js";

const responseSchema = z.object({
  model: z.string().optional(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
  }),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
});

export function createOpenAiProvider(options: {
  apiKey: string;
  fetchFn?: FetchLike;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}): ModelProvider {
  const http = createHttpClient({
    fetchFn: options.fetchFn,
    sleep: options.sleep,
    logger: options.logger,
    secrets: options.apiKey.length >= 8 ? [options.apiKey] : [],
  });
  const url = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  return {
    id: "openai",
    async complete(request) {
      const result = await http.postJson(url, openAiBody(request), {
        authorization: `Bearer ${options.apiKey}`,
      });
      if (!result.ok) throw new ModelProviderError(result.code, result.message);
      return parseOpenAiResponse(result.data, request.model);
    },
  };
}

export function openAiBody(request: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(openAiMessage),
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
    body.tool_choice = "auto";
  }
  return body;
}

function openAiMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "system" || message.role === "user") {
    return { role: message.role, content: message.content };
  }
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  const body: Record<string, unknown> = {
    role: "assistant",
    content: message.content.length > 0 ? message.content : null,
  };
  if (message.toolCalls.length > 0) {
    body.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
  }
  return body;
}

export function parseOpenAiResponse(payload: unknown, fallbackModel: string): CompletionResponse {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ModelProviderError(
      "invalid_response",
      "OpenAI response did not match the expected shape.",
    );
  }
  const message = parsed.data.choices[0]?.message;
  if (!message) throw new ModelProviderError("invalid_response", "OpenAI response had no message.");
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: parseArguments(call.function.arguments),
  }));
  return {
    content: message.content ?? "",
    toolCalls,
    usage: {
      inputTokens: parsed.data.usage.prompt_tokens,
      outputTokens: parsed.data.usage.completion_tokens,
    },
    model: parsed.data.model ?? fallbackModel,
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ModelProviderError("invalid_response", "Tool arguments were not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ModelProviderError("invalid_response", "Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
