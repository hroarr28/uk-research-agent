import { describe, expect, it } from "vitest";
import { redactValue, scrub } from "./redact.js";

describe("redact", () => {
  it("replaces secret substrings and sensitive keys", () => {
    const secret = "super-secret-key-value";
    expect(scrub(`failed for ${secret}`, [secret])).toBe("failed for [REDACTED]");
    expect(scrub("short", ["tiny"])).toBe("short");
    expect(
      redactValue({ authorization: "Basic abc", nested: { api_key: "k", note: secret } }, [secret]),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { api_key: "[REDACTED]", note: "[REDACTED]" },
    });
  });
});
