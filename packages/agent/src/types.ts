import type { ToolDefinition } from "@uk-research/contract";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type CompletionRequest = {
  model: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
};

export type CompletionResponse = {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
};

export interface ModelProvider {
  readonly id: string;
  /**
   * Local runtimes set this. Their token cost is recorded as $0.
   * Tokens and latency are still reported.
   */
  readonly local?: boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export type ToolCatalog = {
  definitions(): ToolDefinition[];
  call(name: string, args: Record<string, unknown>): Promise<string>;
};

export type AgentLimits = {
  maxSteps: number;
  maxTotalTokens: number;
  maxCostUsd: number;
};

export const DEFAULT_LIMITS: AgentLimits = {
  maxSteps: 8,
  maxTotalTokens: 24_000,
  maxCostUsd: 0.5,
};

export type AgentStatus = "completed" | "step_limit" | "budget_exceeded" | "model_error";

export type AgentToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
  ok: boolean;
};

export type AgentResult = {
  status: AgentStatus;
  answer: string;
  model: string | null;
  steps: number;
  toolCalls: AgentToolCall[];
  usage: TokenUsage & { estimatedCostUsd: number; priceKnown: boolean };
  traceId: string;
};
