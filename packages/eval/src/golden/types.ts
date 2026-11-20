import type { AgentLimits, AgentStatus, TokenUsage } from "@uk-research/agent";
import type { ToolResult } from "@uk-research/contract";

export type GoldenTurn =
  | { usage: TokenUsage; answer: string }
  | {
      usage: TokenUsage;
      toolCalls: Array<{
        name: string;
        args: Record<string, unknown>;
        result: ToolResult<unknown>;
      }>;
    };

export type GoldenTask = {
  id: string;
  question: string;
  expectedStatus: AgentStatus;
  expectedTools: Array<{ name: string; args: Record<string, unknown> }>;
  order: "any" | "strict";
  requiredFacts: string[];
  answerIncludes: string[];
  forbiddenClaims: string[];
  checkNumbers: boolean;
  limits?: Partial<AgentLimits>;
  judge: { score: number; supported: boolean; reasons: string[] };
  turns: GoldenTurn[];
};
