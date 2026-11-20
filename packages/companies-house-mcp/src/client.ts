import { toolError, type ToolResult } from "@uk-research/contract";
import { createHttpClient, type FetchLike, type HttpResult, type Logger } from "@uk-research/http";
import {
  mapFilings,
  mapOfficers,
  mapProfile,
  mapSearch,
  type CompanyProfile,
  type CompanySearchData,
  type FilingsData,
  type OfficersData,
} from "./map.js";
import type { CompanyNumberArgs, CompanyProfileArgs, SearchCompaniesArgs } from "./schemas.js";

export const COMPANIES_HOUSE_BASE_URL = "https://api.company-information.service.gov.uk";

export type CompaniesHouseClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  minIntervalMs?: number;
};

export type CompaniesHouseClient = {
  searchCompanies(args: SearchCompaniesArgs): Promise<ToolResult<CompanySearchData>>;
  getCompanyProfile(args: CompanyProfileArgs): Promise<ToolResult<CompanyProfile>>;
  getCompanyOfficers(args: CompanyNumberArgs): Promise<ToolResult<OfficersData>>;
  getFilingHistory(args: CompanyNumberArgs): Promise<ToolResult<FilingsData>>;
};

export function createCompaniesHouseClient(
  options: CompaniesHouseClientOptions = {},
): CompaniesHouseClient {
  const apiKey =
    options.apiKey !== undefined ? options.apiKey : (process.env.COMPANIES_HOUSE_API_KEY ?? "");
  const baseUrl = (options.baseUrl ?? COMPANIES_HOUSE_BASE_URL).replace(/\/$/, "");
  const http = createHttpClient({
    fetchFn: options.fetchFn,
    sleep: options.sleep,
    logger: options.logger,
    secrets: apiKey.length >= 8 ? [apiKey] : [],
    minIntervalMs: options.minIntervalMs,
  });

  async function get(path: string): Promise<HttpResult<unknown>> {
    if (apiKey.length === 0) {
      return {
        ok: false,
        code: "missing_api_key",
        message: "Set COMPANIES_HOUSE_API_KEY to a Companies House REST API key.",
      };
    }
    const token = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
    return http.getJson(`${baseUrl}${path}`, { authorization: `Basic ${token}` });
  }

  return {
    async searchCompanies(args) {
      const page = args.itemsPerPage ?? 5;
      const result = await get(
        `/search/companies?q=${encodeURIComponent(args.query)}&items_per_page=${page}`,
      );
      if (!result.ok) return asToolError(result);
      return mapSearch(args.query, result.data);
    },
    async getCompanyProfile(args) {
      const result = await get(`/company/${encodeURIComponent(args.companyNumber)}`);
      if (!result.ok) return asToolError(result);
      return mapProfile(result.data);
    },
    async getCompanyOfficers(args) {
      const page = args.itemsPerPage ?? 10;
      const result = await get(
        `/company/${encodeURIComponent(args.companyNumber)}/officers?items_per_page=${page}`,
      );
      if (!result.ok) return asToolError(result);
      return mapOfficers(args.companyNumber, result.data);
    },
    async getFilingHistory(args) {
      const page = args.itemsPerPage ?? 10;
      const result = await get(
        `/company/${encodeURIComponent(args.companyNumber)}/filing-history?items_per_page=${page}`,
      );
      if (!result.ok) return asToolError(result);
      return mapFilings(args.companyNumber, result.data);
    },
  };
}

function asToolError(result: {
  ok: false;
  code: string;
  message: string;
  status?: number;
}): ToolResult<never> {
  if (result.code === "not_found")
    return toolError("not_found", "Company not found.", result.status);
  return toolError(result.code, result.message, result.status);
}
