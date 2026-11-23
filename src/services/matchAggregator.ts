import { LEAGUES } from "@/config/sports";
import { getMockDashboardData, getMockMatchesForLeague } from "@/data/mockData";
import {
  fetchEventOdds,
  fetchLeagueEvents,
  fetchLeagueInjuries,
  fetchLeagueStandings,
  fetchTeamStatistics,
  type ApiSportsEvent,
} from "@/services/apiSportsService";
import {
  fetchOddsForLeague,
  findOddsEventForTeams,
  type NormalizedOddsEvent,
} from "@/services/oddsApiService";
import { fetchSportMonksForLeague } from "@/services/sportMonksService";
import {
  favoriteSideFromSummary,
  summarizeMarket,
} from "@/lib/marketSummary";
import { clamp, namesLikelyMatch, normalizeName } from "@/lib/utils";
import {
  dateInVET,
  dateInVETOffset,
  matchDayVET,
  resolveMatchStatus,
} from "@/lib/format";
import { flashscoreRecordsToMatches } from "@/services/flashscoreAdapter";
import { listMatches as listFlashscoreRecords } from "@/services/flashscoreIngestStore";
import { applyTriunfobetQuotes } from "@/services/triunfobetAdapter";
import { listQuotes as listTriunfobetQuotes } from "@/services/triunfobetIngestStore";
import { applyApuestasRoyalQuotes } from "@/services/apuestasRoyalAdapter";
import { listQuotes as listApuestasRoyalQuotes } from "@/services/apuestasRoyalIngestStore";
import { listInsights as listTheAnalystInsights } from "@/services/theAnalystStore";
import { findTheAnalystMatch } from "@/services/theAnalystAdapter";
import type {
  AnalystInsight,
  BookmakerQuote,
  DashboardData,
  DashboardMeta,
  FormResult,
  Injury,
  LeagueInfo,
  MatchDay,
  MatchIntel,
  SportKey,
  SportsMatch,
  StandingRow,
  TeamAdvancedStats,
  TeamRef,
  VenueSplit,
} from "@/types/sports";

const CACHE_SECONDS = 3600;
const MAX_EVENTS_PER_LEAGUE = 8;
const MAX_STATS_TEAMS_PER_LEAGUE = 10;

interface LiveLeagueResult {
  league: LeagueInfo;
  matches: SportsMatch[];
  warnings: string[];
  fromMock: boolean;
  oddsCredits: number | null;
  sportmonksCredits: number | null;
  apiCredits: number | null;
}

const TEAM_PALETTE = [
  { color: "#2563eb", secondaryColor: "#bfdbfe" },
  { color: "#dc2626", secondaryColor: "#fecaca" },
  { color: "#059669", secondaryColor: "#a7f3d0" },
  { color: "#d97706", secondaryColor: "#fde68a" },
  { color: "#7c3aed", secondaryColor: "#ddd6fe" },
  { color: "#0e7490", secondaryColor: "#a5f3fc" },
  { color: "#be123c", secondaryColor: "#fecdd3" },
  { color: "#4d7c0f", secondaryColor: "#d9f99d" },
  { color: "#4338ca", secondaryColor: "#c7d2fe" },
  { color: "#b45309", secondaryColor: "#fde68a" },
];

function colorForTeam(name: string): { color: string; secondaryColor: string } {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}

function shortTeamName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return name;
  const ignored = new Set([
    "fc",
    "cf",
    "sc",
    "afc",
    "club",
    "de",
    "del",
    "the",
    "basketball",
    "baloncesto",
  ]);
  const filtered = words.filter(
    (word) => !ignored.has(word.toLowerCase()),
  );
  return filtered.slice(0, 2).join(" ") || name;
}

function buildTeamRef(
  name: string,
  id: string,
  logo: string | undefined,
): TeamRef {
  const palette = colorForTeam(name);
  return {
    id,
    name,
    shortName: shortTeamName(name),
    color: palette.color,
    secondaryColor: palette.secondaryColor,
    logo,
  };
}

function minNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return Math.min(...valid);
}

function fallbackStanding(name: string, id: string, index: number): StandingRow {
  return {
    teamId: id,
    teamName: name,
    teamShortName: shortTeamName(name),
    position: index + 1,
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

function buildVenueSplit(
  played: number,
  wins: number,
  draws: number,
  losses: number,
  scored: number,
  conceded: number,
): VenueSplit {
  return { played, wins, draws, losses, scored, conceded };
}

function deriveStats(
  standing: StandingRow | undefined,
  sport: SportKey,
): TeamAdvancedStats {
  const row = standing;
  if (!row || row.played === 0) {
    return {
      teamId: row?.teamId ?? "unknown",
      form: row?.form ?? [],
      avgScored: 0,
      avgConceded: 0,
      home: buildVenueSplit(0, 0, 0, 0, 0, 0),
      away: buildVenueSplit(0, 0, 0, 0, 0, 0),
      streak: "Sin datos",
    };
  }

  const homePlayed = Math.ceil(row.played / 2);
  const awayPlayed = row.played - homePlayed;
  const homeWins = Math.round(row.wins * 0.58);
  const awayWins = Math.max(0, row.wins - homeWins);
  const homeDraws = Math.round(row.draws * 0.55);
  const awayDraws = Math.max(0, row.draws - homeDraws);
  const form = row.form.length > 0 ? row.form : [];
  const points = form.reduce((total, result) => {
    if (result === "W") return total + 3;
    if (result === "D") return total + 1;
    return total;
  }, 0);
  const formRate = form.length > 0 ? points / (form.length * 3) : 0.5;

  return {
    teamId: row.teamId,
    form,
    avgScored: row.played > 0 ? row.scored / row.played : 0,
    avgConceded: row.played > 0 ? row.conceded / row.played : 0,
    home: buildVenueSplit(
      homePlayed,
      homeWins,
      homeDraws,
      Math.max(0, homePlayed - homeWins - homeDraws),
      row.scored * 0.53,
      row.conceded * 0.47,
    ),
    away: buildVenueSplit(
      awayPlayed,
      awayWins,
      awayDraws,
      Math.max(0, awayPlayed - awayWins - awayDraws),
      row.scored * 0.47,
      row.conceded * 0.53,
    ),
    streak:
      form.length > 0
        ? `${form[form.length - 1] === "W" ? "V" : form[form.length - 1] === "D" ? "E" : "D"} · forma ${Math.round(formRate * 100)}%`
        : "Sin datos",
  };
}

function filterInjuries(
  injuries: Injury[],
  teamId: string,
  teamName: string,
): Injury[] {
  return injuries.filter(
    (injury) =>
      injury.teamId === teamId ||
      namesLikelyMatch(injury.teamId, teamId) ||
      namesLikelyMatch(injury.teamId, teamName),
  );
}

function buildIntel(params: {
  event: ApiSportsEvent;
  standings: StandingRow[];
  statsByTeam: Map<string, TeamAdvancedStats>;
  injuries: Injury[];
  league: LeagueInfo;
}): MatchIntel {
  const { event, standings, statsByTeam, injuries, league } = params;
  const homeStanding =
    standings.find((row) => row.teamId === event.homeTeamId) ??
    standings.find((row) => namesLikelyMatch(row.teamName, event.homeTeamName)) ??
    fallbackStanding(event.homeTeamName, event.homeTeamId, 0);
  const awayStanding =
    standings.find((row) => row.teamId === event.awayTeamId) ??
    standings.find((row) => namesLikelyMatch(row.teamName, event.awayTeamName)) ??
    fallbackStanding(event.awayTeamName, event.awayTeamId, 1);
  const table =
    standings.length > 0 ? standings : [homeStanding, awayStanding];
  const homeInjuries = filterInjuries(
    injuries,
    event.homeTeamId,
    event.homeTeamName,
  );
  const awayInjuries = filterInjuries(
    injuries,
    event.awayTeamId,
    event.awayTeamName,
  );

  const notes: string[] = [];
  if (standings.length === 0) {
    notes.push("Clasificación no disponible en este momento.");
  }
  if (league.sport !== "soccer") {
    notes.push(
      "API-Sports no publica un endpoint de lesionados para este deporte; las bajas mostradas solo aparecen si la liga las reporta.",
    );
  } else if (homeInjuries.length === 0 && awayInjuries.length === 0) {
    notes.push("Sin bajas confirmadas en el feed de API-Sports.");
  }

  return {
    standings: {
      home: homeStanding,
      away: awayStanding,
      table,
    },
    stats: {
      home:
        statsByTeam.get(event.homeTeamId) ?? deriveStats(homeStanding, league.sport),
      away:
        statsByTeam.get(event.awayTeamId) ?? deriveStats(awayStanding, league.sport),
    },
    injuries: {
      home: homeInjuries,
      away: awayInjuries,
    },
    note: notes.join(" "),
  };
}

function dedupeBookmakers(bookmakers: BookmakerQuote[]): BookmakerQuote[] {
  const seen = new Set<string>();
  const result: BookmakerQuote[] = [];
  for (const bookmaker of bookmakers) {
    const key = `${bookmaker.source}:${bookmaker.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(bookmaker);
  }
  return result;
}

function findOddsEvent(
  events: NormalizedOddsEvent[],
  homeName: string,
  awayName: string,
): NormalizedOddsEvent | null {
  const exact = findOddsEventForTeams(events, homeName, awayName);
  if (exact) return exact;
  return (
    events.find(
      (event) =>
        namesLikelyMatch(event.homeTeam, homeName) &&
        namesLikelyMatch(event.awayTeam, awayName),
    ) ?? null
  );
}

function buildMatchStatus(
  event: ApiSportsEvent,
): "scheduled" | "live" | "finished" {
  return event.status;
}

async function buildLiveLeague(league: LeagueInfo): Promise<LiveLeagueResult> {
  const warnings: string[] = [];
  const [eventsResult, sportMonksResult] = await Promise.all([
    fetchLeagueEvents(league),
    fetchSportMonksForLeague(league),
  ]);

  if (eventsResult.error) {
    warnings.push(`${league.name}: ${eventsResult.error}`);
  }
  if (sportMonksResult.error) {
    warnings.push(`${league.name}: ${sportMonksResult.error}`);
  }

  const useSportMonks =
    eventsResult.events.length === 0 && sportMonksResult.fixtures.length > 0;
  if (useSportMonks) {
    warnings.push(
      `${league.name}: API-Sports no entregó eventos; se usan partidos y cuotas de SportMonks.`,
    );
  }

  const events = (
    useSportMonks ? sportMonksResult.fixtures : eventsResult.events
  ).slice(0, MAX_EVENTS_PER_LEAGUE);

  if (events.length === 0) {
    if (eventsResult.error || sportMonksResult.error) {
      return {
        league,
        matches: getMockMatchesForLeague(league.id),
        warnings,
        fromMock: true,
        oddsCredits: null,
        sportmonksCredits: sportMonksResult.creditsRemaining,
        apiCredits: eventsResult.remaining,
      };
    }
    return {
      league,
      matches: [],
      warnings,
      fromMock: false,
      oddsCredits: null,
      sportmonksCredits: sportMonksResult.creditsRemaining,
      apiCredits: eventsResult.remaining,
    };
  }

  const [standingsResult, injuriesResult, oddsLeagueResult] = await Promise.all([
    useSportMonks
      ? Promise.resolve({ standings: [], remaining: null, error: undefined })
      : fetchLeagueStandings(league),
    useSportMonks
      ? Promise.resolve({
          injuries: [],
          remaining: null,
          supported: true,
          error: undefined,
        })
      : fetchLeagueInjuries(league),
    fetchOddsForLeague(league),
  ]);

  if (standingsResult.error) {
    warnings.push(`${league.name}: ${standingsResult.error}`);
  }
  if (injuriesResult.error && league.sport === "soccer") {
    warnings.push(`${league.name}: ${injuriesResult.error}`);
  }
  if (oddsLeagueResult.error) {
    warnings.push(`${league.name}: ${oddsLeagueResult.error}`);
  }

  const uniqueTeamIds = Array.from(
    new Set(events.flatMap((event) => [event.homeTeamId, event.awayTeamId])),
  ).slice(0, MAX_STATS_TEAMS_PER_LEAGUE);

  const statsResults = useSportMonks
    ? []
    : await Promise.all(
        uniqueTeamIds.map((teamId) => fetchTeamStatistics(league, teamId)),
      );
  const oddsEventResults = useSportMonks
    ? []
    : await Promise.all(events.map((event) => fetchEventOdds(league, event)));

  const statsByTeam = new Map<string, TeamAdvancedStats>();
  for (let index = 0; index < uniqueTeamIds.length; index += 1) {
    const stats = statsResults[index]?.stats;
    if (stats) statsByTeam.set(uniqueTeamIds[index], stats);
  }

  const matches: SportsMatch[] = [];
  let missingOddsEvents = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const home = buildTeamRef(
      event.homeTeamName,
      event.homeTeamId,
      event.homeLogo,
    );
    const away = buildTeamRef(
      event.awayTeamName,
      event.awayTeamId,
      event.awayLogo,
    );
    const oddsEvent = findOddsEvent(
      oddsLeagueResult.events,
      event.homeTeamName,
      event.awayTeamName,
    );
    const sportMonksOddsEvent = useSportMonks
      ? findOddsEvent(
          sportMonksResult.oddsEvents,
          event.homeTeamName,
          event.awayTeamName,
        )
      : null;
    const apiSportsOdds = oddsEventResults[index]?.bookmakers ?? [];
    const bookmakers = dedupeBookmakers([
      ...(oddsEvent?.bookmakers ?? []),
      ...(sportMonksOddsEvent?.bookmakers ?? []),
      ...apiSportsOdds,
    ]);
    if (bookmakers.length === 0) missingOddsEvents += 1;

    const intel = buildIntel({
      event,
      standings: standingsResult.standings,
      statsByTeam,
      injuries: injuriesResult.injuries,
      league,
    });
    if (useSportMonks) {
      intel.note = `${intel.note ? `${intel.note} ` : ""}Partidos y cuotas de SportMonks; clasificación y bajas de API-Sports no disponibles para esta temporada.`;
    }

    const odds = summarizeMarket(bookmakers);
    matches.push({
      id: `live-${league.id}-${event.id}`,
      sport: league.sport,
      league,
      commenceTime: event.commenceTime,
      status: buildMatchStatus(event),
      venue: event.venue,
      home,
      away,
      odds,
      intel,
      favoriteSide: favoriteSideFromSummary(odds),
    });
  }

  if (missingOddsEvents > 0) {
    warnings.push(
      `${league.name}: ${missingOddsEvents} evento(s) sin cuotas cruzadas disponibles.`,
    );
  }

  const credits = [
    eventsResult.remaining,
    ...statsResults.map((result) => result.remaining),
    ...oddsEventResults.map((result) => result.remaining),
  ];

  return {
    league,
    matches,
    warnings,
    fromMock: false,
    oddsCredits: oddsLeagueResult.creditsRemaining,
    sportmonksCredits: sportMonksResult.creditsRemaining,
    apiCredits: minNullable(credits),
  };
}

function countSports(matches: SportsMatch[]): Record<SportKey, number> {
  const counts: Record<SportKey, number> = {
    soccer: 0,
    basketball: 0,
    baseball: 0,
    hockey: 0,
  };
  for (const match of matches) {
    counts[match.sport] += 1;
  }
  return counts;
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings)).slice(0, 12);
}

/** Cuenta partidos pre-match (aún no iniciados) por ventana hoy/mañana. */
function countMatchDays(
  matches: SportsMatch[],
  now: Date = new Date(),
): Record<MatchDay, number> {
  const counts: Record<MatchDay, number> = { today: 0, tomorrow: 0 };
  for (const match of matches) {
    if (resolveMatchStatus(match, now) !== "scheduled") continue;
    const day = matchDayVET(match.commenceTime, now);
    if (day) counts[day] += 1;
  }
  return counts;
}

function finalizeDashboard(
  data: Omit<DashboardData, "dayCounts"> & { dayCounts?: Record<MatchDay, number> },
  now: Date = new Date(),
): DashboardData {
  return { ...data, dayCounts: countMatchDays(data.matches, now) };
}

function mockWithConfigurationWarnings(): DashboardData {
  const mock = getMockDashboardData();
  const missing: string[] = [];
  if (!process.env.THE_ODDS_API_KEY) missing.push("THE_ODDS_API_KEY");
  if (!process.env.SPORTMONKS_KEY) missing.push("SPORTMONKS_KEY");
  if (!process.env.APISPORTS_KEY) missing.push("APISPORTS_KEY");

  return {
    ...mock,
    meta: {
      ...mock.meta,
      generatedAt: new Date().toISOString(),
      warnings: [
        missing.length > 0
          ? `Modo demo: falta configurar ${missing.join(" y ")} en .env.local.`
          : "Modo demo activo.",
        ...mock.meta.warnings,
      ],
      sources: {
        oddsApi: Boolean(process.env.THE_ODDS_API_KEY),
        sportmonks: Boolean(process.env.SPORTMONKS_KEY),
        apiSports: Boolean(process.env.APISPORTS_KEY),
      },
    },
  };
}

async function getAggregatedDataUnfinalized(): Promise<
  Omit<DashboardData, "dayCounts">
> {
  const hasOddsKey = Boolean(process.env.THE_ODDS_API_KEY);
  const hasSportMonksKey = Boolean(process.env.SPORTMONKS_KEY);
  const hasApiSportsKey = Boolean(process.env.APISPORTS_KEY);

  if (!hasOddsKey || !hasSportMonksKey || !hasApiSportsKey) {
    return mockWithConfigurationWarnings();
  }

  try {
    const results = await Promise.all(LEAGUES.map((league) => buildLiveLeague(league)));
    const matches = results.flatMap((result) => result.matches);
    const warnings = uniqueWarnings(
      results.flatMap((result) => result.warnings),
    );

    if (results.every((result) => result.fromMock)) {
      const mock = getMockDashboardData();
      return {
        ...mock,
        meta: {
          ...mock.meta,
          mode: "mock",
          generatedAt: new Date().toISOString(),
          warnings: uniqueWarnings([
            "Las APIs respondieron pero no entregaron eventos reales; se muestra el dataset de demostración.",
            ...warnings,
            ...mock.meta.warnings,
          ]),
          sources: { oddsApi: true, sportmonks: true, apiSports: true },
        },
      };
    }

    if (matches.length === 0) {
      return {
        ...getMockDashboardData(),
        meta: {
          ...getMockDashboardData().meta,
          generatedAt: new Date().toISOString(),
          warnings: uniqueWarnings([
            "Las APIs no devolvieron eventos para hoy; se muestra el dataset de demostración.",
            ...warnings,
          ]),
          sources: { oddsApi: true, sportmonks: true, apiSports: true },
        },
      };
    }

    const fromMock = results.some((result) => result.fromMock);
    const mode: DashboardMeta["mode"] = fromMock ? "hybrid" : "live";
    const activeLeagues = Array.from(
      new Map(matches.map((match) => [match.league.id, match.league])).values(),
    );
    const oddsCredits = minNullable(
      results.map((result) => result.oddsCredits),
    );
    const sportmonksCredits = minNullable(
      results.map((result) => result.sportmonksCredits),
    );
    const apiCredits = minNullable(results.map((result) => result.apiCredits));

    return {
      matches,
      leagues: activeLeagues,
      sportCounts: countSports(matches),
      meta: {
        mode,
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: CACHE_SECONDS,
        oddsCreditsRemaining: oddsCredits,
        sportmonksRemaining: sportmonksCredits,
        apiSportsRemaining: apiCredits,
        warnings,
        sources: {
          oddsApi: true,
          sportmonks: true,
          apiSports: true,
        },
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido de las APIs";
    const mock = getMockDashboardData();
    return {
      ...mock,
      meta: {
        ...mock.meta,
        generatedAt: new Date().toISOString(),
        warnings: uniqueWarnings([
          `Se activó el modo demo por un fallo de las APIs: ${message}`,
          ...mock.meta.warnings,
        ]),
        sources: { oddsApi: true, sportmonks: true, apiSports: true },
      },
    };
  }
}

async function getAggregatedData(now: Date = new Date()): Promise<DashboardData> {
  return finalizeDashboard(await getAggregatedDataUnfinalized(), now);
}

export function getActiveLeagueIds(matches: SportsMatch[]): Set<string> {
  return new Set(matches.map((match) => match.league.id));
}

export function clampLine(value: number, minimum: number, maximum: number): number {
  return clamp(value, minimum, maximum);
}

export function formPoints(form: FormResult[]): number {
  return form.reduce((total, result) => {
    if (result === "W") return total + 3;
    if (result === "D") return total + 1;
    return total;
  }, 0);
}

interface CapturedQuotesResult {
  matches: SportsMatch[];
  warnings: string[];
  triunfobetConnected: boolean;
  royalConnected: boolean;
}

/**
 * Cruza las cotizaciones capturadas de ambas casas con la ventana hoy/mañana.
 * Se conservan solo precios vigentes; las filas sin cuota válida no se aplican.
 */
function withCapturedBookmakerQuotes(
  matches: SportsMatch[],
  now: Date = new Date(),
): CapturedQuotesResult {
  const days = new Set([dateInVETOffset(0, now), dateInVETOffset(1, now)]);
  // Una captura es vigente si el partido que describe cae en hoy/mañana VET.
  // `fecha_local` manda; `fecha_extraccion` solo se usa como respaldo cuando
  // la casa no informó la fecha del encuentro.
  const isCurrent = (quote: {
    fecha_extraccion: string;
    fecha_local?: string | null;
  }) =>
    (quote.fecha_local != null && days.has(quote.fecha_local)) ||
    (quote.fecha_local == null && days.has(quote.fecha_extraccion));

  const triunfobetQuotes = listTriunfobetQuotes().filter(isCurrent);
  const royalQuotes = listApuestasRoyalQuotes().filter(isCurrent);

  const triunfobet = applyTriunfobetQuotes(matches, triunfobetQuotes);
  const royal = applyApuestasRoyalQuotes(triunfobet.matches, royalQuotes);
  const warnings: string[] = [];
  if (triunfobet.applied > 0) {
    warnings.push(
      `${triunfobet.applied} cotización(es) de Triunfobet cruzadas con partidos de hoy/mañana (VET).`,
    );
  }
  if (royal.applied > 0) {
    warnings.push(
      `${royal.applied} cotización(es) de Apuestas Royal cruzadas con partidos de hoy/mañana (VET).`,
    );
  }

  return {
    matches: royal.matches,
    warnings,
    triunfobetConnected: triunfobet.applied > 0,
    royalConnected: royal.applied > 0,
  };
}

interface TheAnalystResult {
  matches: SportsMatch[];
  applied: number;
  connected: boolean;
}

/**
 * Cruza los partidos del dashboard con los insights capturados de The Analyst
 * (xG, probabilidades 1X2 y rachas). El resultado se guarda en `match.analyst`
 * para que el motor de valor compare la probabilidad estadística contra la
 * implícita de las cuotas de las casas.
 */
function withTheAnalystInsights(matches: SportsMatch[]): TheAnalystResult {
  const records = listTheAnalystInsights();
  if (records.length === 0 || matches.length === 0) {
    return { matches, applied: 0, connected: false };
  }

  let applied = 0;
  const enriched = matches.map((match) => {
    const found = findTheAnalystMatch(
      {
        id: match.id,
        match_slug: match.id.startsWith("flashscore-")
          ? match.id.slice("flashscore-".length)
          : null,
        fecha_local: dateInVET(match.commenceTime),
        liga: match.league.name,
        equipo_local: match.home.name,
        equipo_visitante: match.away.name,
      },
      records,
    );
    if (!found) return match;

    const { probabilidades, metricas, resumen, confianza } = found.insight;
    const winProbabilities =
      probabilidades.home != null &&
      probabilidades.draw != null &&
      probabilidades.away != null
        ? {
            home: probabilidades.home,
            draw: probabilidades.draw,
            away: probabilidades.away,
          }
        : null;
    const analyst: AnalystInsight = {
      source: "the-analyst",
      xgHome: metricas.xg_local,
      xgAway: metricas.xg_visitante,
      winProbabilities,
      streakHome: metricas.racha_local ?? metricas.forma_local,
      streakAway: metricas.racha_visitante ?? metricas.forma_visitante,
      headline: resumen ?? found.record.titulo,
      url: found.record.url || null,
      updatedAt: found.record.actualizado_en,
    };

    applied += 1;
    return {
      ...match,
      analyst,
      intel: {
        ...match.intel,
        note: [
          match.intel.note,
          winProbabilities
            ? `The Analyst (confianza ${confianza}): ${(winProbabilities.home * 100).toFixed(1)}% / ${(winProbabilities.draw * 100).toFixed(1)}% / ${(winProbabilities.away * 100).toFixed(1)}%`
            : `The Analyst: ${resumen ?? found.record.titulo}`,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    };
  });

  return { matches: enriched, applied, connected: applied > 0 };
}

/**
 * Punto de entrada del dashboard. Prioriza los partidos inyectados por el agente
 * de Flashscore, los convierte al modelo interno y limita el radar pre-match a
 * los encuentros pendientes de hoy y mañana en hora de Venezuela.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const ahora = new Date();
  const [base, flashscoreMatches] = await Promise.all([
    getAggregatedData(ahora),
    Promise.resolve(flashscoreRecordsToMatches(listFlashscoreRecords(), ahora)),
  ]);
  // Solo entran partidos de hoy o mañana que todavía no hayan comenzado. Los
  // que ya arrancaron o finalizaron se retiran automáticamente del feed.
  const esVigente = (match: SportsMatch) =>
    matchDayVET(match.commenceTime, ahora) !== null &&
    resolveMatchStatus(match, ahora) === "scheduled";

  const baseUpcoming = base.matches.filter(esVigente);
  const upcomingFlashscore = flashscoreMatches.filter(esVigente);
  const excluded =
    base.matches.length -
    baseUpcoming.length +
    (flashscoreMatches.length - upcomingFlashscore.length);

  if (upcomingFlashscore.length === 0) {
    const captured = withCapturedBookmakerQuotes(baseUpcoming, ahora);
    const analyst = withTheAnalystInsights(captured.matches);
    return finalizeDashboard({
      ...base,
      matches: analyst.matches,
      leagues: base.leagues.filter((league) =>
        analyst.matches.some((match) => match.league.id === league.id),
      ),
      sportCounts: countSports(analyst.matches),
      meta: {
        ...base.meta,
        warnings: uniqueWarnings([
          `${excluded} partidos ya comenzaron o están fuera de la ventana hoy/mañana y fueron excluidos.`,
          ...captured.warnings,
          ...(analyst.applied > 0
            ? [`${analyst.applied} análisis de The Analyst cruzados con partidos.`]
            : []),
          ...base.meta.warnings,
        ]),
        sources: {
          ...base.meta.sources,
          theAnalyst: analyst.connected,
          triunfobet: captured.triunfobetConnected,
          apuestasRoyal: captured.royalConnected,
        },
      },
    }, ahora);
  }

  const keyOf = (match: SportsMatch) =>
    `${normalizeName(match.home.name)}|${normalizeName(match.away.name)}`;
  const seen = new Set<string>();
  const matches: SportsMatch[] = [];
  for (const match of [...upcomingFlashscore, ...baseUpcoming]) {
    const key = keyOf(match);
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(match);
  }

  const captured = withCapturedBookmakerQuotes(matches, ahora);
  const analyst = withTheAnalystInsights(captured.matches);
  const finalMatches = analyst.matches;
  const leagues = Array.from(
    new Map(finalMatches.map((match) => [match.league.id, match.league])).values(),
  );

  return finalizeDashboard({
    matches: finalMatches,
    leagues,
    sportCounts: countSports(finalMatches),
    meta: {
      ...base.meta,
      mode: "live",
      generatedAt: new Date().toISOString(),
      warnings: uniqueWarnings([
        `${upcomingFlashscore.length} partidos de Flashscore pendientes hoy/mañana (VET).`,
        ...captured.warnings,
        ...(analyst.applied > 0
          ? [`${analyst.applied} análisis de The Analyst cruzados con partidos.`]
          : []),
        ...base.meta.warnings,
      ]),
      sources: {
        ...base.meta.sources,
        flashscore: true,
        theAnalyst: analyst.connected,
        triunfobet: captured.triunfobetConnected,
        apuestasRoyal: captured.royalConnected,
      },
    },
  }, ahora);
}
