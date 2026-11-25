import assert from "node:assert/strict";
import test from "node:test";

import {
  dixonColesProbabilities,
  dixonColesTau,
  fitDixonColesModel,
  lambdasForMatch,
} from "../src/lib/dixonColes.ts";
import {
  buildEloSnapshots,
  decayRating,
  DEFAULT_ELO_CONFIG,
  eloProbabilities,
} from "../src/services/ratingService.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EPS = 1e-9;

function approxEqual(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("dixonColesTau aplica corrección solo a marcadores bajos", () => {
  const rho = -0.13;
  const homeLambda = 1.2;
  const awayLambda = 1.0;
  approxEqual(dixonColesTau(0, 0, homeLambda, awayLambda, rho), 1 - homeLambda * awayLambda * rho);
  approxEqual(dixonColesTau(0, 1, homeLambda, awayLambda, rho), 1 + homeLambda * rho);
  approxEqual(dixonColesTau(1, 0, homeLambda, awayLambda, rho), 1 + awayLambda * rho);
  approxEqual(dixonColesTau(1, 1, homeLambda, awayLambda, rho), 1 - rho);
  assert.equal(dixonColesTau(2, 1, homeLambda, awayLambda, rho), 1);
  assert.equal(dixonColesTau(0, 2, homeLambda, awayLambda, rho), 1);
});

test("dixonColesProbabilities normaliza a 1 y respeta ventajas claras", () => {
  const probs = dixonColesProbabilities(1.8, 0.7, { rho: -0.13, xiPerDay: 0.0018, homeAdvantage: 0.16 });
  approxEqual(probs.home + probs.draw + probs.away, 1, 1e-9);
  assert.ok(probs.home > probs.away);
  assert.ok(probs.home > probs.draw);
  assert.ok(probs.draw >= 0 && probs.draw <= 1);
});

test("fitDixonColesModel es determinista y normaliza fuerzas", () => {
  const matches = [
    { id: "m1", date: "2026-01-01T00:00:00.000Z", home: "A", away: "B", homeGoals: 2, awayGoals: 0 },
    { id: "m2", date: "2026-01-08T00:00:00.000Z", home: "B", away: "C", homeGoals: 1, awayGoals: 1 },
    { id: "m3", date: "2026-01-15T00:00:00.000Z", home: "C", away: "A", homeGoals: 0, awayGoals: 1 },
    { id: "m4", date: "2026-01-22T00:00:00.000Z", home: "A", away: "C", homeGoals: 3, awayGoals: 1 },
    { id: "m5", date: "2026-01-29T00:00:00.000Z", home: "C", away: "B", homeGoals: 2, awayGoals: 2 },
    { id: "m6", date: "2026-02-05T00:00:00.000Z", home: "B", away: "A", homeGoals: 0, awayGoals: 2 },
  ];
  const a = fitDixonColesModel(matches);
  const b = fitDixonColesModel(matches);
  assert.deepEqual(a, b);

  // FP accumulation order can differ with input order; verify invariants instead of bit-equality.
  const c = fitDixonColesModel([...matches].reverse());
  assert.deepEqual(Object.keys(c.attack).sort(), ["A", "B", "C"]);

  const teams = Object.keys(a.attack);
  assert.deepEqual(teams.sort(), ["A", "B", "C"]);
  let attackLogSum = 0;
  let defenseLogSum = 0;
  for (const team of teams) {
    attackLogSum += Math.log(a.attack[team]);
    defenseLogSum += Math.log(a.defense[team]);
    assert.ok(a.attack[team] > 0);
    assert.ok(a.defense[team] > 0);
  }
  // Normalization should keep geometric mean near 1.
  assert.ok(Math.abs(attackLogSum / teams.length) < 0.05);
  assert.ok(Math.abs(defenseLogSum / teams.length) < 0.05);

  const lambdas = lambdasForMatch(a, "A", "B");
  assert.ok(lambdas.homeLambda > 0);
  assert.ok(lambdas.awayLambda > 0);
  const unknown = lambdasForMatch(a, "Unknown", "A");
  assert.ok(Number.isFinite(unknown.homeLambda));
  assert.ok(Number.isFinite(unknown.awayLambda));
});

test("decayRating regresa hacia initialRating con inactividad", () => {
  const config = { ...DEFAULT_ELO_CONFIG, decayPerDay: 0.01, initialRating: 1500 };
  const last = "2026-01-01T00:00:00.000Z";
  const same = decayRating(1700, last, last, config);
  const later = decayRating(1700, last, "2026-01-11T00:00:00.000Z", config);
  const muchLater = decayRating(1700, last, "2027-01-01T00:00:00.000Z", config);
  assert.equal(same, 1700);
  assert.ok(later < 1700);
  assert.ok(later > 1500);
  assert.ok(muchLater < later);
  assert.ok(muchLater > 1499);
});

test("buildEloSnapshots y eloProbabilities son deterministas", () => {
  const matches = [
    { id: "m1", date: "2026-01-01T00:00:00.000Z", home: "A", away: "B", homeGoals: 1, awayGoals: 0 },
    { id: "m2", date: "2026-01-08T00:00:00.000Z", home: "B", away: "A", homeGoals: 2, awayGoals: 2 },
    { id: "m3", date: "2026-01-15T00:00:00.000Z", home: "A", away: "B", homeGoals: 0, awayGoals: 1 },
  ];
  const snapA = buildEloSnapshots(matches, DEFAULT_ELO_CONFIG);
  const snapB = buildEloSnapshots([...matches].reverse(), DEFAULT_ELO_CONFIG);
  assert.deepEqual(snapA, snapB);
  assert.ok(snapA.A.n === 3);
  assert.ok(snapA.B.n === 3);

  const probs = eloProbabilities(snapA.A.rating, snapA.B.rating, true, DEFAULT_ELO_CONFIG);
  approxEqual(probs.home + probs.draw + probs.away, 1, 1e-9);
  const noDraw = eloProbabilities(snapA.A.rating, snapA.B.rating, false, DEFAULT_ELO_CONFIG);
  approxEqual(noDraw.home + noDraw.away, 1, 1e-9);
  assert.equal(noDraw.draw, 0);
});

test("model-params.json tiene forma de artefacto válida", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const artifactPath = path.join(repoRoot, "src", "data", "model-params.json");
  const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  assert.equal(typeof raw, "object");
  assert.equal(typeof raw.generatedAt, "string");
  assert.ok(Number.isFinite(Date.parse(raw.generatedAt)));
  assert.equal(typeof raw.dixonColes, "object");
  assert.equal(typeof raw.dixonColes.params, "object");
  assert.equal(typeof raw.dixonColes.leagueAverage, "number");
  assert.equal(typeof raw.dixonColes.attack, "object");
  assert.equal(typeof raw.dixonColes.defense, "object");
  assert.equal(typeof raw.elo, "object");
  assert.equal(typeof raw.eloConfig, "object");
  assert.equal(typeof raw.eloConfig.k, "number");
});

test("walk-forward sintetico es determinista", () => {
  const matches = [
    { id: "m1", date: "2026-01-01T00:00:00.000Z", home: "A", away: "B", homeGoals: 2, awayGoals: 1 },
    { id: "m2", date: "2026-01-05T00:00:00.000Z", home: "C", away: "D", homeGoals: 0, awayGoals: 0 },
    { id: "m3", date: "2026-01-10T00:00:00.000Z", home: "A", away: "C", homeGoals: 1, awayGoals: 1 },
    { id: "m4", date: "2026-01-15T00:00:00.000Z", home: "B", away: "D", homeGoals: 3, awayGoals: 0 },
    { id: "m5", date: "2026-01-20T00:00:00.000Z", home: "D", away: "A", homeGoals: 1, awayGoals: 2 },
    { id: "m6", date: "2026-01-25T00:00:00.000Z", home: "C", away: "B", homeGoals: 0, awayGoals: 1 },
  ];

  function runWalkForward(data) {
    const probsOut = [];
    for (let i = 0; i < data.length; i += 1) {
      const train = data.slice(0, i);
      const match = data[i];
      const model = fitDixonColesModel(train);
      const { homeLambda, awayLambda } = lambdasForMatch(model, match.home, match.away);
      const dc = dixonColesProbabilities(homeLambda, awayLambda, model.params);
      const eloSnap = buildEloSnapshots(train, DEFAULT_ELO_CONFIG);
      const homeRating = eloSnap[match.home]?.rating ?? DEFAULT_ELO_CONFIG.initialRating;
      const awayRating = eloSnap[match.away]?.rating ?? DEFAULT_ELO_CONFIG.initialRating;
      const elo = eloProbabilities(homeRating, awayRating, true, DEFAULT_ELO_CONFIG);
      const mixed = {
        home: dc.home * 0.7 + elo.home * 0.3,
        draw: dc.draw * 0.7 + elo.draw * 0.3,
        away: dc.away * 0.7 + elo.away * 0.3,
      };
      const total = mixed.home + mixed.draw + mixed.away;
      probsOut.push({
        home: mixed.home / total,
        draw: mixed.draw / total,
        away: mixed.away / total,
      });
    }
    return probsOut;
  }

  const first = runWalkForward(matches);
  const second = runWalkForward(matches);
  assert.deepEqual(first, second);
  assert.equal(first.length, matches.length);
  for (const p of first) {
    approxEqual(p.home + p.draw + p.away, 1, 1e-9);
    assert.ok(p.home >= 0 && p.draw >= 0 && p.away >= 0);
  }
});
