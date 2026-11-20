import { describe, expect, it } from "vitest";
import { mapFilings, mapOfficers, mapProfile, mapSearch } from "./map.js";

describe("Companies House mappers", () => {
  it("drops officer addresses and dates of birth", () => {
    const mapped = mapOfficers("12345678", {
      active_count: 1,
      resigned_count: 1,
      total_results: 2,
      items: [
        {
          name: "NORTH, Ada",
          officer_role: "director",
          appointed_on: "2019-04-02",
          occupation: "Director",
          nationality: "British",
          date_of_birth: { month: 4, year: 1980 },
          address: { address_line_1: "1 Secret Road", postal_code: "M1 1AA" },
        },
        {
          name: "QUILL, Jonathan",
          officer_role: "director",
          appointed_on: "2021-09-15",
          resigned_on: "2024-02-29",
        },
      ],
    });
    expect(mapped.ok).toBe(true);
    const text = JSON.stringify(mapped);
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("date_of_birth");
    expect(text).not.toContain("British");
    expect(text).not.toContain("M1 1AA");
    if (mapped.ok) {
      expect(mapped.data.activeCount).toBe(1);
      expect(mapped.data.resignedCount).toBe(1);
      expect(mapped.data.officers[1]?.resignedOn).toBe("2024-02-29");
    }
  });

  it("maps search, profile, and filings and flags a truncated page", () => {
    const search = mapSearch("Northstar", {
      total_results: 1,
      items: [
        {
          title: "NORTHSTAR ANALYTICS LTD",
          company_number: "12345678",
          company_status: "active",
          company_type: "ltd",
          date_of_creation: "2019-04-02",
          address_snippet: "1 Quay Street, Manchester, M3 4AE",
        },
      ],
    });
    const profile = mapProfile({
      company_name: "BRAMBLE WORKS LTD",
      company_number: "11223344",
      company_status: "dissolved",
      type: "ltd",
      date_of_cessation: "2023-11-30",
      registered_office_address: {
        address_line_1: "4 Kirk Gate",
        locality: "Leeds",
        postal_code: "LS1 3HS",
      },
      sic_codes: ["41202"],
    });
    const filings = mapFilings("12345678", {
      total_count: 4,
      items: [
        {
          date: "2024-07-12",
          type: "AA",
          category: "accounts",
          description: "accounts-with-accounts-type-full",
          description_values: { made_up_date: "2024-03-31" },
          links: { self: "/ignore" },
        },
      ],
    });
    expect(search.ok && search.data.companies[0]?.companyNumber).toBe("12345678");
    expect(profile.ok && profile.data.dateOfCessation).toBe("2023-11-30");
    expect(profile.ok && profile.data.sicCodes).toEqual(["41202"]);
    expect(filings.ok && filings.data.truncated).toBe(true);
    expect(filings.ok && filings.data.filings[0]?.descriptionValues.made_up_date).toBe(
      "2024-03-31",
    );
    expect(JSON.stringify(filings)).not.toContain("/ignore");
  });

  it("returns invalid_response for the wrong document", () => {
    expect(mapProfile({ error: "nope" }).ok).toBe(false);
  });
});
