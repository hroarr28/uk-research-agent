import { context, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import { JsonSpanExporter, type TraceSpan } from "./span.js";

export type ExporterName = "json" | "console" | "otlp";

export function resolveOtlpTracesUrl(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/$/, "");
  if (trimmed.endsWith("/v1/traces")) return trimmed;
  return `${trimmed}/v1/traces`;
}

export function exporterPlan(options: {
  console?: boolean;
  otlpEndpoint?: string;
}): ExporterName[] {
  const names: ExporterName[] = ["json"];
  if (options.console) names.push("console");
  if (options.otlpEndpoint) names.push("otlp");
  return names;
}

export type Tracing = {
  tracer: Tracer;
  provider: TracerProvider;
  spans: TraceSpan[];
  exporters: ExporterName[];
};

let contextReady = false;

function ensureContextManager(): void {
  if (contextReady) return;
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
  contextReady = true;
}

export function createTracing(options?: {
  serviceName?: string;
  console?: boolean;
  otlpEndpoint?: string;
  secrets?: readonly string[];
  writeJson?: (span: TraceSpan) => void;
}): Tracing {
  ensureContextManager();
  const plan = exporterPlan({
    console: options?.console,
    otlpEndpoint: options?.otlpEndpoint,
  });
  const json = new JsonSpanExporter(options?.secrets ?? [], options?.writeJson);
  const exporters: SpanExporter[] = [json];
  if (plan.includes("console")) exporters.push(new ConsoleSpanExporter());
  const otlpUrl = resolveOtlpTracesUrl(options?.otlpEndpoint);
  if (otlpUrl) exporters.push(new OTLPTraceExporter({ url: otlpUrl }));

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      "service.name": options?.serviceName ?? "uk-research-agent",
      "service.version": "0.1.0",
    }),
    spanProcessors: exporters.map((exporter) => new SimpleSpanProcessor({ exporter })),
  });
  return {
    tracer: provider.getTracer("uk-research-agent", "0.1.0"),
    provider,
    spans: json.spans,
    exporters: plan,
  };
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
