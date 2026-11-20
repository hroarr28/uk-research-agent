import { describe, expect, it } from "vitest";
import { createTracing } from "@uk-research/tracing";
import { boundToolOutput } from "./output.js";
import { runAgent } from "./loop.js";
import { ScriptedModel } from "./scripted.js";
import type { CompletionResponse, ToolCatalog } from "./types.js";

const usage = { inputTokens: 400, outputTokens: 80 };

function response(
  partial: Partial<CompletionResponse> & Pick<CompletionResponse, "content" | "toolCalls">,
): CompletionResponse {
  return { usage, model: "gpt-5-mini", ...partial };
}

function catalog(
  impl: (name: string, args: Record<string, unknown>) => string | Promise<string>,
): ToolCatalog {
  return {
    definitions: () => [
      { name: "search_companies", description: "Search", inputSchema: { type: "object" } },
    ],
    call: (name, args) => Promise.resolve(impl(name, args)),
  };
}

async function run(options: {
  responses: CompletionResponse[];
  tools?: ToolCatalog;
  limits?: { maxSteps?: number; maxTotalTokens?: number; maxCostUsd?: number };
  question?: string;
  secrets?: string[];
}) {
  const tracing = createTracing({ secrets: options.secrets });
  const provider = new ScriptedModel(options.responses);
  const result = await runAgent({
    question: options.question ?? "Find Northstar",
    provider,
    tools: options.tools ?? catalog(() => '{"ok":true,"data":{"companyNumber":"12345678"}}'),
    tracer: tracing.tracer,
    model: "gpt-5-mini",
    limits: options.limits,
    secrets: options.secrets,
  });
  await tracing.provider.shutdown();
  return { result, provider, spans: tracing.spans };
}

describe("runAgent", () => {
  it("returns a direct answer without a sources footer", async () => {
    const { result, provider } = await run({
      responses: [response({ content: "I cannot answer that from these tools.", toolCalls: [] })],
    });
    expect(result.status).toBe("completed");
    expect(result.answer).toBe("I cannot answer that from these tools.");
    expect(result.steps).toBe(1);
    expect(result.usage.estimatedCostUsd).toBe(0.00026);
    expect(provider.requests[0]?.tools[0]?.name).toBe("search_companies");
    expect(provider.requests[0]?.messages[0]?.role).toBe("system");
  });

  it("calls tools, then cites them", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { result, spans } = await run({
      tools: catalog((name, args) => {
        seen.push({ name, ...args });
        return '{"ok":true,"data":{"companyNumber":"12345678"}}';
      }),
      responses: [
        response({
          content: "",
          toolCalls: [
            { id: "c1", name: "search_companies", arguments: { query: "Northstar" } },
            { id: "c2", name: "get_company_profile", arguments: { companyNumber: "12345678" } },
          ],
        }),
        response({ content: "NORTHSTAR ANALYTICS LTD is 12345678.", toolCalls: [] }),
      ],
    });
    expect(seen.map((call) => call.name)).toEqual(["search_companies", "get_company_profile"]);
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("12345678");
    expect(result.answer).toContain("Sources:\n- search_companies\n- get_company_profile");
    expect(result.usage.inputTokens).toBe(800);
    const names = spans.map((span) => span.name);
    expect(names).toContain("llm.chat");
    expect(names).toContain("tool.call");
    const llm = spans.find((span) => span.name === "llm.chat");
    expect(llm?.attributes["gen_ai.usage.input_tokens"]).toBe(400);
    expect(llm?.attributes["agent.estimated_cost_usd"]).toBe(0.00026);
  });

  it("returns a tool exception to the model instead of crashing", async () => {
    const { result } = await run({
      tools: catalog(() => {
        throw new Error("socket down");
      }),
      responses: [
        response({
          content: "",
          toolCalls: [{ id: "c1", name: "search_companies", arguments: { query: "x" } }],
        }),
        response({ content: "The search failed.", toolCalls: [] }),
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]?.ok).toBe(false);
    expect(result.toolCalls[0]?.output).toContain("tool_failed");
    expect(result.answer).toContain("The search failed.");
  });

  it("stops at the step limit after executing the tool", async () => {
    const { result, provider } = await run({
      limits: { maxSteps: 1 },
      responses: [
        response({
          content: "",
          toolCalls: [{ id: "c1", name: "search_companies", arguments: { query: "Northstar" } }],
        }),
        response({ content: "should not run", toolCalls: [] }),
      ],
    });
    expect(result.status).toBe("step_limit");
    expect(result.answer).toContain("step limit");
    expect(result.answer).toContain("12345678");
    expect(provider.requests).toHaveLength(1);
    expect(result.toolCalls).toHaveLength(1);
  });

  it("stops when the cost or token budget is spent", async () => {
    const expensive = response({
      content: "",
      toolCalls: [{ id: "c1", name: "search_companies", arguments: { query: "Northstar" } }],
      usage: { inputTokens: 5000, outputTokens: 1000 },
    });
    const cost = await run({ limits: { maxCostUsd: 0.001 }, responses: [expensive] });
    expect(cost.result.status).toBe("budget_exceeded");
    expect(cost.result.answer).toContain("cost budget");
    expect(cost.provider.requests).toHaveLength(1);

    const tokens = await run({
      limits: { maxTotalTokens: 100 },
      responses: [
        response({
          content: "",
          toolCalls: [{ id: "c1", name: "search_companies", arguments: { query: "Northstar" } }],
        }),
      ],
    });
    expect(tokens.result.status).toBe("budget_exceeded");
    expect(tokens.result.answer).toContain("token budget");
  });

  it("scrubs a provider error and records it on the trace", async () => {
    const secret = "super-secret-key-value";
    const { result, spans } = await run({
      question: `lookup ${secret}`,
      secrets: [secret],
      responses: [],
    });
    expect(result.status).toBe("model_error");
    expect(result.answer).toContain("model error");
    expect(result.answer.includes(secret)).toBe(false);
    expect(JSON.stringify(spans).includes(secret)).toBe(false);
    const root = spans.find((span) => span.name === "agent.run");
    expect(root?.attributes["agent.status"]).toBe("model_error");
    expect(root?.status).toBe("error");
  });

  it("feeds one invalid tool call back, then stops if the next call is also invalid", async () => {
    const invalid = '{"ok":false,"error":{"code":"invalid_input","message":"query: too short"}}';
    const recovered = await run({
      tools: catalog(() => invalid),
      responses: [
        response({
          content: "",
          toolCalls: [{ id: "c1", name: "search_companies", arguments: { query: "x" } }],
        }),
        response({ content: "The query was rejected.", toolCalls: [] }),
      ],
    });
    expect(recovered.result.status).toBe("completed");
    expect(recovered.provider.requests).toHaveLength(2);

    const stuck = await run({
      tools: catalog(() => invalid),
      responses: [
        response({
          content: "",
          toolCalls: [{ id: "c1", name: "search_companies", arguments: { query: "x" } }],
        }),
        response({
          content: "",
          toolCalls: [{ id: "c2", name: "search_companies", arguments: { query: "y" } }],
        }),
        response({ content: "should not be asked", toolCalls: [] }),
      ],
    });
    expect(stuck.result.status).toBe("model_error");
    expect(stuck.result.answer).toContain("schema validation after one retry");
    expect(stuck.provider.requests).toHaveLength(2);
  });

  it("records a local model at zero dollars while keeping the token counts", async () => {
    const tracing = createTracing();
    const result = await runAgent({
      question: "Hi",
      provider: {
        id: "ollama",
        local: true,
        async complete() {
          return {
            content: "Hello",
            toolCalls: [],
            usage: { inputTokens: 1000, outputTokens: 50 },
            model: "gemma4:31b",
          };
        },
      },
      tools: catalog(() => "{}"),
      tracer: tracing.tracer,
      model: "gemma4:31b",
    });
    await tracing.provider.shutdown();
    expect(result.usage.estimatedCostUsd).toBe(0);
    expect(result.usage.priceKnown).toBe(true);
    expect(result.usage.inputTokens).toBe(1000);
    expect(result.usage.outputTokens).toBe(50);
  });
});

describe("boundToolOutput", () => {
  it("truncates oversized tool output", () => {
    expect(boundToolOutput("abcdef", 3)).toBe("abc\n[truncated]");
  });
});
