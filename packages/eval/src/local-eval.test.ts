import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelProvider } from "@uk-research/agent";
import type { FetchLike } from "@uk-research/http";
import { createPoliceClient } from "@uk-research/police-uk-mcp";
import { createTracing } from "@uk-research/tracing";
import { loadGoldenTasks } from "./golden/tasks.js";
import { hardwareInfo, liveToolCatalog, resultFileSlug, runLocalEval } from "./local-eval.js";
import { replayCatalog } from "./replay.js";

const hardware = {
  platform: "darwin",
  arch: "arm64",
  cpuModel: "Apple M4 Pro",
  cpuCount: 14,
  totalMemoryGb: 64,
  node: "v22.23.4",
};

function provider(script: (system: string) => string): {
  model: ModelProvider;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    model: {
      id: "ollama",
      local: true,
      async complete(request) {
        calls += 1;
        const system = request.messages.find((message) => message.role === "system")?.content ?? "";
        return {
          content: script(system),
          toolCalls: [],
          usage: { inputTokens: 11, outputTokens: 7 },
          model: "gemma4:31b",
        };
      },
    },
  };
}

describe("runLocalEval", () => {
  it("records tasks as they finish and skips them on the next run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "uk-research-local-"));
    const partialPath = path.join(directory, "live-gemma4-31b.partial.json");
    const summaryPath = path.join(directory, "live-gemma4-31b.summary.json");
    const tasks = loadGoldenTasks().filter((task) => task.id === "out-of-scope-weather");
    const tracing = createTracing();
    const fake = provider((system) =>
      system.includes("You grade")
        ? '{"score":5,"supported":true,"reasons":["The answer declines without inventing a forecast."]}'
        : "I can't answer a weather forecast from Companies House or Police UK. I won't guess one.",
    );
    const first = await runLocalEval({
      tasks,
      provider: fake.model,
      model: "gemma4:31b",
      tracer: tracing.tracer,
      catalogFor: replayCatalog,
      partialPath,
      summaryPath,
      mode: "live-recorded-tools",
      hardware,
      now: () => new Date("2026-11-20T12:00:00.000Z"),
      log() {},
    });
    expect(first.complete).toBe(true);
    expect(first.passed).toBe(1);
    expect(first.totalEstimatedCostUsd).toBe(0);
    expect(first.hardware.cpuModel).toBe("Apple M4 Pro");
    expect(first.judgeNote).toContain("weaker");
    expect(fake.calls()).toBe(2);

    const second = await runLocalEval({
      tasks,
      provider: fake.model,
      model: "gemma4:31b",
      tracer: tracing.tracer,
      catalogFor: replayCatalog,
      partialPath,
      summaryPath,
      mode: "live-recorded-tools",
      hardware,
      now: () => new Date("2026-11-20T13:00:00.000Z"),
      log() {},
    });
    expect(second.complete).toBe(true);
    expect(fake.calls()).toBe(2);
    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as { model: string };
    expect(summary.model).toBe("gemma4:31b");
    await tracing.provider.shutdown();
  });

  it("names the result file from the model tag and describes this machine", () => {
    expect(resultFileSlug("gemma4:31b")).toBe("gemma4-31b");
    const info = hardwareInfo();
    expect(info.platform.length).toBeGreaterThan(0);
    expect(info.totalMemoryGb).toBeGreaterThan(0);
    expect(info.node.startsWith("v")).toBe(true);
  });
});

describe("liveToolCatalog", () => {
  it("calls the live Police UK client and keeps Companies House on the fixture", async () => {
    const task = loadGoldenTasks().find((item) => item.id === "police-force-names");
    if (!task) throw new Error("missing police task");
    let policeCalls = 0;
    const fetchFn: FetchLike = async (url) => {
      policeCalls += 1;
      expect(url).toContain("/forces");
      return new Response(
        JSON.stringify([
          { id: "metropolitan", name: "Metropolitan Police Service" },
          { id: "leicestershire", name: "Leicestershire Police" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const catalog = liveToolCatalog({
      task,
      police: createPoliceClient({ fetchFn }),
    });
    const live = await catalog.call("list_police_forces", {});
    expect(live).toContain("Leicestershire Police");
    expect(policeCalls).toBe(1);
    const recorded = await catalog.call("search_companies", { query: "NORTHSTAR ANALYTICS LTD" });
    expect(recorded).toContain("fixture_miss");
    expect(policeCalls).toBe(1);
    const rejected = await catalog.call("summarise_street_crime", {
      lat: 1,
      lng: 1,
      date: "2026-13",
    });
    expect(rejected).toContain("invalid_input");
    expect(policeCalls).toBe(1);
  });
});
