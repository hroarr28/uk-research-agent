#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPoliceServer } from "./server.js";

const server = createPoliceServer();
await server.connect(new StdioServerTransport());
