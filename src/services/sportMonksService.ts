import type { ApiSportsEvent } from "@/services/apiSportsService";
import type { NormalizedOddsEvent } from "@/services/oddsApiService";
import type { BookmakerQuote, LeagueInfo, OutcomePrices } from "@/types/sports";

const SPORTMONKS_BASE = "https://api.sportmonks.com/v3/football";
const CACHE_SECONDS = 3600;
const MATCH_WINNER_MARKET_ID = 1;

interface SportMonksParticipant {
  id: number;
  name: string;
  meta?: { location?: string };
}

interface SportMonksFixture {
  id: number;
  league_id: number;
  name?: string | null;
  starting_at: string;
  participants?: SportMonksParticipant[];
}

interface SportMonksBookmaker {
  id: number;
  name: string;
}

interface SportMonksOdd {
  market_id: number;
  bookmaker_id: number;
  label: string;
  value: string;
  stopped?: boolean;
  latest_bookmaker_update?: string | null;
  bookmaker?: SportMonksBookmaker | null;
}

interface SportMonksPayload<T> {
  data?: T;
  rate_limit?: { remaining?: number };
  message?: string;
  error?: { message?: string };
}

interface RequestResult<T> {
  data: T | null;
  remaining: number | null;
  error?: string;
}

export interface SportMonksLeagueResult {
  leagueId: string;
  fixtures: ApiSportsEvent[];
  oddsEvents: NormalizedOddsEvent[];
  creditsRemaining: number | null;
  error?: string;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function minNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length === 0 ? null : Math.min(...valid);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTimestamp(value: string): string {
  const candidate = value.includes("T") ? value : value.replace(" ", "T");
  const dated = candidate.endsWith("Z") ? candidate : `${candidate}Z`;
  const parsed = new Date(dated);
  return Number.isNaN(parsed.getTime()) ? dated : parsed.toISOString();
}

async function request<T>(
  path: string,
  params: Record<string, string>,
): Promise<RequestResult<T>> {
  const apiKey = process.env.SPORTMONKS_KEY;
  if (!apiKey) {
    return { data: null, remaining: null, error: "SPORTMONKS_KEY no configurada" };
  }

  const url = new URL(`${SPORTMONKS_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
      },
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(15000),
    });
    const payload = (await response.json()) as SportMonksPayload<T>;
    const remaining = parseNumber(
      response.headers.get("x-ratelimit-remaining") ??
        payload.rate_limit?.remaining,
    );

    if (!response.ok) {
      const detail =
        payload.message ??
        payload.error?.message ??
        `HTTP ${response.status}`;
      return { data: null, remaining, error: detail };
    }

    return { data: payload.data ?? null, remaining };
  } catch (error) {
    return {
      data: null,
      remaining: null,
      error:
        error instanceof Error ? error.message : "Error de red con SportMonks",
    };
  }
}

function mapFixture(
  fixture: SportMonksFixture,
  league: LeagueInfo,
): ApiSportsEvent | null {
  const participants = fixture.participants ?? [];
  const home =
    participants.find((item) => item.meta?.location === "home") ??
    participants[0];
  const away =
    participants.find((item) => item.meta?.location === "away") ??
    participants[1];

  const fallbackNames = (fixture.name ?? "").split(" vs ").map((name) => name.trim());
  const homeName = home?.name || fallbackNames[0] || "";
  const awayName = away?.name || fallbackNames[1] || "";
  if (!homeName || !awayName) return null;

  return {
    id: String(fixture.id),
    leagueId: league.id,
    homeTeamId: String(home?.id ?? homeName),
    awayTeamId: String(away?.id ?? awayName),
    homeTeamName: homeName,
    awayTeamName: awayName,
    commenceTime: normalizeTimestamp(fixture.starting_at),
    venue: "SportMonks",
    status: "scheduled",
  };
}

function outcomeForLabel(
  label: string,
  homeTeam: string,
  awayTeam: string,
): keyof OutcomePrices | null {
  const value = label.trim().toLowerCase();
  if (["draw", "tie", "x"].includes(value)) return "draw";
  if (["home", "1"].includes(value) || value === homeTeam.toLowerCase()) {
    return "home";
  }
  if (["away", "2"].includes(value) || value === awayTeam.toLowerCase()) {
    return "away";
  }
  return null;
}

interface OddGroup {
  name: string;
  outcomes: Partial<OutcomePrices>;
  updatedAt: string;
}

function buildBookmakerQuotes(
  odds: SportMonksOdd[],
  homeTeam: string,
  awayTeam: string,
): BookmakerQuote[] {
  const groups = new Map<number, OddGroup>();

  for (const odd of odds) {
    if (odd.market_id !== MATCH_WINNER_MARKET_ID || odd.stopped) continue;

    const outcome = outcomeForLabel(odd.label, homeTeam, awayTeam);
    const price = Number(odd.value);
    if (!outcome || !Number.isFinite(price) || price <= 1) continue;

    const group = groups.get(odd.bookmaker_id) ?? {
      name: odd.bookmaker?.name || `Casa ${odd.bookmaker_id}`,
      outcomes: {},
      updatedAt: odd.latest_bookmaker_update ?? "",
    };
    group.outcomes[outcome] = price;
    if (
      odd.latest_bookmaker_update &&
      odd.latest_bookmaker_update > group.updatedAt
    ) {
      group.updatedAt = odd.latest_bookmaker_update;
    }
    groups.set(odd.bookmaker_id, group);
  }

  const quotes: BookmakerQuote[] = [];
  for (const [bookmakerId, group] of groups.entries()) {
    const { home, draw, away } = group.outcomes;
    if (home === undefined || away === undefined) continue;

    quotes.push({
      id: `sportmonks-${bookmakerId}`,
      name: group.name,
      source: "sportmonks",
      outcomes: { home, draw: draw ?? null, away },
      updatedAt: group.updatedAt
        ? normalizeTimestamp(group.updatedAt)
        : new Date().toISOString(),
    });
  }

  return quotes;
}

async function fetchFixtureOdds(
  fixture: ApiSportsEvent,
): Promise<{ event: NormalizedOddsEvent | null; remaining: number | null; error?: string }> {
  const result = await request<SportMonksOdd[]>(
    `/odds/pre-match/fixtures/${fixture.id}`,
    { include: "bookmaker", filters: `markets:${MATCH_WINNER_MARKET_ID}` },
  );

  if (result.error) {
    return { event: null, remaining: result.remaining, error: result.error };
  }

  const bookmakers = buildBookmakerQuotes(
    result.data ?? [],
    fixture.homeTeamName,
    fixture.awayTeamName,
  );

  return {
    event: {
      id: fixture.id,
      leagueId: fixture.leagueId,
      homeTeam: fixture.homeTeamName,
      awayTeam: fixture.awayTeamName,
      commenceTime: fixture.commenceTime,
      bookmakers,
    },
    remaining: result.remaining,
  };
}

export async function fetchSportMonksForLeague(
  league: LeagueInfo,
): Promise<SportMonksLeagueResult> {
  const empty: SportMonksLeagueResult = {
    leagueId: league.id,
    fixtures: [],
    oddsEvents: [],
    creditsRemaining: null,
  };

  if (!process.env.SPORTMONKS_KEY) {
    return { ...empty, error: "SPORTMONKS_KEY no configurada" };
  }
  if (league.sport !== "soccer" || !league.sportmonksLeagueId) return empty;

  const fixturesResult = await request<SportMonksFixture[]>(
    `/fixtures/date/${formatLocalDate(new Date())}`,
    { include: "participants" },
  );
  if (fixturesResult.error) {
    return {
      ...empty,
      creditsRemaining: fixturesResult.remaining,
      error: fixturesResult.error,
    };
  }

  const fixtures = (fixturesResult.data ?? [])
    .filter((fixture) => fixture.league_id === league.sportmonksLeagueId)
    .map((fixture) => mapFixture(fixture, league))
    .filter((fixture): fixture is ApiSportsEvent => fixture !== null);

  if (fixtures.length === 0) {
    return { ...empty, creditsRemaining: fixturesResult.remaining };
  }

  const oddsResults = await Promise.all(fixtures.map(fetchFixtureOdds));
  const oddsEvents = oddsResults
    .map((result) => result.event)
    .filter((event): event is NormalizedOddsEvent => event !== null)
    .filter((event) => event.bookmakers.length > 0);

  const firstError = oddsResults.find((result) => result.error)?.error;

  return {
    leagueId: league.id,
    fixtures,
    oddsEvents,
    creditsRemaining: minNullable([
      fixturesResult.remaining,
      ...oddsResults.map((result) => result.remaining),
    ]),
    error: firstError,
  };
}
