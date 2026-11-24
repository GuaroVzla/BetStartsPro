import type { OutcomeKey } from "@/types/sports";
import type { HistoricalMatch } from "@/lib/dixonColes";

export interface EloSnapshot {
  rating: number;
  n: number;
  lastMatchAt: string;
  leagueId?: string;
}

export interface EloConfig {
  k: number;
  homeAdvantage: number;
  decayPerDay: number;
  initialRating: number;
}

export const DEFAULT_ELO_CONFIG: EloConfig = {
  k: 20,
  homeAdvantage: 80,
  decayPerDay: 0.0015,
  initialRating: 1500,
};

const MS_PER_DAY = 86_400_000;
const FALLBACK_DATE = "1970-01-01T00:00:00.000Z";
const BASE_DRAW_PROBABILITY = 0.3;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function numberOr(value: number | undefined | null, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveConfig(config?: EloConfig): EloConfig {
  const source = config ?? DEFAULT_ELO_CONFIG;
  return {
    k: clamp(numberOr(source.k, DEFAULT_ELO_CONFIG.k), 0, 200),
    homeAdvantage: clamp(numberOr(source.homeAdvantage, DEFAULT_ELO_CONFIG.homeAdvantage), -500, 500),
    decayPerDay: clamp(numberOr(source.decayPerDay, DEFAULT_ELO_CONFIG.decayPerDay), 0, 1),
    initialRating: clamp(numberOr(source.initialRating, DEFAULT_ELO_CONFIG.initialRating), 0, 5000),
  };
}

function hasOwn(record: Record<string, EloSnapshot>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validDate(value: string | undefined): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : FALLBACK_DATE;
}

/**
 * Regresión lineal hacia initialRating por inactividad. Se usa al actualizar y
 * también al predecir: pase `asOf` con la fecha del partido a predecir.
 */
export function decayRating(
  rating: number,
  lastMatchAt: string,
  asOf: string,
  config?: EloConfig,
): number {
  const resolved = resolveConfig(config);
  const current = numberOr(rating, resolved.initialRating);
  const from = Date.parse(validDate(lastMatchAt));
  const to = Date.parse(validDate(asOf));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || resolved.decayPerDay === 0) {
    return current;
  }

  const days = (to - from) / MS_PER_DAY;
  const retention = Math.exp(-resolved.decayPerDay * days);
  return resolved.initialRating + (current - resolved.initialRating) * retention;
}

/** Esperanza de victoria local con ventaja de campo en escala Elo (/400). */
export function eloExpected(homeRating: number, awayRating: number, config?: EloConfig): number {
  const resolved = resolveConfig(config);
  const home = numberOr(homeRating, resolved.initialRating);
  const away = numberOr(awayRating, resolved.initialRating);
  const difference = clamp(home + resolved.homeAdvantage - away, -2000, 2000);
  return 1 / (1 + Math.pow(10, -difference / 400));
}

/** Actualiza el record in-place con margen de victoria y decaimiento. */
export function updateElo(
  ratings: Record<string, EloSnapshot>,
  homeId: string,
  awayId: string,
  homeGoals: number,
  awayGoals: number,
  date: string,
  config?: EloConfig,
): void {
  if (!ratings || homeId === awayId) return;

  const resolved = resolveConfig(config);
  const when = validDate(date);
  const homeSnapshot = hasOwn(ratings, homeId)
    ? ratings[homeId]
    : { rating: resolved.initialRating, n: 0, lastMatchAt: when };
  const awaySnapshot = hasOwn(ratings, awayId)
    ? ratings[awayId]
    : { rating: resolved.initialRating, n: 0, lastMatchAt: when };

  const homeRating = decayRating(homeSnapshot.rating, homeSnapshot.lastMatchAt, when, resolved);
  const awayRating = decayRating(awaySnapshot.rating, awaySnapshot.lastMatchAt, when, resolved);
  const expected = eloExpected(homeRating, awayRating, resolved);

  const homeScore = numberOr(homeGoals, 0);
  const awayScore = numberOr(awayGoals, 0);
  const actual = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
  const marginMultiplier = Math.log1p(Math.abs(homeScore - awayScore));
  const delta = resolved.k * marginMultiplier * (actual - expected);

  const nextHome: EloSnapshot = {
    rating: homeRating + delta,
    n: Math.max(0, Math.floor(numberOr(homeSnapshot.n, 0))) + 1,
    lastMatchAt: when,
  };
  if (typeof homeSnapshot.leagueId === "string") nextHome.leagueId = homeSnapshot.leagueId;

  const nextAway: EloSnapshot = {
    rating: awayRating - delta,
    n: Math.max(0, Math.floor(numberOr(awaySnapshot.n, 0))) + 1,
    lastMatchAt: when,
  };
  if (typeof awaySnapshot.leagueId === "string") nextAway.leagueId = awaySnapshot.leagueId;

  ratings[homeId] = nextHome;
  ratings[awayId] = nextAway;
}

function compareMatches(a: HistoricalMatch, b: HistoricalMatch): number {
  const timeA = Date.parse(a.date);
  const timeB = Date.parse(b.date);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeA - timeB;
  const byDate = a.date.localeCompare(b.date);
  return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
}

/** Construye snapshots cronológicamente; los partidos inválidos se ignoran. */
export function buildEloSnapshots(
  matches: HistoricalMatch[],
  config?: EloConfig,
): Record<string, EloSnapshot> {
  const snapshots: Record<string, EloSnapshot> = {};
  const resolved = resolveConfig(config);
  if (!Array.isArray(matches)) return snapshots;

  const ordered = matches
    .filter(
      (match) =>
        !!match &&
        typeof match.home === "string" &&
        match.home.length > 0 &&
        typeof match.away === "string" &&
        match.away.length > 0 &&
        Number.isFinite(match.homeGoals) &&
        Number.isFinite(match.awayGoals) &&
        Number.isFinite(Date.parse(match.date)),
    )
    .slice()
    .sort(compareMatches);

  for (const match of ordered) {
    for (const team of [match.home, match.away]) {
      if (!hasOwn(snapshots, team)) {
        const snapshot: EloSnapshot = {
          rating: resolved.initialRating,
          n: 0,
          lastMatchAt: match.date,
        };
        if (typeof match.leagueId === "string" && match.leagueId.length > 0) {
          snapshot.leagueId = match.leagueId;
        }
        snapshots[team] = snapshot;
      } else if (
        typeof match.leagueId === "string" &&
        match.leagueId.length > 0 &&
        typeof snapshots[team].leagueId !== "string"
      ) {
        snapshots[team].leagueId = match.leagueId;
      }
    }

    updateElo(
      snapshots,
      match.home,
      match.away,
      match.homeGoals,
      match.awayGoals,
      match.date,
      resolved,
    );
  }

  return snapshots;
}

/**
 * 1X2 desde Elo. El empate se deriva de la ventaja: cuanto mayor es la
 * diferencia de ratings (ya decayed por el llamador), menor es su peso.
 */
export function eloProbabilities(
  homeRating: number,
  awayRating: number,
  includeDraw: boolean,
  config?: EloConfig,
): Record<OutcomeKey, number> {
  const resolved = resolveConfig(config);
  const home = numberOr(homeRating, resolved.initialRating);
  const away = numberOr(awayRating, resolved.initialRating);
  const expected = eloExpected(home, away, resolved);

  const advantage = clamp(Math.abs(home - away) / 400, 0, 2.5);
  const draw = includeDraw
    ? clamp(BASE_DRAW_PROBABILITY * Math.exp(-advantage * 1.6), 0.03, BASE_DRAW_PROBABILITY)
    : 0;

  return {
    home: (1 - draw) * expected,
    draw,
    away: (1 - draw) * (1 - expected),
  };
}
