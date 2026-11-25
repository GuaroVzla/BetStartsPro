/**
 * Fuente TheRundown V2 (plan gratuito).
 * Aporta fixtures multi-deporte y cuotas 1X2 moneyline de DraftKings, BetMGM y
 * FanDuel. No publica tablas ni xG en este integration: esos campos quedan
 * vacíos para que otras fuentes los completen, nunca inventados.
 *
 * Cuidados del tier gratis:
 * - 1 request/s (espaciado de 1.6 s antes de cada llamada y 1 reintento con backoff).
 * - Datos pre-match con 5 min de retraso.
 * - 20.000 data points/día; se pide solo `market_ids=1`, 3 casas,
 *   `main_line=true` y `hide_closed=true`, con cache de 30 min.
 *
 * Flujo por actualización:
 * 1. `/sports/events/{fecha}?sport_ids=...&offset=-240` (2 fechas VET).
 * 2. Solo para deportes con eventos, `/sports/{id}/events/{fecha}`.
 * El header es `X-TheRundown-Key`; la key nunca va en la URL.
 */
import { LEAGUES } from "@/config/sports";
import { dateInVETOffset, isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { canonicalBookmakerName, normalizeName } from "@/lib/utils";
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

const BASE = "https://therundown.io/api/v2";
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_SPACING_MS = 1600;
const RETRY_BACKOFF_MS = 1600;
const VET_OFFSET_MINUTES = -240;
const MAX_EVENTS = 250;

const AFFILIATES: Record<string, string> = {
  "19": "DraftKings",
  "22": "BetMGM",
  "23": "FanDuel",
};
const AFFILIATE_IDS = Object.keys(AFFILIATES).join(",");

interface RundownSport {
  id: number;
  sport: SportKey;
  label: string;
  leagueId?: string;
}

const SPORTS: RundownSport[] = [
  { id: 11, sport: "soccer", label: "Premier League", leagueId: "epl" },
  { id: 12, sport: "soccer", label: "Ligue 1" },
  { id: 13, sport: "soccer", label: "Bundesliga", leagueId: "bundesliga" },
  { id: 14, sport: "soccer", label: "LaLiga", leagueId: "laliga" },
  { id: 15, sport: "soccer", label: "Serie A", leagueId: "serie-a" },
  { id: 16, sport: "soccer", label: "UEFA Champions League", leagueId: "champions" },
  { id: 33, sport: "soccer", label: "UEFA Europa League" },
  { id: 4, sport: "basketball", label: "NBA", leagueId: "nba" },
  { id: 3, sport: "baseball", label: "MLB", leagueId: "mlb" },
  { id: 6, sport: "hockey", label: "NHL", leagueId: "nhl" },
];

export interface TheRundownResult {
  matches: SportsMatch[];
  warnings: string[];
  connected: boolean;
}

let cache: { at: number; data: TheRundownResult } | null = null;
let lastRequestAt = 0;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asJsonRecord(value: unknown): Record<string, Json> {
  const source = asObject(value);
  const result: Record<string, Json> = {};
  for (const [key, item] of Object.entries(source)) result[key] = asObject(item);
  return result;
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

function americanToDecimal(value: unknown): number | null {
  const american = asNumber(value);
  if (american === null || american <= 1 || american === 0.0001) return null;
  const decimal = american > 0 ? 1 + american / 100 : 1 - 100 / american;
  return decimal > 1 ? Number(decimal.toFixed(3)) : null;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSlot(): Promise<void> {
  const wait = REQUEST_SPACING_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await pause(wait);
  lastRequestAt = Date.now();
}

/**
 * Una sola sonda por petición, con un reintento ligero en 429/5xx o error de
 * red. El plan gratis permite 1 req/s: `waitForSlot` se aplica también al
 * reintento, así que nunca se disparan dos llamadas consecutivas sin espaciar.
 */
async function fetchJson(path: string, query: Record<string, string>): Promise<Json> {
  const key = process.env.THERUNDOWN_API_KEY;
  if (!key) return {};
  const url = new URL(`${BASE}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForSlot();
    try {
      const response = await fetch(url, {
        headers: { "X-TheRundown-Key": key, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return asObject(await response.json());
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await pause(RETRY_BACKOFF_MS);
        continue;
      }
      return { __status: response.status };
    } catch {
      if (attempt === 0) {
        await pause(RETRY_BACKOFF_MS);
        continue;
      }
      return { __networkError: true };
    }
  }
  return { __networkError: true };
}

function paletteFor(name: string) {
  const colors = [
    { color: "#1d4ed8", secondaryColor: "#bfdbfe" },
    { color: "#be123c", secondaryColor: "#fecdd3" },
    { color: "#047857", secondaryColor: "#a7f3d0" },
    { color: "#7c2d12", secondaryColor: "#fed7aa" },
    { color: "#6d28d9", secondaryColor: "#ddd6fe" },
  ];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return colors[hash % colors.length];
}

function buildTeam(raw: Json, fallback: string): TeamRef {
  const name = asString(raw.name) || fallback;
  return {
    id: `trd-${asNumber(raw.team_id) ?? (normalizeName(name) || "equipo")}`,
    name,
    shortName: asString(raw.abbreviation) || name,
    ...paletteFor(name),
  };
}

function resolveLeague(item: RundownSport, season: string): LeagueInfo {
  const configured = item.leagueId
    ? LEAGUES.find((league) => league.id === item.leagueId)
    : undefined;
  if (configured) return configured;
  return {
    id: `trd-${item.id}`,
    sport: item.sport,
    oddsApiKey: "",
    apiSportsId: 0,
    name: item.label,
    shortName: item.label,
    country: "Internacional",
    season: season || String(new Date().getFullYear()),
  };
}

function mapStatus(raw: Json): MatchStatus {
  const status = asString(raw.event_status).toUpperCase();
  if (/FINAL|COMPLETE|CLOSED|POSTP|CANC/.test(status)) return "finished";
  if (/PROGRESS|LIVE|INPLAY|HALFTIME/.test(status)) return "live";
  return "scheduled";
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

function oddsFromEvent(event: Json): BookmakerQuote[] {
  const teams = asArray(event.teams).map(asObject);
  const home = teams.find((team) => team.is_home === true) ?? teams[0] ?? {};
  const away = teams.find((team) => team.is_away === true) ?? teams[1] ?? {};
  const homeId = String(asNumber(home.team_id) ?? "");
  const awayId = String(asNumber(away.team_id) ?? "");
  const market = asArray(event.markets)
    .map(asObject)
    .find((item) => asNumber(item.market_id) === 1 && asNumber(item.period_id) === 0);
  if (!market) return [];

  const pricesByParticipant = new Map<string, Record<string, Json>>();
  for (const rawParticipant of asArray(market.participants)) {
    const participant = asObject(rawParticipant);
    const line = asObject(asArray(participant.lines)[0]);
    pricesByParticipant.set(String(asNumber(participant.id) ?? ""), asJsonRecord(line.prices));
  }
  const homePrices = pricesByParticipant.get(homeId) ?? {};
  const awayPrices = pricesByParticipant.get(awayId) ?? {};
  const drawEntry = asArray(market.participants)
    .map(asObject)
    .find((participant) =>
      /TYPE_RESULT|draw/i.test(`${asString(participant.type)} ${asString(participant.name)}`),
    );
  const drawValues = drawEntry
    ? asObject(asObject(asArray(drawEntry.lines)[0]).prices)
    : {};

  const quotes: BookmakerQuote[] = [];
  for (const affiliateId of Object.keys(AFFILIATES)) {
    const homeDecimal = americanToDecimal(asObject(homePrices[affiliateId]).price);
    const awayDecimal = americanToDecimal(asObject(awayPrices[affiliateId]).price);
    if (!(homeDecimal && homeDecimal > 1) || !(awayDecimal && awayDecimal > 1)) continue;
    const drawDecimal = americanToDecimal(asObject(drawValues[affiliateId]).price);
    const canonical = canonicalBookmakerName(AFFILIATES[affiliateId], "therundown");
    const rawTotal = 1 / homeDecimal + (drawDecimal && drawDecimal > 1 ? 1 / drawDecimal : 0) + 1 / awayDecimal;
    const updatedAt =
      asString(asObject(homePrices[affiliateId]).updated_at) ||
      asString(asObject(awayPrices[affiliateId]).updated_at) ||
      new Date().toISOString();
    quotes.push({
      id: `trd-${affiliateId}`,
      name: canonical || AFFILIATES[affiliateId],
      canonicalName: canonical || AFFILIATES[affiliateId],
      source: "therundown",
      outcomes: { home: homeDecimal, draw: drawDecimal && drawDecimal > 1 ? drawDecimal : null, away: awayDecimal },
      updatedAt,
      asOf: updatedAt,
      overround: Math.max(0, rawTotal - 1),
    });
  }
  return quotes;
}

function mapEvent(event: Json, item: RundownSport, now: Date): SportsMatch | null {
  const commenceTime = normalizeCommenceTime(asString(event.event_date), now);
  if (!commenceTime || !isWithinMatchWindow(commenceTime, now)) return null;
  const teams = asArray(event.teams).map(asObject);
  const homeRaw = teams.find((team) => team.is_home === true);
  const awayRaw = teams.find((team) => team.is_away === true);
  if (!homeRaw || !awayRaw) return null;

  const home = buildTeam(homeRaw, "Local");
  const away = buildTeam(awayRaw, "Visitante");
  const score = asObject(event.score);
  const schedule = asObject(event.schedule);
  const quotes = oddsFromEvent(event);
  const homeStanding = emptyStanding(home);
  const awayStanding = emptyStanding(away);
  const match: SportsMatch = {
    id: `trd-${asString(event.event_id) || `${item.id}-${normalizeName(home.name)}-${normalizeName(away.name)}`}`,
    sport: item.sport,
    league: resolveLeague(item, asString(schedule.season_year)),
    commenceTime,
    status: mapStatus(score),
    venue: asString(score.venue_name) || "Por definir",
    home,
    away,
    odds: summarizeMarket(quotes),
    intel: {
      standings: { home: homeStanding, away: awayStanding, table: [homeStanding, awayStanding] },
      stats: { home: emptyStats(home.id), away: emptyStats(away.id) },
      injuries: { home: [], away: [] },
      note: "TheRundown: cuotas 1X2 con 5 min de retraso (plan gratis); sin tabla ni xG.",
      provenance: "api",
    },
  };
  match.favoriteSide = canonicalFavoriteFromSummary(match.odds);
  match.canonicalFavorite = match.favoriteSide;
  return match;
}

async function fetchMatches(now: Date): Promise<TheRundownResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!process.env.THERUNDOWN_API_KEY) {
    return { matches: [], warnings: [], connected: false };
  }

  const dates = [dateInVETOffset(0, now), dateInVETOffset(1, now)];
  const warnings: string[] = [];
  const usedSportIds = SPORTS.map((item) => String(item.id)).join(",");
  const scheduled = new Map<string, Set<number>>();

  for (const date of dates) {
    const payload = await fetchJson(`/sports/events/${date}`, {
      sport_ids: usedSportIds,
      offset: String(VET_OFFSET_MINUTES),
    });
    if (payload.__status) {
      warnings.push(`TheRundown calendario ${date}: HTTP ${payload.__status}`);
      continue;
    }
    if (payload.__networkError) {
      warnings.push(`TheRundown calendario ${date}: error de red`);
      continue;
    }
    const withEvents = new Set<number>(
      Object.entries(payload)
        .filter(([, values]) => asArray(values).length > 0)
        .map(([id]) => Number(id)),
    );
    scheduled.set(date, withEvents);
  }

  const byId = new Map<string, SportsMatch>();
  for (const date of dates) {
    for (const item of SPORTS) {
      if (!scheduled.get(date)?.has(item.id)) continue;
      const payload = await fetchJson(`/sports/${item.id}/events/${date}`, {
        market_ids: "1",
        affiliate_ids: AFFILIATE_IDS,
        main_line: "true",
        hide_closed: "true",
        offset: String(VET_OFFSET_MINUTES),
      });
      if (payload.__status === 429) {
        warnings.push(`TheRundown ${item.label} ${date}: límite de 1 req/s alcanzado.`);
        continue;
      }
      if (payload.__status || payload.__networkError) {
        warnings.push(`TheRundown ${item.label} ${date}: ${payload.__status ? `HTTP ${payload.__status}` : "error de red"}`);
        continue;
      }
      for (const raw of asArray(payload.events)) {
        const match = mapEvent(asObject(raw), item, now);
        if (!match || byId.has(match.id)) continue;
        byId.set(match.id, match);
      }
    }
  }

  const matches = Array.from(byId.values()).slice(0, MAX_EVENTS);
  if (matches.length > 0) {
    warnings.push(`${matches.length} partido(s) de TheRundown con cuotas 1X2 (5 min de retraso).`);
  } else if (warnings.length === 0) {
    warnings.push("TheRundown: sin partidos en la ventana hoy/mañana (VET).");
  }

  const data: TheRundownResult = { matches, warnings, connected: matches.length > 0 };
  cache = { at: Date.now(), data };
  return data;
}

export async function fetchTheRundownMatches(now: Date = new Date()): Promise<TheRundownResult> {
  try {
    return await fetchMatches(now);
  } catch {
    return {
      matches: [],
      warnings: ["TheRundown: fallo inesperado al consultar fuentes."],
      connected: false,
    };
  }
}
