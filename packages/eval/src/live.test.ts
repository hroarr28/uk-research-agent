import { describe, expect, it } from "vitest";
import { ScriptedModel, type ToolCatalog } from "@uk-research/agent";
import { createTracing } from "@uk-research/tracing";
import { runLiveTasks, scoreLiveRun } from "./live.js";

const usage = { inputTokens: 20, outputTokens: 10 };

describe("live scoring", () => {
  it("accepts a grounded answer and rejects an invented number", () => {
    const common = {
      question: "What was the 2026-08 total?",
      status: "completed",
      expectedTools: [{ name: "summarise_street_crime", args: { date: "2026-08" } }],
      toolCalls: [
        {
          name: "summarise_street_crime",
          arguments: { date: "2026-08", lat: 52.6 },
          output: '{"ok":true,"data":{"total":5,"date":"2026-08"}}',
        },
      ],
      judge: { score: 5, supported: true },
    };
    expect(
      scoreLiveRun({
        ...common,
        answer: "The 2026-08 total was 5.\n\nSources:\n- summarise_street_crime",
      }).passed,
    ).toBe(true);
    expect(
      scoreLiveRun({
        ...common,
        answer: "The 2026-08 total was 99.\n\nSources:\n- summarise_street_crime",
      }).passed,
    ).toBe(false);
  });

  it("runs a scripted live task through the judge", async () => {
    const tracing = createTracing();
    const provider = new ScriptedModel([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "summarise_street_crime", arguments: { date: "2026-08" } }],
        usage,
        model: "gpt-5-mini",
      },
      {
        content: "The 2026-08 total was 5.\n\nSources:\n- summarise_street_crime",
        toolCalls: [],
        usage,
        model: "gpt-5-mini",
      },
      {
        content: '{"score":5,"supported":true,"reasons":["The total is in the tool output."]}',
        toolCalls: [],
        usage,
        model: "gpt-5-mini",
      },
    ]);
    const tools: ToolCatalog = {
      definitions: () => [
        { name: "summarise_street_crime", description: "Count", inputSchema: { type: "object" } },
      ],
      call: async () => '{"ok":true,"data":{"total":5,"date":"2026-08"}}',
    };
    const report = await runLiveTasks({
      tasks: [
        {
          id: "live-sample",
          question: "What was the 2026-08 total?",
          expectedTools: [{ name: "summarise_street_crime", args: { date: "2026-08" } }],
          requires: "police",
        },
      ],
      provider,
      tools,
      tracer: tracing.tracer,
      model: "gpt-5-mini",
    });
    await tracing.provider.shutdown();
    expect(report.tasks[0]?.passed).toBe(true);
    expect(report.mode).toBe("live");
  });
});
