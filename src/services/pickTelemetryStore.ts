import type { AnalyzerOptions, SportsMatch } from "@/types/sports";
import { analyzeMatch } from "@/lib/bettingAnalyzer";

export interface PickTelemetryRecord {
  id: string;
  createdAt: string;
  matchId: string;
  commenceTime: string;
  leagueId: string;
  home: string;
  away: string;
  outcome: "home" | "draw" | "away";
  selection: string;
  pModelWeight: number;
  pMarketWeight: number;
  pAnalystWeight: number;
  pFinal: number;
  odds: number | null;
  impliedDevig: number;
  edge: number;
  expectedValue: number;
  asOf: string;
  weights: string;
  confidence: number;
  bookmaker: string | null;
  supportingSources: string[];
  result?: "win" | "loss" | "push" | null;
}

export function buildPickTelemetryRecords(
  matches: SportsMatch[],
  options: AnalyzerOptions = {},
  createdAt = new Date().toISOString(),
): PickTelemetryRecord[] {
  const lines: PickTelemetryRecord[] = [];

  for (const match of matches) {
    const analysis = analyzeMatch(match, options);
    const qualifying = analysis.picks.filter((pick) => pick.qualifies);
    for (const pick of qualifying) {
      lines.push({
        id: `${match.id}:${pick.outcome}:${createdAt}`,
        createdAt,
        matchId: match.id,
        commenceTime: match.commenceTime,
        leagueId: match.league.id,
        home: match.home.name,
        away: match.away.name,
        outcome: pick.outcome,
        selection: pick.selectionName,
        pModelWeight: pick.blend.model,
        pMarketWeight: pick.blend.market,
        pAnalystWeight: pick.blend.analyst,
        pFinal: pick.modelProbability,
        odds: pick.bestOdds,
        impliedDevig: pick.impliedDevig,
        edge: pick.edge,
        expectedValue: pick.expectedValue,
        asOf: match.odds.bookmakers[0]?.asOf ?? match.odds.bookmakers[0]?.updatedAt ?? createdAt,
        weights: pick.blend.weights,
        confidence: analysis.confidence,
        bookmaker: pick.bookmaker,
        supportingSources: match.odds.bookmakers.map((b) => b.canonicalName ?? b.name),
        result: null,
      });
    }
  }

  return lines;
}

/**
 * Telemetría desactivada en runtime: este módulo ya no escribe a filesystem.
 * Mantener solo como builder puro hasta migrar a KV/D1/cron Node-only.
 */
export async function recordPicksTelemetry(
  _matches: SportsMatch[],
  _options: AnalyzerOptions = {},
): Promise<void> {
  return;
}
