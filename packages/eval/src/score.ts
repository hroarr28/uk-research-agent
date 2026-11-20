export type ToolCallRecord = {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
};

export type ExpectedTool = {
  name: string;
  args: Record<string, unknown>;
};

export type JudgeScore = {
  score: number;
  supported: boolean;
  reasons: string[];
};

export type DeterministicScore = {
  passed: boolean;
  toolCallAccuracy: number;
  groundedness: number;
  numericGroundedness: number | null;
  failures: string[];
};

export function canonical(value: unknown): string {
  const json = JSON.stringify(sortValue(value));
  return json ?? "undefined";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}

export function scoreTools(
  expected: readonly ExpectedTool[],
  actual: readonly ToolCallRecord[],
  order: "any" | "strict",
): { f1: number; detail: string } {
  const used = new Set<number>();
  let cursor = 0;
  let hits = 0;
  for (const wanted of expected) {
    let found = -1;
    for (let index = order === "strict" ? cursor : 0; index < actual.length; index += 1) {
      const call = actual[index];
      if (!call || used.has(index)) continue;
      if (call.name === wanted.name && canonical(wanted.args) === canonical(call.arguments)) {
        found = index;
        break;
      }
    }
    if (found >= 0) {
      used.add(found);
      hits += 1;
      cursor = found + 1;
    }
  }
  const precision = actual.length === 0 ? (expected.length === 0 ? 1 : 0) : hits / actual.length;
  const recall = expected.length === 0 ? 1 : hits / expected.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { f1, detail: `hits=${hits} expected=${expected.length} actual=${actual.length}` };
}

export function scoreLiveTools(
  expected: ReadonlyArray<{ name: string; args?: Record<string, unknown> }>,
  actual: readonly ToolCallRecord[],
): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  const used = new Set<number>();
  let hits = 0;
  for (const wanted of expected) {
    const found = actual.findIndex((call, index) => {
      if (used.has(index) || call.name !== wanted.name) return false;
      if (!wanted.args) return true;
      return Object.entries(wanted.args).every(
        ([key, value]) => canonical(value) === canonical(call.arguments[key]),
      );
    });
    if (found >= 0) {
      used.add(found);
      hits += 1;
    }
  }
  return hits / expected.length;
}

export function scoreGroundedness(
  facts: readonly string[],
  answer: string,
  toolOutputs: readonly string[],
): { score: number; missing: string[]; unsupported: string[] } {
  if (facts.length === 0) return { score: 1, missing: [], unsupported: [] };
  const answerText = answer.toLowerCase();
  const evidence = toolOutputs.join("\n").toLowerCase();
  const missing = facts.filter((fact) => !answerText.includes(fact.toLowerCase()));
  const unsupported = facts.filter((fact) => !evidence.includes(fact.toLowerCase()));
  const supported = facts.filter(
    (fact) => answerText.includes(fact.toLowerCase()) && evidence.includes(fact.toLowerCase()),
  ).length;
  return { score: supported / facts.length, missing, unsupported };
}

export function scoreNumbers(
  question: string,
  answer: string,
  toolOutputs: readonly string[],
): { score: number; unsupported: string[] } {
  const allowed = new Set(extractNumbers(`${question}\n${toolOutputs.join("\n")}`));
  const numbers = extractNumbers(answer);
  const unsupported = [...new Set(numbers.filter((value) => !allowed.has(value)))];
  if (numbers.length === 0) return { score: 1, unsupported: [] };
  return {
    score:
      (numbers.length - numbers.filter((value) => !allowed.has(value)).length) / numbers.length,
    unsupported,
  };
}

export function scoreDeterministic(input: {
  question: string;
  answer: string;
  status: string;
  expectedStatus: string;
  expectedTools: readonly ExpectedTool[];
  order: "any" | "strict";
  requiredFacts: readonly string[];
  answerIncludes?: readonly string[];
  forbiddenClaims: readonly string[];
  checkNumbers: boolean;
  toolCalls: readonly ToolCallRecord[];
  judge: Pick<JudgeScore, "score" | "supported">;
}): DeterministicScore {
  const failures: string[] = [];
  if (input.status !== input.expectedStatus) {
    failures.push(`status ${input.status} != ${input.expectedStatus}`);
  }
  const tools = scoreTools(input.expectedTools, input.toolCalls, input.order);
  if (tools.f1 !== 1) failures.push(`tool accuracy ${tools.f1} (${tools.detail})`);
  const outputs = input.toolCalls.map((call) => call.output);
  const grounded = scoreGroundedness(input.requiredFacts, input.answer, outputs);
  if (grounded.score !== 1) {
    failures.push(
      `groundedness missing=${grounded.missing.join("|")} unsupported=${grounded.unsupported.join("|")}`,
    );
  }
  const absent = (input.answerIncludes ?? []).filter(
    (phrase) => !input.answer.toLowerCase().includes(phrase.toLowerCase()),
  );
  if (absent.length > 0) failures.push(`answer missing: ${absent.join("|")}`);
  const forbidden = input.forbiddenClaims.filter((claim) =>
    input.answer.toLowerCase().includes(claim.toLowerCase()),
  );
  if (forbidden.length > 0) failures.push(`forbidden: ${forbidden.join("|")}`);
  let numeric: number | null = null;
  if (input.checkNumbers) {
    const numbers = scoreNumbers(input.question, input.answer, outputs);
    numeric = numbers.score;
    if (numbers.score !== 1) failures.push(`unsupported numbers: ${numbers.unsupported.join("|")}`);
  }
  const cited = new Set(input.toolCalls.map((call) => call.name));
  const missingCitations = [...cited].filter((name) => !input.answer.includes(name));
  if (missingCitations.length > 0)
    failures.push(`missing citations: ${missingCitations.join("|")}`);
  if (input.judge.score < 4 || !input.judge.supported) failures.push("judge below threshold");
  return {
    passed: failures.length === 0,
    toolCallAccuracy: tools.f1,
    groundedness: grounded.score,
    numericGroundedness: numeric,
    failures,
  };
}

function extractNumbers(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}
