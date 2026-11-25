/**
 * Fuente gratuita ESPN (endpoint público no oficial).
 * Aporta fixtures, estado, sede y, cuando ESPN lo publica, moneyline 1X2.
 * No requiere API key; se usa como fuente principal de cobertura gratuita.
 *
 * Cobertura:
 * - Fútbol: `soccer/all` agrega todas las competiciones del día en 1 request.
 * - Básquet, béisbol y hockey: feeds específicos por liga.
 */
import { LEAGUES } from "@/config/sports";
import { isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { normalizeName } from "@/lib/utils";
import type {
  BookmakerQuote,
  LeagueInfo,
  MatchStatus,
  SportKey,
  StandingRow,
  SportsMatch,
  TeamAdvancedStats,
  TeamRef,
} from "@/types/sports";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const CACHE_SECONDS = 1800;
const MAX_TOTAL_EVENTS = 600;

type JsonObject = Record<string, unknown>;

interface EspnFeed {
  path: string;
  sport: SportKey;
  /** Liga configurada cuyos metadatos (nombre/país) se heredan. */
  leagueId?: string;
  /** País para ligas descubiertas que no están en LEAGUES. */
  country?: string;
}

const ESPN_FEEDS: EspnFeed[] = [
  // `soccer/all` devuelve todas las competiciones (ligas, copas y torneos).
  { path: "soccer/all", sport: "soccer" },
  { path: "basketball/nba", sport: "basketball", leagueId: "nba" },
  { path: "basketball/euroleague", sport: "basketball", leagueId: "euroleague" },
  { path: "basketball/mens-college-basketball", sport: "basketball", country: "Estados Unidos" },
  { path: "basketball/wnba", sport: "basketball", country: "Estados Unidos" },
  { path: "baseball/mlb", sport: "baseball", leagueId: "mlb" },
  { path: "baseball/dominican-winter-league", sport: "baseball", leagueId: "lidom" },
  { path: "baseball/venezuelan-winter-league", sport: "baseball", country: "Venezuela" },
  { path: "baseball/mexican-winter-league", sport: "baseball", country: "México" },
  { path: "baseball/college-baseball", sport: "baseball", country: "Estados Unidos" },
  { path: "hockey/nhl", sport: "hockey", leagueId: "nhl" },
  { path: "hockey/mens-college-hockey", sport: "hockey", country: "Estados Unidos" },
];

export interface EspnSourceResult {
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

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function americanToDecimal(value: unknown): number | null {
  const american = asNumber(value);
  if (american === null || american === 0) return null;
  const decimal = american > 0 ? 1 + american / 100 : 1 - 100 / american;
  return decimal > 1 ? Number(decimal.toFixed(3)) : null;
}

function oddsFromCompetition(competition: JsonObject, updatedAt: string): BookmakerQuote[] {
  const bookmakers: BookmakerQuote[] = [];
  for (const raw of asArray(competition.odds)) {
    const odd = asObject(raw);
    const moneyline = asObject(odd.moneyline);
    const close = (side: unknown) => asObject(asObject(side).close);
    const home = americanToDecimal(
      close(moneyline.home).odds ?? asObject(asObject(odd.homeTeamOdds).close).odds,
    );
    const away = americanToDecimal(
      close(moneyline.away).odds ?? asObject(asObject(odd.awayTeamOdds).close).odds,
    );
    const draw = americanToDecimal(
      asObject(odd.drawOdds).moneyLine ?? close(odd.drawOdds).odds,
    );
    if (!(home && home > 1) || !(away && away > 1)) continue;
    const provider = asString(asObject(odd.provider).name, "ESPN");
    const rawHome = 1 / home;
    const rawDraw = draw && draw > 1 ? 1 / draw : 0;
    const rawAway = 1 / away;
    bookmakers.push({
      id: `espn-${normalizeName(provider)}-${bookmakers.length}`,
      name: provider,
      canonicalName: provider,
      source: "espn",
      outcomes: { home, draw: draw && draw > 1 ? draw : null, away },
      updatedAt,
      asOf: updatedAt,
      overround: Math.max(0, rawHome + rawDraw + rawAway - 1),
    });
  }
  return bookmakers;
}

function paletteFor(name: string) {
  const colors = [
    { color: "#2563eb", secondaryColor: "#bfdbfe" },
    { color: "#dc2626", secondaryColor: "#fecaca" },
    { color: "#059669", secondaryColor: "#a7f3d0" },
    { color: "#d97706", secondaryColor: "#fde68a" },
    { color: "#7c3aed", secondaryColor: "#ddd6fe" },
    { color: "#0e7490", secondaryColor: "#a5f3fc" },
  ];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return colors[hash % colors.length];
}

function buildTeam(team: JsonObject, fallbackName: string): TeamRef {
  const name = asString(team.displayName) || asString(team.name) || fallbackName;
  return {
    id: `espn-${asString(team.id) || normalizeName(name) || "equipo"}`,
    name,
    shortName: asString(team.shortDisplayName) || name,
    ...paletteFor(name),
    logo: asString(team.logo) || undefined,
  };
}

function buildStanding(team: TeamRef): StandingRow {
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

function buildStats(teamId: string): TeamAdvancedStats {
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

function mapStatus(competition: JsonObject | undefined): MatchStatus {
  if (!competition) return "scheduled";
  const type = asObject(asObject(competition.status).type);
  const state = asString(type.state).toLowerCase();
  const name = asString(type.name).toUpperCase();
  if (state === "post" || name.includes("FULL_TIME") || name.includes("FINAL")) return "finished";
  if (state === "in" || name.includes("IN_PROGRESS")) return "live";
  return "scheduled";
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const leagueCache = new Map<string, LeagueInfo>();

function configuredLeagueFor(sport: SportKey, label: string): LeagueInfo | undefined {
  const normalized = normalizeName(label);
  if (!normalized) return undefined;
  return LEAGUES.find((league) => {
    if (league.sport !== sport) return false;
    const name = normalizeName(league.name);
    // Coincidencia por nombre completo o sufijo ("English Premier League" →
    // "Premier League"). Evita que "Championship" o "AFC Champions League"
    // se confundan con la Champions de la UEFA.
    return normalized === name || normalized.endsWith(` ${name}`);
  });
}

function resolveLeague(feed: EspnFeed, label: string, seasonYear: number): LeagueInfo {
  const explicit = feed.leagueId
    ? LEAGUES.find((league) => league.id === feed.leagueId)
    : undefined;
  const configured = explicit ?? configuredLeagueFor(feed.sport, label);
  if (configured) return configured;

  const cacheKey = `${feed.sport}|${label}`;
  const cached = leagueCache.get(cacheKey);
  if (cached) return cached;

  const league: LeagueInfo = {
    id: `espn-${slugify(label) || feed.sport}`,
    sport: feed.sport,
    oddsApiKey: "",
    apiSportsId: 0,
    name: label,
    shortName: label,
    country: feed.country ?? "Internacional",
    season: String(seasonYear),
  };
  leagueCache.set(cacheKey, league);
  return league;
}

const DEFAULT_LABEL: Record<SportKey, string> = {
  soccer: "Fútbol internacional",
  basketball: "Básquet internacional",
  baseball: "Béisbol internacional",
  hockey: "Hockey internacional",
};

/** Etiqueta de competición: `altGameNote` suele traer "Liga, Fase". */
function competitionLabel(payload: JsonObject, event: JsonObject, sport: SportKey): string {
  const competition = asObject(asArray(event.competitions)[0]);
  const note = asString(competition.altGameNote);
  if (note) return note.split(",")[0].trim();
  const leagueName = asString(asObject(asArray(payload.leagues)[0]).name);
  return leagueName || DEFAULT_LABEL[sport];
}

function parseFeedDate(date: string, feed: EspnFeed) {
  const url = `${ESPN_BASE}/${feed.path}/scoreboard?dates=${date}&limit=400`;
  return fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: CACHE_SECONDS },
    signal: AbortSignal.timeout(12000),
  }).then(async (response) => {
    if (!response.ok) {
      return { feed, response, payload: null as JsonObject | null };
    }
    return { feed, response, payload: asObject(await response.json()) };
  });
}

async function fetchFeed(feed: EspnFeed, date: string, now: Date) {
  const seasonYear = now.getUTCFullYear();
  try {
    const { response, payload } = await parseFeedDate(date, feed);
    if (!response.ok || !payload) {
      return { matches: [] as SportsMatch[], error: `${feed.path}: ESPN HTTP ${response.status}` };
    }
    const matches: SportsMatch[] = [];
    for (const rawEvent of asArray(payload.events)) {
      const event = asObject(rawEvent);
      const competition = asObject(asArray(event.competitions)[0]);
      const commenceTime = normalizeCommenceTime(event.date, now);
      if (!commenceTime || !isWithinMatchWindow(commenceTime, now)) continue;

      const competitors = asArray(competition.competitors).map(asObject);
      const homeRaw = competitors.find((item) => asString(item.homeAway) === "home");
      const awayRaw = competitors.find((item) => asString(item.homeAway) === "away");
      if (!homeRaw || !awayRaw) continue;

      const home = buildTeam(asObject(homeRaw.team), "Local");
      const away = buildTeam(asObject(awayRaw.team), "Visitante");
      const label = competitionLabel(payload, event, feed.sport);
      const eventSeason = asNumber(asObject(event.season).year) ?? seasonYear;
      const league = resolveLeague(feed, label, eventSeason);
      const updatedAt = new Date().toISOString();
      const bookmakers = oddsFromCompetition(competition, updatedAt);
      const homeStanding = buildStanding(home);
      const awayStanding = buildStanding(away);
      const match: SportsMatch = {
        id: `espn-${asString(event.id) || `${feed.sport}-${normalizeName(home.name)}-${normalizeName(away.name)}`}`,
        sport: feed.sport,
        league,
        commenceTime,
        status: mapStatus(competition),
        venue: asString(asObject(competition.venue).fullName) || "Por definir",
        home,
        away,
        odds: summarizeMarket(bookmakers),
        intel: {
          standings: { home: homeStanding, away: awayStanding, table: [homeStanding, awayStanding] },
          stats: { home: buildStats(home.id), away: buildStats(away.id) },
          injuries: { home: [], away: [] },
          note: "Fuente gratuita ESPN: fixtures y estado. Sin tabla, lesiones ni xG.",
          provenance: "api",
        },
      };
      match.favoriteSide = canonicalFavoriteFromSummary(match.odds);
      match.canonicalFavorite = match.favoriteSide;
      matches.push(match);
    }
    return { matches, error: null as string | null };
  } catch (error) {
    return {
      matches: [] as SportsMatch[],
      error: `${feed.path}: ESPN ${error instanceof Error ? error.message : "error de red"}`,
    };
  }
}

export async function fetchEspnMatches(now: Date = new Date()): Promise<EspnSourceResult> {
  const dates = [0, 1].map((offset) => {
    const shifted = new Date(now.getTime() + offset * 86_400_000);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(shifted)
      .replace(/-/g, "");
  });

  const results = await Promise.all(
    ESPN_FEEDS.flatMap((feed) => dates.map((date) => fetchFeed(feed, date, now))),
  );

  const warnings = results
    .map((result) => result.error)
    .filter((value): value is string => Boolean(value));

  const byId = new Map<string, SportsMatch>();
  for (const match of results.flatMap((result) => result.matches)) {
    const key = match.id;
    const existing = byId.get(key);
    if (!existing || (existing.odds.bookmakers.length === 0 && match.odds.bookmakers.length > 0)) {
      byId.set(key, match);
    }
  }

  const matches = Array.from(byId.values()).slice(0, MAX_TOTAL_EVENTS);
  const soccerAllFailed = results.some(
    (result) => result.error?.startsWith("soccer/all") ?? false,
  );
  if (soccerAllFailed) {
    warnings.push("ESPN: soccer/all falló; cobertura de fútbol reducida en esta actualización.");
  }

  return { matches, warnings, connected: matches.length > 0 };
}
