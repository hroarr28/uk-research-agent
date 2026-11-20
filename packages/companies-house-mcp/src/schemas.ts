import { formatZodIssues, toJsonSchema, type ToolDefinition } from "@uk-research/contract";
import { z } from "zod";

export const companyNumberSchema = z
  .string()
  .regex(
    /^(\d{8}|[A-Z]{2}\d{6})$/,
    "Company number must be 8 digits or 2 letters followed by 6 digits",
  );

const itemsPerPage = z
  .number()
  .int()
  .min(1)
  .max(10)
  .optional()
  .describe("How many items to return, from 1 to 10.");

export const searchCompaniesSchema = z
  .object({
    query: z.string().min(2).max(100).describe("Company name to search for."),
    itemsPerPage: itemsPerPage,
  })
  .strict();

export const companyNumberArgsSchema = z
  .object({
    companyNumber: companyNumberSchema.describe("Companies House company number."),
    itemsPerPage: itemsPerPage,
  })
  .strict();

export const companyProfileSchema = z
  .object({
    companyNumber: companyNumberSchema.describe("Companies House company number."),
  })
  .strict();

export type SearchCompaniesArgs = z.infer<typeof searchCompaniesSchema>;
export type CompanyNumberArgs = z.infer<typeof companyNumberArgsSchema>;
export type CompanyProfileArgs = z.infer<typeof companyProfileSchema>;

const descriptions = {
  search_companies:
    "Search the Companies House register by name. Returns company number, status, type, creation date, and an address snippet.",
  get_company_profile:
    "Fetch a Companies House company profile by company number: status, type, dates, registered office, and SIC codes.",
  get_company_officers:
    "List officers for a company number. Returns name, role, appointment and resignation dates, and occupation. Home addresses and dates of birth are omitted.",
  get_filing_history:
    "List recent Companies House filings for a company number. Descriptions are API enumeration keys plus values such as the accounts made-up date.",
} as const;

const schemas = {
  search_companies: searchCompaniesSchema,
  get_company_profile: companyProfileSchema,
  get_company_officers: companyNumberArgsSchema,
  get_filing_history: companyNumberArgsSchema,
} as const;

export type CompaniesHouseToolName = keyof typeof schemas;

export function companiesHouseToolNames(): CompaniesHouseToolName[] {
  return Object.keys(schemas) as CompaniesHouseToolName[];
}

export const companiesHouseToolDefinitions: ToolDefinition[] = companiesHouseToolNames().map(
  (name) => ({
    name,
    description: descriptions[name],
    inputSchema: toJsonSchema(schemas[name]),
  }),
);

export function explainInvalidCompaniesHouseArgs(name: string, args: unknown): string | undefined {
  if (!(name in schemas)) return undefined;
  const parsed = schemas[name as CompaniesHouseToolName].safeParse(args);
  if (parsed.success) return undefined;
  return formatZodIssues(parsed.error);
}

export function companiesHouseDescription(name: CompaniesHouseToolName): string {
  return descriptions[name];
}
