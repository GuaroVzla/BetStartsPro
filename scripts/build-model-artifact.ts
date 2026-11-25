import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fitDixonColesModel, type HistoricalMatch } from "../src/lib/dixonColes.ts";
import { buildEloSnapshots, DEFAULT_ELO_CONFIG } from "../src/services/ratingService.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseHistoricalResults(raw: unknown): HistoricalMatch[] {
  if (!Array.isArray(raw)) return [];
  const parsed: HistoricalMatch[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    if (typeof item.date !== "string" || !Number.isFinite(Date.parse(item.date))) continue;
    if (typeof item.home !== "string" || item.home.length === 0) continue;
    if (typeof item.away !== "string" || item.away.length === 0) continue;
    const homeGoals = asFiniteNumber(item.homeGoals);
    const awayGoals = asFiniteNumber(item.awayGoals);
    if (homeGoals === null || awayGoals === null || homeGoals < 0 || awayGoals < 0) continue;
    const row: HistoricalMatch = {
      id: item.id,
      date: item.date,
      home: item.home,
      away: item.away,
      homeGoals,
      awayGoals,
    };
    if (typeof item.leagueId === "string" && item.leagueId.length > 0) {
      row.leagueId = item.leagueId;
    }
    parsed.push(row);
  }
  return parsed.sort((a, b) => {
    const delta = Date.parse(a.date) - Date.parse(b.date);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

function main(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const dataPath = path.join(repoRoot, "data", "historical-results.json");
  const outPath = path.join(repoRoot, "src", "data", "model-params.json");

  if (!fs.existsSync(dataPath)) {
    console.error(`Missing ${dataPath}. Add historical results before building artifact.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8")) as unknown;
  const matches = parseHistoricalResults(raw);
  if (matches.length === 0) {
    console.error("No valid historical matches found. Artifact not written.");
    process.exit(1);
  }

  const dixonColes = fitDixonColesModel(matches);
  const elo = buildEloSnapshots(matches, DEFAULT_ELO_CONFIG);
  const artifact = {
    generatedAt: new Date().toISOString(),
    dixonColes,
    elo,
    eloConfig: DEFAULT_ELO_CONFIG,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(
    `matches=${matches.length} teams(dc)=${Object.keys(dixonColes.attack).length} teams(elo)=${Object.keys(elo).length}`,
  );
}

main();
