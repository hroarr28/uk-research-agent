import type { Tracer } from "@opentelemetry/api";
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  ScriptedModel,
  type CompletionResponse,
  type ToolCatalog,
} from "@uk-research/agent";
import {
  companiesHouseToolDefinitions,
  companiesHouseToolNames,
  explainInvalidCompaniesHouseArgs,
} from "@uk-research/companies-house-mcp";
import { toolError, toolJson, type ToolResult } from "@uk-research/contract";
import {
  explainInvalidPoliceArgs,
  policeToolDefinitions,
  policeToolNames,
} from "@uk-research/police-uk-mcp";
import { loadGoldenTasks } from "./golden/tasks.js";
import type { GoldenTask } from "./golden/types.js";
import { judgeSchema } from "./judge.js";
import type { EvalReport, TaskReport } from "./report.js";
import { canonical, scoreDeterministic } from "./score.js";

const companyNames = new Set<string>(companiesHouseToolNames());
const policeNames = new Set<string>(policeToolNames());

export function researchToolDefinitions() {
  return [...companiesHouseToolDefinitions, ...policeToolDefinitions];
}

export function rejectionFor(name: string, args: unknown): string | undefined {
  const companyIssue = explainInvalidCompaniesHouseArgs(name, args);
  if (companyIssue) return toolJson(toolError("invalid_input", companyIssue));
  if (companyNames.has(name)) return undefined;
  const policeIssue = explainInvalidPoliceArgs(name, args);
  if (policeIssue) return toolJson(toolError("invalid_input", policeIssue));
  if (policeNames.has(name)) return undefined;
  return toolJson(toolError("unknown_tool", `No tool named ${name}.`));
}

export function scriptedResponses(task: GoldenTask): CompletionResponse[] {
  let sequence = 0;
  return task.turns.map((turn) => {
    if ("answer" in turn) {
      return {
        content: turn.answer,
        toolCalls: [],
        usage: turn.usage,
        model: DEFAULT_OPENAI_MODEL,
      };
    }
    return {
      content: "",
      toolCalls: turn.toolCalls.map((call) => {
        sequence += 1;
        return { id: `call_${sequence}`, name: call.name, arguments: call.args };
      }),
      usage: turn.usage,
      model: DEFAULT_OPENAI_MODEL,
    };
  });
}

export function replayCatalog(task: GoldenTask): ToolCatalog {
  const queues = new Map<string, ToolResult<unknown>[]>();
  for (const turn of task.turns) {
    if (!("toolCalls" in turn)) continue;
    for (const call of turn.toolCalls) {
      const key = `${call.name}:${canonical(call.args)}`;
      const list = queues.get(key) ?? [];
      list.push(call.result);
      queues.set(key, list);
    }
  }
  return {
    definitions: () => researchToolDefinitions(),
    async call(name, args) {
      const rejected = rejectionFor(name, args);
      if (rejected) return rejected;
      const queue = queues.get(`${name}:${canonical(args)}`);
      const result = queue?.shift();
      if (!result)
        return toolJson(
          toolError("fixture_miss", `No recorded ${name} result for these arguments.`),
        );
      return toolJson(result);
    },
  };
}

export async function runGoldenTask(
  task: GoldenTask,
  tracer: Tracer,
): Promise<{ report: TaskReport; answer: string }> {
  const provider = new ScriptedModel(scriptedResponses(task));
  const started = performance.now();
  const result = await runAgent({
    question: task.question,
    provider,
    tools: replayCatalog(task),
    tracer,
    model: DEFAULT_OPENAI_MODEL,
    limits: task.limits,
    secrets: [],
  });
  const latencyMs = Math.round(performance.now() - started);
  const judge = judgeSchema.parse(task.judge);
  const score = scoreDeterministic({
    question: task.question,
    answer: result.answer,
    status: result.status,
    expectedStatus: task.expectedStatus,
    expectedTools: task.expectedTools,
    order: task.order,
    requiredFacts: task.requiredFacts,
    answerIncludes: task.answerIncludes,
    forbiddenClaims: task.forbiddenClaims,
    checkNumbers: task.checkNumbers,
    toolCalls: result.toolCalls,
    judge,
  });
  return {
    answer: result.answer,
    report: {
      id: task.id,
      passed: score.passed,
      status: result.status,
      toolCallAccuracy: score.toolCallAccuracy,
      groundedness: score.groundedness,
      judgeScore: judge.score,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.estimatedCostUsd,
      latencyMs,
      failures: score.failures,
    },
  };
}

export async function runGoldenReplay(options: {
  tracer: Tracer;
  tasks?: GoldenTask[];
}): Promise<EvalReport> {
  const tasks = options.tasks ?? loadGoldenTasks();
  const reports: TaskReport[] = [];
  for (const task of tasks) {
    reports.push((await runGoldenTask(task, options.tracer)).report);
  }
  return { mode: "replay", tasks: reports };
}
