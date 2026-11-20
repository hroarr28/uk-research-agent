import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { formatTrace } from "./format.js";
import { createTracing, exporterPlan, resolveOtlpTracesUrl, withSpan } from "./setup.js";

describe("tracing setup", () => {
  it("resolves an OTLP traces URL and names the exporters", () => {
    expect(resolveOtlpTracesUrl(undefined)).toBeUndefined();
    expect(resolveOtlpTracesUrl("http://127.0.0.1:4318")).toBe("http://127.0.0.1:4318/v1/traces");
    expect(resolveOtlpTracesUrl("http://127.0.0.1:4318/v1/traces/")).toBe(
      "http://127.0.0.1:4318/v1/traces",
    );
    expect(exporterPlan({})).toEqual(["json"]);
    expect(exporterPlan({ console: true, otlpEndpoint: "http://127.0.0.1:4318" })).toEqual([
      "json",
      "console",
      "otlp",
    ]);
  });

  it("exports a JSON span with tokens and scrubs secrets", async () => {
    const secret = "super-secret-key-value";
    const tracing = createTracing({ secrets: [secret] });
    await withSpan(
      tracing.tracer,
      "llm.chat",
      { "gen_ai.request.model": "gpt-5-mini" },
      async (span) => {
        span.setAttribute("gen_ai.usage.input_tokens", 12);
        span.setAttribute("agent.question", `lookup ${secret}`);
        span.setStatus({ code: SpanStatusCode.OK });
      },
    );
    await tracing.provider.shutdown();
    expect(tracing.spans).toHaveLength(1);
    const [span] = tracing.spans;
    expect(span?.name).toBe("llm.chat");
    expect(span?.attributes["gen_ai.usage.input_tokens"]).toBe(12);
    expect(span?.status).toBe("ok");
    expect(JSON.stringify(span).includes(secret)).toBe(false);
    expect(JSON.stringify(span)).toContain("[REDACTED]");
  });

  it("keeps child spans under the active parent across awaits", async () => {
    const tracing = createTracing();
    await withSpan(tracing.tracer, "agent.run", {}, async () => {
      await Promise.resolve();
      await withSpan(tracing.tracer, "agent.step", {}, async () => {
        await withSpan(tracing.tracer, "llm.chat", {}, async () => undefined);
      });
    });
    await tracing.provider.shutdown();
    const run = tracing.spans.find((span) => span.name === "agent.run");
    const step = tracing.spans.find((span) => span.name === "agent.step");
    const llm = tracing.spans.find((span) => span.name === "llm.chat");
    expect(step?.parentSpanId).toBe(run?.spanId);
    expect(llm?.parentSpanId).toBe(step?.spanId);
    const text = formatTrace(tracing.spans);
    expect(text).toContain("\n  agent.step");
    expect(text).toContain("\n    llm.chat");
  });
});
