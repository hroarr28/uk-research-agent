import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTracing } from "@uk-research/tracing";
import { loadGoldenTasks } from "./golden/tasks.js";
import { runGoldenReplay } from "./replay.js";
import { renderMarkdown, stableSummary } from "./report.js";
import { JUDGE_RUBRIC } from "./rubric.js";

describe("replay eval", () => {
  it("passes every golden task offline and writes a latency-free summary", async () => {
    const tasks = loadGoldenTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(20);
    expect(tasks.length).toBeLessThanOrEqual(40);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
    expect(JUDGE_RUBRIC).toContain("Return JSON only");

    const tracing = createTracing();
    const report = await runGoldenReplay({ tracer: tracing.tracer, tasks });
    await tracing.provider.shutdown();
    const failed = report.tasks
      .filter((task) => !task.passed)
      .map((task) => ({ id: task.id, failures: task.failures }));
    expect(failed).toEqual([]);
    expect(
      tracing.spans.some(
        (span) => span.name === "llm.chat" && span.attributes["gen_ai.usage.input_tokens"] === 400,
      ),
    ).toBe(true);

    const stable = stableSummary(report);
    expect(JSON.stringify(stable)).not.toContain("latency");
    expect(stable.passRate).toBe(1);
    expect(stable.toolCallAccuracy).toBe(1);
    expect(stable.groundedness).toBe(1);
    expect(renderMarkdown(stable)).toContain("replay mode");
    expect(renderMarkdown(stable)).toContain(tasks[0]?.id ?? "");
  });

  it("keeps the recorded burglary filter consistent with the all-crime breakdown", () => {
    const snapshot = JSON.parse(readFileSync(snapshotPath(), "utf8")) as {
      summaries: Record<
        string,
        { total: number; byCategory: Array<{ category: string; count: number }> }
      >;
    };
    const all = snapshot.summaries["leicester-2026-08"];
    const filtered = snapshot.summaries["leicester-2026-08-burglary"];
    const burglary = all?.byCategory.find((item) => item.category === "burglary");
    expect(burglary?.count).toBe(filtered?.total);
  });
});

function snapshotPath(): string {
  return path.resolve("evals/fixtures/police-recorded.json");
}
