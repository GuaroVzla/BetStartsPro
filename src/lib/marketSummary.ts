import type {
  BookmakerQuote,
  MarketSummary,
  OutcomePrices,
} from "@/types/sports";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

  return {
    best,
    average: {
      home: avgHome,
      draw: avgDraw,
      away: avgAway,
    },
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
