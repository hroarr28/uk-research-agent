import { describe, expect, it } from "vitest";
import type { FetchLike } from "@uk-research/http";
import { createOllamaProvider, ollamaBody } from "./ollama.js";
import type { CompletionRequest } from "./types.js";

const request: CompletionRequest = {
  model: "gemma4:31b",
  tools: [
    {
      name: "search_companies",
      description: "Search the register",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    },
  ],
  messages: [
    { role: "system", content: "Be exact." },
    { role: "user", content: "Find Northstar" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "c1", name: "search_companies", arguments: { query: "NORTHSTAR ANALYTICS LTD" } },
      ],
    },
    { role: "tool", toolCallId: "c1", name: "search_companies", content: '{"ok":true}' },
  ],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Ollama provider", () => {
  it("posts to the native chat API and accepts object arguments", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn: FetchLike = async (url, init) => {
      expect(url).toBe("http://127.0.0.1:11434/api/chat");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json({
        model: "gemma4:31b",
        prompt_eval_count: 20,
        eval_count: 8,
        message: {
          content: "",
          tool_calls: [
            {
              function: {
                name: "search_companies",
                arguments: { query: "NORTHSTAR ANALYTICS LTD" },
              },
            },
          ],
        },
      });
    };
    const provider = createOllamaProvider({ fetchFn });
    const response = await provider.complete(request);
    expect(provider.local).toBe(true);
    expect(response.toolCalls[0]?.arguments).toEqual({ query: "NORTHSTAR ANALYTICS LTD" });
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(response.model).toBe("gemma4:31b");
    expect(bodies[0]?.stream).toBe(false);
    const messages = bodies[0]?.messages as Array<Record<string, unknown>>;
    expect(messages[3]).toMatchObject({ role: "tool", tool_name: "search_companies" });
    expect(ollamaBody(request).tools).toHaveLength(1);
  });

  it("retries once when arguments are not JSON, then accepts the corrected call", async () => {
    const seen: string[] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content?: string }> };
      seen.push(body.messages.map((message) => message.content ?? "").join("\n"));
      if (seen.length === 1) {
        return json({
          model: "gemma4:31b",
          prompt_eval_count: 10,
          eval_count: 4,
          message: {
            content: "",
            tool_calls: [{ function: { name: "search_companies", arguments: "not-json" } }],
          },
        });
      }
      return json({
        model: "gemma4:31b",
        prompt_eval_count: 12,
        eval_count: 6,
        message: {
          content: "",
          tool_calls: [
            {
              function: {
                name: "search_companies",
                arguments: '{"query":"NORTHSTAR ANALYTICS LTD"}',
              },
            },
          ],
        },
      });
    };
    const provider = createOllamaProvider({ fetchFn, sleep: async () => {} });
    const response = await provider.complete({
      model: "gemma4:31b",
      tools: request.tools,
      messages: [{ role: "user", content: "Find Northstar" }],
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("not valid JSON");
    expect(response.toolCalls[0]?.arguments).toEqual({ query: "NORTHSTAR ANALYTICS LTD" });
    expect(response.usage).toEqual({ inputTokens: 22, outputTokens: 10 });
  });

  it("fails cleanly when the retry is still malformed", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      return json({
        model: "gemma4:31b",
        message: { tool_calls: [{ function: { name: "", arguments: [] } }] },
      });
    };
    const provider = createOllamaProvider({ fetchFn });
    await expect(
      provider.complete({
        model: "gemma4:31b",
        tools: [],
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow(/after one retry/);
    expect(calls).toBe(2);
  });

  it("uses a thinking trace only when the message has no content and no tool call", async () => {
    const fetchFn: FetchLike = async () =>
      json({
        model: "gemma4:31b",
        prompt_eval_count: 3,
        eval_count: 2,
        message: { content: "", thinking: "The register has no weather feed." },
      });
    const provider = createOllamaProvider({ fetchFn });
    const response = await provider.complete({
      model: "gemma4:31b",
      tools: [],
      messages: [{ role: "user", content: "Weather?" }],
    });
    expect(response.content).toBe("The register has no weather feed.");
    expect(response.toolCalls).toEqual([]);
  });
});
