import type { TraceSpan } from "./span.js";

export function formatTrace(spans: readonly TraceSpan[]): string {
  const ids = new Set(spans.map((span) => span.spanId));
  const byParent = new Map<string | undefined, TraceSpan[]>();
  for (const span of spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : undefined;
    const list = byParent.get(parent) ?? [];
    list.push(span);
    byParent.set(parent, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.startTimeUnixMs - b.startTimeUnixMs || a.name.localeCompare(b.name));
  }

  const lines: string[] = [];
  const walk = (parent: string | undefined, depth: number): void => {
    for (const span of byParent.get(parent) ?? []) {
      lines.push(`${"  ".repeat(depth)}${span.name}  ${span.durationMs}ms${detail(span)}`);
      walk(span.spanId, depth + 1);
    }
  };
  walk(undefined, 0);
  return lines.join("\n");
}

function detail(span: TraceSpan): string {
  const parts: string[] = [];
  const status = span.attributes["agent.status"];
  const tool = span.attributes["tool.name"];
  const model = span.attributes["gen_ai.request.model"];
  const input = span.attributes["gen_ai.usage.input_tokens"];
  const output = span.attributes["gen_ai.usage.output_tokens"];
  const cost = span.attributes["agent.estimated_cost_usd"];
  const ok = span.attributes["tool.success"];
  if (typeof status === "string") parts.push(status);
  if (typeof tool === "string") parts.push(tool);
  if (typeof ok === "boolean") parts.push(ok ? "ok" : "error");
  if (typeof model === "string") parts.push(model);
  if (typeof input === "number" && typeof output === "number")
    parts.push(`tokens ${input}/${output}`);
  if (typeof cost === "number") parts.push(`$${cost}`);
  return parts.length > 0 ? `  ${parts.join("  ")}` : "";
}
