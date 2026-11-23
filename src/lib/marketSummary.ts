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
  const raw: Record<OutcomeKey, number> = {
    home: average.home > 1 ? 1 / average.home : 0,
    draw: average.draw !== null && average.draw > 1 ? 1 / average.draw : 0,
    away: average.away > 1 ? 1 / average.away : 0,
  };
  const total = raw.home + raw.draw + raw.away;
  if (total <= 0) return { home: 0, draw: 0, away: 0 };
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total,
  };
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
    spreadPercent: {
      home: spread(bestHome, avgHome),
      draw: bestDraw !== null && avgDraw !== null ? spread(bestDraw, avgDraw) : null,
      away: spread(bestAway, avgAway),
    },
    bookmakers,
    bookmakerCount: bookmakers.length,
  };
}

export function getOutcomePrice(prices: OutcomePrices, outcome: "home" | "draw" | "away"): number | null {
  const price = prices[outcome];
  if (price === null || price <= 1) return null;
  return price;
}

/** Favorito de mercado: menor cuota entre local y visitante. */
export function favoriteSideFromSummary(
  summary: MarketSummary,
): "home" | "away" | null {
  const home = summary.best.home;
  const away = summary.best.away;
  const homeValid = home > 1;
  const awayValid = away > 1;
  if (!homeValid && !awayValid) return null;
  if (!homeValid) return "away";
  if (!awayValid) return "home";
  if (home < away) return "home";
  if (away < home) return "away";
  return null;
}
