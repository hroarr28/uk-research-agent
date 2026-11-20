import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function source(dir: string): string {
  return fileURLToPath(new URL(`./packages/${dir}/src/index.ts`, import.meta.url));
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@uk-research/contract": source("contract"),
      "@uk-research/http": source("http"),
      "@uk-research/tracing": source("tracing"),
      "@uk-research/companies-house-mcp": source("companies-house-mcp"),
      "@uk-research/police-uk-mcp": source("police-uk-mcp"),
      "@uk-research/agent": source("agent"),
      "@uk-research/eval": source("eval"),
    },
  },
});
