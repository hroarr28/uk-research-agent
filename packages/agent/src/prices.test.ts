import { describe, expect, it } from "vitest";
import { estimateCost, FALLBACK_PRICE, roundCost } from "./prices.js";

describe("estimateCost", () => {
  it("uses the published gpt-5-mini rates", () => {
    const cost = estimateCost("gpt-5-mini", { inputTokens: 400, outputTokens: 80 });
    expect(cost.priceKnown).toBe(true);
    expect(cost.usd).toBe(0.00026);
    expect(roundCost(cost.usd)).toBe(0.00026);
  });

  it("prices Gemma 4 local tags at zero", () => {
    const cost = estimateCost("gemma4:31b", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toEqual({ usd: 0, priceKnown: true });
    expect(estimateCost("gpt-5-mini", { inputTokens: 10, outputTokens: 10 }, true)).toEqual({
      usd: 0,
      priceKnown: true,
    });
  });

  it("overestimates an unknown model at the highest table rate", () => {
    const cost = estimateCost("unknown-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost.priceKnown).toBe(false);
    expect(cost.usd).toBe(FALLBACK_PRICE.inputPerMillionUsd + FALLBACK_PRICE.outputPerMillionUsd);
    expect(FALLBACK_PRICE).toEqual({ inputPerMillionUsd: 3, outputPerMillionUsd: 15 });
  });
});
