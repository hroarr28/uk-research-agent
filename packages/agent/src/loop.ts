import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { toolError, toolJson } from "@uk-research/contract";
import { scrub } from "@uk-research/http";
import { withSpan } from "@uk-research/tracing";
import { boundToolOutput, outputIsOk } from "./output.js";
import { estimateCost, roundCost } from "./prices.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import type {
  AgentLimits,
  AgentResult,
  AgentStatus,
  AgentToolCall,
  CompletionResponse,
  ModelMessage,
  ModelProvider,
  ToolCatalog,
} from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";

export type RunAgentInput = {
  question: string;
  provider: ModelProvider;
  tools: ToolCatalog;
  tracer: Tracer;
  model: string;
  limits?: Partial<AgentLimits>;
  secrets?: readonly string[];
  systemPrompt?: string;
};

type StepOutcome =
  { type: "model_error"; message: string } | { type: "final"; text: string } | { type: "continue" };

export async function runAgent(input: RunAgentInput): Promise<AgentResult> {
  const limits: AgentLimits = { ...DEFAULT_LIMITS, ...input.limits };
  const secrets = input.secrets ?? [];
  const messages: ModelMessage[] = [
    { role: "system", content: input.systemPrompt ?? SYSTEM_PROMPT },
    { role: "user", content: input.question },
  ];
  const toolCalls: AgentToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let priceKnown = true;
  let steps = 0;
  let modelUsed: string | null = null;

  return withSpan(
    input.tracer,
    "agent.run",
    {
      "agent.question": scrub(input.question, secrets).slice(0, 500),
      "agent.max_steps": limits.maxSteps,
      "agent.max_total_tokens": limits.maxTotalTokens,
      "agent.max_cost_usd": limits.maxCostUsd,
      "gen_ai.request.model": input.model,
    },
    async (root) => {
      const finish = (status: AgentStatus, answer: string): AgentResult => {
        root.setAttribute("agent.status", status);
        root.setAttribute("agent.steps", steps);
        root.setAttribute("gen_ai.usage.input_tokens", inputTokens);
        root.setAttribute("gen_ai.usage.output_tokens", outputTokens);
        root.setAttribute("agent.estimated_cost_usd", roundCost(estimatedCostUsd));
        root.setAttribute("agent.price_known", priceKnown);
        root.setStatus({
          code: status === "model_error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });
        return {
          status,
          answer: appendSources(answer, toolCalls),
          model: modelUsed,
          steps,
          toolCalls,
          usage: {
            inputTokens,
            outputTokens,
            estimatedCostUsd: roundCost(estimatedCostUsd),
            priceKnown,
          },
          traceId: root.spanContext().traceId,
        };
      };

      for (;;) {
        if (steps >= limits.maxSteps)
          return finish("step_limit", stopText("step limit", toolCalls));
        if (inputTokens + outputTokens >= limits.maxTotalTokens) {
          return finish("budget_exceeded", stopText("token budget", toolCalls));
        }
        if (estimatedCostUsd >= limits.maxCostUsd) {
          return finish("budget_exceeded", stopText("cost budget", toolCalls));
        }

        const outcome = await withSpan(
          input.tracer,
          "agent.step",
          { "agent.step.index": steps + 1 },
          async () =>
            runStep({
              input,
              secrets,
              messages,
              toolCalls,
              onCompletion: (completion) => {
                steps += 1;
                modelUsed = completion.model || input.model;
                inputTokens += completion.usage.inputTokens;
                outputTokens += completion.usage.outputTokens;
                const cost = estimateCost(modelUsed, completion.usage);
                estimatedCostUsd += cost.usd;
                priceKnown = priceKnown && cost.priceKnown;
              },
            }),
        );
        if (outcome.type === "model_error")
          return finish("model_error", `Stopped: model error. ${outcome.message}`);
        if (outcome.type === "final") return finish("completed", outcome.text);
      }
    },
  );
}

async function runStep(args: {
  input: RunAgentInput;
  secrets: readonly string[];
  messages: ModelMessage[];
  toolCalls: AgentToolCall[];
  onCompletion: (completion: CompletionResponse) => void;
}): Promise<StepOutcome> {
  let completion: CompletionResponse;
  try {
    completion = await withSpan(
      args.input.tracer,
      "llm.chat",
      {
        "gen_ai.operation.name": "chat",
        "gen_ai.system": args.input.provider.id,
        "gen_ai.request.model": args.input.model,
      },
      async (span) => {
        const started = performance.now();
        const value = await args.input.provider.complete({
          model: args.input.model,
          messages: args.messages,
          tools: args.input.tools.definitions(),
        });
        const cost = estimateCost(value.model || args.input.model, value.usage);
        span.setAttribute("gen_ai.request.model", value.model || args.input.model);
        span.setAttribute("gen_ai.usage.input_tokens", value.usage.inputTokens);
        span.setAttribute("gen_ai.usage.output_tokens", value.usage.outputTokens);
        span.setAttribute("agent.estimated_cost_usd", roundCost(cost.usd));
        span.setAttribute("agent.price_known", cost.priceKnown);
        span.setAttribute("agent.latency_ms", Math.round(performance.now() - started));
        span.setStatus({ code: SpanStatusCode.OK });
        return value;
      },
    );
  } catch (error) {
    return {
      type: "model_error",
      message: scrub(error instanceof Error ? error.message : "Model call failed.", args.secrets),
    };
  }

  args.onCompletion(completion);
  args.messages.push({
    role: "assistant",
    content: completion.content,
    toolCalls: completion.toolCalls,
  });
  if (completion.toolCalls.length === 0) return { type: "final", text: completion.content };

  for (const call of completion.toolCalls) {
    const executed = await withSpan(
      args.input.tracer,
      "tool.call",
      {
        "tool.name": call.name,
        "tool.arguments": scrub(JSON.stringify(call.arguments), args.secrets).slice(0, 500),
      },
      async (span) => {
        const started = performance.now();
        let text: string;
        try {
          text = boundToolOutput(await args.input.tools.call(call.name, call.arguments));
        } catch (error) {
          const message = scrub(
            error instanceof Error ? error.message : "Tool call failed.",
            args.secrets,
          );
          text = toolJson(toolError("tool_failed", message));
        }
        const ok = outputIsOk(text);
        span.setAttribute("tool.success", ok);
        span.setAttribute("agent.latency_ms", Math.round(performance.now() - started));
        span.setAttribute("tool.output_preview", scrub(text, args.secrets).slice(0, 300));
        span.setStatus({ code: SpanStatusCode.OK });
        return { text, ok };
      },
    );
    args.toolCalls.push({
      name: call.name,
      arguments: call.arguments,
      output: executed.text,
      ok: executed.ok,
    });
    args.messages.push({
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: executed.text,
    });
  }
  return { type: "continue" };
}

function stopText(
  reason: "step limit" | "token budget" | "cost budget",
  calls: readonly AgentToolCall[],
): string {
  const lead = `Stopped: ${reason} reached before a final answer.`;
  if (calls.length === 0) return lead;
  return `${lead}\n\nTool results already retrieved:\n${calls.map((call) => call.output).join("\n")}`;
}

function appendSources(answer: string, calls: readonly AgentToolCall[]): string {
  const names = [...new Set(calls.map((call) => call.name))];
  if (names.length === 0) return answer;
  return `${answer.trim()}\n\nSources:\n${names.map((name) => `- ${name}`).join("\n")}`;
}
