import { toolError, toolOk, type ToolResult } from "@uk-research/contract";
import { z } from "zod";

const searchItemSchema = z.object({
  company_number: z.string(),
  title: z.string(),
  company_status: z.string().optional(),
  company_type: z.string().optional(),
  date_of_creation: z.string().optional(),
  address_snippet: z.string().optional(),
});

const searchSchema = z.object({
  items: z.array(searchItemSchema).optional(),
  total_results: z.number().optional(),
});

const addressSchema = z.object({
  address_line_1: z.string().optional(),
  locality: z.string().optional(),
  postal_code: z.string().optional(),
});

const profileSchema = z.object({
  company_name: z.string(),
  company_number: z.string(),
  company_status: z.string().optional(),
  type: z.string().optional(),
  date_of_creation: z.string().optional(),
  date_of_cessation: z.string().optional(),
  registered_office_address: addressSchema.optional(),
  sic_codes: z.array(z.string()).optional(),
});

const officerSchema = z.object({
  name: z.string(),
  officer_role: z.string().optional(),
  appointed_on: z.string().optional(),
  resigned_on: z.string().optional(),
  occupation: z.string().optional(),
});

const officersSchema = z.object({
  items: z.array(officerSchema).optional(),
  active_count: z.number().optional(),
  resigned_count: z.number().optional(),
  total_results: z.number().optional(),
});

const filingSchema = z.object({
  date: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  description_values: z.record(z.unknown()).optional(),
});

const filingsSchema = z.object({
  items: z.array(filingSchema).optional(),
  total_count: z.number().optional(),
});

export type CompanySearchData = {
  query: string;
  totalResults: number;
  companies: Array<{
    companyName: string;
    companyNumber: string;
    status: string;
    type: string;
    dateOfCreation: string | null;
    addressSnippet: string | null;
  }>;
};

export type CompanyProfile = {
  companyName: string;
  companyNumber: string;
  status: string;
  type: string;
  dateOfCreation: string | null;
  dateOfCessation: string | null;
  registeredOffice: {
    addressLine1: string | null;
    locality: string | null;
    postalCode: string | null;
  };
  sicCodes: string[];
};

export type OfficersData = {
  companyNumber: string;
  totalResults: number;
  activeCount: number;
  resignedCount: number;
  truncated: boolean;
  officers: Array<{
    name: string;
    role: string;
    appointedOn: string | null;
    resignedOn: string | null;
    occupation: string | null;
  }>;
};

export type FilingsData = {
  companyNumber: string;
  totalCount: number;
  truncated: boolean;
  filings: Array<{
    date: string | null;
    type: string | null;
    category: string | null;
    description: string | null;
    descriptionValues: Record<string, string>;
  }>;
};

export function mapSearch(query: string, payload: unknown): ToolResult<CompanySearchData> {
  const parsed = searchSchema.safeParse(payload);
  if (!parsed.success)
    return toolError(
      "invalid_response",
      "Company search response did not match the expected shape.",
    );
  const items = parsed.data.items ?? [];
  return toolOk({
    query,
    totalResults: parsed.data.total_results ?? items.length,
    companies: items.map((item) => ({
      companyName: item.title,
      companyNumber: item.company_number,
      status: item.company_status ?? "unknown",
      type: item.company_type ?? "unknown",
      dateOfCreation: item.date_of_creation ?? null,
      addressSnippet: item.address_snippet ?? null,
    })),
  });
}

export function mapProfile(payload: unknown): ToolResult<CompanyProfile> {
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success)
    return toolError(
      "invalid_response",
      "Company profile response did not match the expected shape.",
    );
  const address = parsed.data.registered_office_address;
  return toolOk({
    companyName: parsed.data.company_name,
    companyNumber: parsed.data.company_number,
    status: parsed.data.company_status ?? "unknown",
    type: parsed.data.type ?? "unknown",
    dateOfCreation: parsed.data.date_of_creation ?? null,
    dateOfCessation: parsed.data.date_of_cessation ?? null,
    registeredOffice: {
      addressLine1: address?.address_line_1 ?? null,
      locality: address?.locality ?? null,
      postalCode: address?.postal_code ?? null,
    },
    sicCodes: parsed.data.sic_codes ?? [],
  });
}

export function mapOfficers(companyNumber: string, payload: unknown): ToolResult<OfficersData> {
  const parsed = officersSchema.safeParse(payload);
  if (!parsed.success)
    return toolError("invalid_response", "Officers response did not match the expected shape.");
  const items = parsed.data.items ?? [];
  const officers = items.map((item) => ({
    name: item.name,
    role: item.officer_role ?? "unknown",
    appointedOn: item.appointed_on ?? null,
    resignedOn: item.resigned_on ?? null,
    occupation: item.occupation ?? null,
  }));
  const computedResigned = officers.filter((officer) => officer.resignedOn !== null).length;
  const totalResults = parsed.data.total_results ?? officers.length;
  return toolOk({
    companyNumber,
    totalResults,
    activeCount: parsed.data.active_count ?? officers.length - computedResigned,
    resignedCount: parsed.data.resigned_count ?? computedResigned,
    truncated: officers.length < totalResults,
    officers,
  });
}

export function mapFilings(companyNumber: string, payload: unknown): ToolResult<FilingsData> {
  const parsed = filingsSchema.safeParse(payload);
  if (!parsed.success)
    return toolError(
      "invalid_response",
      "Filing history response did not match the expected shape.",
    );
  const items = parsed.data.items ?? [];
  const filings = items.map((item) => ({
    date: item.date ?? null,
    type: item.type ?? null,
    category: item.category ?? null,
    description: item.description ?? null,
    descriptionValues: stringValues(item.description_values),
  }));
  const totalCount = parsed.data.total_count ?? filings.length;
  return toolOk({
    companyNumber,
    totalCount,
    truncated: filings.length < totalCount,
    filings,
  });
}

function stringValues(value: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
    else if (typeof entry === "number" || typeof entry === "boolean") out[key] = String(entry);
  }
  return out;
}
