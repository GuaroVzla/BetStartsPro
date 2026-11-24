import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { AnalyzerOptions, SportsMatch, ValuePick } from "@/types/sports";
import { analyzeMatch } from "@/lib/bettingAnalyzer";

const DATA_DIR = path.join(process.cwd(), "data");
const PICKS_FILE = path.join(DATA_DIR, "pick-telemetry.jsonl");

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
  pModel: number;
  pMarket: number;
  pAnalyst: number;
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

function outcomeResult(
  outcome: "home" | "draw" | "away",
  homeScore: number,
  awayScore: number,
): "win" | "loss" {
  if (outcome === "home") return homeScore > awayScore ? "win" : "loss";
  if (outcome === "away") return awayScore > homeScore ? "win" : "loss";
  return homeScore === awayScore ? "win" : "loss";
}

export async function recordPicksTelemetry(
  matches: SportsMatch[],
  options: AnalyzerOptions = {},
): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const nowIso = new Date().toISOString();
    const lines: string[] = [];

    for (const match of matches) {
      const analysis = analyzeMatch(match, options);
      const qualifying = analysis.picks.filter((pick) => pick.qualifies);
      for (const pick of qualifying) {
        const record: PickTelemetryRecord = {
          id: `${match.id}:${pick.outcome}:${nowIso.slice(0, 13)}`,
          createdAt: nowIso,
          matchId: match.id,
          commenceTime: match.commenceTime,
          leagueId: match.league.id,
          home: match.home.name,
          away: match.away.name,
          outcome: pick.outcome,
          selection: pick.selectionName,
          pModel: pick.blend.model,
          pMarket: pick.blend.market,
          pAnalyst: pick.blend.analyst,
          pFinal: pick.modelProbability,
          odds: pick.bestOdds,
          impliedDevig: pick.impliedDevig,
          edge: pick.edge,
          expectedValue: pick.expectedValue,
          asOf: match.odds.bookmakers[0]?.asOf ?? match.odds.bookmakers[0]?.updatedAt ?? nowIso,
          weights: pick.blend.weights,
          confidence: analysis.confidence,
          bookmaker: pick.bookmaker,
          supportingSources: match.odds.bookmakers.map((b) => b.canonicalName ?? b.name),
          result: null,
        };
        lines.push(JSON.stringify(record));
      }
    }

    if (lines.length > 0) {
      await appendFile(PICKS_FILE, lines.join("\n") + "\n", "utf8");
    }
  } catch {
    // Telemetría nunca debe romper la respuesta del dashboard.
  }
}
