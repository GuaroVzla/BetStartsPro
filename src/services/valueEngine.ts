import { analyzeMatch } from "@/lib/bettingAnalyzer";
import { devigProportional } from "@/lib/marketSummary";
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
  impliedDevig: number;
  edge: number;
  edgeVsMarket: number;
  expectedValue: number;
  supportingSources: string[];
  analyst: AnalystInsight | null | undefined;
  rationale: string;
  confidence: number;
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

    const analysis = analyzeMatch(match, {
      now,
      day,
      minEdge,
      minOdds,
      analystWeight: options.analystWeight ?? 0.45,
    });

    for (const pick of analysis.picks) {
      if (!pick.bestOdds || pick.bestOdds < minOdds) continue;
      if (pick.edge < minEdge || pick.expectedValue <= 0) continue;

      const supportingSources = Array.from(
        new Set(
          match.odds.bookmakers
            .filter((bookmaker) => (bookmaker.outcomes[pick.outcome] ?? 0) > 1)
            .map((bookmaker) => bookmaker.canonicalName ?? bookmaker.source),
        ),
      );
      const sourceLabel = pick.probabilitySource;
      const rationale =
        `${OUTCOME_LABEL[pick.outcome]} a ${pick.bestOdds.toFixed(2)} en ${pick.bookmaker ?? "casa"}: ` +
        `prob. ${(pick.modelProbability * 100).toFixed(1)}% (${sourceLabel}) vs. ` +
        `implícita desvigada ${(pick.impliedDevig * 100).toFixed(1)}%. Edge ${(pick.edge * 100).toFixed(1)}%.`;

      picks.push({
        id: `${match.id}-${pick.outcome}`,
        match,
        outcome: pick.outcome,
        selection: selectionName(match, pick.outcome),
        bestOdds: pick.bestOdds,
        bookmaker: pick.bookmaker ?? "—",
        bookmakerSource:
          match.odds.bookmakers.find(
            (quote) => Math.abs((quote.outcomes[pick.outcome] ?? 0) - pick.bestOdds!) < 0.0001,
          )?.source ?? null,
        statisticalProbability: pick.modelProbability,
        probabilitySource: pick.probabilitySource,
        impliedProbability: pick.impliedProbability,
        impliedDevig: pick.impliedDevig,
        edge: pick.edge,
        edgeVsMarket: pick.edgeVsMarket,
        expectedValue: pick.expectedValue,
        supportingSources,
        analyst: match.analyst,
        rationale,
        confidence: analysis.confidence,
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
