import { describe, expect, it } from "vitest";
import { scoreDeterministic, scoreTools } from "./score.js";

const judge = { score: 5, supported: true, reasons: ["ok"] };

describe("scoreTools", () => {
  it("requires the same calls in strict order and ignores order otherwise", () => {
    const expected = [
      { name: "search_companies", args: { query: "A" } },
      { name: "get_company_profile", args: { companyNumber: "12345678" } },
    ];
    const swapped = [
      { name: "get_company_profile", arguments: { companyNumber: "12345678" }, output: "" },
      { name: "search_companies", arguments: { query: "A" }, output: "" },
    ];
    expect(scoreTools(expected, swapped, "any").f1).toBe(1);
    expect(scoreTools(expected, swapped, "strict").f1).toBeLessThan(1);
    expect(scoreTools([], [], "any").f1).toBe(1);
  });
});

describe("scoreDeterministic", () => {
  const base = {
    question: "What is 12345678?",
    answer: "Company 12345678 is active.\n\nSources:\n- get_company_profile",
    status: "completed",
    expectedStatus: "completed",
    expectedTools: [{ name: "get_company_profile", args: { companyNumber: "12345678" } }],
    order: "any" as const,
    requiredFacts: ["12345678", "active"],
    forbiddenClaims: [] as string[],
    checkNumbers: true,
    toolCalls: [
      {
        name: "get_company_profile",
        arguments: { companyNumber: "12345678" },
        output: '{"ok":true,"data":{"companyNumber":"12345678","status":"active"}}',
      },
    ],
    judge,
  };

  it("passes when the facts are in the answer and the tool output", () => {
    expect(scoreDeterministic(base).passed).toBe(true);
  });

  it("fails a fact that is not in the tool output, an extra tool, a forbidden claim, or a low judge score", () => {
    expect(scoreDeterministic({ ...base, requiredFacts: ["dissolved"] }).passed).toBe(false);
    expect(
      scoreDeterministic({
        ...base,
        toolCalls: [
          ...base.toolCalls,
          { name: "search_companies", arguments: { query: "A" }, output: "{}" },
        ],
      }).toolCallAccuracy,
    ).toBeLessThan(1);
    expect(
      scoreDeterministic({ ...base, forbiddenClaims: ["active"] }).failures.join(" "),
    ).toContain("forbidden");
    expect(scoreDeterministic({ ...base, judge: { score: 2, supported: false } }).passed).toBe(
      false,
    );
    expect(
      scoreDeterministic({
        ...base,
        answer: "Company 99999999 is active.\n\nSources:\n- get_company_profile",
      }).failures.join(" "),
    ).toContain("unsupported numbers");
  });
});
