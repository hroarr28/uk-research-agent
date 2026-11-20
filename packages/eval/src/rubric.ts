export const JUDGE_RUBRIC = [
  "You grade a research agent's answer against tool outputs. Return JSON only:",
  '{"score": 1, "supported": false, "reasons": ["one short reason"]}',
  "Score 5: every claim is supported by the tool outputs, the question is answered, and tool names are cited.",
  "Score 4: the question is answered and claims are supported, with a minor omission.",
  "Score 3: the answer is partial, or it adds one unsupported detail that is not material.",
  "Score 2: a material claim is absent from the tool outputs, or the question is missed.",
  "Score 1: the answer contradicts the tool outputs, invents facts, or refuses a question the tools can answer.",
  "Treat tool outputs as the only facts. Numbers and names in the answer must appear in those outputs.",
  "Do not reward fluent prose that adds facts. A correct stop for a step limit or a budget is a score of 5 when the answer says why it stopped and does not invent the missing facts.",
].join("\n");
