import { toolError, toolOk } from "@uk-research/contract";

/**
 * Synthetic Companies House documents. The company numbers and names are fictional
 * and are not extracts from the live register. The field names match the mapped tool
 * output, not a particular employer's data.
 */
export const northstarSearch = toolOk({
  query: "NORTHSTAR ANALYTICS LTD",
  totalResults: 1,
  companies: [
    {
      companyName: "NORTHSTAR ANALYTICS LTD",
      companyNumber: "12345678",
      status: "active",
      type: "ltd",
      dateOfCreation: "2019-04-02",
      addressSnippet: "1 Quay Street, Manchester, M3 4AE",
    },
  ],
});

export const northstarProfile = toolOk({
  companyName: "NORTHSTAR ANALYTICS LTD",
  companyNumber: "12345678",
  status: "active",
  type: "ltd",
  dateOfCreation: "2019-04-02",
  dateOfCessation: null,
  registeredOffice: { addressLine1: "1 Quay Street", locality: "Manchester", postalCode: "M3 4AE" },
  sicCodes: ["62012", "70229"],
});

export const northstarOfficers = toolOk({
  companyNumber: "12345678",
  totalResults: 3,
  activeCount: 2,
  resignedCount: 1,
  truncated: false,
  officers: [
    {
      name: "NORTH, Ada",
      role: "director",
      appointedOn: "2019-04-02",
      resignedOn: null,
      occupation: "Director",
    },
    {
      name: "QUILL, Jonathan",
      role: "director",
      appointedOn: "2021-09-15",
      resignedOn: "2024-02-29",
      occupation: "Engineer",
    },
    {
      name: "SEN, Priya",
      role: "secretary",
      appointedOn: "2022-01-10",
      resignedOn: null,
      occupation: "Company Secretary",
    },
  ],
});

export const northstarFilings = toolOk({
  companyNumber: "12345678",
  totalCount: 3,
  truncated: false,
  filings: [
    {
      date: "2024-09-30",
      type: "CS01",
      category: "confirmation-statement",
      description: "confirmation-statement",
      descriptionValues: {},
    },
    {
      date: "2024-07-12",
      type: "AA",
      category: "accounts",
      description: "accounts-with-accounts-type-full",
      descriptionValues: { made_up_date: "2024-03-31" },
    },
    {
      date: "2024-03-04",
      type: "TM01",
      category: "officers",
      description: "termination-director",
      descriptionValues: { officer_name: "QUILL, Jonathan" },
    },
  ],
});

export const brambleProfile = toolOk({
  companyName: "BRAMBLE WORKS LTD",
  companyNumber: "11223344",
  status: "dissolved",
  type: "ltd",
  dateOfCreation: "2014-05-20",
  dateOfCessation: "2023-11-30",
  registeredOffice: { addressLine1: "4 Kirk Gate", locality: "Leeds", postalCode: "LS1 3HS" },
  sicCodes: ["41202"],
});

export const emptySearch = toolOk({
  query: "zzzz-no-match-example",
  totalResults: 0,
  companies: [],
});

export const missingCompany = toolError("not_found", "Company 00000001 was not found.", 404);

export const USAGE = { inputTokens: 400, outputTokens: 80 };
export const EXPENSIVE_USAGE = { inputTokens: 5000, outputTokens: 1000 };
