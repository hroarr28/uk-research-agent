import { describe, expect, it } from "vitest";
import type { FetchLike } from "@uk-research/http";
import { connectLiveCatalog } from "./catalog.js";

describe("connectLiveCatalog", () => {
  it("calls Companies House through the MCP client without using the network", async () => {
    let seen = "";
    const fetchFn: FetchLike = async (url, init) => {
      seen = url;
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization?.startsWith("Basic ")).toBe(true);
      return new Response(
        JSON.stringify({
          total_results: 1,
          items: [
            {
              title: "NORTHSTAR ANALYTICS LTD",
              company_number: "12345678",
              company_status: "active",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const { catalog, close } = await connectLiveCatalog({ apiKey: "test-key-123", fetchFn });
    try {
      const names = catalog.definitions().map((tool) => tool.name);
      expect(names).toContain("search_companies");
      expect(names).toContain("summarise_street_crime");
      const text = await catalog.call("search_companies", { query: "NORTHSTAR ANALYTICS LTD" });
      expect(text).toContain("12345678");
      expect(seen).toContain("/search/companies");
    } finally {
      await close();
    }
  });
});
