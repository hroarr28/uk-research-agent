import { describe, expect, it } from "vitest";
import { ScriptedModel } from "@uk-research/agent";
import { judgeAnswer, parseJudgeOutput } from "./judge.js";
import { JUDGE_RUBRIC } from "./rubric.js";

describe("judge", () => {
  it("documents the rubric and parses a fenced score", () => {
    expect(JUDGE_RUBRIC).toContain("Score 5");
    expect(JUDGE_RUBRIC).toContain("tool outputs");
    expect(JUDGE_RUBRIC).toContain("step limit");
    const parsed = parseJudgeOutput(
      '```json\n{"score":4,"supported":true,"reasons":["Minor omission."]}\n```',
    );
    expect(parsed.score).toBe(4);
    expect(() => parseJudgeOutput('{"score":6,"supported":true,"reasons":["no"]}')).toThrow();
  });

  it("asks the provider with the rubric and parses the reply", async () => {
    const provider = new ScriptedModel([
      {
        content: '{"score":5,"supported":true,"reasons":["The total is in the tool output."]}',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10 },
        model: "gpt-5-mini",
      },
    ]);
    const score = await judgeAnswer(provider, "gpt-5-mini", {
      question: "Total?",
      answer: "5",
      toolOutputs: ['{"total":5}'],
    });
    expect(score.score).toBe(5);
    expect(provider.requests[0]?.messages[0]?.content).toContain("Score 5");
    expect(provider.requests[0]?.tools).toEqual([]);
  });
});
