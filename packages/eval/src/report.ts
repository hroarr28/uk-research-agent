export type TaskReport = {
  id: string;
  passed: boolean;
  status: string;
  toolCallAccuracy: number;
  groundedness: number;
  judgeScore: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  failures: string[];
};

export type EvalReport = {
  mode: "replay" | "live";
  tasks: TaskReport[];
};

export type StableSummary = {
  mode: "replay" | "live";
  taskCount: number;
  passed: number;
  passRate: number;
  toolCallAccuracy: number;
  groundedness: number;
  meanJudgeScore: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  tasks: Array<Omit<TaskReport, "status" | "latencyMs">>;
};

export function summarise(report: EvalReport) {
  const count = report.tasks.length;
  const mean = (pick: (task: TaskReport) => number) =>
    count === 0 ? 0 : report.tasks.reduce((sum, task) => sum + pick(task), 0) / count;
  return {
    mode: report.mode,
    taskCount: count,
    passed: report.tasks.filter((task) => task.passed).length,
    passRate: count === 0 ? 0 : report.tasks.filter((task) => task.passed).length / count,
    toolCallAccuracy: mean((task) => task.toolCallAccuracy),
    groundedness: mean((task) => task.groundedness),
    meanJudgeScore: mean((task) => task.judgeScore),
    totalInputTokens: report.tasks.reduce((sum, task) => sum + task.inputTokens, 0),
    totalOutputTokens: report.tasks.reduce((sum, task) => sum + task.outputTokens, 0),
    totalEstimatedCostUsd: report.tasks.reduce((sum, task) => sum + task.estimatedCostUsd, 0),
    meanLatencyMs: mean((task) => task.latencyMs),
    tasks: report.tasks,
  };
}

export function stableSummary(report: EvalReport): StableSummary {
  const full = summarise(report);
  return {
    mode: full.mode,
    taskCount: full.taskCount,
    passed: full.passed,
    passRate: round(full.passRate),
    toolCallAccuracy: round(full.toolCallAccuracy),
    groundedness: round(full.groundedness),
    meanJudgeScore: round(full.meanJudgeScore),
    totalInputTokens: full.totalInputTokens,
    totalOutputTokens: full.totalOutputTokens,
    totalEstimatedCostUsd: round(full.totalEstimatedCostUsd),
    tasks: full.tasks.map((task) => ({
      id: task.id,
      passed: task.passed,
      toolCallAccuracy: round(task.toolCallAccuracy),
      groundedness: round(task.groundedness),
      judgeScore: task.judgeScore,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCostUsd: round(task.estimatedCostUsd),
      failures: task.failures,
    })),
  };
}

export function renderMarkdown(summary: StableSummary): string {
  const intro =
    summary.mode === "replay"
      ? "These figures are from replay mode. Tool responses and model responses are recorded fixtures, so this run does not call a model provider or a public API."
      : "These figures are from live mode. They depend on the model provider and the public APIs.";
  const lines = [
    `# Eval report (${summary.mode})`,
    "",
    intro,
    "",
    `- Tasks: ${summary.taskCount}`,
    `- Passed: ${summary.passed}`,
    `- Pass rate: ${summary.passRate}`,
    `- Mean tool-call accuracy: ${summary.toolCallAccuracy}`,
    `- Mean groundedness: ${summary.groundedness}`,
    `- Mean judge score: ${summary.meanJudgeScore}`,
    `- Total input tokens: ${summary.totalInputTokens}`,
    `- Total output tokens: ${summary.totalOutputTokens}`,
    `- Total estimated cost: $${summary.totalEstimatedCostUsd}`,
    "",
    "Latency is printed by the command and is not stored in this file, because it varies by machine.",
    "",
    "| Task | Pass | Tool accuracy | Groundedness | Judge | Estimated cost |",
    "| --- | --- | --- | --- | --- | --- |",
    ...summary.tasks.map(
      (task) =>
        `| ${task.id} | ${task.passed ? "yes" : "no"} | ${task.toolCallAccuracy} | ${task.groundedness} | ${task.judgeScore} | $${task.estimatedCostUsd} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
