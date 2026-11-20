import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { backoffMs, createHttpClient, retryAfterMs, type FetchLike } from "./request.js";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sequence(responses: Array<Response | Error>): FetchLike {
  let index = 0;
  return async () => {
    const next = responses[index];
    index += 1;
    if (!next) throw new Error("fetch sequence exhausted");
    if (next instanceof Error) throw next;
    return next;
  };
}

describe("retry timing", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMs("2", 0, 10_000)).toBe(2000);
    expect(retryAfterMs("0", 0, 10_000)).toBe(0);
    const now = Date.parse("2026-11-20T20:00:00.000Z");
    expect(retryAfterMs("Fri, 20 Nov 2026 20:00:03 GMT", now, 10_000)).toBe(3000);
    expect(retryAfterMs("999", 0, 1_000)).toBe(1_000);
  });

  it("applies exponential backoff with jitter", () => {
    expect(backoffMs(0, 100, 1_000, () => 0)).toBe(50);
    expect(backoffMs(1, 100, 1_000, () => 0)).toBe(100);
    expect(backoffMs(0, 100, 1_000, () => 1)).toBe(100);
    expect(backoffMs(6, 100, 1_000, () => 1)).toBe(1_000);
  });
});

describe("createHttpClient", () => {
  it("retries 429 using Retry-After and then returns the JSON body", async () => {
    const sleeps: number[] = [];
    const client = createHttpClient({
      fetchFn: sequence([
        new Response(null, { status: 429, headers: { "retry-after": "0" } }),
        jsonResponse(200, { ok: true }),
      ]),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
      baseDelayMs: 100,
    });
    const result = await client.getJson("https://example.test/companies");
    expect(result).toEqual({ ok: true, status: 200, data: { ok: true } });
    expect(sleeps).toEqual([0]);
  });

  it("backs off on 503 and does not retry a 400", async () => {
    const sleeps: number[] = [];
    const retrying = createHttpClient({
      fetchFn: sequence([jsonResponse(503, { error: "down" }), jsonResponse(200, { items: [] })]),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
      baseDelayMs: 100,
    });
    expect((await retrying.getJson("https://example.test/a")).ok).toBe(true);
    expect(sleeps).toEqual([50]);

    let calls = 0;
    const once = createHttpClient({
      fetchFn: async () => {
        calls += 1;
        return jsonResponse(400, { error: "bad query" });
      },
    });
    const failed = await once.getJson("https://example.test/a");
    expect(failed).toMatchObject({
      ok: false,
      code: "bad_request",
      status: 400,
      message: "bad query",
    });
    expect(calls).toBe(1);
  });

  it("returns rate_limited when retries are exhausted", async () => {
    const client = createHttpClient({
      fetchFn: sequence([
        new Response(null, { status: 429 }),
        new Response(null, { status: 429 }),
        new Response(null, { status: 429 }),
      ]),
      sleep: async () => {},
      maxRetries: 2,
      random: () => 0,
    });
    const result = await client.getJson("https://example.test/limited");
    expect(result).toMatchObject({ ok: false, code: "rate_limited", status: 429 });
  });

  it("retries a network error and scrubs secrets from errors and logs", async () => {
    const secret = "super-secret-key-value";
    const lines: string[] = [];
    const client = createHttpClient({
      fetchFn: sequence([
        new Error(`connect ${secret}`),
        jsonResponse(500, { error: `boom ${secret}` }),
        jsonResponse(500, { error: `boom ${secret}` }),
        jsonResponse(500, { error: `boom ${secret}` }),
      ]),
      sleep: async () => {},
      maxRetries: 2,
      random: () => 0,
      secrets: [secret],
      logger: createLogger({ write: (line) => lines.push(line), secrets: [secret], level: "warn" }),
    });
    const result = await client.postJson(
      "https://example.test/v1?api_key=" + secret,
      { q: 1 },
      {
        authorization: `Bearer ${secret}`,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.includes(secret)).toBe(false);
      expect(result.code).toBe("upstream_unavailable");
    }
    const logs = lines.join("\n");
    expect(logs.includes(secret)).toBe(false);
    expect(logs.includes("authorization")).toBe(false);
    expect(logs.includes("[REDACTED]")).toBe(true);
  });

  it("maps 401 and 404 without echoing the body", async () => {
    const unauthorized = createHttpClient({
      fetchFn: async () => jsonResponse(401, { error: "Invalid Authorization secret-value" }),
    });
    const missing = createHttpClient({
      fetchFn: async () => jsonResponse(404, { errors: [{ error: "company-profile-not-found" }] }),
    });
    expect(await unauthorized.getJson("https://example.test/company/1")).toMatchObject({
      ok: false,
      code: "unauthorized",
      message: "Upstream rejected the credentials.",
    });
    expect(await missing.getJson("https://example.test/company/1")).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("spaces calls when minIntervalMs is set", async () => {
    let clock = 1_000;
    const sleeps: number[] = [];
    const client = createHttpClient({
      fetchFn: async () => jsonResponse(200, { ok: true }),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      minIntervalMs: 250,
    });
    await client.getJson("https://example.test/1");
    await client.getJson("https://example.test/2");
    expect(sleeps).toEqual([250]);
  });
});
