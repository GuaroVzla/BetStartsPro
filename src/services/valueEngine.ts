import { analyzeMatch, impliedProbability } from "@/lib/bettingAnalyzer";
import { isMatchDayVET, resolveMatchStatus } from "@/lib/format";
import type {
  AnalystInsight,
  MatchDay,
  OddsSource,
  OutcomeKey,
  SportsMatch,
} from "@/types/sports";

export interface CrossSourcePick {
  id: string;
  match: SportsMatch;
  outcome: OutcomeKey;
  selection: string;
  bestOdds: number;
  bookmaker: string;
  bookmakerSource: string | null;
  statisticalProbability: number;
  probabilitySource: "analista" | "modelo" | "mercado";
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  supportingSources: string[];
  analyst: AnalystInsight | null | undefined;
  rationale: string;
}

export interface ValueEngineOptions {
  day?: MatchDay | "all";
  now?: Date;
  minEdge?: number;
  minOdds?: number;
  maxPicks?: number;
  analystWeight?: number;
}

const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  home: "Local",
  draw: "Empate",
  away: "Visitante",
};

function selectionName(match: SportsMatch, outcome: OutcomeKey): string {
  if (outcome === "draw") return "Empate";
  return outcome === "home" ? match.home.shortName : match.away.shortName;
}

/**
 * Motor de cruce de las 4 fuentes. Compara la mejor cuota observada en todas
 * las casas contra la probabilidad estadística (The Analyst cuando existe,
 * modelo propio en su defecto) y ordena por valor esperado.
 */
export function buildCrossSourcePicks(
  matches: SportsMatch[],
  options: ValueEngineOptions = {},
): CrossSourcePick[] {
  const now = options.now ?? new Date();
  const day = options.day ?? "all";
  const minEdge = options.minEdge ?? 0.02;
  const minOdds = options.minOdds ?? 1.5;
  const maxPicks = options.maxPicks ?? 12;

  const picks: CrossSourcePick[] = [];

  for (const match of matches) {
    if (
      !isMatchDayVET(match.commenceTime, day, now) ||
      resolveMatchStatus(match, now) !== "scheduled"
    ) {
      continue;
    }

    const analyst = match.analyst;
    const analystProbabilities = analyst?.winProbabilities;
    const analysis = analyzeMatch(match, {
      now,
      day,
      analystWeight: options.analystWeight ?? 0.45,
    });

    const outcomes: OutcomeKey[] = match.sport === "soccer"
      ? ["home", "draw", "away"]
      : ["home", "away"];

    for (const outcome of outcomes) {
      const quotes: Array<{ name: string; source: OddsSource; price: number }> = [];
      for (const bookmaker of match.odds.bookmakers) {
        const price = bookmaker.outcomes[outcome];
        if (typeof price === "number" && price > 1) {
          quotes.push({ name: bookmaker.name, source: bookmaker.source, price });
        }
      }

      if (quotes.length === 0) continue;

      const best = quotes.reduce((current, quote) =>
        quote.price > current.price ? quote : current,
      );
      if (best.price < minOdds) continue;

      const modelPick = analysis.picks.find((pick) => pick.outcome === outcome);
      const hasAnalyst =
        analystProbabilities != null &&
        Number.isFinite(analystProbabilities[outcome]) &&
        analystProbabilities[outcome] > 0;
      const statisticalProbability = hasAnalyst
        ? analystProbabilities![outcome]
        : (modelPick?.modelProbability ?? 0);
      if (!Number.isFinite(statisticalProbability) || statisticalProbability <= 0) {
        continue;
      }

      const implied = impliedProbability(best.price);
      const edge = statisticalProbability - implied;
      const expectedValue = statisticalProbability * best.price - 1;
      if (edge < minEdge || expectedValue <= 0) continue;

      const supportingSources = Array.from(
        new Set(quotes.map((quote) => quote.source)),
      );
      const sourceLabel = hasAnalyst ? "The Analyst" : (modelPick?.probabilitySource ?? "modelo");
      const rationale =
        `${OUTCOME_LABEL[outcome]} a ${best.price.toFixed(2)} en ${best.name}: ` +
        `prob. ${(statisticalProbability * 100).toFixed(1)}% (${sourceLabel}) vs. ` +
        `implícita ${(implied * 100).toFixed(1)}%. Edge ${(edge * 100).toFixed(1)}%.`;

      picks.push({
        id: `${match.id}-${outcome}`,
        match,
        outcome,
        selection: selectionName(match, outcome),
        bestOdds: best.price,
        bookmaker: best.name,
        bookmakerSource: best.source,
        statisticalProbability,
        probabilitySource: hasAnalyst ? "analista" : (modelPick?.probabilitySource ?? "modelo"),
        impliedProbability: implied,
        edge,
        expectedValue,
        supportingSources,
        analyst,
        rationale,
      });
    }
  }

  return picks
    .sort((a, b) => b.expectedValue - a.expectedValue || b.edge - a.edge)
    .slice(0, maxPicks);
}

/** Resumen de la mejor cuota por partido para la tabla principal. */
export function bestPriceForMatch(match: SportsMatch): {
  odds: number | null;
  bookmaker: string | null;
  outcome: OutcomeKey | null;
} {
  let best: { odds: number; bookmaker: string; outcome: OutcomeKey } | null = null;
  for (const bookmaker of match.odds.bookmakers) {
    for (const outcome of ["home", "draw", "away"] as const) {
      const price = bookmaker.outcomes[outcome];
      if (typeof price !== "number" || price <= 1) continue;
      if (!best || price > best.odds) {
        best = { odds: price, bookmaker: bookmaker.name, outcome };
      }
    }
  }
  return {
    odds: best?.odds ?? null,
    bookmaker: best?.bookmaker ?? null,
    outcome: best?.outcome ?? null,
  };
}
