import { LEAGUES } from "@/config/sports";
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
  canonicalFavoriteFromSummary,
  summarizeMarket,
} from "@/lib/marketSummary";
import {
  canonicalBookmakerName,
  clamp,
  namesLikelyMatch,
  normalizeName,
} from "@/lib/utils";
import {
  dateInVET,
  dateInVETOffset,
  isWithinMatchWindow,
  matchDayVET,
  resolveMatchStatus,
} from "@/lib/format";
import { flashscoreRecordsToMatches } from "@/services/flashscoreAdapter";
import { listMatches as listFlashscoreRecords } from "@/services/flashscoreIngestStore";
import { applyApuestasRoyalQuotes } from "@/services/apuestasRoyalAdapter";
import { listQuotes as listApuestasRoyalQuotes } from "@/services/apuestasRoyalIngestStore";
import { listInsights as listTheAnalystInsights } from "@/services/theAnalystStore";
import { findTheAnalystMatch } from "@/services/theAnalystAdapter";
import { curatedRecordsToMatches } from "@/services/curatedAdapter";
import { listCuratedMatches } from "@/services/curatedIngestStore";
import { fetchAllSportsApiMatches } from "@/services/allSportsApiService";
import { fetchFreeSourceMatches } from "@/services/freeSourcesService";
import { enrichWithEspnStandings } from "@/services/espnStandingsService";
import { enrichWithFallbackStandings } from "@/services/fallbackStandingsService";
import { enrichWithTheSportsDbStats } from "@/services/theSportsDbStatsService";
import { fetchTheRundownMatches } from "@/services/theRundownService";
import { buildRankedFavorites } from "@/services/favoriteRankingService";
import {
  failedSourceResult,
  healthSnapshot,
  runResilientSource,
  type SourceResult,
} from "@/services/sourceResilience";
import type {
  AnalystInsight,
  DataSourceId,
  BookmakerQuote,
  DashboardData,
  FormResult,
  Injury,
  LeagueInfo,
  MatchDay,
  MatchIntel,
  SourceHealthSnapshot,
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

/** Marca cada partido con las fuentes reales que aportaron datos. */
function tagMatches(
  matches: SportsMatch[],
  ...sources: DataSourceId[]
): SportsMatch[] {
  if (sources.length === 0) return matches;
  return matches.map((match) => ({
    ...match,
    sourceTags: Array.from(new Set([...(match.sourceTags ?? []), ...sources])),
  }));
}

/** Convierte el resultado de un adapter en el snapshot de salud del dashboard. */
function snapshotFromResult(result: SourceResult<unknown>): SourceHealthSnapshot {
  return {
    source: result.source,
    status: result.status,
    ok: result.ok,
    latencyMs: result.latencyMs,
    dataPoints: result.dataPoints,
    partial: result.partial,
    failures: result.failures,
    reason: result.reason,
  };
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
    // Sin partidos jugados no hay posición real. Asignar index+1 hacía que el
    // motor treated el orden de iteración como clasificación (sesgo local).
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
      provenance: "none",
    };
  }

  // Splits casa/visita reales no disponibles en la tabla básica; se dejan en 0.
  const form = row.form.length > 0 ? row.form : [];
  const points = form.reduce((total, result) => {
    if (result === "W") return total + 3;
    if (result === "D") return total + 1;
    return total;
  }, 0);
  const formRate = form.length > 0 ? points / (form.length * 3) : 0.5;

  // Los splits casa/visita no vienen en la tabla básica. Antes se inventaban
  // 53/47% y 58/55%, y eso pasaba hasGoalStatistics como "modelo real". Ahora
  // declaramos la procedencia y dejamos ceros para que el motor no simule Poisson.
  return {
    teamId: row.teamId,
    form,
    avgScored: row.played > 0 ? row.scored / row.played : 0,
    avgConceded: row.played > 0 ? row.conceded / row.played : 0,
    home: buildVenueSplit(0, 0, 0, 0, 0, 0),
    away: buildVenueSplit(0, 0, 0, 0, 0, 0),
    streak:
      form.length > 0
        ? `${form[form.length - 1] === "W" ? "V" : form[form.length - 1] === "D" ? "E" : "D"} · forma ${Math.round(formRate * 100)}%`
        : "Sin datos",
    provenance: "table-derived",
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

const MAX_QUOTE_AGE_MS = 24 * 60 * 60 * 1000;

function dedupeBookmakers(bookmakers: BookmakerQuote[], now = Date.now()): BookmakerQuote[] {
  const fresh = bookmakers.filter((bookmaker) => {
    const ts = Date.parse(bookmaker.asOf ?? bookmaker.updatedAt);
    return !Number.isFinite(ts) || now - ts <= MAX_QUOTE_AGE_MS;
  });
  const candidates = fresh.length > 0 ? fresh : bookmakers;
  const byHouse = new Map<string, BookmakerQuote>();
  for (const bookmaker of candidates) {
    const canonical = canonicalBookmakerName(
      bookmaker.canonicalName ?? bookmaker.name,
      bookmaker.source,
    );
    const enriched = {
      ...bookmaker,
      canonicalName: canonical || bookmaker.name,
      asOf: bookmaker.asOf ?? bookmaker.updatedAt,
    };
    const key = canonical || `${bookmaker.source}:${bookmaker.name.toLowerCase()}`;
    const existing = byHouse.get(key);
    if (!existing) {
      byHouse.set(key, enriched);
      continue;
    }
    // Misma casa desde otro proveedor: conservar la más reciente, pero sumar
    // procedencia en el nombre si ayuda a depurar.
    const existingTs = Date.parse(existing.asOf ?? existing.updatedAt);
    const currentTs = Date.parse(enriched.asOf ?? enriched.updatedAt);
    if (Number.isFinite(currentTs) && currentTs > (Number.isFinite(existingTs) ? existingTs : 0)) {
      byHouse.set(key, enriched);
    }
  }
  return Array.from(byHouse.values());
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
    // Una liga sin eventos reales no se rellena con fixtures simulados: eso
    // generaba partidos inexistentes (p. ej. PSG vs Manchester City) en modo live.
    return {
      league,
      matches: [],
      warnings,
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
    const canonicalFavorite = canonicalFavoriteFromSummary(odds);
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
      favoriteSide: canonicalFavorite,
      canonicalFavorite,
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

function missingKeysDashboard(now: Date = new Date()): DashboardData {
  const missing: string[] = [];
  if (!process.env.THE_ODDS_API_KEY) missing.push("THE_ODDS_API_KEY");
  if (!process.env.SPORTMONKS_KEY) missing.push("SPORTMONKS_KEY");
  if (!process.env.APISPORTS_KEY) missing.push("APISPORTS_KEY");

  return {
    matches: [],
    leagues: LEAGUES,
    sportCounts: { soccer: 0, basketball: 0, baseball: 0, hockey: 0 },
    dayCounts: { today: 0, tomorrow: 0 },
    meta: {
      mode: "live",
      generatedAt: now.toISOString(),
      cacheTtlSeconds: CACHE_SECONDS,
      oddsCreditsRemaining: null,
      sportmonksRemaining: null,
      apiSportsRemaining: null,
      warnings: [
        missing.length > 0
          ? `Claves API premium no configuradas: ${missing.join(", ")}. Se usarán fuentes gratuitas e ingestas disponibles.`
          : "No hay datos reales disponibles.",
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

  const missing: string[] = [];
  if (!hasOddsKey) missing.push("THE_ODDS_API_KEY");
  if (!hasSportMonksKey) missing.push("SPORTMONKS_KEY");
  if (!hasApiSportsKey) missing.push("APISPORTS_KEY");

  if (!hasOddsKey && !hasSportMonksKey && !hasApiSportsKey) {
    const base = missingKeysDashboard();
    return {
      matches: base.matches,
      leagues: base.leagues,
      sportCounts: base.sportCounts,
      meta: base.meta,
    };
  }

  try {
    const results = await Promise.all(LEAGUES.map((league) => buildLiveLeague(league)));
    if (missing.length > 0) {
      for (const result of results) {
        result.warnings.push(
          `Fuentes API no configuradas: ${missing.join(", ")}. Se usan las fuentes disponibles.`,
        );
      }
    }
    const matches = results.flatMap((result) => result.matches);
    const warnings = uniqueWarnings(
      results.flatMap((result) => result.warnings),
    );
    const oddsCredits = minNullable(
      results.map((result) => result.oddsCredits),
    );
    const sportmonksCredits = minNullable(
      results.map((result) => result.sportmonksCredits),
    );
    const apiCredits = minNullable(results.map((result) => result.apiCredits));
    const sources = {
      oddsApi: hasOddsKey,
      sportmonks: hasSportMonksKey,
      apiSports: hasApiSportsKey,
    };

    if (matches.length === 0) {
      // Sin eventos reales no se usa dataset simulado; se devuelven advertencias reales.
      return {
        matches: [],
        leagues: [],
        sportCounts: countSports([]),
        meta: {
          mode: "live",
          generatedAt: new Date().toISOString(),
          cacheTtlSeconds: CACHE_SECONDS,
          oddsCreditsRemaining: oddsCredits,
          sportmonksRemaining: sportmonksCredits,
          apiSportsRemaining: apiCredits,
          warnings: uniqueWarnings([
            "Las APIs no devolvieron partidos reales; no se muestran datos simulados.",
            ...warnings,
          ]),
          sources,
        },
      };
    }

    const activeLeagues = Array.from(
      new Map(matches.map((match) => [match.league.id, match.league])).values(),
    );

    return {
      matches,
      leagues: activeLeagues,
      sportCounts: countSports(matches),
      meta: {
        mode: "live",
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: CACHE_SECONDS,
        oddsCreditsRemaining: oddsCredits,
        sportmonksRemaining: sportmonksCredits,
        apiSportsRemaining: apiCredits,
        warnings,
        sources,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido de las APIs";
    return {
      matches: [],
      leagues: [],
      sportCounts: countSports([]),
      meta: {
        mode: "live",
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: CACHE_SECONDS,
        oddsCreditsRemaining: null,
        sportmonksRemaining: null,
        apiSportsRemaining: null,
        warnings: uniqueWarnings([
          `Fallo de las APIs premium: ${message}. No se muestran datos simulados.`,
        ]),
        sources: {
          oddsApi: Boolean(process.env.THE_ODDS_API_KEY),
          sportmonks: Boolean(process.env.SPORTMONKS_KEY),
          apiSports: Boolean(process.env.APISPORTS_KEY),
        },
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
  royalConnected: boolean;
}

/**
 * Cruza las cotizaciones capturadas de Apuestas Royal con la ventana hoy/mañana.
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

  const royalQuotes = listApuestasRoyalQuotes().filter(isCurrent);
  const royal = applyApuestasRoyalQuotes(matches, royalQuotes);
  const warnings: string[] = [];
  if (royal.applied > 0) {
    warnings.push(
      `${royal.applied} cotización(es) de Apuestas Royal cruzadas con partidos de hoy/mañana (VET).`,
    );
  }

  // Etiquetar solo los partidos que realmente recibieron una cuota de la casa.
  const tagged = royal.matches.map((match) => {
    const hasRoyal = match.odds.bookmakers.some(
      (bookmaker) => bookmaker.source === "apuestas-royal",
    );
    if (!hasRoyal) return match;
    return {
      ...match,
      sourceTags: Array.from(
        new Set([...(match.sourceTags ?? []), "apuestas-royal" as const]),
      ),
    };
  });

  return {
    matches: tagged,
    warnings,
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
    const swapped = found.swapped;
    const homeProb = swapped ? probabilidades.away : probabilidades.home;
    const drawProb = probabilidades.draw;
    const awayProb = swapped ? probabilidades.home : probabilidades.away;
    const winProbabilities =
      homeProb != null && drawProb != null && awayProb != null
        ? { home: homeProb, draw: drawProb, away: awayProb }
        : null;
    const confidence =
      confianza === "alta" ? 1 : confianza === "media" ? 0.6 : 0.15;
    const analyst: AnalystInsight = {
      source: "the-analyst",
      xgHome: swapped ? metricas.xg_visitante : metricas.xg_local,
      xgAway: swapped ? metricas.xg_local : metricas.xg_visitante,
      winProbabilities,
      streakHome: swapped
        ? metricas.racha_visitante ?? metricas.forma_visitante
        : metricas.racha_local ?? metricas.forma_local,
      streakAway: swapped
        ? metricas.racha_local ?? metricas.forma_local
        : metricas.racha_visitante ?? metricas.forma_visitante,
      headline: resumen ?? found.record.titulo,
      url: found.record.url || null,
      updatedAt: found.record.actualizado_en,
      confidence,
      provenance: "editorial",
    };

    applied += 1;
    return {
      ...match,
      analyst,
      sourceTags: Array.from(
        new Set([...(match.sourceTags ?? []), "the-analyst" as const]),
      ),
      intel: {
        ...match.intel,
        note: [
          match.intel.note,
          winProbabilities
            ? `The Analyst (confianza ${confianza}${swapped ? ", invertido" : ""}): ${(winProbabilities.home * 100).toFixed(1)}% / ${(winProbabilities.draw * 100).toFixed(1)}% / ${(winProbabilities.away * 100).toFixed(1)}%`
            : `The Analyst: ${resumen ?? found.record.titulo}`,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    };
  });

  return { matches: enriched, applied, connected: applied > 0 };
}

const DASHBOARD_CACHE_MS = 60_000;
let dashboardCache: { value: DashboardData; expiresAt: number } | null = null;
let dashboardInFlight: Promise<DashboardData> | null = null;

/**
 * Punto de entrada del dashboard. Mantiene un snapshot de 60 s dentro del
 * isolate del Worker: sin él, cada request de `/` repetía el fanout completo de
 * fuentes y los cruces O(n·m), agotando el presupuesto de CPU (error 1102).
 * `forceRefresh` se reserva para el endpoint con `?refresh=1`.
 */
export async function getDashboardData(
  forceRefresh = false,
): Promise<DashboardData> {
  const now = Date.now();
  if (!forceRefresh && dashboardCache && dashboardCache.expiresAt > now) {
    return dashboardCache.value;
  }
  if (dashboardInFlight) return dashboardInFlight;

  dashboardInFlight = buildDashboardData()
    .then((value) => {
      dashboardCache = { value, expiresAt: Date.now() + DASHBOARD_CACHE_MS };
      return value;
    })
    .finally(() => {
      dashboardInFlight = null;
    });
  return dashboardInFlight;
}

/**
 * Construye el snapshot. Prioriza los partidos inyectados por el agente de
 * Flashscore, los convierte al modelo interno y limita el radar pre-match a los
 * encuentros pendientes de hoy y mañana en hora de Venezuela.
 *
 * Todas las fuentes se consultan en paralelo con `Promise.allSettled` y se
 * envuelven en `runResilientSource`: si una falla, se omite y el ranking se
 * calcula solo con las que respondieron.
 */
async function buildDashboardData(): Promise<DashboardData> {
  const ahora = new Date();
  const emptyDashboard = (): DashboardData =>
    finalizeDashboard(
      {
        matches: [],
        leagues: LEAGUES,
        sportCounts: countSports([]),
        meta: {
          mode: "live",
          generatedAt: ahora.toISOString(),
          cacheTtlSeconds: CACHE_SECONDS,
          oddsCreditsRemaining: null,
          sportmonksRemaining: null,
          apiSportsRemaining: null,
          warnings: [],
          sources: { oddsApi: false, sportmonks: false, apiSports: false },
        },
      },
      ahora,
    );

  const settled = await Promise.allSettled([
    runResilientSource(
      "api-sports",
      async () => {
        const data = await getAggregatedData(ahora);
        return {
          data,
          warnings: data.meta.warnings,
          partial: data.matches.length === 0,
          dataPoints: data.matches.length,
        };
      },
      { fallback: emptyDashboard() },
    ),
    runResilientSource(
      "flashscore",
      async () => {
        const data = flashscoreRecordsToMatches(listFlashscoreRecords(), ahora);
        return { data, dataPoints: data.length };
      },
      { fallback: [] as SportsMatch[] },
    ),
    runResilientSource(
      "curated",
      async () => {
        const data = curatedRecordsToMatches(listCuratedMatches(), ahora);
        return { data, dataPoints: data.length };
      },
      { fallback: [] as SportsMatch[] },
    ),
    runResilientSource(
      "espn",
      async () => {
        const data = await fetchFreeSourceMatches(ahora);
        return {
          data,
          warnings: data.warnings,
          partial: data.matches.length === 0,
          dataPoints: data.matches.length,
        };
      },
      {
        fallback: {
          matches: [],
          warnings: [],
          sources: { espn: false, sportsdb: false, openligadb: false },
        } as Awaited<ReturnType<typeof fetchFreeSourceMatches>>,
      },
    ),
    runResilientSource(
      "allsportsapi",
      async () => {
        const data = await fetchAllSportsApiMatches(ahora);
        return {
          data,
          warnings: data.warnings,
          partial: data.matches.length === 0,
          dataPoints: data.matches.length,
        };
      },
      {
        fallback: {
          matches: [],
          warnings: [],
          connected: false,
        } as Awaited<ReturnType<typeof fetchAllSportsApiMatches>>,
      },
    ),
    runResilientSource(
      "therundown",
      async () => {
        const data = await fetchTheRundownMatches(ahora);
        return {
          data,
          warnings: data.warnings,
          partial: data.matches.length === 0,
          dataPoints: data.matches.length,
        };
      },
      {
        fallback: {
          matches: [],
          warnings: [],
          connected: false,
        } as Awaited<ReturnType<typeof fetchTheRundownMatches>>,
      },
    ),
  ]);

  const baseSettled = settled[0] as PromiseSettledResult<SourceResult<DashboardData>>;
  const flashscore = settled[1] as PromiseSettledResult<SourceResult<SportsMatch[]>>;
  const curated = settled[2] as PromiseSettledResult<SourceResult<SportsMatch[]>>;
  const free = settled[3] as PromiseSettledResult<
    SourceResult<Awaited<ReturnType<typeof fetchFreeSourceMatches>>>
  >;
  const allSports = settled[4] as PromiseSettledResult<
    SourceResult<Awaited<ReturnType<typeof fetchAllSportsApiMatches>>>
  >;
  const rundownSettled = settled[5] as PromiseSettledResult<
    SourceResult<Awaited<ReturnType<typeof fetchTheRundownMatches>>>
  >;

  const baseResult =
    baseSettled.status === "fulfilled"
      ? baseSettled.value
      : failedSourceResult("api-sports", emptyDashboard(), "Promise.allSettled rechazado");
  const flashscoreResult =
    flashscore.status === "fulfilled"
      ? flashscore.value
      : failedSourceResult("flashscore", [] as SportsMatch[], "Promise.allSettled rechazado");
  const curatedResult =
    curated.status === "fulfilled"
      ? curated.value
      : failedSourceResult("curated", [] as SportsMatch[], "Promise.allSettled rechazado");
  const freeResult =
    free.status === "fulfilled"
      ? free.value
      : failedSourceResult(
        "espn",
        {
          matches: [],
          warnings: [],
          sources: { espn: false, sportsdb: false, openligadb: false },
        } as Awaited<ReturnType<typeof fetchFreeSourceMatches>>,
        "Promise.allSettled rechazado",
      );
  const allSportsResult =
    allSports.status === "fulfilled"
      ? allSports.value
      : failedSourceResult(
        "allsportsapi",
        { matches: [], warnings: [], connected: false } as Awaited<ReturnType<typeof fetchAllSportsApiMatches>>,
        "Promise.allSettled rechazado",
      );
  const rundownResult =
    rundownSettled.status === "fulfilled"
      ? rundownSettled.value
      : failedSourceResult(
        "therundown",
        { matches: [], warnings: [], connected: false } as Awaited<ReturnType<typeof fetchTheRundownMatches>>,
        "Promise.allSettled rechazado",
      );

  const adapters = [
    baseResult,
    flashscoreResult,
    curatedResult,
    freeResult,
    allSportsResult,
    rundownResult,
  ];
  const sourceHealth = {} as Record<DataSourceId, SourceHealthSnapshot>;
  for (const adapter of adapters) {
    sourceHealth[adapter.source] = snapshotFromResult(adapter);
  }
  // Las tres APIs premium se consultan dentro del mismo adapter; se refleja su
  // configuración sin duplicar peticiones.
  for (const id of ["the-odds-api", "sportmonks"] as const) {
    const configured =
      id === "the-odds-api"
        ? baseResult.data.meta.sources.oddsApi
        : baseResult.data.meta.sources.sportmonks;
    if (configured) {
      sourceHealth[id] = {
        ...healthSnapshot(id),
        ok: baseResult.ok,
        status: baseResult.status,
        latencyMs: baseResult.latencyMs,
      };
    }
  }
  const resilienceWarnings = adapters
    .filter((adapter) => !adapter.ok)
    .map((adapter) => adapter.warnings[0] ?? `${adapter.source}: fuente omitida`);

  const withRanking = (data: DashboardData): DashboardData => {
    const ranked = buildRankedFavorites(data.matches, {
      now: ahora,
      sourceHealth,
      day: "all",
      extraWarnings: resilienceWarnings,
    });
    return {
      ...data,
      rankedFavorites: ranked,
      meta: {
        ...data.meta,
        warnings: uniqueWarnings([...data.meta.warnings, ...ranked.warnings]),
        sourceHealth,
      },
    };
  };

  const base = baseResult.data;
  const flashscoreMatches = tagMatches(flashscoreResult.data, "flashscore");
  const curatedMatches = tagMatches(curatedResult.data, "curated");
  const freeSources = freeResult.data;
  const allSportsApi = allSportsResult.data;
  const rundown = rundownResult.data;

  const baseSources: DataSourceId[] = [];
  if (base.meta.sources.apiSports) baseSources.push("api-sports");
  if (base.meta.sources.sportmonks) baseSources.push("sportmonks");
  if (base.meta.sources.oddsApi) baseSources.push("the-odds-api");
  const taggedBase = tagMatches(base.matches, ...baseSources);
  // Las fuentes gratuitas ya vienen etiquetadas por partido en freeSourcesService;
  // no re-etiquetar globalmente para no inflar la procedencia.
  const taggedFree = freeSources.matches;
  const taggedAllSports = tagMatches(allSportsApi.matches, "allsportsapi");
  const taggedRundown = tagMatches(rundown.matches, "therundown");

  // Solo entran partidos de hoy o mañana que todavía no hayan comenzado. Los
  // que ya arrancaron o finalizaron se retiran automáticamente del feed.
  const esVigente = (match: SportsMatch) =>
    isWithinMatchWindow(match.commenceTime, ahora) &&
    resolveMatchStatus(match, ahora) === "scheduled";

  const baseUpcoming = taggedBase.filter(esVigente);
  const upcomingFlashscore = flashscoreMatches.filter(esVigente);
  const upcomingCurated = curatedMatches.filter(esVigente);
  const upcomingFree = taggedFree.filter(esVigente);
  const upcomingAllSports = taggedAllSports.filter(esVigente);
  const upcomingRundown = taggedRundown.filter(esVigente);
  const excluded =
    taggedBase.length - baseUpcoming.length +
    (flashscoreMatches.length - upcomingFlashscore.length) +
    (curatedMatches.length - upcomingCurated.length) +
    (taggedFree.length - upcomingFree.length) +
    (taggedAllSports.length - upcomingAllSports.length) +
    (taggedRundown.length - upcomingRundown.length);

  const ingested = [
    ...upcomingCurated,
    ...upcomingFlashscore,
    ...upcomingAllSports,
    ...upcomingRundown,
    ...upcomingFree,
  ];
  if (ingested.length === 0) {
    const captured = withCapturedBookmakerQuotes(baseUpcoming, ahora);
    const analyst = withTheAnalystInsights(captured.matches);
    const tsdbEnriched = await enrichWithTheSportsDbStats(analyst.matches);
    const espnEnriched = await enrichWithEspnStandings(tsdbEnriched.matches);
    const enriched = await enrichWithFallbackStandings(espnEnriched.matches);
    return withRanking(
      finalizeDashboard(
        {
          ...base,
          matches: enriched.matches,
          leagues: base.leagues.filter((league) =>
            enriched.matches.some((match) => match.league.id === league.id),
          ),
          sportCounts: countSports(enriched.matches),
          meta: {
            ...base.meta,
            warnings: uniqueWarnings([
              ...(excluded > 0
                ? [`${excluded} partidos ya comenzaron o están fuera de la ventana hoy/mañana y fueron excluidos.`]
                : []),
              ...(upcomingAllSports.length > 0 ? [`${upcomingAllSports.length} partidos de AllSportsAPI pendientes hoy/mañana (VET).`] : []),
              ...(upcomingRundown.length > 0 ? [`${upcomingRundown.length} partidos de TheRundown pendientes hoy/mañana (VET).`] : []),
              ...captured.warnings,
              ...freeSources.warnings,
              ...allSportsApi.warnings,
              ...rundown.warnings,
              ...(analyst.applied > 0
                ? [`${analyst.applied} análisis de The Analyst cruzados con partidos.`]
                : []),
              ...(enriched.applied > 0
                ? [`${enriched.applied} partido(s) con posiciones/forma de TheSportsDB (tier gratuito).`]
                : []),
              ...base.meta.warnings,
            ]),
            sources: {
              ...base.meta.sources,
              flashscore: upcomingFlashscore.length > 0,
              curated: upcomingCurated.length > 0,
              espn: freeSources.sources.espn,
              sportsdb: freeSources.sources.sportsdb,
              openligadb: freeSources.sources.openligadb,
              allsportsapi: allSportsApi.connected,
              therundown: rundown.connected,
              theAnalyst: analyst.connected,
              apuestasRoyal: captured.royalConnected,
            },
          },
        },
        ahora,
      ),
    );
  }

  const keyOf = (match: SportsMatch) =>
    `${dateInVET(match.commenceTime)}|${normalizeName(match.home.name)}|${normalizeName(match.away.name)}`;
  // Merge en O(n) con clave precalculada: el anterior `.find` dentro del bucle
  // reconstruía la clave (y un `Intl.DateTimeFormat`) por cada comparación,
  // superando el límite de CPU del Worker al haber cientos de partidos.
  const mergedByKey = new Map<string, SportsMatch>();
  for (const match of [...ingested, ...baseUpcoming]) {
    const key = keyOf(match);
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, match);
      continue;
    }
    // El partido ganador conserva la identidad; las fuentes se suman para que
    // el motor de fusión sepa quién respaldó cada señal.
    existing.sourceTags = Array.from(
      new Set([...(existing.sourceTags ?? []), ...(match.sourceTags ?? [])]),
    );
  }
  const mergedMatches = Array.from(mergedByKey.values());

  const captured = withCapturedBookmakerQuotes(mergedMatches, ahora);
  const analyst = withTheAnalystInsights(captured.matches);
  const tsdbEnriched = await enrichWithTheSportsDbStats(analyst.matches);
  const espnEnriched = await enrichWithEspnStandings(tsdbEnriched.matches);
  const enriched = await enrichWithFallbackStandings(espnEnriched.matches);
  const finalMatches = enriched.matches;
  const leagues = Array.from(
    new Map(finalMatches.map((match) => [match.league.id, match.league])).values(),
  );

  return withRanking(
    finalizeDashboard(
      {
        matches: finalMatches,
        leagues,
        sportCounts: countSports(finalMatches),
        meta: {
          ...base.meta,
          mode: "live",
          generatedAt: new Date().toISOString(),
          warnings: uniqueWarnings([
            ...(upcomingCurated.length > 0 ? [`${upcomingCurated.length} partidos curados ETL pendientes hoy/mañana (VET).`] : []),
            ...(upcomingFlashscore.length > 0 ? [`${upcomingFlashscore.length} partidos de Flashscore pendientes hoy/mañana (VET).`] : []),
            ...(upcomingFree.length > 0 ? [`${upcomingFree.length} partidos de fuentes gratuitas (ESPN/TheSportsDB/OpenLigaDB) pendientes hoy/mañana (VET).`] : []),
            ...(upcomingAllSports.length > 0 ? [`${upcomingAllSports.length} partidos de AllSportsAPI pendientes hoy/mañana (VET).`] : []),
            ...(upcomingRundown.length > 0 ? [`${upcomingRundown.length} partidos de TheRundown pendientes hoy/mañana (VET).`] : []),
            ...captured.warnings,
            ...freeSources.warnings,
            ...allSportsApi.warnings,
            ...rundown.warnings,
            ...(analyst.applied > 0
              ? [`${analyst.applied} análisis de The Analyst cruzados con partidos.`]
              : []),
            ...(enriched.applied > 0
              ? [`${enriched.applied} partido(s) con posiciones/forma de TheSportsDB (tier gratuito).`]
              : []),
            ...base.meta.warnings,
          ]),
          sources: {
            ...base.meta.sources,
            flashscore: upcomingFlashscore.length > 0,
            curated: upcomingCurated.length > 0,
            espn: freeSources.sources.espn,
            sportsdb: freeSources.sources.sportsdb,
            openligadb: freeSources.sources.openligadb,
            allsportsapi: allSportsApi.connected,
            therundown: rundown.connected,
            theAnalyst: analyst.connected,
            apuestasRoyal: captured.royalConnected,
          },
        },
      },
      ahora,
    ),
  );
}
