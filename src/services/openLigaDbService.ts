/**
 * Fuente gratuita OpenLigaDB (Bundesliga).
 * Respaldo público sin API key; aporta fixtures/estado de la liga alemana.
 * Se deduplica contra ESPN, que suele traer cuotas además del fixture.
 */
import { LEAGUES } from "@/config/sports";
import { isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { normalizeName } from "@/lib/utils";
import type { LeagueInfo, MatchStatus, SportsMatch, TeamRef } from "@/types/sports";

const BASE = "https://api.openligadb.de";
const CACHE_SECONDS = 1800;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function paletteFor(name: string) {
  const colors = [
    { color: "#b45309", secondaryColor: "#fde68a" },
    { color: "#dc2626", secondaryColor: "#fecaca" },
    { color: "#059669", secondaryColor: "#a7f3d0" },
  ];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return colors[hash % colors.length];
}

function buildTeam(raw: unknown): TeamRef {
  const team = asObject(raw);
  const name = asString(team.teamName) || "Equipo";
  return {
    id: `olb-${asString(team.teamId) || normalizeName(name) || "equipo"}`,
    name,
    shortName: asString(team.shortName) || name,
    ...paletteFor(name),
    logo: asString(team.teamIconUrl) || undefined,
  };
}

function mapStatus(match: JsonObject): MatchStatus {
  if (match.matchIsFinished === true) return "finished";
  const results = asArray(match.goals);
  return results.length > 0 ? "live" : "scheduled";
}

export interface OpenLigaDbResult {
  matches: SportsMatch[];
  warnings: string[];
  connected: boolean;
}

export async function fetchOpenLigaDbMatches(now: Date = new Date()): Promise<OpenLigaDbResult> {
  const league: LeagueInfo | undefined = LEAGUES.find((item) => item.id === "bundesliga");
  if (!league) return { matches: [], warnings: [], connected: false };

  try {
    const response = await fetch(`${BASE}/getmatchdata/bl1`, {
      headers: { Accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { matches: [], warnings: [`OpenLigaDB: HTTP ${response.status}`], connected: false };
    }
    const payload = asArray(await response.json());
    const matches: SportsMatch[] = [];

    for (const raw of payload) {
      const item = asObject(raw);
      const commenceTime = normalizeCommenceTime(item.matchDateTimeUTC, now);
      if (!commenceTime || !isWithinMatchWindow(commenceTime, now)) continue;
      const home = buildTeam(item.team1);
      const away = buildTeam(item.team2);
      const odds = summarizeMarket([]);
      const match: SportsMatch = {
        id: `olb-${asString(item.matchID)}`,
        sport: "soccer",
        league,
        commenceTime,
        status: mapStatus(item),
        venue: asString(item.location) || "Por definir",
        home,
        away,
        odds,
        intel: {
          standings: {
            home: { teamId: home.id, teamName: home.name, teamShortName: home.shortName, position: 0, played: 0, wins: 0, draws: 0, losses: 0, points: 0, winPercentage: 0, scored: 0, conceded: 0, difference: 0, form: [] },
            away: { teamId: away.id, teamName: away.name, teamShortName: away.shortName, position: 0, played: 0, wins: 0, draws: 0, losses: 0, points: 0, winPercentage: 0, scored: 0, conceded: 0, difference: 0, form: [] },
            table: [],
          },
          stats: {
            home: { teamId: home.id, form: [], avgScored: 0, avgConceded: 0, home: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }, away: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }, streak: "Sin datos", provenance: "none" },
            away: { teamId: away.id, form: [], avgScored: 0, avgConceded: 0, home: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }, away: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }, streak: "Sin datos", provenance: "none" },
          },
          injuries: { home: [], away: [] },
          note: "Fuente gratuita OpenLigaDB: fixture/estado de Bundesliga; sin cuotas ni estadísticas.",
          provenance: "api",
        },
      };
      match.favoriteSide = canonicalFavoriteFromSummary(match.odds);
      match.canonicalFavorite = match.favoriteSide;
      matches.push(match);
    }

    return { matches, warnings: [], connected: matches.length > 0 };
  } catch (error) {
    return {
      matches: [],
      warnings: [`OpenLigaDB: ${error instanceof Error ? error.message : "error de red"}`],
      connected: false,
    };
  }
}
