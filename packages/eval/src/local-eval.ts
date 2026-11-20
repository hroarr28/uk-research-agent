import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Tracer } from "@opentelemetry/api";
import { runAgent, type ModelProvider, type ToolCatalog } from "@uk-research/agent";
import {
  callCompaniesHouseTool,
  companiesHouseToolNames,
  type CompaniesHouseClient,
} from "@uk-research/companies-house-mcp";
import { toolError, toolJson } from "@uk-research/contract";
import { callPoliceTool, policeToolNames, type PoliceClient } from "@uk-research/police-uk-mcp";
import type { GoldenTask } from "./golden/types.js";
import { judgeAnswer } from "./judge.js";
import { LOCAL_JUDGE_NOTE } from "./local-judge.js";
import { replayCatalog } from "./replay.js";
import type { TaskReport } from "./report.js";
import { scoreDeterministic } from "./score.js";

const companyNames = new Set<string>(companiesHouseToolNames());
const policeNames = new Set<string>(policeToolNames());

export type HardwareInfo = {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryGb: number;
  node: string;
};

export type LocalEvalMode = "live-recorded-tools" | "live-full";

export type LocalSummary = {
  mode: LocalEvalMode;
  complete: boolean;
  model: string;
  startedAt: string;
  updatedAt: string;
  hardware: HardwareInfo;
  judgeNote: string;
  expectedTaskCount: number;
  taskCount: number;
  passed: number;
  passRate: number;
  toolCallAccuracy: number;
  groundedness: number;
  meanJudgeScore: number;
  meanLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  tasks: TaskReport[];
};

type PartialState = {
  model: string;
  mode: LocalEvalMode;
  startedAt: string;
  tasks: Record<string, TaskReport>;
};

export function hardwareInfo(): HardwareInfo {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
  };
}

export function resultFileSlug(model: string): string {
  const slug = model.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "model";
}

export function liveToolCatalog(options: {
  task: GoldenTask;
  police?: PoliceClient;
  companies?: CompaniesHouseClient;
}): ToolCatalog {
  const recorded = replayCatalog(options.task);
  return {
    definitions: () => recorded.definitions(),
    async call(name, args) {
      if (policeNames.has(name) && options.police)
        return callPoliceTool(options.police, name, args);
      if (companyNames.has(name) && options.companies) {
        return callCompaniesHouseTool(options.companies, name, args);
      }
      if (!policeNames.has(name) && !companyNames.has(name)) {
        return toolJson(toolError("unknown_tool", `No tool named ${name}.`));
      }
      return recorded.call(name, args);
    },
  };
}

export async function runLocalEval(options: {
  tasks: GoldenTask[];
  provider: ModelProvider;
  model: string;
  tracer: Tracer;
  catalogFor: (task: GoldenTask) => ToolCatalog;
  partialPath: string;
  summaryPath: string;
  mode: LocalEvalMode;
  fresh?: boolean;
  hardware?: HardwareInfo;
  now?: () => Date;
  log?: (line: string) => void;
}): Promise<LocalSummary> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const hardware = options.hardware ?? hardwareInfo();
  if (options.fresh) await rm(options.partialPath, { force: true });
  const existing = options.fresh ? null : await readPartial(options.partialPath);
  const sameRun =
    existing !== null && existing.model === options.model && existing.mode === options.mode;
  const saved: Record<string, TaskReport> = sameRun ? { ...existing.tasks } : {};
  const startedAt = sameRun ? existing.startedAt : now().toISOString();
  if (existing && !sameRun) {
    log("Partial file is for a different model or mode. Starting a new run.");
  }

  for (const [index, task] of options.tasks.entries()) {
    const prior = saved[task.id];
    if (prior) {
      log(`skip ${index + 1}/${options.tasks.length} ${task.id} (already recorded)`);
      continue;
    }
    log(`run ${index + 1}/${options.tasks.length} ${task.id}`);
    const started = performance.now();
    const result = await runAgent({
      question: task.question,
      provider: options.provider,
      tools: options.catalogFor(task),
      tracer: options.tracer,
      model: options.model,
      limits: task.limits,
    });
    if (result.status === "model_error" && isUnreachable(result.answer)) {
      const summary = buildSummary({
        tasks: options.tasks,
        saved,
        mode: options.mode,
        model: options.model,
        startedAt,
        updatedAt: now().toISOString(),
        hardware,
      });
      await writeJson(options.summaryPath, summary);
      throw new Error(
        `Ollama is not reachable (${result.answer}). Completed tasks were kept. Re-run the same command to continue.`,
      );
    }
    let judge: { score: number; supported: boolean; reasons: string[] };
    try {
      judge = await judgeAnswer(options.provider, options.model, {
        question: task.question,
        answer: result.answer,
        toolOutputs: result.toolCalls.map((call) => call.output),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Judge failed.";
      if (isUnreachable(message)) {
        const summary = buildSummary({
          tasks: options.tasks,
          saved,
          mode: options.mode,
          model: options.model,
          startedAt,
          updatedAt: now().toISOString(),
          hardware,
        });
        await writeJson(options.summaryPath, summary);
        throw new Error(
          `Ollama is not reachable (${message}). Completed tasks were kept. Re-run the same command to continue.`,
        );
      }
      judge = { score: 1, supported: false, reasons: [message] };
    }
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
    saved[task.id] = {
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
    };
    await writeJson(options.partialPath, {
      model: options.model,
      mode: options.mode,
      startedAt,
      tasks: saved,
    } satisfies PartialState);
    log(
      `${saved[task.id]?.passed ? "pass" : "fail"} ${task.id} ${saved[task.id]?.latencyMs ?? 0} ms`,
    );
  }

  const summary = buildSummary({
    tasks: options.tasks,
    saved,
    mode: options.mode,
    model: options.model,
    startedAt,
    updatedAt: now().toISOString(),
    hardware,
  });
  await writeJson(options.summaryPath, summary);
  return summary;
}

function buildSummary(input: {
  tasks: GoldenTask[];
  saved: Record<string, TaskReport>;
  mode: LocalEvalMode;
  model: string;
  startedAt: string;
  updatedAt: string;
  hardware: HardwareInfo;
}): LocalSummary {
  const tasks = input.tasks.flatMap((task) => {
    const report = input.saved[task.id];
    return report ? [report] : [];
  });
  const count = tasks.length;
  const mean = (pick: (task: TaskReport) => number) =>
    count === 0 ? 0 : tasks.reduce((sum, task) => sum + pick(task), 0) / count;
  const passed = tasks.filter((task) => task.passed).length;
  return {
    mode: input.mode,
    complete: count === input.tasks.length,
    model: input.model,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    hardware: input.hardware,
    judgeNote: LOCAL_JUDGE_NOTE,
    expectedTaskCount: input.tasks.length,
    taskCount: count,
    passed,
    passRate: round(count === 0 ? 0 : passed / count),
    toolCallAccuracy: round(mean((task) => task.toolCallAccuracy)),
    groundedness: round(mean((task) => task.groundedness)),
    meanJudgeScore: round(mean((task) => task.judgeScore)),
    meanLatencyMs: round(mean((task) => task.latencyMs)),
    totalInputTokens: tasks.reduce((sum, task) => sum + task.inputTokens, 0),
    totalOutputTokens: tasks.reduce((sum, task) => sum + task.outputTokens, 0),
    totalEstimatedCostUsd: round(tasks.reduce((sum, task) => sum + task.estimatedCostUsd, 0)),
    tasks,
  };
}

async function readPartial(file: string): Promise<PartialState | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as PartialState;
    if (!parsed || typeof parsed.model !== "string" || typeof parsed.tasks !== "object")
      return null;
    if (parsed.mode !== "live-recorded-tools" && parsed.mode !== "live-full") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

function isUnreachable(text: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network request failed|socket hang up/i.test(
    text,
  );
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
