import { describe, expect, it } from "vitest";
import { createLogger, silentLogger, type FetchLike } from "@uk-research/http";
import { createCompaniesHouseClient } from "./client.js";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Companies House client", () => {
  it("sends the API key as Basic auth and does not log it", async () => {
    const secret = "companies-house-test-key";
    const lines: string[] = [];
    let authorization = "";
    const fetchFn: FetchLike = async (_url, init) => {
      authorization = String((init?.headers as Record<string, string>).authorization);
      return jsonResponse(500, { error: `echo ${secret}` });
    };
    const client = createCompaniesHouseClient({
      apiKey: secret,
      fetchFn,
      sleep: async () => {},
      logger: createLogger({ write: (line) => lines.push(line), secrets: [secret], level: "warn" }),
    });
    const result = await client.getCompanyProfile({ companyNumber: "12345678" });
    expect(authorization).toBe(`Basic ${Buffer.from(`${secret}:`).toString("base64")}`);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result).includes(secret)).toBe(false);
    expect(lines.join("\n").includes(secret)).toBe(false);
  });

  it("retries a 429 and maps the profile", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async (url) => {
      calls += 1;
      expect(url).toContain("/company/12345678");
      if (calls === 1) return new Response(null, { status: 429, headers: { "retry-after": "0" } });
      return jsonResponse(200, {
        company_name: "NORTHSTAR ANALYTICS LTD",
        company_number: "12345678",
        company_status: "active",
        type: "ltd",
        sic_codes: ["62012"],
      });
    };
    const client = createCompaniesHouseClient({
      apiKey: "test-key-123",
      fetchFn,
      sleep: async () => {},
      logger: silentLogger,
    });
    const result = await client.getCompanyProfile({ companyNumber: "12345678" });
    expect(calls).toBe(2);
    expect(result.ok && result.data.companyName).toBe("NORTHSTAR ANALYTICS LTD");
  });

  it("reports a missing key and a 404 without calling the network for the missing key", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      return jsonResponse(404, {});
    };
    const missing = createCompaniesHouseClient({ apiKey: "", fetchFn });
    expect(await missing.searchCompanies({ query: "Northstar" })).toMatchObject({
      ok: false,
      error: { code: "missing_api_key" },
    });
    expect(calls).toBe(0);
    const notFound = createCompaniesHouseClient({ apiKey: "test-key-123", fetchFn });
    expect(await notFound.getCompanyProfile({ companyNumber: "00000001" })).toMatchObject({
      ok: false,
      error: { code: "not_found", status: 404 },
    });
  });
});
