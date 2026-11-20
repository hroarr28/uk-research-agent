import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "@uk-research/http";
import { createCompaniesHouseServer } from "./server.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Companies House MCP server", () => {
  it("lists tools and returns a mapped search through the MCP client", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      return jsonResponse({
        total_results: 1,
        items: [
          {
            title: "NORTHSTAR ANALYTICS LTD",
            company_number: "12345678",
            company_status: "active",
          },
        ],
      });
    };
    const server = createCompaniesHouseServer({ apiKey: "test-key-123", fetchFn });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "get_company_officers",
        "get_company_profile",
        "get_filing_history",
        "search_companies",
      ]);
      const result = await client.callTool({
        name: "search_companies",
        arguments: { query: "NORTHSTAR ANALYTICS LTD" },
      });
      expect(result.isError).toBeUndefined();
      const text = textOf(result);
      expect(text).toContain("NORTHSTAR ANALYTICS LTD");
      expect(calls).toBe(1);

      const invalid = await client.callTool({ name: "search_companies", arguments: { query: "" } });
      expect(invalid.isError).toBe(true);
      expect(calls).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function textOf(result: unknown): string {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return "";
  }
  return result.content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : ""))
    .join("\n");
}
