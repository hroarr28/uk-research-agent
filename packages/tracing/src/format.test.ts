import { describe, expect, it } from "vitest";
import { formatTrace } from "./format.js";
import type { TraceSpan } from "./span.js";

function span(partial: Pick<TraceSpan, "spanId" | "name"> & Partial<TraceSpan>): TraceSpan {
  return {
    traceId: "trace",
    startTimeUnixMs: 0,
    endTimeUnixMs: 10,
    durationMs: 10,
    status: "ok",
    attributes: {},
    ...partial,
  };
}

describe("formatTrace", () => {
  it("indents child spans and prints tokens, cost, and tool outcome", () => {
    const text = formatTrace([
      span({
        spanId: "root",
        name: "agent.run",
        durationMs: 40,
        attributes: { "agent.status": "completed", "agent.estimated_cost_usd": 0.00026 },
      }),
      span({
        spanId: "llm",
        parentSpanId: "root",
        name: "llm.chat",
        startTimeUnixMs: 1,
        attributes: {
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 400,
          "gen_ai.usage.output_tokens": 80,
        },
      }),
      span({
        spanId: "tool",
        parentSpanId: "root",
        name: "tool.call",
        startTimeUnixMs: 2,
        attributes: { "tool.name": "search_companies", "tool.success": true },
      }),
    ]);
    expect(text).toBe(
      [
        "agent.run  40ms  completed  $0.00026",
        "  llm.chat  10ms  gpt-5-mini  tokens 400/80",
        "  tool.call  10ms  search_companies  ok",
      ].join("\n"),
    );
  });
});
