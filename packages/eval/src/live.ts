import type { Tracer } from "@opentelemetry/api";
import { runAgent, type ModelProvider, type ToolCatalog } from "@uk-research/agent";
import { judgeAnswer } from "./judge.js";
import type { EvalReport, TaskReport } from "./report.js";
import { scoreLiveTools, scoreNumbers, type DeterministicScore } from "./score.js";

export type LiveTask = {
  id: string;
  question: string;
  expectedTools: Array<{ name: string; args?: Record<string, unknown> }>;
  requires: "police" | "companies-house";
};

export const liveSmokeTasks: LiveTask[] = [
  {
    id: "live-police-leicester",
    question:
      "Using the Police UK street-level tool, how many crimes were recorded within a mile of latitude 52.6369, longitude -1.1398 in 2026-08, and which category was most common? Cite the month and the tool.",
    expectedTools: [
      { name: "summarise_street_crime", args: { lat: 52.6369, lng: -1.1398, date: "2026-08" } },
    ],
    requires: "police",
  },
  {
    id: "live-companies-search",
    question:
      "Search Companies House for NORTHSTAR ANALYTICS LTD. Report the company number of the first match if one is returned. If the tool returns no matches or an error, say so and do not invent a company number.",
    expectedTools: [{ name: "search_companies", args: { query: "NORTHSTAR ANALYTICS LTD" } }],
    requires: "companies-house",
  },
];

export function scoreLiveRun(input: {
  question: string;
  answer: string;
  status: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; output: string }>;
  expectedTools: LiveTask["expectedTools"];
  judge: { score: number; supported: boolean };
}): DeterministicScore {
  const failures: string[] = [];
  if (input.status !== "completed") failures.push(`status ${input.status} != completed`);
  const toolCallAccuracy = scoreLiveTools(input.expectedTools, input.toolCalls);
  if (toolCallAccuracy !== 1) failures.push(`tool accuracy ${toolCallAccuracy}`);
  const outputs = input.toolCalls.map((call) => call.output);
  const numbers = scoreNumbers(input.question, input.answer, outputs);
  if (numbers.score !== 1) failures.push(`unsupported numbers: ${numbers.unsupported.join("|")}`);
  const missingCitations = [...new Set(input.expectedTools.map((tool) => tool.name))].filter(
    (name) => !input.answer.includes(name),
  );
  if (missingCitations.length > 0)
    failures.push(`missing citations: ${missingCitations.join("|")}`);
  if (input.judge.score < 4 || !input.judge.supported) failures.push("judge below threshold");
  return {
    passed: failures.length === 0,
    toolCallAccuracy,
    groundedness: numbers.score,
    numericGroundedness: numbers.score,
    failures,
  };
}

export async function runLiveTasks(options: {
  tasks: LiveTask[];
  provider: ModelProvider;
  tools: ToolCatalog;
  tracer: Tracer;
  model: string;
  secrets?: readonly string[];
}): Promise<EvalReport> {
  const reports: TaskReport[] = [];
  for (const task of options.tasks) {
    const started = performance.now();
    const result = await runAgent({
      question: task.question,
      provider: options.provider,
      tools: options.tools,
      tracer: options.tracer,
      model: options.model,
      secrets: options.secrets,
    });
    const judge = await judgeAnswer(options.provider, options.model, {
      question: task.question,
      answer: result.answer,
      toolOutputs: result.toolCalls.map((call) => call.output),
    });
    const score = scoreLiveRun({
      question: task.question,
      answer: result.answer,
      status: result.status,
      toolCalls: result.toolCalls,
      expectedTools: task.expectedTools,
      judge,
    });
    reports.push({
      id: task.id,
      passed: score.passed,
      status: result.status,
      toolCallAccuracy: score.toolCallAccuracy,
      groundedness: score.groundedness,
      judgeScore: judge.score,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.estimatedCostUsd,
      latencyMs: Math.round(performance.now() - started),
      failures: score.failures,
    });
  }
  return { mode: "live", tasks: reports };
}
