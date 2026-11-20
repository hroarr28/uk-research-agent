#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  DEFAULT_OPENAI_MODEL,
  type ModelProvider,
} from "@uk-research/agent";
import {
  liveSmokeTasks,
  liveToolCatalog,
  replayCatalog,
  loadGoldenTasks,
  renderMarkdown,
  resultFileSlug,
  runGoldenReplay,
  runGoldenTask,
  runLiveTasks,
  runLocalEval,
  stableSummary,
  summarise,
} from "@uk-research/eval";
import { createCompaniesHouseClient } from "@uk-research/companies-house-mcp";
import { createPoliceClient } from "@uk-research/police-uk-mcp";
import { createTracing, formatTrace, type TraceSpan } from "@uk-research/tracing";
import { connectLiveCatalog } from "./catalog.js";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string", default: "replay" },
    fresh: { type: "boolean", default: false },
    tools: { type: "string", default: "recorded" },
  },
  allowPositionals: true,
});

const command = positionals[0] ?? "demo";
const exitCode = await run(command, values.mode ?? "replay", positionals[1]);
process.exitCode = exitCode;

async function run(name: string, mode: string, file: string | undefined): Promise<number> {
  if (name === "demo") return demo();
  if (name === "eval") {
    if (mode === "live") return live();
    if (mode === "local") return localEval();
    return replay();
  }
  if (name === "trace") return file ? showTrace(file) : usage();
  return usage();
}

async function demo(): Promise<number> {
  const task = loadGoldenTasks().find((item) => item.id === "ch-officers-and-filings");
  if (!task) {
    process.stderr.write("Demo task is missing from the golden set.\n");
    return 1;
  }
  const tracing = createTracing();
  const { report, answer } = await runGoldenTask(task, tracing.tracer);
  await tracing.provider.shutdown();
  process.stdout.write(`${task.question}\n\n`);
  process.stdout.write(`${report.passed ? "Replay checks passed." : report.failures.join("\n")}\n`);
  process.stdout.write(`Status: ${report.status}\n`);
  process.stdout.write(`Tokens: ${report.inputTokens} in / ${report.outputTokens} out\n`);
  process.stdout.write(`Estimated cost: $${report.estimatedCostUsd}\n\n`);
  process.stdout.write(`${answer}\n\n${formatTrace(tracing.spans)}\n`);
  await mkdir("runs", { recursive: true });
  await writeFile("runs/demo-trace.json", `${JSON.stringify({ spans: tracing.spans }, null, 2)}\n`);
  process.stdout.write("\nWrote runs/demo-trace.json\n");
  return report.passed ? 0 : 1;
}

async function replay(): Promise<number> {
  const tracing = createTracing({
    console: process.env.TRACE_EXPORTER === "console",
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    writeJson:
      process.env.TRACE_EXPORTER === "console"
        ? undefined
        : (span) => {
            if (process.env.TRACE_STDERR === "1") process.stderr.write(`${JSON.stringify(span)}\n`);
          },
  });
  const report = await runGoldenReplay({ tracer: tracing.tracer });
  await tracing.provider.shutdown();
  const stable = stableSummary(report);
  const markdown = renderMarkdown(stable);
  await mkdir(path.dirname("evals/results/replay.summary.json"), { recursive: true });
  await writeFile("evals/results/replay.summary.json", `${JSON.stringify(stable, null, 2)}\n`);
  await writeFile("evals/results/replay.md", markdown);
  process.stdout.write(markdown);
  process.stdout.write(
    `Mean latency: ${summarise(report).meanLatencyMs.toFixed(3)} ms on this machine. Not stored; it is not a CI gate.\n`,
  );
  const failed = report.tasks.filter((task) => !task.passed);
  for (const task of failed) process.stderr.write(`${task.id}: ${task.failures.join("; ")}\n`);
  return failed.length === 0 ? 0 : 1;
}

async function live(): Promise<number> {
  const providerName = process.env.RESEARCH_PROVIDER ?? "openai";
  if (providerName !== "openai" && providerName !== "anthropic") {
    process.stderr.write("RESEARCH_PROVIDER must be openai or anthropic.\n");
    return 1;
  }
  const apiKey =
    providerName === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      `Set ${providerName === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} for live mode.\n`,
    );
    return 1;
  }
  const model =
    process.env.RESEARCH_MODEL ||
    (providerName === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL);
  const provider: ModelProvider =
    providerName === "openai"
      ? createOpenAiProvider({ apiKey })
      : createAnthropicProvider({ apiKey });
  const companiesKey = process.env.COMPANIES_HOUSE_API_KEY;
  const tasks = liveSmokeTasks.filter(
    (task) => task.requires === "police" || Boolean(companiesKey),
  );
  if (!companiesKey) {
    process.stderr.write(
      "Skipping Companies House live tasks because COMPANIES_HOUSE_API_KEY is not set.\n",
    );
  }
  const tracing = createTracing({
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    secrets: [apiKey, companiesKey ?? ""].filter((secret) => secret.length >= 8),
  });
  const connected = await connectLiveCatalog({ apiKey: companiesKey ?? "" });
  try {
    const report = await runLiveTasks({
      tasks,
      provider,
      tools: connected.catalog,
      tracer: tracing.tracer,
      model,
      secrets: [apiKey, companiesKey ?? ""].filter((secret) => secret.length >= 8),
    });
    const stable = stableSummary(report);
    process.stdout.write(renderMarkdown(stable));
    process.stdout.write(`Mean latency: ${summarise(report).meanLatencyMs} ms\n`);
    return report.tasks.every((task) => task.passed) ? 0 : 1;
  } finally {
    await tracing.provider.shutdown();
    await connected.close();
  }
}

async function localEval(): Promise<number> {
  const tools = values.tools ?? "recorded";
  if (tools !== "recorded" && tools !== "live") {
    process.stderr.write("--tools must be recorded or live.\n");
    return 1;
  }
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const timeout = Number(process.env.OLLAMA_TIMEOUT_MS ?? DEFAULT_OLLAMA_TIMEOUT_MS);
  const provider = createOllamaProvider({
    baseUrl,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_OLLAMA_TIMEOUT_MS,
  });
  const slug = resultFileSlug(model);
  const partialPath = path.join("evals", "results", `live-${slug}.partial.json`);
  const summaryPath = path.join("evals", "results", `live-${slug}.summary.json`);
  const companiesKey = process.env.COMPANIES_HOUSE_API_KEY;
  const companies =
    tools === "live" && companiesKey
      ? createCompaniesHouseClient({ apiKey: companiesKey })
      : undefined;
  const police = tools === "live" ? createPoliceClient() : undefined;
  if (tools === "live" && !companies) {
    process.stderr.write(
      "Companies House calls use recorded fixtures because COMPANIES_HOUSE_API_KEY is not set. Police UK calls use the live API.\n",
    );
  }
  const tracing = createTracing({
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    secrets: companiesKey && companiesKey.length >= 8 ? [companiesKey] : [],
  });
  try {
    const summary = await runLocalEval({
      tasks: loadGoldenTasks(),
      provider,
      model,
      tracer: tracing.tracer,
      mode: tools === "live" ? "live-full" : "live-recorded-tools",
      fresh: values.fresh === true,
      partialPath,
      summaryPath,
      catalogFor: (task) =>
        tools === "recorded" ? replayCatalog(task) : liveToolCatalog({ task, police, companies }),
    });
    process.stdout.write(
      `${summary.complete ? "Complete" : "Incomplete"} ${summary.model}: ${summary.passed}/${summary.taskCount} passed, tool accuracy ${summary.toolCallAccuracy}, groundedness ${summary.groundedness}, judge ${summary.meanJudgeScore}, mean latency ${summary.meanLatencyMs} ms, cost $${summary.totalEstimatedCostUsd}.\n`,
    );
    process.stdout.write(`Wrote ${summaryPath}\n`);
    return summary.complete && summary.passed === summary.taskCount ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Local eval failed."}\n`);
    return 1;
  } finally {
    await tracing.provider.shutdown();
  }
}

async function showTrace(file: string): Promise<number> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as { spans?: TraceSpan[] };
  if (!parsed.spans) {
    process.stderr.write("Trace file must be a JSON object with a spans array.\n");
    return 1;
  }
  process.stdout.write(`${formatTrace(parsed.spans)}\n`);
  return 0;
}

function usage(): number {
  process.stderr.write(
    "Usage: uk-research demo | uk-research eval --mode replay|live|local [--fresh] [--tools recorded|live] | uk-research trace <file>\n",
  );
  return 1;
}
