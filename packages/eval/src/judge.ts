import type { ModelProvider } from "@uk-research/agent";
import { z } from "zod";
import { JUDGE_RUBRIC } from "./rubric.js";
import type { JudgeScore } from "./score.js";

export const judgeSchema = z.object({
  score: z.number().int().min(1).max(5),
  supported: z.boolean(),
  reasons: z.array(z.string().min(1)).min(1),
});

export function parseJudgeOutput(text: string): JudgeScore {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Judge output did not contain JSON");
  return judgeSchema.parse(JSON.parse(text.slice(start, end + 1)));
}

export async function judgeAnswer(
  provider: ModelProvider,
  model: string,
  input: { question: string; answer: string; toolOutputs: readonly string[] },
): Promise<JudgeScore> {
  const response = await provider.complete({
    model,
    tools: [],
    messages: [
      { role: "system", content: JUDGE_RUBRIC },
      {
        role: "user",
        content: [
          "Question:",
          input.question,
          "",
          "Tool outputs:",
          input.toolOutputs.join("\n---\n"),
          "",
          "Answer:",
          input.answer,
        ].join("\n"),
      },
    ],
  });
  return parseJudgeOutput(response.content);
}
