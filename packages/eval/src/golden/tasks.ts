import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TokenUsage } from "@uk-research/agent";
import { toolOk } from "@uk-research/contract";
import {
  EXPENSIVE_USAGE,
  brambleProfile,
  emptySearch,
  missingCompany,
  northstarFilings,
  northstarOfficers,
  northstarProfile,
  northstarSearch,
  USAGE,
} from "./companies.js";
import type { GoldenTask, GoldenTurn } from "./types.js";

type Summary = {
  lat: number;
  lng: number;
  date: string;
  category: string;
  total: number;
  byCategory: Array<{ category: string; count: number }>;
  coverageNote: string;
};

type Snapshot = {
  forces: Array<{ id: string; name: string }>;
  categories: Array<{ code: string; name: string }>;
  summaries: Record<string, Summary>;
};

const recorded = readSnapshot();

function readSnapshot(): Snapshot {
  const snapshotPath = findSnapshot();
  return JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
}

function findSnapshot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = path.join(dir, "evals", "fixtures", "police-recorded.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find evals/fixtures/police-recorded.json. Run npm run record:police.");
}

const searchArgs = { query: "NORTHSTAR ANALYTICS LTD" };
const northstarArgs = { companyNumber: "12345678" };
const leicester = { lat: 52.6369, lng: -1.1398 };
const nottingham = { lat: 52.9548, lng: -1.1581 };
const shetland = { lat: 60.15, lng: -1.15 };

function judge(reason: string): GoldenTask["judge"] {
  return { score: 5, supported: true, reasons: [reason] };
}

function tools(
  calls: Extract<GoldenTurn, { toolCalls: unknown }>["toolCalls"],
  usage: TokenUsage = USAGE,
): GoldenTurn {
  return { usage, toolCalls: calls };
}

function answer(text: string, usage: TokenUsage = USAGE): GoldenTurn {
  return { usage, answer: text };
}

function task(
  partial: Omit<GoldenTask, "answerIncludes"> & { answerIncludes?: string[] },
): GoldenTask {
  return { answerIncludes: [], ...partial };
}

function summary(key: string): Summary {
  const value = recorded.summaries[key];
  if (!value) throw new Error(`Police snapshot is missing ${key}. Run npm run record:police.`);
  return value;
}

function force(id: string): { id: string; name: string } {
  const found = recorded.forces.find((item) => item.id === id);
  if (!found) throw new Error(`Police snapshot is missing force ${id}. Run npm run record:police.`);
  return found;
}

function category(code: string): { code: string; name: string } {
  const found = recorded.categories.find((item) => item.code === code);
  if (!found)
    throw new Error(`Police snapshot is missing category ${code}. Run npm run record:police.`);
  return found;
}

function buildTasks(): GoldenTask[] {
  const august = summary("leicester-2026-08");
  const july = summary("leicester-2026-07");
  const nottinghamAugust = summary("nottingham-2026-08");
  const shetlandAugust = summary("shetland-2026-08");
  const burglarySummary = summary("leicester-2026-08-burglary");
  const top = august.byCategory[0];
  const burglaryInAll = august.byCategory.find((item) => item.category === "burglary");
  if (!top || !burglaryInAll)
    throw new Error("Leicester August snapshot has no category breakdown.");
  const leicestershire = force("leicestershire");
  const metropolitan = force("metropolitan");
  const burglaryCategory = category("burglary");
  const higher =
    august.total === nottinghamAugust.total
      ? "The totals were equal."
      : august.total > nottinghamAugust.total
        ? "Leicester's total was higher."
        : "Nottingham's total was higher.";

  return [
    task({
      id: "ch-search-by-name",
      question: "What is the company number and status of NORTHSTAR ANALYTICS LTD?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "search_companies", args: searchArgs }],
      requiredFacts: ["NORTHSTAR ANALYTICS LTD", "12345678", "active"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The number and status come from the search result."),
      turns: [
        tools([{ name: "search_companies", args: searchArgs, result: northstarSearch }]),
        answer("NORTHSTAR ANALYTICS LTD is company number 12345678 and its status is active."),
      ],
    }),
    task({
      id: "ch-profile-active",
      question: "What is the status and creation date of company 12345678?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_profile", args: northstarArgs }],
      requiredFacts: ["active", "2019-04-02", "NORTHSTAR ANALYTICS LTD"],
      forbiddenClaims: ["dissolved"],
      checkNumbers: true,
      judge: judge("Status and creation date are both in the profile."),
      turns: [
        tools([{ name: "get_company_profile", args: northstarArgs, result: northstarProfile }]),
        answer("NORTHSTAR ANALYTICS LTD is active and was created on 2019-04-02."),
      ],
    }),
    task({
      id: "ch-officers-and-filings",
      question: "Summarise NORTHSTAR ANALYTICS LTD's officers and recent filings.",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [
        { name: "search_companies", args: searchArgs },
        { name: "get_company_officers", args: northstarArgs },
        { name: "get_filing_history", args: northstarArgs },
      ],
      requiredFacts: [
        "NORTH, Ada",
        "SEN, Priya",
        "QUILL, Jonathan",
        "2024-02-29",
        "2024-09-30",
        "2024-03-31",
        "2",
      ],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge(
        "Officer names, the resignation date, and the filing dates are in the tool results.",
      ),
      turns: [
        tools([{ name: "search_companies", args: searchArgs, result: northstarSearch }]),
        tools([
          { name: "get_company_officers", args: northstarArgs, result: northstarOfficers },
          { name: "get_filing_history", args: northstarArgs, result: northstarFilings },
        ]),
        answer(
          "NORTHSTAR ANALYTICS LTD (12345678) has 2 active officers. NORTH, Ada was appointed on 2019-04-02. SEN, Priya was appointed on 2022-01-10. QUILL, Jonathan resigned on 2024-02-29. Filings include CS01 on 2024-09-30 and accounts made up to 2024-03-31.",
        ),
      ],
    }),
    task({
      id: "ch-dissolved-status",
      question: "Is company 11223344 still active?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_profile", args: { companyNumber: "11223344" } }],
      requiredFacts: ["BRAMBLE WORKS LTD", "dissolved", "2023-11-30"],
      forbiddenClaims: ["active"],
      checkNumbers: true,
      judge: judge("The profile says the company is dissolved and gives the cessation date."),
      turns: [
        tools([
          {
            name: "get_company_profile",
            args: { companyNumber: "11223344" },
            result: brambleProfile,
          },
        ]),
        answer("BRAMBLE WORKS LTD is dissolved. The cessation date is 2023-11-30."),
      ],
    }),
    task({
      id: "ch-not-found",
      question: "Who are the officers of company 00000001?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_profile", args: { companyNumber: "00000001" } }],
      requiredFacts: ["00000001", "not_found"],
      forbiddenClaims: ["NORTH, Ada"],
      checkNumbers: true,
      judge: judge("The tool returned not_found and the answer does not invent officers."),
      turns: [
        tools([
          {
            name: "get_company_profile",
            args: { companyNumber: "00000001" },
            result: missingCompany,
          },
        ]),
        answer("Company 00000001 was not_found, so no officers can be listed."),
      ],
    }),
    task({
      id: "ch-empty-search",
      question: "Find a company named zzzz-no-match-example.",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "search_companies", args: { query: "zzzz-no-match-example" } }],
      requiredFacts: ["zzzz-no-match-example", "0"],
      forbiddenClaims: ["12345678"],
      checkNumbers: true,
      judge: judge("The search result is empty and the answer says so."),
      turns: [
        tools([
          {
            name: "search_companies",
            args: { query: "zzzz-no-match-example" },
            result: emptySearch,
          },
        ]),
        answer("No companies matched zzzz-no-match-example. The search returned 0 results."),
      ],
    }),
    task({
      id: "ch-officer-resigned",
      question: "When did QUILL, Jonathan resign from company 12345678?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_officers", args: northstarArgs }],
      requiredFacts: ["QUILL, Jonathan", "2024-02-29"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The resignation date is on the officer record."),
      turns: [
        tools([{ name: "get_company_officers", args: northstarArgs, result: northstarOfficers }]),
        answer("QUILL, Jonathan resigned on 2024-02-29."),
      ],
    }),
    task({
      id: "ch-sic-codes",
      question: "Which SIC codes does company 12345678 have?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_profile", args: northstarArgs }],
      requiredFacts: ["62012", "70229"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("Both SIC codes are on the profile."),
      turns: [
        tools([{ name: "get_company_profile", args: northstarArgs, result: northstarProfile }]),
        answer("Company 12345678 has SIC codes 62012 and 70229."),
      ],
    }),
    task({
      id: "ch-filing-accounts-date",
      question: "When were the latest accounts for company 12345678 made up to?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_filing_history", args: northstarArgs }],
      requiredFacts: ["2024-07-12", "2024-03-31"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The filing date and made-up date are in the filing history."),
      turns: [
        tools([{ name: "get_filing_history", args: northstarArgs, result: northstarFilings }]),
        answer("Accounts filed on 2024-07-12 were made up to 2024-03-31."),
      ],
    }),
    task({
      id: "ch-compare-two-companies",
      question: "Compare the status of company 12345678 and company 11223344.",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [
        { name: "get_company_profile", args: northstarArgs },
        { name: "get_company_profile", args: { companyNumber: "11223344" } },
      ],
      requiredFacts: ["NORTHSTAR ANALYTICS LTD", "active", "BRAMBLE WORKS LTD", "dissolved"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("Each status is taken from that company's profile."),
      turns: [
        tools([
          { name: "get_company_profile", args: northstarArgs, result: northstarProfile },
          {
            name: "get_company_profile",
            args: { companyNumber: "11223344" },
            result: brambleProfile,
          },
        ]),
        answer("NORTHSTAR ANALYTICS LTD is active. BRAMBLE WORKS LTD is dissolved."),
      ],
    }),
    task({
      id: "ch-registered-office",
      question: "What is the registered office of company 12345678?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_profile", args: northstarArgs }],
      requiredFacts: ["1 Quay Street", "M3 4AE"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The address lines are on the profile."),
      turns: [
        tools([{ name: "get_company_profile", args: northstarArgs, result: northstarProfile }]),
        answer("The registered office is 1 Quay Street, Manchester, M3 4AE."),
      ],
    }),
    task({
      id: "ch-active-officer-count",
      question: "How many active officers does company 12345678 have, and who are they?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_officers", args: northstarArgs }],
      requiredFacts: ["2", "NORTH, Ada", "SEN, Priya"],
      forbiddenClaims: ["QUILL, Jonathan"],
      checkNumbers: true,
      judge: judge("The active count and the two unresigned names are in the officer list."),
      turns: [
        tools([{ name: "get_company_officers", args: northstarArgs, result: northstarOfficers }]),
        answer("Company 12345678 has 2 active officers: NORTH, Ada and SEN, Priya."),
      ],
    }),
    task({
      id: "ch-search-then-profile-order",
      question: "Look up NORTHSTAR ANALYTICS LTD and then confirm its company type.",
      expectedStatus: "completed",
      order: "strict",
      expectedTools: [
        { name: "search_companies", args: searchArgs },
        { name: "get_company_profile", args: northstarArgs },
      ],
      requiredFacts: ["ltd", "12345678"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The type comes from the profile fetched after the search."),
      turns: [
        tools([{ name: "search_companies", args: searchArgs, result: northstarSearch }]),
        tools([{ name: "get_company_profile", args: northstarArgs, result: northstarProfile }]),
        answer("NORTHSTAR ANALYTICS LTD, company 12345678, is type ltd."),
      ],
    }),
    task({
      id: "ch-invalid-company-number",
      question: "Get the profile for company number 12.",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "get_company_profile", args: { companyNumber: "12" } }],
      requiredFacts: ["invalid_input"],
      forbiddenClaims: ["NORTHSTAR ANALYTICS LTD"],
      checkNumbers: true,
      judge: judge("The schema rejected the number and the answer does not invent a profile."),
      turns: [
        tools([
          {
            name: "get_company_profile",
            args: { companyNumber: "12" },
            result: toolOk({ ignored: true }),
          },
        ]),
        answer(
          "The company number was rejected as invalid_input. Company number must be 8 digits or 2 letters followed by 6 digits.",
        ),
      ],
    }),
    task({
      id: "police-force-names",
      question:
        "Does the Police UK force list include Leicestershire Police and the Metropolitan Police Service?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "list_police_forces", args: {} }],
      requiredFacts: [leicestershire.name, metropolitan.name],
      forbiddenClaims: [],
      checkNumbers: false,
      judge: judge("Both force names are in the published list."),
      turns: [
        tools([
          { name: "list_police_forces", args: {}, result: toolOk({ forces: recorded.forces }) },
        ]),
        answer(`The force list includes ${leicestershire.name} and ${metropolitan.name}.`),
      ],
    }),
    task({
      id: "police-categories-include-burglary",
      question: "Is burglary a Police UK crime category for 2026-08?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "list_crime_categories", args: { date: "2026-08" } }],
      requiredFacts: [burglaryCategory.code, burglaryCategory.name, "2026-08"],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The category code and name are in the category list for that month."),
      turns: [
        tools([
          {
            name: "list_crime_categories",
            args: { date: "2026-08" },
            result: toolOk({ date: "2026-08", categories: recorded.categories }),
          },
        ]),
        answer(
          `The 2026-08 category list includes ${burglaryCategory.code} (${burglaryCategory.name}).`,
        ),
      ],
    }),
    task({
      id: "police-leicester-august-total",
      question: `How many street-level crimes were recorded within a mile of latitude ${leicester.lat}, longitude ${leicester.lng} in 2026-08, and how many were burglary?`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "summarise_street_crime", args: { ...leicester, date: "2026-08" } }],
      requiredFacts: [String(august.total), String(burglaryInAll.count), "burglary", august.date],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The total and the burglary count are in the August summary."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-08" },
            result: toolOk(august),
          },
        ]),
        answer(
          `In ${august.date} the sample recorded ${august.total} street-level crimes, of which ${burglaryInAll.count} were burglary.`,
        ),
      ],
    }),
    task({
      id: "police-compare-leicester-nottingham",
      question: `Compare street-level crime within a mile of latitude ${leicester.lat}, longitude ${leicester.lng} with latitude ${nottingham.lat}, longitude ${nottingham.lng} in 2026-08.`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [
        { name: "summarise_street_crime", args: { ...leicester, date: "2026-08" } },
        { name: "summarise_street_crime", args: { ...nottingham, date: "2026-08" } },
      ],
      requiredFacts: [String(august.total), String(nottinghamAugust.total), august.date],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("Both totals come from the two street-crime summaries."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-08" },
            result: toolOk(august),
          },
          {
            name: "summarise_street_crime",
            args: { ...nottingham, date: "2026-08" },
            result: toolOk(nottinghamAugust),
          },
        ]),
        answer(
          `In ${august.date}, street-level crime within a mile of the first point totalled ${august.total}, and the second point totalled ${nottinghamAugust.total}. ${higher}`,
        ),
      ],
    }),
    task({
      id: "police-leicester-burglary",
      question: `How many burglary crimes were recorded within a mile of latitude ${leicester.lat}, longitude ${leicester.lng} in 2026-08?`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [
        {
          name: "summarise_street_crime",
          args: { ...leicester, date: "2026-08", category: "burglary" },
        },
      ],
      requiredFacts: [String(burglarySummary.total), "burglary", burglarySummary.date],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The filtered summary's total is the burglary count."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-08", category: "burglary" },
            result: toolOk(burglarySummary),
          },
        ]),
        answer(
          `The burglary category for ${burglarySummary.date} returned ${burglarySummary.total} crimes.`,
        ),
      ],
    }),
    task({
      id: "police-shetland-coverage",
      question: `How many street-level crimes did data.police.uk record within a mile of latitude ${shetland.lat}, longitude ${shetland.lng} in 2026-08? This point is in Scotland. Include the dataset's Scotland coverage limit.`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "summarise_street_crime", args: { ...shetland, date: "2026-08" } }],
      requiredFacts: [
        String(shetlandAugust.total),
        shetlandAugust.date,
        "British Transport Police",
      ],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge(
        "The total and the British Transport Police coverage note are both in the tool output.",
      ),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...shetland, date: "2026-08" },
            result: toolOk(shetlandAugust),
          },
        ]),
        answer(
          `data.police.uk recorded ${shetlandAugust.total} street-level crimes within a mile of that point in ${shetlandAugust.date}. British Transport Police is the only contributor for Scotland in this dataset, so the figure is not a territorial-force total.`,
        ),
      ],
    }),
    task({
      id: "police-highest-category",
      question: `What was the most common street-crime category within a mile of latitude ${leicester.lat}, longitude ${leicester.lng} in 2026-08?`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "summarise_street_crime", args: { ...leicester, date: "2026-08" } }],
      requiredFacts: [top.category, String(top.count), august.date],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The top category and its count are the first row of the summary."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-08" },
            result: toolOk(august),
          },
        ]),
        answer(
          `In ${august.date} the most common category was ${top.category} with ${top.count} crimes.`,
        ),
      ],
    }),
    task({
      id: "police-leicester-two-months",
      question: `Compare street-level crime within a mile of latitude ${leicester.lat}, longitude ${leicester.lng} for 2026-07 and 2026-08.`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [
        { name: "summarise_street_crime", args: { ...leicester, date: "2026-07" } },
        { name: "summarise_street_crime", args: { ...leicester, date: "2026-08" } },
      ],
      requiredFacts: [String(july.total), july.date, String(august.total), august.date],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("Each month's total comes from that month's summary."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-07" },
            result: toolOk(july),
          },
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-08" },
            result: toolOk(august),
          },
        ]),
        answer(
          `The point totalled ${july.total} in ${july.date} and ${august.total} in ${august.date}.`,
        ),
      ],
    }),
    task({
      id: "police-nottingham-cites-month",
      question: `What was the street-level crime total within a mile of latitude ${nottingham.lat}, longitude ${nottingham.lng} in 2026-08? Name the month.`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "summarise_street_crime", args: { ...nottingham, date: "2026-08" } }],
      requiredFacts: [nottinghamAugust.date, String(nottinghamAugust.total)],
      forbiddenClaims: [],
      checkNumbers: true,
      judge: judge("The month and total are in the Nottingham summary."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...nottingham, date: "2026-08" },
            result: toolOk(nottinghamAugust),
          },
        ]),
        answer(`The ${nottinghamAugust.date} street-level total was ${nottinghamAugust.total}.`),
      ],
    }),
    task({
      id: "police-invalid-date",
      question: `Summarise street crime at latitude ${leicester.lat}, longitude ${leicester.lng} for the month 2026-13.`,
      expectedStatus: "completed",
      order: "any",
      expectedTools: [{ name: "summarise_street_crime", args: { ...leicester, date: "2026-13" } }],
      requiredFacts: ["invalid_input"],
      forbiddenClaims: ["violent-crime"],
      checkNumbers: true,
      judge: judge("The month failed validation and the answer does not invent a count."),
      turns: [
        tools([
          {
            name: "summarise_street_crime",
            args: { ...leicester, date: "2026-13" },
            result: toolOk({ ignored: true }),
          },
        ]),
        answer("The date was rejected as invalid_input. Month must be YYYY-MM."),
      ],
    }),
    task({
      id: "out-of-scope-weather",
      question: "What is the weather in Leeds tomorrow?",
      expectedStatus: "completed",
      order: "any",
      expectedTools: [],
      requiredFacts: [],
      forbiddenClaims: ["degrees", "celsius"],
      checkNumbers: false,
      judge: judge("The agent declines instead of inventing a forecast."),
      turns: [
        answer(
          "I can't answer a weather forecast from Companies House or Police UK. I won't guess one.",
        ),
      ],
    }),
    task({
      id: "step-limit",
      question: "Find NORTHSTAR ANALYTICS LTD.",
      expectedStatus: "step_limit",
      order: "any",
      expectedTools: [{ name: "search_companies", args: searchArgs }],
      requiredFacts: ["12345678"],
      answerIncludes: ["step limit"],
      forbiddenClaims: [],
      checkNumbers: true,
      limits: { maxSteps: 1 },
      judge: judge("The run stopped at the step limit and kept the tool result."),
      turns: [tools([{ name: "search_companies", args: searchArgs, result: northstarSearch }])],
    }),
    task({
      id: "cost-budget",
      question: "Find NORTHSTAR ANALYTICS LTD.",
      expectedStatus: "budget_exceeded",
      order: "any",
      expectedTools: [{ name: "search_companies", args: searchArgs }],
      requiredFacts: ["12345678"],
      answerIncludes: ["cost budget"],
      forbiddenClaims: [],
      checkNumbers: true,
      limits: { maxCostUsd: 0.001 },
      judge: judge("The run stopped because the cost budget was spent."),
      turns: [
        {
          usage: EXPENSIVE_USAGE,
          toolCalls: [{ name: "search_companies", args: searchArgs, result: northstarSearch }],
        },
      ],
    }),
    task({
      id: "token-budget",
      question: "Find NORTHSTAR ANALYTICS LTD.",
      expectedStatus: "budget_exceeded",
      order: "any",
      expectedTools: [{ name: "search_companies", args: searchArgs }],
      requiredFacts: ["12345678"],
      answerIncludes: ["token budget"],
      forbiddenClaims: [],
      checkNumbers: true,
      limits: { maxTotalTokens: 100 },
      judge: judge("The run stopped because the token budget was spent."),
      turns: [tools([{ name: "search_companies", args: searchArgs, result: northstarSearch }])],
    }),
  ];
}

export function loadGoldenTasks(): GoldenTask[] {
  return buildTasks();
}
