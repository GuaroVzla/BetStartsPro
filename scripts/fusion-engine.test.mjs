import assert from "node:assert/strict";
import test from "node:test";

import {
  FUSION_LAYER_WEIGHTS,
  fuseMatch,
  rankFavorites,
} from "../src/lib/fusionEngine.ts";
import { summarizeMarket } from "../src/lib/marketSummary.ts";

const emptySplit = () => ({
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  scored: 0,
  conceded: 0,
});

const emptyStats = (teamId) => ({
  teamId,
  form: [],
  avgScored: 0,
  avgConceded: 0,
  home: emptySplit(),
  away: emptySplit(),
  streak: "Sin datos",
  provenance: "none",
});

const emptyStanding = (teamId, teamName) => ({
  teamId,
  teamName,
  teamShortName: teamName,
  position: 0,
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  points: 0,
  winPercentage: 0,
  scored: 0,
  conceded: 0,
  difference: 0,
  form: [],
});

function quote(name, source, home, draw, away) {
  return {
    id: `${source}-${name}`,
    name,
    canonicalName: name.toLowerCase(),
    source,
    outcomes: { home, draw, away },
    updatedAt: "2026-11-24T12:00:00.000Z",
    asOf: "2026-11-24T12:00:00.000Z",
    overround: 0.05,
  };
}

function makeMatch(overrides = {}) {
  const bookmakers = overrides.bookmakers ?? [
    quote("Bet365", "api-sports", 2.1, 3.4, 3.6),
    quote("Pinnacle", "therundown", 2.05, 3.5, 3.8),
    quote("FanDuel", "therundown", 2.15, 3.3, 3.7),
  ];
  return {
    id: "m1",
    sport: "soccer",
    league: {
      id: "epl",
      sport: "soccer",
      oddsApiKey: "",
      apiSportsId: 0,
      name: "Premier League",
      shortName: "EPL",
      country: "Inglaterra",
      season: "2026",
    },
    commenceTime: "2026-11-25T18:00:00.000Z",
    status: "scheduled",
    venue: "Estadio",
    home: {
      id: "h",
      name: "Alpha",
      shortName: "Alpha",
      color: "#000",
      secondaryColor: "#fff",
    },
    away: {
      id: "a",
      name: "Beta",
      shortName: "Beta",
      color: "#111",
      secondaryColor: "#eee",
    },
    odds: overrides.odds ?? summarizeMarket(bookmakers),
    intel: {
      standings: {
        home: emptyStanding("h", "Alpha"),
        away: emptyStanding("a", "Beta"),
        table: [],
      },
      stats: { home: emptyStats("h"), away: emptyStats("a") },
      injuries: { home: [], away: [] },
      note: "",
      provenance: "none",
    },
    sourceTags: ["api-sports", "therundown"],
    ...overrides,
  };
}

const strongAwayModel = {
  probabilities: { home: 0.15, draw: 0.2, away: 0.65 },
  confidence: 1,
  source: "modelo",
};

test("los pesos base aprobados suman 1", () => {
  const total = Object.values(FUSION_LAYER_WEIGHTS).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(FUSION_LAYER_WEIGHTS.market, 0.45);
  assert.equal(FUSION_LAYER_WEIGHTS.model, 0.2);
});

test("si cae el mercado, su peso se redistribuye y no queda en la summaria", () => {
  const match = makeMatch({ bookmakers: [] });
  const entry = fuseMatch({ match, modelSignal: strongAwayModel });
  assert.ok(entry);
  assert.equal(entry.layerWeights.market, 0);
  assert.ok(entry.layerWeights.model > 0.2);
  const total = Object.values(entry.layerWeights).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.001);
});

test("una fuente con circuito abierto deja de respaldar la capa de mercado", () => {
  const match = makeMatch({
    bookmakers: [quote("DraftKings", "therundown", 1.8, 3.5, 4.1)],
  });
  const health = {
    therundown: {
      source: "therundown",
      status: "open",
      ok: false,
      latencyMs: 0,
      dataPoints: 0,
      partial: true,
      failures: 3,
    },
  };
  const entry = fuseMatch({ match, modelSignal: strongAwayModel, sourceHealth: health });
  assert.ok(entry);
  assert.equal(entry.layerWeights.market, 0);
  assert.ok(!entry.supportingSources.includes("therundown"));
});

test("sin datos reales no se inventan cuotas ni se marca value bet", () => {
  const match = makeMatch({ bookmakers: [], sourceTags: [] });
  const entry = fuseMatch({ match, modelSignal: null });
  assert.ok(entry);
  assert.equal(entry.marketImpliedProbability, 0);
  assert.equal(entry.isValueBet, false);
  assert.equal(entry.metrics.h2hAvailable, false);
  assert.ok(entry.confidence < 0.15);
});

test("detecta value bet cuando la probabilidad modelada supera la implícita", () => {
  const match = makeMatch({
    bookmakers: [
      quote("Bet365", "api-sports", 3.4, 3.3, 2.25),
      quote("Pinnacle", "therundown", 3.5, 3.2, 2.2),
      quote("FanDuel", "therundown", 3.6, 3.1, 2.15),
    ],
  });
  const entry = fuseMatch({ match, modelSignal: strongAwayModel });
  assert.ok(entry);
  assert.equal(entry.outcome, "away");
  assert.ok(entry.edge > 0, `edge esperado > 0, recibido ${entry.edge}`);
  assert.ok(entry.isValueBet);
  assert.ok(entry.expectedValue > 0);
});

test("el ranking ordena por probabilidad real y renumera", () => {
  const weak = makeMatch({ id: "weak" });
  const strong = makeMatch({
    id: "strong",
    odds: summarizeMarket([
      quote("Bet365", "api-sports", 4.2, 3.4, 1.75),
      quote("Pinnacle", "therundown", 4.4, 3.2, 1.72),
      quote("FanDuel", "therundown", 4.1, 3.3, 1.78),
    ]),
  });
  const result = rankFavorites([
    { match: weak, modelSignal: null },
    { match: strong, modelSignal: strongAwayModel },
  ]);
  assert.equal(result.entries[0].matchId, "strong");
  assert.deepEqual(
    result.entries.map((entry) => entry.rank),
    result.entries.map((_, index) => index + 1),
  );
});
