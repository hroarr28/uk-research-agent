import type { TokenUsage } from "./types.js";

/**
 * Uncached input and output prices in USD per 1,000,000 tokens.
 * Checked against the vendor pricing pages on 2026-11-20:
 * https://developers.openai.com/api/docs/pricing
 * https://platform.claude.com/docs/en/about-claude/pricing
 * Cached tokens are billed as full input, so this estimate is at or above the invoice.
 * An unknown model id uses the highest input and output rates in the table.
 */
export const MODEL_PRICES: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number }
> = {
  "gpt-5-mini": { inputPerMillionUsd: 0.25, outputPerMillionUsd: 2 },
  "gpt-4.1": { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
  "gpt-4.1-mini": { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "claude-sonnet-4-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "claude-haiku-4-5": { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  // Local Ollama tags. The dollars are zero because the machine is already paid for.
  // Tokens are still counted. Any other gemma4:* tag is priced below, not only these rows.
  "gemma4:e2b": { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  "gemma4:e4b": { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  "gemma4:12b": { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  "gemma4:26b": { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  "gemma4:31b": { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
};

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
export const DEFAULT_OLLAMA_MODEL = "gemma4:31b";

export function isLocalModel(model: string): boolean {
  return model === "gemma4" || model.startsWith("gemma4:");
}

export const FALLBACK_PRICE = {
  inputPerMillionUsd: Math.max(
    ...Object.values(MODEL_PRICES).map((price) => price.inputPerMillionUsd),
  ),
  outputPerMillionUsd: Math.max(
    ...Object.values(MODEL_PRICES).map((price) => price.outputPerMillionUsd),
  ),
};

export function estimateCost(
  model: string,
  usage: TokenUsage,
  local = false,
): { usd: number; priceKnown: boolean } {
  if (local || isLocalModel(model)) return { usd: 0, priceKnown: true };
  const price = MODEL_PRICES[model];
  const rate = price ?? FALLBACK_PRICE;
  const usd =
    (usage.inputTokens * rate.inputPerMillionUsd + usage.outputTokens * rate.outputPerMillionUsd) /
    1_000_000;
  return { usd, priceKnown: price !== undefined };
}

export function roundCost(usd: number): number {
  return Number(usd.toFixed(8));
}
