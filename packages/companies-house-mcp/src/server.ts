import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolJson, type ToolResult } from "@uk-research/contract";
import { createCompaniesHouseClient, type CompaniesHouseClientOptions } from "./client.js";
import {
  companiesHouseDescription,
  companyNumberArgsSchema,
  companyProfileSchema,
  searchCompaniesSchema,
} from "./schemas.js";

export function createCompaniesHouseServer(options?: CompaniesHouseClientOptions): McpServer {
  const client = createCompaniesHouseClient(options);
  const server = new McpServer({ name: "companies-house", version: "0.1.0" });

  server.registerTool(
    "search_companies",
    {
      description: companiesHouseDescription("search_companies"),
      inputSchema: searchCompaniesSchema,
    },
    async (args) => mcpResult(await client.searchCompanies(args)),
  );
  server.registerTool(
    "get_company_profile",
    {
      description: companiesHouseDescription("get_company_profile"),
      inputSchema: companyProfileSchema,
    },
    async (args) => mcpResult(await client.getCompanyProfile(args)),
  );
  server.registerTool(
    "get_company_officers",
    {
      description: companiesHouseDescription("get_company_officers"),
      inputSchema: companyNumberArgsSchema,
    },
    async (args) => mcpResult(await client.getCompanyOfficers(args)),
  );
  server.registerTool(
    "get_filing_history",
    {
      description: companiesHouseDescription("get_filing_history"),
      inputSchema: companyNumberArgsSchema,
    },
    async (args) => mcpResult(await client.getFilingHistory(args)),
  );

  return server;
}

function mcpResult(result: ToolResult<unknown>) {
  return {
    content: [{ type: "text" as const, text: toolJson(result) }],
    ...(result.ok ? {} : { isError: true as const }),
  };
}
