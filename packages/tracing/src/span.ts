import { SpanStatusCode } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { scrub } from "@uk-research/http";

export type TraceSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
};

export function hrTimeToUnixMs(time: readonly [number, number]): number {
  return time[0] * 1000 + time[1] / 1e6;
}

export function toTraceSpan(span: ReadableSpan, secrets: readonly string[]): TraceSpan {
  const context = span.spanContext();
  const parent = span.parentSpanContext?.spanId;
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(span.attributes)) {
    if (typeof value === "string") attributes[key] = scrub(value, secrets).slice(0, 500);
    else if (typeof value === "number" || typeof value === "boolean") attributes[key] = value;
  }
  const record: TraceSpan = {
    traceId: context.traceId,
    spanId: context.spanId,
    name: span.name,
    startTimeUnixMs: Math.round(hrTimeToUnixMs(span.startTime)),
    endTimeUnixMs: Math.round(hrTimeToUnixMs(span.endTime)),
    durationMs: Math.round(hrTimeToUnixMs(span.duration)),
    status:
      span.status.code === SpanStatusCode.OK
        ? "ok"
        : span.status.code === SpanStatusCode.ERROR
          ? "error"
          : "unset",
    attributes,
  };
  if (parent && parent !== "0000000000000000") record.parentSpanId = parent;
  return record;
}

export class JsonSpanExporter implements SpanExporter {
  readonly spans: TraceSpan[] = [];

  constructor(
    private readonly secrets: readonly string[] = [],
    private readonly write?: (span: TraceSpan) => void,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      const record = toTraceSpan(span, this.secrets);
      this.spans.push(record);
      this.write?.(record);
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
