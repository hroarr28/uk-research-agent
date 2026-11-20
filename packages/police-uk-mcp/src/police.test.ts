import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "@uk-research/http";
import { COVERAGE_NOTE, summariseCrimes } from "./aggregate.js";
import { createPoliceClient } from "./client.js";
import { explainInvalidPoliceArgs } from "./schemas.js";
import { createPoliceServer } from "./server.js";

describe("Police UK schemas and aggregation", () => {
  it("rejects dates, coordinates, and categories outside the contract", () => {
    expect(explainInvalidPoliceArgs("list_crime_categories", { date: "2026-13" })).toMatch(
      /YYYY-MM/,
    );
    expect(
      explainInvalidPoliceArgs("summarise_street_crime", { lat: 10, lng: -1.1, date: "2026-08" }),
    ).toMatch(/lat/);
    expect(
      explainInvalidPoliceArgs("summarise_street_crime", {
        lat: 52.6,
        lng: -1.1,
        date: "2026-08",
        category: "../all-crime",
      }),
    ).toMatch(/slug/);
    expect(
      explainInvalidPoliceArgs("summarise_street_crime", {
        lat: 52.6369,
        lng: -1.1398,
        date: "2026-08",
      }),
    ).toBeUndefined();
  });

  it("counts categories and always includes the coverage note", () => {
    const summary = summariseCrimes(
      [{ category: "burglary" }, { category: "burglary" }, { category: "shoplifting" }],
      { lat: 52.6, lng: -1.1, date: "2026-08", category: "all-crime" },
    );
    expect(summary.total).toBe(3);
    expect(summary.byCategory).toEqual([
      { category: "burglary", count: 2 },
      { category: "shoplifting", count: 1 },
    ]);
    expect(summary.coverageNote).toBe(COVERAGE_NOTE);
    expect(JSON.stringify(summary)).not.toContain("persistent_id");
  });
});

describe("Police UK client and MCP server", () => {
  it("retries a 429, aggregates crimes, and sorts forces", async () => {
    let crimeCalls = 0;
    const fetchFn: FetchLike = async (url) => {
      if (url.endsWith("/forces")) {
        return json([
          { id: "metropolitan", name: "Metropolitan Police Service" },
          { id: "avon-and-somerset", name: "Avon and Somerset Constabulary" },
        ]);
      }
      crimeCalls += 1;
      if (crimeCalls === 1)
        return new Response(null, { status: 429, headers: { "retry-after": "0" } });
      expect(url).toContain("/crimes-street/burglary?");
      return json([
        { category: "burglary", id: 1, persistent_id: "secret-id" },
        { category: "burglary", id: 2, persistent_id: "secret-id-2" },
      ]);
    };
    const client = createPoliceClient({ fetchFn, sleep: async () => {} });
    const forces = await client.listForces();
    expect(forces.ok && forces.data.forces.map((force) => force.name)).toEqual([
      "Avon and Somerset Constabulary",
      "Metropolitan Police Service",
    ]);
    const summary = await client.summariseStreetCrime({
      lat: 52.6369,
      lng: -1.1398,
      date: "2026-08",
      category: "burglary",
    });
    expect(crimeCalls).toBe(2);
    expect(summary.ok && summary.data.total).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("secret-id");
  });

  it("serves an aggregated count through the MCP client", async () => {
    const fetchFn: FetchLike = async () =>
      json([{ category: "violent-crime" }, { category: "violent-crime" }]);
    const server = createPoliceServer({ fetchFn });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "list_crime_categories",
        "list_police_forces",
        "summarise_street_crime",
      ]);
      const result = await client.callTool({
        name: "summarise_street_crime",
        arguments: { lat: 52.6369, lng: -1.1398, date: "2026-08" },
      });
      const text = JSON.stringify(result);
      expect(text).toContain("violent-crime");
      expect(text).toContain("British Transport Police");
      const invalid = await client.callTool({
        name: "summarise_street_crime",
        arguments: { lat: 52.6369, lng: -1.1398, date: "2026-13" },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
