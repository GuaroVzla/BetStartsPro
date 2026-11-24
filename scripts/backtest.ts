import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dixonColesProbabilities,
  fitDixonColesModel,
  lambdasForMatch,
  type HistoricalMatch,
} from "../src/lib/dixonColes";
import {
  buildEloSnapshots,
  decayRating,
  DEFAULT_ELO_CONFIG,
  eloProbabilities,
  type EloSnapshot,
} from "../src/services/ratingService";

type Outcome = "home" | "draw" | "away";

interface HistoricalResult extends HistoricalMatch {
  closingOdds?: Record<Outcome, number>;
}

interface OutcomeMetrics {
  count: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  rps: number;
  ece: number;
}

interface MetricAccumulator {
  count: number;
  correct: number;
  brier: number;
  logLoss: number;
  rps: number;
  eceBins: Array<{ sumPred: number; sumOutcome: number; count: number }>;
}

const OUTCOMES: Outcome[] = ["home", "draw", "away"];
const ECE_BINS = 10;
const EPSILON = 1e-12;
const DIXON_COLES_WEIGHT = 0.7;
const ELO_WEIGHT = 0.3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseHistoricalResults(raw: unknown): HistoricalResult[] {
  if (!Array.isArray(raw)) return [];

  const parsed: HistoricalResult[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    if (typeof item.date !== "string" || !Number.isFinite(Date.parse(item.date))) continue;
    if (typeof item.home !== "string" || item.home.length === 0) continue;
    if (typeof item.away !== "string" || item.away.length === 0) continue;

    const homeGoals = asFiniteNumber(item.homeGoals);
    const awayGoals = asFiniteNumber(item.awayGoals);
    if (homeGoals === null || awayGoals === null || homeGoals < 0 || awayGoals < 0) continue;

    const row: HistoricalResult = {
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

    if (isRecord(item.closingOdds)) {
      const home = asFiniteNumber(item.closingOdds.home);
      const draw = asFiniteNumber(item.closingOdds.draw);
      const away = asFiniteNumber(item.closingOdds.away);
      if (home !== null && draw !== null && away !== null && home > 1 && draw > 1 && away > 1) {
        row.closingOdds = { home, draw, away };
      }
    }

    parsed.push(row);
  }

  return parsed.sort((a, b) => {
    const delta = Date.parse(a.date) - Date.parse(b.date);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

function normalizeProbabilities(
  probs: Record<Outcome, number>,
): Record<Outcome, number> {
  const safe: Record<Outcome, number> = {
    home: Math.max(0, probs.home),
    draw: Math.max(0, probs.draw),
    away: Math.max(0, probs.away),
  };
  const total = safe.home + safe.draw + safe.away;
  if (!Number.isFinite(total) || total <= 0) {
    return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  }
  return {
    home: safe.home / total,
    draw: safe.draw / total,
    away: safe.away / total,
  };
}

function devigClosingOdds(odds: Record<Outcome, number>): Record<Outcome, number> {
  const implied = {
    home: 1 / Math.max(EPSILON, odds.home),
    draw: 1 / Math.max(EPSILON, odds.draw),
    away: 1 / Math.max(EPSILON, odds.away),
  };
  return normalizeProbabilities(implied);
}

function mixProbabilities(
  dc: Record<Outcome, number>,
  elo: Record<Outcome, number>,
): Record<Outcome, number> {
  return normalizeProbabilities({
    home: dc.home * DIXON_COLES_WEIGHT + elo.home * ELO_WEIGHT,
    draw: dc.draw * DIXON_COLES_WEIGHT + elo.draw * ELO_WEIGHT,
    away: dc.away * DIXON_COLES_WEIGHT + elo.away * ELO_WEIGHT,
  });
}

function actualOutcome(match: HistoricalResult): Outcome {
  if (match.homeGoals > match.awayGoals) return "home";
  if (match.homeGoals < match.awayGoals) return "away";
  return "draw";
}

function predictedOutcome(probs: Record<Outcome, number>): Outcome {
  let best: Outcome = "home";
  let bestValue = -1;
  for (const outcome of OUTCOMES) {
    if (probs[outcome] > bestValue) {
      best = outcome;
      bestValue = probs[outcome];
    }
  }
  return best;
}

function createAccumulator(): MetricAccumulator {
  return {
    count: 0,
    correct: 0,
    brier: 0,
    logLoss: 0,
    rps: 0,
    eceBins: Array.from({ length: ECE_BINS }, () => ({ sumPred: 0, sumOutcome: 0, count: 0 })),
  };
}

function addObservation(
  acc: MetricAccumulator,
  probs: Record<Outcome, number>,
  actual: Outcome,
): void {
  const p = normalizeProbabilities(probs);
  acc.count += 1;
  if (predictedOutcome(p) === actual) acc.correct += 1;

  for (const outcome of OUTCOMES) {
    const observed = outcome === actual ? 1 : 0;
    acc.brier += (p[outcome] - observed) ** 2;
  }

  acc.logLoss += -Math.log(Math.max(EPSILON, p[actual]));

  const cumPred = [p.home, p.home + p.draw, p.home + p.draw + p.away];
  const cumActual = [
    actual === "home" ? 1 : 0,
    actual === "home" || actual === "draw" ? 1 : 0,
    1,
  ];
  let rps = 0;
  for (let i = 0; i < OUTCOMES.length - 1; i += 1) {
    rps += (cumPred[i] - cumActual[i]) ** 2;
  }
  acc.rps += rps / (OUTCOMES.length - 1);

  const predictedActual = Math.max(EPSILON, Math.min(1, p[actual]));
  const bin = Math.min(ECE_BINS - 1, Math.floor(predictedActual * ECE_BINS));
  acc.eceBins[bin].sumPred += predictedActual;
  acc.eceBins[bin].sumOutcome += 1;
  acc.eceBins[bin].count += 1;
}

function finalizeMetrics(acc: MetricAccumulator): OutcomeMetrics {
  if (acc.count === 0) {
    return { count: 0, accuracy: 0, brier: 0, logLoss: 0, rps: 0, ece: 0 };
  }

  let ece = 0;
  for (const bin of acc.eceBins) {
    if (bin.count === 0) continue;
    ece += (bin.count / acc.count) * Math.abs(bin.sumOutcome / bin.count - bin.sumPred / bin.count);
  }

  return {
    count: acc.count,
    accuracy: acc.correct / acc.count,
    brier: acc.brier / acc.count,
    logLoss: acc.logLoss / acc.count,
    rps: acc.rps / acc.count,
    ece,
  };
}

function eloSnapshotAsOf(
  snapshots: Record<string, EloSnapshot>,
  team: string,
  asOf: string,
): number {
  const snapshot = snapshots[team];
  if (!snapshot) return DEFAULT_ELO_CONFIG.initialRating;
  return decayRating(snapshot.rating, snapshot.lastMatchAt, asOf, DEFAULT_ELO_CONFIG);
}

function formatMetric(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printReport(model: OutcomeMetrics, market: OutcomeMetrics): void {
  const rows: Array<[string, string, string]> = [
    ["count", String(model.count), String(market.count)],
    ["accuracy", formatMetric(model.accuracy), formatMetric(market.accuracy)],
    ["rps", formatMetric(model.rps), formatMetric(market.rps)],
    ["log-loss", formatMetric(model.logLoss), formatMetric(market.logLoss)],
    ["brier", formatMetric(model.brier), formatMetric(market.brier)],
    ["ece(10)", formatMetric(model.ece), formatMetric(market.ece)],
  ];

  const header = ["metric", "model", "market-baseline"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");

  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

function ensureHistoricalFile(filePath: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "[]\n", "utf8");
  console.log(`Created ${filePath} with an empty array.`);
}

function main(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const dataPath = path.join(repoRoot, "data", "historical-results.json");

  ensureHistoricalFile(dataPath);
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8")) as unknown;
  const matches = parseHistoricalResults(raw);

  console.log(`Loaded ${matches.length} historical matches from ${dataPath}`);
  console.log(
    `Walk-forward: train on prior matches only, mix DC ${DIXON_COLES_WEIGHT}/Elo ${ELO_WEIGHT}, devig closing odds proportionally.`,
  );

  const modelAcc = createAccumulator();
  const marketAcc = createAccumulator();

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const train = matches.slice(0, i);

    const dcModel = fitDixonColesModel(train);
    const { homeLambda, awayLambda } = lambdasForMatch(dcModel, match.home, match.away);
    const dcProbs = dixonColesProbabilities(homeLambda, awayLambda, dcModel.params);

    const eloSnapshots = buildEloSnapshots(train, DEFAULT_ELO_CONFIG);
    const homeRating = eloSnapshotAsOf(eloSnapshots, match.home, match.date);
    const awayRating = eloSnapshotAsOf(eloSnapshots, match.away, match.date);
    const eloProbs = eloProbabilities(homeRating, awayRating, true, DEFAULT_ELO_CONFIG);

    const modelProbs = mixProbabilities(dcProbs, eloProbs);
    const actual = actualOutcome(match);
    addObservation(modelAcc, modelProbs, actual);

    if (match.closingOdds) {
      addObservation(marketAcc, devigClosingOdds(match.closingOdds), actual);
    }
  }

  console.log("");
  printReport(finalizeMetrics(modelAcc), finalizeMetrics(marketAcc));
}

main();
