/**
 * Fuente AllSportsAPI v2 (plan gratuito, fútbol).
 * Aporta fixtures, cuotas 1X2 de varias casas y tablas de posiciones reales.
 * No publica xG ni lesiones; esos campos quedan vacíos, nunca inventados.
 *
 * Endpoints usados (todos `met=` sobre `/football/`):
 * - `Fixtures&from=&to=`: cartelera de hoy/mañana en fecha VET.
 * - `Odds&from=&to=`: objeto indexado por `event_key` con cuotas por casa.
 * - `Standings&leagueId=`: posiciones reales por liga (máximo 6 ligas por update).
 *
 * La key se lee de `ALLSPORTSAPI_KEY`; la respuesta se cachea 15 minutos.
 */
import { LEAGUES } from "@/config/sports";
import { dateInVETOffset, isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { canonicalBookmakerName, normalizeName } from "@/lib/utils";
import type {
  BookmakerQuote,
  FormResult,
  LeagueInfo,
  MatchStatus,
  StandingRow,
  SportsMatch,
  TeamAdvancedStats,
  TeamRef,
} from "@/types/sports";

const BASE = "https://apiv2.allsportsapi.com/football";
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_FIXTURES = 300;
const MAX_STANDINGS_LEAGUES = 6;

type Json = Record<string, unknown>;

interface AllSportsApiResult {
  matches: SportsMatch[];
  warnings: string[];
  connected: boolean;
}

let cache: { at: number; data: AllSportsApiResult } | null = null;

function asObject(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
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

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paletteFor(name: string) {
  const colors = [
    { color: "#0f766e", secondaryColor: "#99f6e4" },
    { color: "#b91c1c", secondaryColor: "#fecaca" },
    { color: "#1d4ed8", secondaryColor: "#bfdbfe" },
    { color: "#7c2d12", secondaryColor: "#fed7aa" },
    { color: "#6d28d9", secondaryColor: "#ddd6fe" },
  ];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return colors[hash % colors.length];
}

function buildTeam(name: string, key: string, logo: string): TeamRef {
  const resolved = name || "Equipo por definir";
  return {
    id: `asa-${key || normalizeName(resolved) || "equipo"}`,
    name: resolved,
    shortName: resolved,
    ...paletteFor(resolved),
    logo: logo || undefined,
  };
}

function resolveLeague(label: string, key: string, season: string): LeagueInfo {
  const normalized = normalizeName(label);
  const patterns: Array<[RegExp, string]> = [
    [/champions league|uefa champions/i, "champions"],
    [/premier league/i, "epl"],
    [/la\s*liga|laliga/i, "laliga"],
    [/serie a/i, "serie-a"],
    [/bundesliga/i, "bundesliga"],
  ];
  const configured =
    LEAGUES.find((league) => normalizeName(league.name) === normalized) ??
    LEAGUES.find((league) =>
      patterns.some(([pattern, id]) => id === league.id && pattern.test(label)),
    );
  if (configured) return configured;

  return {
    id: `asa-${key || normalizeName(label) || "liga"}`,
    sport: "soccer",
    oddsApiKey: "",
    apiSportsId: 0,
    name: label || "Fútbol internacional",
    shortName: label || "Fútbol",
    country: "Internacional",
    season: season || String(new Date().getFullYear()),
  };
}

function mapStatus(event: Json): MatchStatus {
  const live = asString(event.event_live);
  if (live === "1") return "live";
  const final = asString(event.event_final_result);
  if (final && final !== "-") return "finished";
  return "scheduled";
}

function buildOdds(rows: unknown[], updatedAt: string): BookmakerQuote[] {
  const quotes: BookmakerQuote[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = asObject(raw);
    const home = asNumber(row.odd_1);
    const draw = asNumber(row.odd_x);
    const away = asNumber(row.odd_2);
    if (!(home && home > 1) || !(away && away > 1)) continue;
    const name = asString(row.odd_bookmakers, "AllSportsAPI");
    const canonical = canonicalBookmakerName(name, "allsportsapi");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const rawTotal = 1 / home + (draw && draw > 1 ? 1 / draw : 0) + 1 / away;
    quotes.push({
      id: `asa-${canonical}-${quotes.length}`,
      name: canonical || name,
      canonicalName: canonical || name,
      source: "allsportsapi",
      outcomes: { home, draw: draw && draw > 1 ? draw : null, away },
      updatedAt,
      asOf: updatedAt,
      overround: Math.max(0, rawTotal - 1),
    });
  }
  return quotes;
}

function emptyStanding(team: TeamRef): StandingRow {
  return {
    teamId: team.id,
    teamName: team.name,
    teamShortName: team.shortName,
    position: 0,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    winPercentage: 0,
    scored: 0,
    conceded: 0,
    difference: 0,
    form: [],
  };
}

function emptyStats(teamId: string): TeamAdvancedStats {
  return {
    teamId,
    form: [],
    avgScored: 0,
    avgConceded: 0,
    home: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 },
    away: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 },
    streak: "Sin datos",
    provenance: "none",
  };
}

function mapStanding(raw: unknown): StandingRow | null {
  const row = asObject(raw);
  const name = asString(row.standing_team);
  const played = asNumber(row.standing_P) ?? 0;
  if (!name || played <= 0) return null;
  const wins = asNumber(row.standing_W) ?? 0;
  const draws = asNumber(row.standing_D) ?? 0;
  const losses = asNumber(row.standing_L) ?? 0;
  const scored = asNumber(row.standing_F) ?? 0;
  const conceded = asNumber(row.standing_A) ?? 0;
  return {
    teamId: `asa-${asString(row.team_key)}`,
    teamName: name,
    teamShortName: name,
    position: asNumber(row.standing_place) ?? 0,
    played,
    wins,
    draws,
    losses,
    points: asNumber(row.standing_PTS) ?? wins * 3 + draws,
    winPercentage: wins / played,
    scored,
    conceded,
    difference: asNumber(row.standing_GD) ?? scored - conceded,
    form: [] as FormResult[],
    note: `AllSportsAPI · ${asString(row.league_season) || "temporada actual"}`,
  };
}

function statsFromStanding(row: StandingRow): TeamAdvancedStats {
  return {
    teamId: row.teamId,
    form: [],
    avgScored: row.scored / row.played,
    avgConceded: row.conceded / row.played,
    home: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 },
    away: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 },
    streak: "Sin datos",
    provenance: "table-derived",
    asOf: new Date().toISOString(),
  };
}

function findStanding(rows: StandingRow[], team: TeamRef): StandingRow | null {
  return (
    rows.find((row) => row.teamId === team.id) ??
    rows.find((row) => normalizeName(row.teamName) === normalizeName(team.name)) ??
    null
  );
}

async function fetchJson(met: string, params: Record<string, string>): Promise<Json> {
  const key = process.env.ALLSPORTSAPI_KEY;
  if (!key) return {};
  const url = new URL(`${BASE}/`);
  url.searchParams.set("met", met);
  url.searchParams.set("APIkey", key);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      // La respuesta de Odds supera 2 MB y Next.js no la puede cachear;
      // el cache en memoria de este servicio evita repetir la petición.
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return {};
    const payload = asObject(await response.json());
    return asString(payload.success, "") === "1" || payload.success === 1 ? payload : {};
  } catch {
    return {};
  }
}

async function fetchMatches(now: Date): Promise<AllSportsApiResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!process.env.ALLSPORTSAPI_KEY) {
    return { matches: [], warnings: [], connected: false };
  }

  const from = dateInVETOffset(0, now);
  const to = dateInVETOffset(1, now);
  const warnings: string[] = [];
  const [fixturesPayload, oddsPayload] = await Promise.all([
    fetchJson("Fixtures", { from, to }),
    fetchJson("Odds", { from, to }),
  ]);

  const fixtures = asArray(fixturesPayload.result);
  if (fixtures.length === 0) {
    warnings.push("AllSportsAPI: sin fixtures en la ventana hoy/mañana (VET).");
    const empty = { matches: [] as SportsMatch[], warnings, connected: false };
    cache = { at: Date.now(), data: empty };
    return empty;
  }

  const oddsByMatch = new Map<string, unknown[]>();
  for (const [id, rows] of Object.entries(asObject(oddsPayload.result))) {
    oddsByMatch.set(String(id), asArray(rows));
  }

  const updatedAt = new Date().toISOString();
  const matches: SportsMatch[] = [];
  const leagueKeys = new Set<string>();
  for (const raw of fixtures.slice(0, MAX_FIXTURES)) {
    const event = asObject(raw);
    const id = asString(event.event_key);
    const homeName = asString(event.event_home_team);
    const awayName = asString(event.event_away_team);
    if (!id || !homeName || !awayName) continue;

    const time = asString(event.event_time);
    const commenceTime = normalizeCommenceTime(
      time ? `${asString(event.event_date)} ${time}` : asString(event.event_date),
      now,
    );
    if (!commenceTime || !isWithinMatchWindow(commenceTime, now)) continue;

    const leagueKey = asString(event.league_key);
    if (leagueKey) leagueKeys.add(leagueKey);
    const league = resolveLeague(
      asString(event.league_name),
      leagueKey,
      asString(event.league_season),
    );
    const home = buildTeam(homeName, asString(event.home_team_key), asString(event.home_team_logo));
    const away = buildTeam(awayName, asString(event.away_team_key), asString(event.away_team_logo));
    const quotes = buildOdds(oddsByMatch.get(id) ?? [], updatedAt);
    const homeStanding = emptyStanding(home);
    const awayStanding = emptyStanding(away);
    const match: SportsMatch = {
      id: `asa-${id}`,
      sport: "soccer",
      league,
      commenceTime,
      status: mapStatus(event),
      venue: asString(event.event_stadium) || "Por definir",
      home,
      away,
      odds: summarizeMarket(quotes),
      intel: {
        standings: {
          home: homeStanding,
          away: awayStanding,
          table: [homeStanding, awayStanding],
        },
        stats: { home: emptyStats(home.id), away: emptyStats(away.id) },
        injuries: { home: [], away: [] },
        note: "AllSportsAPI: fixtures, cuotas 1X2 y tabla cuando está disponible; sin xG ni lesiones.",
        provenance: "api",
      },
    };
    match.favoriteSide = canonicalFavoriteFromSummary(match.odds);
    match.canonicalFavorite = match.favoriteSide;
    matches.push(match);
  }

  let standingsApplied = 0;
  for (const leagueKey of Array.from(leagueKeys).slice(0, MAX_STANDINGS_LEAGUES)) {
    const payload = await fetchJson("Standings", { leagueId: leagueKey });
    const rows = asArray(asObject(payload.result).total)
      .map(mapStanding)
      .filter((row): row is StandingRow => row !== null);
    if (rows.length === 0) continue;
    for (const match of matches) {
      const homeRow = findStanding(rows, match.home);
      const awayRow = findStanding(rows, match.away);
      if (!homeRow && !awayRow) continue;
      match.intel.standings = {
        home: homeRow ?? match.intel.standings.home,
        away: awayRow ?? match.intel.standings.away,
        table: Array.from(
          new Map(
            [...match.intel.standings.table, ...rows].map((row) => [row.teamId, row]),
          ).values(),
        ).sort((a, b) => a.position - b.position || a.teamName.localeCompare(b.teamName)),
      };
      match.intel.stats = {
        home: homeRow ? statsFromStanding(homeRow) : match.intel.stats.home,
        away: awayRow ? statsFromStanding(awayRow) : match.intel.stats.away,
      };
      standingsApplied += 1;
    }
  }
  if (standingsApplied > 0) {
    warnings.push(`${standingsApplied} partido(s) con tabla real de AllSportsAPI.`);
  }
  if (matches.length === 0) {
    warnings.push("AllSportsAPI: ningún fixture de la ventana superó la validación de fecha.");
  }

  const data: AllSportsApiResult = {
    matches,
    warnings,
    connected: matches.length > 0,
  };
  cache = { at: Date.now(), data };
  return data;
}

export async function fetchAllSportsApiMatches(
  now: Date = new Date(),
): Promise<AllSportsApiResult> {
  try {
    return await fetchMatches(now);
  } catch {
    return { matches: [], warnings: ["AllSportsAPI: fallo inesperado al consultar fuentes."], connected: false };
  }
}
