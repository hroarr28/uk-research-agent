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
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.unknown().optional(),
    }),
  ),
});

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicBlock[] };

export function createAnthropicProvider(options: {
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
  const url = `${(options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "")}/messages`;
  return {
    id: "anthropic",
    async complete(request) {
      const result = await http.postJson(url, anthropicBody(request), {
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
      });
      if (!result.ok) throw new ModelProviderError(result.code, result.message);
      return parseAnthropicResponse(result.data, request.model);
    },
  };
}

export function anthropicBody(request: CompletionRequest): Record<string, unknown> {
  const converted = toAnthropicMessages(request.messages);
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: 2048,
    messages: converted.messages,
  };
  if (converted.system) body.system = converted.system;
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
  return body;
}

export function toAnthropicMessages(messages: readonly ModelMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (message.content.length > 0) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    const block: AnthropicBlock = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
    };
    const previous = out.at(-1);
    if (previous && previous.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }
  return system.length > 0 ? { system, messages: out } : { messages: out };
}

export function parseAnthropicResponse(
  payload: unknown,
  fallbackModel: string,
): CompletionResponse {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ModelProviderError(
      "invalid_response",
      "Anthropic response did not match the expected shape.",
    );
  }
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of parsed.data.content) {
    if (block.type === "text" && block.text) text.push(block.text);
    if (block.type === "tool_use") {
      if (!block.id || !block.name) {
        throw new ModelProviderError(
          "invalid_response",
          "Anthropic tool use was missing an id or name.",
        );
      }
      toolCalls.push({ id: block.id, name: block.name, arguments: objectArguments(block.input) });
    }
  }
  return {
    content: text.join("\n"),
    toolCalls,
    usage: {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    },
    model: parsed.data.model ?? fallbackModel,
  };
}

function objectArguments(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ModelProviderError("invalid_response", "Anthropic tool input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}
