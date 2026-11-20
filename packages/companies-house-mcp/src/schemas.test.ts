import { describe, expect, it } from "vitest";
import { explainInvalidCompaniesHouseArgs, searchCompaniesSchema } from "./schemas.js";

describe("Companies House schemas", () => {
  it("accepts a search and a canonical company number", () => {
    expect(searchCompaniesSchema.safeParse({ query: "Northstar" }).success).toBe(true);
    expect(
      explainInvalidCompaniesHouseArgs("get_company_profile", { companyNumber: "12345678" }),
    ).toBeUndefined();
    expect(
      explainInvalidCompaniesHouseArgs("get_company_profile", { companyNumber: "SC123456" }),
    ).toBeUndefined();
  });

  it("rejects malformed numbers, empty queries, and unknown tools", () => {
    expect(
      explainInvalidCompaniesHouseArgs("get_company_profile", { companyNumber: "12" }),
    ).toMatch(/8 digits/);
    expect(
      explainInvalidCompaniesHouseArgs("get_company_profile", { companyNumber: "sc123456" }),
    ).toMatch(/8 digits/);
    expect(explainInvalidCompaniesHouseArgs("search_companies", { query: "a" })).toMatch(/query/);
    expect(
      explainInvalidCompaniesHouseArgs("search_companies", { query: "ok", extra: true }),
    ).toBeTypeOf("string");
    expect(explainInvalidCompaniesHouseArgs("summarise_street_crime", {})).toBeUndefined();
  });
});
