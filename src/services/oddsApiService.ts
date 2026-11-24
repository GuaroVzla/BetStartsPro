import type {
  BookmakerQuote,
  LeagueInfo,
  OutcomePrices,
} from "@/types/sports";
import { canonicalBookmakerName } from "@/lib/utils";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const CACHE_SECONDS = 3600;

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface NormalizedOddsEvent {
  id: string;
  leagueId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: BookmakerQuote[];
}

export interface OddsApiLeagueResult {
  leagueId: string;
  events: NormalizedOddsEvent[];
  creditsRemaining: number | null;
  error?: string;
}

function parseCreditHeader(response: Response): number | null {
  const raw = response.headers.get("x-requests-remaining");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeOutcomes(
  outcomes: OddsApiOutcome[],
  homeTeam: string,
  awayTeam: string,
): OutcomePrices | null {
  let home: number | null = null;
  let away: number | null = null;
  let draw: number | null = null;

  const normalizedHome = homeTeam.toLowerCase();
  const normalizedAway = awayTeam.toLowerCase();

  for (const outcome of outcomes) {
    const name = outcome.name.toLowerCase();
    if (name === normalizedHome) home = outcome.price;
    else if (name === normalizedAway) away = outcome.price;
    else if (name === "draw" || name === "tie") draw = outcome.price;
  }

  if (home === null || away === null) return null;

  return {
    home,
    draw,
    away,
  };
}

function normalizeEvent(
  event: OddsApiEvent,
  leagueId: string,
): NormalizedOddsEvent {
  const bookmakers: BookmakerQuote[] = [];

  for (const bookmaker of event.bookmakers ?? []) {
    const h2hMarket = bookmaker.markets?.find((market) => market.key === "h2h");
    if (!h2hMarket) continue;

    const outcomes = normalizeOutcomes(
      h2hMarket.outcomes ?? [],
      event.home_team,
      event.away_team,
    );
    if (!outcomes) continue;

    const rawHome = outcomes.home > 1 ? 1 / outcomes.home : 0;
    const rawDraw = outcomes.draw && outcomes.draw > 1 ? 1 / outcomes.draw : 0;
    const rawAway = outcomes.away > 1 ? 1 / outcomes.away : 0;
    bookmakers.push({
      id: `odds-api-${bookmaker.key}`,
      name: bookmaker.title,
      canonicalName: canonicalBookmakerName(bookmaker.title, "the-odds-api"),
      source: "the-odds-api",
      outcomes,
      updatedAt: bookmaker.last_update,
      asOf: bookmaker.last_update,
      overround: Math.max(0, rawHome + rawDraw + rawAway - 1),
    });
  }

  return {
    id: event.id,
    leagueId,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    commenceTime: event.commence_time,
    bookmakers,
  };
}

export async function fetchOddsForLeague(
  league: LeagueInfo,
): Promise<OddsApiLeagueResult> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    return {
      leagueId: league.id,
      events: [],
      creditsRemaining: null,
      error: "THE_ODDS_API_KEY no configurada",
    };
  }

  const params = new URLSearchParams({
    apiKey,
    regions: "us,eu",
    markets: "h2h",
    oddsFormat: "decimal",
    dateFormat: "iso",
  });
  const url = `${ODDS_API_BASE}/sports/${encodeURIComponent(league.oddsApiKey)}/odds/?${params.toString()}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: CACHE_SECONDS },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const creditsRemaining = parseCreditHeader(response);

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as {
          message?: string;
          error_code?: string;
        };
        if (payload.message) detail = payload.message;
      } catch {
        detail = `HTTP ${response.status}`;
      }
      return {
        leagueId: league.id,
        events: [],
        creditsRemaining,
        error: `${league.name}: ${detail}`,
      };
    }

    const payload = (await response.json()) as OddsApiEvent[];
    if (!Array.isArray(payload)) {
      return {
        leagueId: league.id,
        events: [],
        creditsRemaining,
        error: `${league.name}: respuesta inesperada de The Odds API`,
      };
    }

    return {
      leagueId: league.id,
      events: payload
        .map((event) => normalizeEvent(event, league.id))
        .filter((event) => event.bookmakers.length > 0),
      creditsRemaining,
    };
  } catch (error) {
    return {
      leagueId: league.id,
      events: [],
      creditsRemaining: null,
      error: `${
        league.name
      }: ${error instanceof Error ? error.message : "Error de red"}`,
    };
  }
}

export function findOddsEventForTeams(
  events: NormalizedOddsEvent[],
  homeTeam: string,
  awayTeam: string,
): NormalizedOddsEvent | null {
  const normalizedHome = homeTeam.toLowerCase();
  const normalizedAway = awayTeam.toLowerCase();

  const exact = events.find(
    (event) =>
      event.homeTeam.toLowerCase() === normalizedHome &&
      event.awayTeam.toLowerCase() === normalizedAway,
  );
  if (exact) return exact;

  const partial = events.find(
    (event) =>
      (event.homeTeam.toLowerCase().includes(normalizedHome) ||
        normalizedHome.includes(event.homeTeam.toLowerCase())) &&
      (event.awayTeam.toLowerCase().includes(normalizedAway) ||
        normalizedAway.includes(event.awayTeam.toLowerCase())),
  );
  return partial ?? null;
}
