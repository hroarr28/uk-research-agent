import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCatalog } from "@uk-research/agent";
import {
  companiesHouseToolNames,
  createCompaniesHouseServer,
  type CompaniesHouseClientOptions,
} from "@uk-research/companies-house-mcp";
import { toolError, toolJson, type ToolDefinition } from "@uk-research/contract";
import {
  createPoliceServer,
  policeToolNames,
  type PoliceClientOptions,
} from "@uk-research/police-uk-mcp";

export async function connectLiveCatalog(
  options: CompaniesHouseClientOptions & PoliceClientOptions = {},
): Promise<{ catalog: ToolCatalog; close: () => Promise<void> }> {
  const companies = await connect(createCompaniesHouseServer(options));
  const police = await connect(createPoliceServer(options));
  const companyNames = new Set<string>(companiesHouseToolNames());
  const policeNames = new Set<string>(policeToolNames());
  const listed = [
    ...(await companies.client.listTools()).tools,
    ...(await police.client.listTools()).tools,
  ];
  const definitions: ToolDefinition[] = listed.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: asRecord(tool.inputSchema),
  }));
  return {
    catalog: {
      definitions: () => definitions,
      async call(name, args) {
        const owner = companyNames.has(name)
          ? companies.client
          : policeNames.has(name)
            ? police.client
            : undefined;
        if (!owner) return toolJson(toolError("unknown_tool", `No tool named ${name}.`));
        const result = await owner.callTool({ name, arguments: args });
        return textFrom(result);
      },
    },
    close: async () => {
      await companies.client.close();
      await companies.server.close();
      await police.client.close();
      await police.server.close();
    },
  };
}

async function connect(server: McpServer): Promise<{ server: McpServer; client: Client }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "uk-research-agent", version: "0.1.0" });
  await client.connect(clientTransport);
  return { server, client };
}

function asRecord(schema: unknown): Record<string, unknown> {
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: "object" };
}

function textFrom(result: unknown): string {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return toolJson(toolError("invalid_response", "MCP tool result had no text."));
  }
  const text = result.content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : ""))
    .filter((item) => item.length > 0)
    .join("\n");
  return text.length > 0
    ? text
    : toolJson(toolError("invalid_response", "MCP tool result was empty."));
}
