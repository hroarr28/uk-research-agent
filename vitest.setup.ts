import { afterEach, beforeEach } from "vitest";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`Blocked network call in test: ${String(input)}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
