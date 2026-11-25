import type {
  BookmakerQuote,
  MarketSummary,
  OutcomeKey,
  OutcomePrices,
} from "@/types/sports";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Consenso de mercado: probabilidad implícita media depurada del margen de la
 * casa (overround). Es más estable que una cuota aislada y sirve como prior
 * para el modelo cuando no hay estadísticas de goles.
 */
export function consensusProbabilities(
  average: OutcomePrices,
): Record<OutcomeKey, number> {
  return devigProportional(average, (average.draw ?? 0) > 1);
}

/** Implícitas RAW: observables, todavía con margen de la casa. */
export function rawProbabilities(prices: OutcomePrices): Record<OutcomeKey, number> {
  return {
    home: prices.home > 1 ? 1 / prices.home : 0,
    draw: prices.draw !== null && prices.draw > 1 ? 1 / prices.draw : 0,
    away: prices.away > 1 ? 1 / prices.away : 0,
  };
}

/**
 * Desvigado proporcional. Se usa tanto para el consenso como para la mejor
 * cuota, de modo que `edge` compare escalas homogéneas.
 */
export function devigProportional(
  prices: OutcomePrices,
  includeDraw = true,
): Record<OutcomeKey, number> {
  const raw = rawProbabilities(prices);
  if (!includeDraw) raw.draw = 0;
  const total = raw.home + raw.draw + raw.away;
  if (total <= 0) return { home: 0, draw: 0, away: 0 };
  return {
    home: raw.home / total,
    draw: includeDraw ? raw.draw / total : 0,
    away: raw.away / total,
  };
}

/**
 * Desvigado Shin: alternativa que corrige parcialmente el favorite-longshot
 * bias. Se expone para backtesting; el runtime usa proportional por defecto.
 */
export function devigShin(
  prices: OutcomePrices,
  includeDraw = true,
  iterations = 60,
): Record<OutcomeKey, number> {
  const raw = rawProbabilities(prices);
  if (!includeDraw) raw.draw = 0;
  const total = raw.home + raw.draw + raw.away;
  if (total <= 0) return { home: 0, draw: 0, away: 0 };

  let z = 0;
  for (let index = 0; index < iterations; index += 1) {
    const denominator = (1 - z) * total;
    if (denominator <= 0) break;
    const sumSquares = Object.values(raw).reduce(
      (sum, probability) => sum + (probability / denominator) ** 2,
      0,
    );
    const next = 1 / (1 + total * (sumSquares - 1));
    if (Number.isFinite(next) && Math.abs(next - z) < 1e-12) {
      z = next;
      break;
    }
    z = Number.isFinite(next) ? next : z;
  }

  const clampedZ = Math.max(0, Math.min(0.5, z));
  const result: Record<OutcomeKey, number> = { home: 0, draw: 0, away: 0 };
  for (const key of ["home", "draw", "away"] as const) {
    if (key === "draw" && !includeDraw) continue;
    const p = raw[key] / total;
    const numerator = Math.sqrt(clampedZ * clampedZ + 4 * (1 - clampedZ) * p * p);
    const denominator = 2 * (1 - clampedZ);
    result[key] = denominator > 0 ? (numerator - clampedZ) / denominator : p;
  }
  const sum = result.home + result.draw + result.away;
  return sum > 0
    ? {
        home: result.home / sum,
        draw: includeDraw ? result.draw / sum : 0,
        away: result.away / sum,
      }
    : { home: 0, draw: 0, away: 0 };
}

/** Overround medio de la muestra de precios (0 = mercado justo). */
export function marketOverround(prices: OutcomePrices): number {
  const raw = rawProbabilities(prices);
  return Math.max(0, raw.home + raw.draw + raw.away - 1);
}

function spread(best: number, mean: number): number {
  if (mean <= 0) return 0;
  return (best - mean) / mean;
}

export function emptyMarketSummary(): MarketSummary {
  return {
    best: { home: 0, draw: null, away: 0 },
    average: { home: 0, draw: null, away: 0 },
    spreadPercent: { home: 0, draw: null, away: 0 },
    consensus: { home: 0, draw: 0, away: 0 },
    impliedDevig: { home: 0, draw: 0, away: 0 },
    overround: 0,
    devigMethod: "proportional",
    bookmakers: [],
    bookmakerCount: 0,
  };
}

export function summarizeMarket(bookmakers: BookmakerQuote[]): MarketSummary {
  if (bookmakers.length === 0) return emptyMarketSummary();

  const homePrices = bookmakers
    .map((bookmaker) => bookmaker.outcomes.home)
    .filter((price) => price > 1);
  const awayPrices = bookmakers
    .map((bookmaker) => bookmaker.outcomes.away)
    .filter((price) => price > 1);
  const drawPrices = bookmakers
    .map((bookmaker) => bookmaker.outcomes.draw)
    .filter((price): price is number => price !== null && price > 1);

  const bestHome = homePrices.length ? Math.max(...homePrices) : 0;
  const bestAway = awayPrices.length ? Math.max(...awayPrices) : 0;
  const bestDraw = drawPrices.length ? Math.max(...drawPrices) : null;
  const avgHome = average(homePrices);
  const avgAway = average(awayPrices);
  const avgDraw = drawPrices.length ? average(drawPrices) : null;

  const best: OutcomePrices = {
    home: bestHome,
    draw: bestDraw,
    away: bestAway,
  };
  const avg: OutcomePrices = {
    home: avgHome,
    draw: avgDraw,
    away: avgAway,
  };

  return {
    best,
    average: avg,
    consensus: consensusProbabilities(avg),
    impliedDevig: devigProportional(best, bestDraw !== null && bestDraw > 1),
    overround: marketOverround(avg),
    devigMethod: "proportional",
    spreadPercent: {
      home: spread(bestHome, avgHome),
      draw: bestDraw !== null && avgDraw !== null ? spread(bestDraw, avgDraw) : null,
      away: spread(bestAway, avgAway),
    },
    bookmakers,
    bookmakerCount: bookmakers.length,
  };
}

export function getOutcomePrice(prices: OutcomePrices, outcome: OutcomeKey): number | null {
  const price = prices[outcome];
  if (price === null || price <= 1) return null;
  return price;
}

/** Favorito de mercado: menor cuota entre local y visitante. */
export function favoriteSideFromSummary(
  summary: MarketSummary,
): "home" | "away" | null {
  return canonicalFavoriteFromSummary(summary);
}

/**
 * Favorito canónico: consenso desvigado; si empatan, se usa la mejor cuota y
 * finalmente el lado local. Una sola definición para toda la aplicación.
 */
export function canonicalFavoriteFromSummary(
  summary: MarketSummary,
): "home" | "away" | null {
  const consensus = summary.consensus;
  const home = summary.best.home;
  const away = summary.best.away;
  const homeValid = home > 1;
  const awayValid = away > 1;
  if (!homeValid && !awayValid) return null;
  if (!homeValid) return "away";
  if (!awayValid) return "home";

  if (Math.abs(consensus.home - consensus.away) > 1e-9) {
    return consensus.home > consensus.away ? "home" : "away";
  }
  if (home !== away) return home < away ? "home" : "away";
  return "home";
}
