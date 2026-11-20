import { toolError, toolOk, type ToolResult } from "@uk-research/contract";
import { createHttpClient, type FetchLike, type HttpResult, type Logger } from "@uk-research/http";
import { z } from "zod";
import { summariseCrimes, type StreetCrimeSummary } from "./aggregate.js";
import type { ListCrimeCategoriesArgs, SummariseStreetCrimeArgs } from "./schemas.js";

export const POLICE_UK_BASE_URL = "https://data.police.uk/api";

const forceSchema = z.object({ id: z.string(), name: z.string() });
const categorySchema = z.object({ url: z.string(), name: z.string() });
const crimeSchema = z.object({ category: z.string() });

export type PoliceForce = { id: string; name: string };
export type CrimeCategory = { code: string; name: string };

export type PoliceClientOptions = {
  baseUrl?: string;
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  minIntervalMs?: number;
};

export type PoliceClient = {
  listForces(): Promise<ToolResult<{ forces: PoliceForce[] }>>;
  listCrimeCategories(
    args: ListCrimeCategoriesArgs,
  ): Promise<ToolResult<{ date: string; categories: CrimeCategory[] }>>;
  summariseStreetCrime(args: SummariseStreetCrimeArgs): Promise<ToolResult<StreetCrimeSummary>>;
  crimeLastUpdated(): Promise<ToolResult<{ date: string }>>;
};

export function createPoliceClient(options: PoliceClientOptions = {}): PoliceClient {
  const baseUrl = (options.baseUrl ?? POLICE_UK_BASE_URL).replace(/\/$/, "");
  const http = createHttpClient({
    fetchFn: options.fetchFn,
    sleep: options.sleep,
    logger: options.logger,
    minIntervalMs: options.minIntervalMs,
  });

  async function get(path: string): Promise<HttpResult<unknown>> {
    return http.getJson(`${baseUrl}${path}`);
  }

  return {
    async listForces() {
      const result = await get("/forces");
      if (!result.ok) return toolError(result.code, result.message, result.status);
      const parsed = z.array(forceSchema).safeParse(result.data);
      if (!parsed.success) return toolError("invalid_response", "Forces response was not a list.");
      const forces = parsed.data
        .map((force) => ({ id: force.id, name: force.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return toolOk({ forces });
    },
    async listCrimeCategories(args) {
      const result = await get(`/crime-categories?date=${encodeURIComponent(args.date)}`);
      if (!result.ok) return toolError(result.code, result.message, result.status);
      const parsed = z.array(categorySchema).safeParse(result.data);
      if (!parsed.success)
        return toolError("invalid_response", "Crime categories response was not a list.");
      const categories = parsed.data
        .map((category) => ({ code: category.url, name: category.name }))
        .sort((a, b) => a.code.localeCompare(b.code));
      return toolOk({ date: args.date, categories });
    },
    async summariseStreetCrime(args) {
      const category = args.category ?? "all-crime";
      if (!/^(all-crime|[a-z0-9-]{1,64})$/.test(category)) {
        return toolError("invalid_input", "Category must be a slug such as burglary.");
      }
      const params = new URLSearchParams({
        lat: String(args.lat),
        lng: String(args.lng),
        date: args.date,
      });
      const result = await get(`/crimes-street/${category}?${params.toString()}`);
      if (!result.ok) return toolError(result.code, result.message, result.status);
      const parsed = z.array(crimeSchema).safeParse(result.data);
      if (!parsed.success)
        return toolError("invalid_response", "Street crime response was not a list.");
      return toolOk(
        summariseCrimes(parsed.data, { lat: args.lat, lng: args.lng, date: args.date, category }),
      );
    },
    async crimeLastUpdated() {
      const result = await get("/crime-last-updated");
      if (!result.ok) return toolError(result.code, result.message, result.status);
      const parsed = z.object({ date: z.string() }).safeParse(result.data);
      if (!parsed.success)
        return toolError("invalid_response", "crime-last-updated did not include a date.");
      return toolOk({ date: parsed.data.date });
    },
  };
}
