import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolJson, type ToolResult } from "@uk-research/contract";
import { createPoliceClient, type PoliceClientOptions } from "./client.js";
import {
  listCrimeCategoriesSchema,
  listForcesSchema,
  policeDescription,
  summariseStreetCrimeSchema,
} from "./schemas.js";

export function createPoliceServer(options?: PoliceClientOptions): McpServer {
  const client = createPoliceClient(options);
  const server = new McpServer({ name: "police-uk", version: "0.1.0" });

  server.registerTool(
    "list_police_forces",
    { description: policeDescription("list_police_forces"), inputSchema: listForcesSchema },
    async () => mcpResult(await client.listForces()),
  );
  server.registerTool(
    "list_crime_categories",
    {
      description: policeDescription("list_crime_categories"),
      inputSchema: listCrimeCategoriesSchema,
    },
    async (args) => mcpResult(await client.listCrimeCategories(args)),
  );
  server.registerTool(
    "summarise_street_crime",
    {
      description: policeDescription("summarise_street_crime"),
      inputSchema: summariseStreetCrimeSchema,
    },
    async (args) => mcpResult(await client.summariseStreetCrime(args)),
  );

  return server;
}

function mcpResult(result: ToolResult<unknown>) {
  return {
    content: [{ type: "text" as const, text: toolJson(result) }],
    ...(result.ok ? {} : { isError: true as const }),
  };
}
