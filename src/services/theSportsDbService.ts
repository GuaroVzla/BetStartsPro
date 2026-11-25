/**
 * Fuente gratuita TheSportsDB (API pública).
 * Aporta cartelera multi-deporte de hoy/mañana sin API key propia.
 * No publica cuotas 1X2 estructuradas; se usa para cobertura de fixtures.
 */
import { dateInVETOffset, isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { normalizeName } from "@/lib/utils";
import type { LeagueInfo, MatchStatus, SportsMatch, SportKey, TeamRef } from "@/types/sports";

const BASE = "https://www.thesportsdb.com/api/v1/json";
const CACHE_SECONDS = 3600;
const MAX_EVENTS_PER_SPORT_DAY = 25;

type JsonObject = Record<string, unknown>;

const SPORTS: Array<{ label: string; sport: SportKey }> = [
  { label: "Soccer", sport: "soccer" },
  { label: "Basketball", sport: "basketball" },
  { label: "Baseball", sport: "baseball" },
  { label: "Ice Hockey", sport: "hockey" },
];

export interface TheSportsDbResult {
  matches: SportsMatch[];
  warnings: string[];
  connected: boolean;
}

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
    { color: "#0e7490", secondaryColor: "#a5f3fc" },
    { color: "#be123c", secondaryColor: "#fecdd3" },
    { color: "#4d7c0f", secondaryColor: "#d9f99d" },
    { color: "#4338ca", secondaryColor: "#c7d2fe" },
    { color: "#b45309", secondaryColor: "#fde68a" },
  ];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return colors[hash % colors.length];
}

function buildTeam(name: string, id: string, logo: string): TeamRef {
  return {
    id: `tsdb-${id || normalizeName(name) || "equipo"}`,
    name,
    shortName: name,
    ...paletteFor(name),
    logo: logo || undefined,
  };
}

function mapStatus(status: string): MatchStatus {
  const value = status.trim().toUpperCase();
  if (!value || value === "NS" || value === "NOT STARTED") return "scheduled";
  if (/(FT|AET|PEN|FINAL|POSTP|CANC|ABD)/.test(value)) return "finished";
  return "live";
}

function buildLeague(event: JsonObject, sport: SportKey): LeagueInfo {
  const name = asString(event.strLeague) || "TheSportsDB";
  const country = asString(event.strCountry) || "Internacional";
  return {
    id: `tsdb-${asString(event.idLeague) || normalizeName(name)}`,
    sport,
    oddsApiKey: "",
    apiSportsId: 0,
    name,
    shortName: name,
    country,
    season: asString(event.strSeason) || String(new Date().getFullYear()),
  };
}

export async function fetchTheSportsDbMatches(now: Date = new Date()): Promise<TheSportsDbResult> {
  // La key pública "123" devuelve HTTP 429 con frecuencia. Solo se activa con
  // una key propia para no degradar el dashboard ni generar falsos positivos.
  const apiKey = process.env.THESPORTSDB_KEY;
  if (!apiKey) {
    return { matches: [], warnings: [], connected: false };
  }
  const dates = [dateInVETOffset(0, now), dateInVETOffset(1, now)];
  const warnings: string[] = [];
  const matches: SportsMatch[] = [];

  for (const sport of SPORTS) {
    for (const date of dates) {
      try {
        const url = `${BASE}/${encodeURIComponent(apiKey)}/eventsday.php?d=${date}&s=${encodeURIComponent(sport.label)}`;
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate: CACHE_SECONDS },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          warnings.push(`TheSportsDB ${sport.label} ${date}: HTTP ${response.status}`);
          continue;
        }
        const payload = asObject(await response.json());
        for (const rawEvent of asArray(payload.events).slice(0, MAX_EVENTS_PER_SPORT_DAY)) {
          const event = asObject(rawEvent);
          const homeName = asString(event.strHomeTeam);
          const awayName = asString(event.strAwayTeam);
          if (!homeName || !awayName) continue;
          const rawTime = asString(event.strTimestamp) || `${asString(event.dateEvent)} ${asString(event.strTime)}`;
          const commenceTime = normalizeCommenceTime(rawTime, now);
          if (!commenceTime || !isWithinMatchWindow(commenceTime, now)) continue;

          const league = buildLeague(event, sport.sport);
          const home = buildTeam(homeName, asString(event.idHomeTeam), asString(event.strHomeTeamBadge));
          const away = buildTeam(awayName, asString(event.idAwayTeam), asString(event.strAwayTeamBadge));
          const odds = summarizeMarket([]);
          const match: SportsMatch = {
            id: `tsdb-${asString(event.idEvent) || `${date}-${normalizeName(homeName)}-${normalizeName(awayName)}`}`,
            sport: sport.sport,
            league,
            commenceTime,
            status: mapStatus(asString(event.strStatus)),
            venue: asString(event.strVenue) || "Por definir",
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
              note: "Fuente gratuita TheSportsDB: cartelera sin cuotas 1X2 ni estadísticas avanzadas.",
              provenance: "api",
            },
          };
          match.favoriteSide = canonicalFavoriteFromSummary(match.odds);
          match.canonicalFavorite = match.favoriteSide;
          matches.push(match);
        }
      } catch (error) {
        warnings.push(
          `TheSportsDB ${sport.label} ${date}: ${error instanceof Error ? error.message : "error de red"}`,
        );
      }
    }
  }

  return { matches, warnings, connected: matches.length > 0 };
}
