import { formatZodIssues, toJsonSchema, type ToolDefinition } from "@uk-research/contract";
import { z } from "zod";

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM")
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 2015 && year <= 2030;
  }, "Month must be from 2015 to 2030");

export const listForcesSchema = z.object({}).strict();

export const listCrimeCategoriesSchema = z
  .object({
    date: monthSchema.describe("Month in YYYY-MM. Categories can change over time."),
  })
  .strict();

export const summariseStreetCrimeSchema = z
  .object({
    lat: z
      .number()
      .finite()
      .gte(49)
      .lte(61)
      .describe("WGS84 latitude inside the UK box from 49 to 61."),
    lng: z
      .number()
      .finite()
      .gte(-8.7)
      .lte(1.9)
      .describe("WGS84 longitude inside the UK box from -8.7 to 1.9."),
    date: monthSchema.describe("Crime month in YYYY-MM."),
    category: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/, "Category must be a slug such as burglary")
      .optional()
      .describe("Optional category slug. Omit to count every category."),
  })
  .strict();

export type ListCrimeCategoriesArgs = z.infer<typeof listCrimeCategoriesSchema>;
export type SummariseStreetCrimeArgs = z.infer<typeof summariseStreetCrimeSchema>;

const descriptions = {
  list_police_forces:
    "List police forces published by data.police.uk. Returns each force id and name.",
  list_crime_categories: "List street-crime categories for one month from data.police.uk.",
  summarise_street_crime:
    "Count anonymised street-level crimes within about one mile of a UK point for one month. Returns totals by category and omits crime identifiers. Scotland in this dataset is British Transport Police only.",
} as const;

const schemas = {
  list_police_forces: listForcesSchema,
  list_crime_categories: listCrimeCategoriesSchema,
  summarise_street_crime: summariseStreetCrimeSchema,
} as const;

export type PoliceToolName = keyof typeof schemas;

export function policeToolNames(): PoliceToolName[] {
  return Object.keys(schemas) as PoliceToolName[];
}

export const policeToolDefinitions: ToolDefinition[] = policeToolNames().map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: toJsonSchema(schemas[name]),
}));

export function explainInvalidPoliceArgs(name: string, args: unknown): string | undefined {
  if (!(name in schemas)) return undefined;
  const parsed = schemas[name as PoliceToolName].safeParse(args);
  if (parsed.success) return undefined;
  return formatZodIssues(parsed.error);
}

export function policeDescription(name: PoliceToolName): string {
  return descriptions[name];
}
