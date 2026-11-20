import { describe, expect, it } from "vitest";
import { silentLogger, type FetchLike } from "@uk-research/http";
import { anthropicBody, createAnthropicProvider, parseAnthropicResponse } from "./anthropic.js";
import { createOpenAiProvider, openAiBody, parseOpenAiResponse } from "./openai.js";
import type { CompletionRequest } from "./types.js";

const request: CompletionRequest = {
  model: "gpt-5-mini",
  tools: [
    {
      name: "search_companies",
      description: "Search",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    },
  ],
  messages: [
    { role: "system", content: "Be exact." },
    { role: "user", content: "Find Northstar" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "search_companies", arguments: { query: "Northstar" } }],
    },
    { role: "tool", toolCallId: "call_1", name: "search_companies", content: '{"ok":true}' },
    { role: "tool", toolCallId: "call_2", name: "get_company_profile", content: '{"ok":true}' },
  ],
};

describe("OpenAI provider", () => {
  it("maps tool calls and parses them back", () => {
    const body = openAiBody(request);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[2]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          function: { name: "search_companies", arguments: '{"query":"Northstar"}' },
        },
      ],
    });
    expect(body.tools).toHaveLength(1);
    const parsed = parseOpenAiResponse(
      {
        model: "gpt-5-mini",
        usage: { prompt_tokens: 10, completion_tokens: 4 },
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_9",
                  function: { name: "search_companies", arguments: '{"query":"Northstar"}' },
                },
              ],
            },
          },
        ],
      },
      "gpt-5-mini",
    );
    expect(parsed.toolCalls).toEqual([
      { id: "call_9", name: "search_companies", arguments: { query: "Northstar" } },
    ]);
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("scrubs the API key from a failed response", async () => {
    const secret = "openai-secret-key-value";
    const fetchFn: FetchLike = async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${secret}`);
      throw new Error(`connect ${secret}`);
    };
    const provider = createOpenAiProvider({
      apiKey: secret,
      fetchFn,
      sleep: async () => {},
      logger: silentLogger,
      baseUrl: "http://models.test/v1",
    });
    let message = "";
    try {
      await provider.complete({ ...request, tools: [] });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("[REDACTED]");
    expect(message.includes(secret)).toBe(false);
  });
});

describe("Anthropic provider", () => {
  it("lifts the system prompt and groups tool results", () => {
    const body = anthropicBody({ ...request, model: "claude-sonnet-4-5" });
    expect(body.system).toBe("Be exact.");
    expect(body.max_tokens).toBe(2048);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    const toolMessage = messages[2];
    expect(Array.isArray(toolMessage?.content)).toBe(true);
    expect(toolMessage?.content).toHaveLength(2);
    const parsed = parseAnthropicResponse(
      {
        model: "claude-sonnet-4-5",
        usage: { input_tokens: 8, output_tokens: 3 },
        content: [
          { type: "text", text: "Checking." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "search_companies",
            input: { query: "Northstar" },
          },
        ],
      },
      "claude-sonnet-4-5",
    );
    expect(parsed.content).toBe("Checking.");
    expect(parsed.toolCalls[0]?.arguments).toEqual({ query: "Northstar" });
  });

  it("scrubs the API key from a failed response", async () => {
    const secret = "anthropic-secret-key-value";
    const fetchFn: FetchLike = async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe(secret);
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      return new Response(JSON.stringify({ error: secret }), { status: 401 });
    };
    const provider = createAnthropicProvider({
      apiKey: secret,
      fetchFn,
      baseUrl: "http://models.test/v1",
    });
    await expect(
      provider.complete({
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
      }),
    ).rejects.toThrow(/credentials/);
  });
});
