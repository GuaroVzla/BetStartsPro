import type {
  BookmakerQuote,
  FormResult,
  Injury,
  LeagueInfo,
  MatchStatus,
  OutcomePrices,
  StandingRow,
  TeamAdvancedStats,
  VenueSplit,
} from "@/types/sports";
import { clamp } from "@/lib/utils";
import { dateInVET, dateInVETOffset, normalizeCommenceTime } from "@/lib/format";

const CACHE_SECONDS = 3600;

const BASES = {
  soccer: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
} as const;

type JsonObject = Record<string, unknown>;

export interface ApiSportsEvent {
  id: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeLogo?: string;
  awayLogo?: string;
  commenceTime: string;
  venue: string;
  status: MatchStatus;
  homeScore?: number;
  awayScore?: number;
}

export interface ApiSportsLeagueEvents {
  events: ApiSportsEvent[];
  remaining: number | null;
  error?: string;
}

export interface ApiSportsLeagueStandings {
  standings: StandingRow[];
  remaining: number | null;
  error?: string;
}

export interface ApiSportsLeagueInjuries {
  injuries: Injury[];
  remaining: number | null;
  supported: boolean;
  error?: string;
}

export interface ApiSportsTeamStats {
  stats: TeamAdvancedStats | null;
  remaining: number | null;
  error?: string;
}

export interface ApiSportsEventOdds {
  bookmakers: BookmakerQuote[];
  remaining: number | null;
  error?: string;
}

interface ApiRequestResult {
  response: unknown;
  remaining: number | null;
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

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nested(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as JsonObject)[segment];
  }
  return current;
}

function flexibleNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") return asNumber(value, fallback);
  if (value && typeof value === "object") {
    const object = value as JsonObject;
    const candidates = [object.total, object.all, object.value, object.home];
    for (const candidate of candidates) {
      if (candidate !== undefined) return flexibleNumber(candidate, fallback);
    }
  }
  return fallback;
}

function parseForm(value: unknown): FormResult[] {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.replace(/[^WDL]/gi, "").toUpperCase();
  return normalized
    .split("")
    .filter((letter): letter is FormResult => ["W", "D", "L"].includes(letter))
    .slice(-5);
}

function parseRemaining(response: Response): number | null {
  const raw =
    response.headers.get("x-ratelimit-requests-remaining") ??
    response.headers.get("x-ratelimit-remaining");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function collectApiErrors(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) {
    if (errors.length === 0) return null;
    return errors.map((error) => asString(error)).filter(Boolean).join(" · ");
  }
  if (typeof errors === "object") {
    const messages = Object.values(errors as JsonObject)
      .map((value) => asString(value))
      .filter(Boolean);
    return messages.length ? messages.join(" · ") : null;
  }
  return asString(errors) || null;
}

async function apiRequest(
  league: LeagueInfo,
  path: string,
  params: Record<string, string | number>,
): Promise<ApiRequestResult> {
  const apiKey = process.env.APISPORTS_KEY;
  if (!apiKey) throw new Error("APISPORTS_KEY no configurada");

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  const url = `${BASES[league.sport]}${path}?${searchParams.toString()}`;
  const response = await fetch(url, {
    next: { revalidate: CACHE_SECONDS },
    headers: {
      "x-apisports-key": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  const remaining = parseRemaining(response);

  let payload: JsonObject;
  try {
    payload = asObject(await response.json());
  } catch {
    payload = {};
  }

  const apiError = collectApiErrors(payload.errors);
  if (!response.ok || apiError) {
    throw new Error(
      apiError ?? `${league.name}: API-Sports respondió HTTP ${response.status}`,
    );
  }

  return {
    response: payload.response,
    remaining,
  };
}

/**
 * API-Sports devuelve las horas en el `timezone` solicitado pero no siempre
 * incluye el offset en el string. Pedimos America/Caracas y convertimos
 * explícitamente a ISO con offset -04:00 para que el filtro VET del agregador
 * y el reloj del navegador hablen el mismo idioma.
 */
function minNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length === 0 ? null : Math.min(...valid);
}

function normalizeApiCommenceTime(date: string, time?: string): string {
  if (!date) return "";
  // Cuando la API separa fecha y hora se unen antes de validar; si la fecha
  // ya trae hora/offset se normaliza tal cual. Inválido => "" (se descarta).
  const value =
    !date.includes("T") && time && /^\d{2}:\d{2}/.test(time)
      ? `${date} ${time.slice(0, 5)}`
      : date;
  return normalizeCommenceTime(value) ?? "";
}

function mapStatus(short: unknown, long: unknown): MatchStatus {
  const token = `${asString(short)} ${asString(long)}`.toUpperCase();
  if (/(FINISHED|FINAL|FT|AOT|AP|ENDED|AFTER)/.test(token)) return "finished";
  if (/(1H|2H|HT|LIVE|Q1|Q2|Q3|Q4|OT|P1|P2|P3|IN[0-9]|INN)/.test(token)) {
    return "live";
  }
  return "scheduled";
}

function mapFootballFixture(item: unknown, league: LeagueInfo): ApiSportsEvent {
  const fixture = asObject(nested(item, "fixture"));
  const teams = asObject(nested(item, "teams"));
  const home = asObject(nested(teams, "home"));
  const away = asObject(nested(teams, "away"));
  const goals = asObject(nested(item, "goals"));
  const status = asObject(nested(fixture, "status"));
  const venue = asObject(nested(fixture, "venue"));
  const venueName =
    asString(venue.name) ||
    asString(venue.city) ||
    `${league.shortName} · Sede por confirmar`;

  return {
    id: asString(fixture.id),
    leagueId: league.id,
    homeTeamId: asString(home.id),
    awayTeamId: asString(away.id),
    homeTeamName: asString(home.name, "Local"),
    awayTeamName: asString(away.name, "Visitante"),
    homeLogo: asString(home.logo) || undefined,
    awayLogo: asString(away.logo) || undefined,
    commenceTime: normalizeApiCommenceTime(asString(fixture.date)),
    venue: venueName,
    status: mapStatus(status.short, status.long),
    homeScore:
      goals.home === null || goals.home === undefined
        ? undefined
        : asNumber(goals.home),
    awayScore:
      goals.away === null || goals.away === undefined
        ? undefined
        : asNumber(goals.away),
  };
}

function mapOtherGame(item: unknown, league: LeagueInfo): ApiSportsEvent {
  const teams = asObject(nested(item, "teams"));
  const home = asObject(nested(teams, "home"));
  const away = asObject(nested(teams, "away"));
  const scores = asObject(nested(item, "scores"));
  const status = asObject(nested(item, "status"));
  const venue = nested(item, "venue");
  const leagueInfo = asObject(nested(item, "league"));
  const venueName =
    typeof venue === "string"
      ? venue
      : asString(nested(venue, "name")) ||
        asString(nested(leagueInfo, "name")) ||
        league.shortName;
  const date = asString(nested(item, "date"));
  const time = asString(nested(item, "time"));
  const commenceTime = normalizeApiCommenceTime(date, time);
  const homeTotal = nested(scores, "home.total");
  const awayTotal = nested(scores, "away.total");

  return {
    id: asString(nested(item, "id")),
    leagueId: league.id,
    homeTeamId: asString(home.id),
    awayTeamId: asString(away.id),
    homeTeamName: asString(home.name, "Local"),
    awayTeamName: asString(away.name, "Visitante"),
    homeLogo: asString(home.logo) || undefined,
    awayLogo: asString(away.logo) || undefined,
    commenceTime,
    venue: venueName,
    status: mapStatus(status.short, status.long),
    homeScore:
      homeTotal === null || homeTotal === undefined
        ? undefined
        : asNumber(homeTotal),
    awayScore:
      awayTotal === null || awayTotal === undefined
        ? undefined
        : asNumber(awayTotal),
  };
}

export async function fetchLeagueEvents(
  league: LeagueInfo,
): Promise<ApiSportsLeagueEvents> {
  const now = new Date();
  // Consultamos las dos ventanas operativas del radar en hora de Venezuela.
  // Calcular `date` con getFullYear/getMonth/getDate del Worker (UTC) dejaba
  // fuera los partidos de "hoy VET" durante varias horas de la madrugada.
  const dates = [dateInVET(now), dateInVETOffset(1, now)];
  const path = league.sport === "soccer" ? "/fixtures" : "/games";

  const results = await Promise.allSettled(
    dates.map((date) =>
      apiRequest(league, path, {
        date,
        league: league.apiSportsId,
        season: league.season,
        timezone: "America/Caracas",
      }),
    ),
  );

  const events = results.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    return asArray(result.value.response)
      .map((item) =>
        league.sport === "soccer"
          ? mapFootballFixture(item, league)
          : mapOtherGame(item, league),
      )
      .filter((event) => event.id && event.homeTeamName && event.awayTeamName);
  });

  const remaining = minNullable(
    results.map((result) =>
      result.status === "fulfilled" ? result.value.remaining : null,
    ),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected"
      ? [
          result.reason instanceof Error
            ? result.reason.message
            : "Error de red en API-Sports",
        ]
      : [],
  );

  if (results.every((result) => result.status === "rejected")) {
    return {
      events: [],
      remaining: null,
      error: errors[0] ?? "API-Sports no respondió",
    };
  }

  return { events, remaining, error: errors[0] };
}

function mapFootballStanding(item: unknown): StandingRow | null {
  const row = asObject(item);
  const team = asObject(nested(row, "team"));
  const all = asObject(nested(row, "all"));
  const goals = asObject(nested(all, "goals"));
  const played = asNumber(nested(all, "played"));
  const wins = asNumber(nested(all, "win"));
  const draws = asNumber(nested(all, "draw"));
  const losses = asNumber(nested(all, "lose"));
  const scored = asNumber(nested(goals, "for"));
  const conceded = asNumber(nested(goals, "against"));
  const name = asString(team.name);

  if (!name) return null;

  return {
    teamId: asString(team.id),
    teamName: name,
    teamShortName: asString(team.name, name),
    position: asNumber(row.rank, 99),
    played,
    wins,
    draws,
    losses,
    points: asNumber(row.points, wins * 3 + draws),
    winPercentage: played > 0 ? wins / played : 0,
    scored,
    conceded,
    difference: asNumber(row.goalsDiff, scored - conceded),
    form: parseForm(row.form),
    group: asString(row.group) || undefined,
    note: asString(row.description) || undefined,
  };
}

function mapOtherStanding(item: unknown): StandingRow | null {
  const row = asObject(item);
  const team = asObject(nested(row, "team"));
  const games = asObject(nested(row, "games"));
  const name = asString(team.name);
  if (!name) return null;

  const played = flexibleNumber(games.played ?? row.played);
  const wins = flexibleNumber(games.win ?? games.wins ?? row.wins);
  const draws = flexibleNumber(games.draw ?? games.draws ?? row.draws);
  const losses = flexibleNumber(games.lose ?? games.losses ?? row.losses);
  const scored = flexibleNumber(
    nested(row, "goals.for") ??
      nested(row, "runs.for") ??
      nested(row, "points_for") ??
      row.scored,
  );
  const conceded = flexibleNumber(
    nested(row, "goals.against") ??
      nested(row, "runs.against") ??
      nested(row, "points_against") ??
      row.conceded,
  );
  const difference = flexibleNumber(
    row.goalsDiff ?? row.difference,
    scored - conceded,
  );
  const groupValue =
    asString(row.group) ||
    asString(nested(row, "group.name")) ||
    asString(row.conference) ||
    asString(row.division);
  const form = parseForm(row.form);

  return {
    teamId: asString(team.id),
    teamName: name,
    teamShortName: name,
    position: asNumber(row.position ?? row.rank, 99),
    played,
    wins,
    draws,
    losses,
    points: asNumber(row.points, wins * 2),
    winPercentage: played > 0 ? wins / played : 0,
    scored,
    conceded,
    difference,
    form,
    group: groupValue || undefined,
    note: asString(row.description) || undefined,
  };
}

function flattenStandingGroups(value: unknown): unknown[] {
  const groups = asArray(value);
  if (groups.length === 0) return [];
  if (groups.some((group) => Array.isArray(group))) {
    return groups.flatMap((group) => asArray(group));
  }
  return groups;
}

export async function fetchLeagueStandings(
  league: LeagueInfo,
): Promise<ApiSportsLeagueStandings> {
  try {
    const { response, remaining } = await apiRequest(
      league,
      "/standings",
      {
        league: league.apiSportsId,
        season: league.season,
      },
    );
    const standings: StandingRow[] = [];

    for (const entry of asArray(response)) {
      const groups = flattenStandingGroups(nested(entry, "league.standings"));
      for (const groupRow of groups) {
        const mapped =
          league.sport === "soccer"
            ? mapFootballStanding(groupRow)
            : mapOtherStanding(groupRow);
        if (mapped) standings.push(mapped);
      }
    }

    standings.sort((a, b) => {
      const groupCompare = (a.group ?? "").localeCompare(b.group ?? "");
      return groupCompare !== 0 ? groupCompare : a.position - b.position;
    });

    return { standings, remaining };
  } catch (error) {
    return {
      standings: [],
      remaining: null,
      error: error instanceof Error ? error.message : "Error de red",
    };
  }
}

function parseOdd(value: unknown): number | null {
  const raw =
    typeof value === "object" && value !== null
      ? (value as JsonObject).odd
      : value;
  const odds = typeof raw === "string" ? Number(raw) : asNumber(raw);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

function extractBookmakers(
  item: unknown,
  homeTeam?: string,
  awayTeam?: string,
): BookmakerQuote[] {
  const bookmakersRaw = asArray(nested(item, "bookmakers"));
  const updatedAt =
    asString(nested(item, "update")) ||
    asString(nested(item, "last_update")) ||
    new Date().toISOString();
  const result: BookmakerQuote[] = [];

  for (const rawBookmaker of bookmakersRaw) {
    const bookmaker = asObject(rawBookmaker);
    const bets = asArray(bookmaker.bets);
    const bet = bets.find((candidate) => {
      const name = asString(nested(candidate, "name")).toLowerCase();
      return /(match winner|winner|moneyline|1x2|home\/away)/.test(name);
    });
    if (!bet) continue;

    const values = asArray(nested(bet, "values"));
    const outcomes: OutcomePrices = { home: 0, draw: null, away: 0 };
    const normalizedHome = homeTeam?.toLowerCase() ?? "";
    const normalizedAway = awayTeam?.toLowerCase() ?? "";
    const leftovers: Array<{ label: string; price: number }> = [];

    for (const rawValue of values) {
      const valueObject = asObject(rawValue);
      const label = asString(valueObject.value).toLowerCase();
      const price = parseOdd(valueObject.odd);
      if (price === null) continue;

      if (
        label === "home" ||
        label === "1" ||
        (normalizedHome && label === normalizedHome)
      ) {
        outcomes.home = price;
      } else if (
        label === "away" ||
        label === "2" ||
        (normalizedAway && label === normalizedAway)
      ) {
        outcomes.away = price;
      } else if (label === "draw" || label === "x" || label === "tie") {
        outcomes.draw = price;
      } else {
        leftovers.push({ label, price });
      }
    }

    if (outcomes.home <= 1 && outcomes.away <= 1 && leftovers.length >= 2) {
      outcomes.home = leftovers[0].price;
      outcomes.away = leftovers[1].price;
    }
    if (outcomes.home <= 1 || outcomes.away <= 1) continue;

    result.push({
      id: `api-sports-${asString(bookmaker.id, asString(bookmaker.name))}`,
      name: asString(bookmaker.name, "API-Sports"),
      source: "api-sports",
      outcomes,
      updatedAt,
    });
  }

  return result;
}

export async function fetchEventOdds(
  league: LeagueInfo,
  event: ApiSportsEvent,
): Promise<ApiSportsEventOdds> {
  try {
    const { response, remaining } = await apiRequest(league, "/odds", {
      [league.sport === "soccer" ? "fixture" : "game"]: event.id,
    });
    const item = asArray(response)[0];
    const bookmakers = extractBookmakers(
      item,
      event.homeTeamName,
      event.awayTeamName,
    );
    return { bookmakers, remaining };
  } catch (error) {
    return {
      bookmakers: [],
      remaining: null,
      error: error instanceof Error ? error.message : "Error de red",
    };
  }
}

function parseVenueSplit(
  played: number,
  wins: number,
  draws: number,
  losses: number,
  scored: number,
  conceded: number,
): VenueSplit {
  return {
    played,
    wins,
    draws,
    losses,
    scored,
    conceded,
  };
}

export async function fetchTeamStatistics(
  league: LeagueInfo,
  teamId: string,
): Promise<ApiSportsTeamStats> {
  const path = league.sport === "soccer" ? "/teams/statistics" : "/statistics";
  try {
    const { response, remaining } = await apiRequest(league, path, {
      league: league.apiSportsId,
      season: league.season,
      team: teamId,
    });
    const payload = Array.isArray(response) ? response[0] : response;
    const source = asObject(payload);
    const fixtures = asObject(nested(source, "fixtures"));
    const goals = asObject(nested(source, "goals"));
    const played = flexibleNumber(nested(fixtures, "played.total"));
    const wins = flexibleNumber(nested(fixtures, "wins.total"));
    const draws = flexibleNumber(nested(fixtures, "draws.total"));
    const losses = flexibleNumber(nested(fixtures, "loses.total"));

    let avgScored = flexibleNumber(nested(goals, "for.average.total"));
    let avgConceded = flexibleNumber(nested(goals, "against.average.total"));
    const scoredTotal = flexibleNumber(nested(goals, "for.total.total"));
    const concededTotal = flexibleNumber(nested(goals, "against.total.total"));

    if (avgScored <= 0 && played > 0 && scoredTotal > 0) {
      avgScored = scoredTotal / played;
    }
    if (avgConceded <= 0 && played > 0 && concededTotal > 0) {
      avgConceded = concededTotal / played;
    }

    if (avgScored <= 0 && avgConceded <= 0) {
      return { stats: null, remaining };
    }

    const homePlayed = flexibleNumber(nested(fixtures, "played.home"));
    const homeWins = flexibleNumber(nested(fixtures, "wins.home"));
    const homeDraws = flexibleNumber(nested(fixtures, "draws.home"));
    const homeLosses = flexibleNumber(nested(fixtures, "loses.home"));
    const awayPlayed = flexibleNumber(nested(fixtures, "played.away"));
    const awayWins = flexibleNumber(nested(fixtures, "wins.away"));
    const awayDraws = flexibleNumber(nested(fixtures, "draws.away"));
    const awayLosses = flexibleNumber(nested(fixtures, "loses.away"));
    const homeScored = flexibleNumber(nested(goals, "for.total.home"));
    const homeConceded = flexibleNumber(nested(goals, "against.total.home"));
    const awayScored = flexibleNumber(nested(goals, "for.total.away"));
    const awayConceded = flexibleNumber(nested(goals, "against.total.away"));
    const form = parseForm(source.form);

    return {
      stats: {
        teamId,
        form,
        avgScored,
        avgConceded,
        home: parseVenueSplit(
          homePlayed,
          homeWins,
          homeDraws,
          homeLosses,
          homeScored,
          homeConceded,
        ),
        away: parseVenueSplit(
          awayPlayed,
          awayWins,
          awayDraws,
          awayLosses,
          awayScored,
          awayConceded,
        ),
        streak: form.length > 0 ? `${form[form.length - 1]}` : "Sin datos",
      },
      remaining,
    };
  } catch (error) {
    return {
      stats: null,
      remaining: null,
      error: error instanceof Error ? error.message : "Error de red",
    };
  }
}

function inferImpact(status: string, reason: string): "high" | "medium" | "low" {
  const token = `${status} ${reason}`.toLowerCase();
  if (/(out|surgery|broken|fracture|acl|cruzado|cirug|rotura)/.test(token)) {
    return "high";
  }
  if (/(doubt|question|day to day|duda|molest|gestion|gestión)/.test(token)) {
    return "medium";
  }
  return "low";
}

export async function fetchLeagueInjuries(
  league: LeagueInfo,
): Promise<ApiSportsLeagueInjuries> {
  if (league.sport !== "soccer") {
    return {
      injuries: [],
      remaining: null,
      supported: false,
      error: "API-Sports no expone lesiones para este deporte.",
    };
  }

  try {
    const { response, remaining } = await apiRequest(league, "/injuries", {
      league: league.apiSportsId,
      season: league.season,
      date: dateInVET(),
    });
    const injuries = asArray(response)
      .map((rawEntry, index): Injury | null => {
        const entry = asObject(rawEntry);
        const player = asObject(nested(entry, "player"));
        const team = asObject(nested(entry, "team"));
        const playerName = asString(player.name);
        const teamId = asString(team.id);
        if (!playerName || !teamId) return null;
        const type = asString(player.type, "Baja");
        const reason = asString(player.reason, "No disponible");
        return {
          id: `injury-${teamId}-${index}`,
          teamId,
          player: playerName,
          position: asString(player.position, "Jugador"),
          status: type,
          reason,
          impact: inferImpact(type, reason),
        };
      })
      .filter((injury): injury is Injury => injury !== null);

    return { injuries, remaining, supported: true };
  } catch (error) {
    return {
      injuries: [],
      remaining: null,
      supported: true,
      error: error instanceof Error ? error.message : "Error de red",
    };
  }
}

export function clampStat(value: number, min: number, max: number): number {
  return clamp(value, min, max);
}
