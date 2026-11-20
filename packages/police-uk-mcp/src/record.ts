#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPoliceClient, type PoliceClient } from "./client.js";

const POINTS = {
  leicester: { label: "Leicester city centre", lat: 52.6369, lng: -1.1398 },
  nottingham: { label: "Nottingham city centre", lat: 52.9548, lng: -1.1581 },
  shetland: { label: "Shetland", lat: 60.15, lng: -1.15 },
} as const;

export async function recordPoliceSnapshot(client: PoliceClient, retrievedAt: string) {
  const updated = await must(client.crimeLastUpdated());
  const forces = await must(client.listForces());
  const categories = await must(client.listCrimeCategories({ date: "2026-08" }));
  const leicesterAugust = await must(
    client.summariseStreetCrime({
      lat: POINTS.leicester.lat,
      lng: POINTS.leicester.lng,
      date: "2026-08",
    }),
  );
  const leicesterJuly = await must(
    client.summariseStreetCrime({
      lat: POINTS.leicester.lat,
      lng: POINTS.leicester.lng,
      date: "2026-07",
    }),
  );
  const nottinghamAugust = await must(
    client.summariseStreetCrime({
      lat: POINTS.nottingham.lat,
      lng: POINTS.nottingham.lng,
      date: "2026-08",
    }),
  );
  const shetlandAugust = await must(
    client.summariseStreetCrime({
      lat: POINTS.shetland.lat,
      lng: POINTS.shetland.lng,
      date: "2026-08",
    }),
  );
  const leicesterBurglary = await must(
    client.summariseStreetCrime({
      lat: POINTS.leicester.lat,
      lng: POINTS.leicester.lng,
      date: "2026-08",
      category: "burglary",
    }),
  );
  return {
    source: "https://data.police.uk/api",
    retrievedAt,
    crimeLastUpdated: updated.date,
    note: "Aggregated from the public street-level crime API. Individual crime identifiers are not stored. Companies House fixtures elsewhere in the eval suite are synthetic.",
    locations: POINTS,
    forces: forces.forces,
    categories: categories.categories,
    summaries: {
      "leicester-2026-08": leicesterAugust,
      "leicester-2026-07": leicesterJuly,
      "nottingham-2026-08": nottinghamAugust,
      "shetland-2026-08": shetlandAugust,
      "leicester-2026-08-burglary": leicesterBurglary,
    },
  };
}

async function main(): Promise<void> {
  const destination = process.argv[2] ?? path.resolve("evals/fixtures/police-recorded.json");
  const snapshot = await recordPoliceSnapshot(
    createPoliceClient({ minIntervalMs: 400 }),
    utcDate(),
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stderr.write(`Wrote ${destination}\n`);
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function must<T>(
  result: Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>,
): Promise<T> {
  const value = await result;
  if (!value.ok) throw new Error(value.error.message);
  return value.data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "record failed"}\n`);
    process.exitCode = 1;
  });
}
