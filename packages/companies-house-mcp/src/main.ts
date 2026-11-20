#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCompaniesHouseServer } from "./server.js";

const server = createCompaniesHouseServer();
await server.connect(new StdioServerTransport());
