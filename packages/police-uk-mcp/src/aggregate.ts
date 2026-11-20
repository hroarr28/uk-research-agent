export const COVERAGE_NOTE =
  "Counts are anonymised street-level crimes within about one mile of the point, not exact locations. data.police.uk does not include territorial-force crime in Scotland, only British Transport Police, so Scottish figures are not comparable with England and Wales.";

export type StreetCrimeSummary = {
  lat: number;
  lng: number;
  date: string;
  category: string;
  total: number;
  byCategory: Array<{ category: string; count: number }>;
  coverageNote: string;
  source: string;
};

export function summariseCrimes(
  crimes: ReadonlyArray<{ category: string }>,
  query: { lat: number; lng: number; date: string; category: string },
): StreetCrimeSummary {
  const counts = new Map<string, number>();
  for (const crime of crimes) {
    counts.set(crime.category, (counts.get(crime.category) ?? 0) + 1);
  }
  const byCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return {
    lat: query.lat,
    lng: query.lng,
    date: query.date,
    category: query.category,
    total: crimes.length,
    byCategory,
    coverageNote: COVERAGE_NOTE,
    source: "https://data.police.uk/docs/method/crime-street/",
  };
}
