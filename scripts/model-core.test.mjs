import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalBookmakerName,
  createNameMatcher,
  createNameNormalizer,
  namesLikelyMatch,
  normalizeName,
} from "../src/lib/utils.ts";
import {
  consensusProbabilities,
  devigProportional,
  devigShin,
  marketOverround,
} from "../src/lib/marketSummary.ts";

test("normalizeName conserva identidad de equipos", () => {
  assert.equal(normalizeName("Real Madrid CF"), "real madrid");
  assert.equal(normalizeName("Atlético de Madrid"), "atletico madrid");
  assert.notEqual(normalizeName("Real Madrid"), normalizeName("Atlético Madrid"));
  assert.notEqual(normalizeName("Manchester City"), normalizeName("Manchester United"));
});

test("namesLikelyMatch no colapsa rivales con token compartido", () => {
  assert.equal(namesLikelyMatch("Real Madrid", "Atlético Madrid"), false);
  assert.equal(namesLikelyMatch("Manchester City", "Manchester United"), false);
  assert.equal(namesLikelyMatch("Man City", "Manchester City"), true);
});

test("createNameMatcher respeta el comportamiento con caché y es simétrico", () => {
  const cached = createNameMatcher();
  const normalize = createNameNormalizer();
  const pairs = [
    ["Real Madrid", "Atlético Madrid"],
    ["Man City", "Manchester City"],
    ["Deportivo La Coruña", "Deportivo La Coruna"],
    ["Manchester United", "Man Utd"],
  ];
  for (const [first, second] of pairs) {
    const expected = namesLikelyMatch(first, second);
    assert.equal(cached(first, second), expected);
    assert.equal(cached(second, first), expected);
    // Segunda pasada: sirve la caché, no debe cambiar el resultado.
    assert.equal(cached(first, second), expected);
  }
  assert.equal(normalize("Atlético de Madrid"), normalize("Atletico de Madrid"));
});

test("canonicalBookmakerName deduplica prefijo de proveedor", () => {
  assert.equal(canonicalBookmakerName("Bet365", "the-odds-api"), "bet365");
  assert.equal(canonicalBookmakerName("the-odds-api Bet365", "the-odds-api"), "bet365");
});

test("devig proporcional elimina overround y conserva orden", () => {
  const prices = { home: 2.1, draw: 3.4, away: 3.6 };
  const devig = devigProportional(prices, true);
  const sum = devig.home + devig.draw + devig.away;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(devig.home > devig.draw);
  assert.ok(devig.home > devig.away);
});

test("consensus y overround son consistentes", () => {
  const avg = { home: 2.0, draw: 3.5, away: 4.0 };
  const consensus = consensusProbabilities(avg);
  assert.ok(Math.abs(consensus.home + consensus.draw + consensus.away - 1) < 1e-9);
  assert.ok(marketOverround(avg) > 0);
});

test("devig Shin devuelve distribución válida", () => {
  const shin = devigShin({ home: 1.9, draw: 3.3, away: 4.2 }, true);
  const sum = shin.home + shin.draw + shin.away;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(shin.home > shin.away);
});
