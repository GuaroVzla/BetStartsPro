/**
 * Adaptador de cruce: lleva nombres de equipos/ligas de The Analyst al mismo
 * espacio de Flashscore y Apuestas Royal. No modifica los stores
 * de esas fuentes; devuelve datos listos para que el agregador los consuma.
 */

import { dateInVET, formatPercent } from "@/lib/format";
import { createNameMatcher, normalizeName } from "@/lib/utils";
import {
  THE_ANALYST_TEAM_ALIASES,
  fairOddsFromProbabilities,
  type ProbabilityOutcome,
  type TheAnalystMatchInsight,
} from "@/services/theAnalystService";
import type { StoredTheAnalystRecord } from "@/services/theAnalystStore";
import type { SportsMatch } from "@/types/sports";

export { fairOddsFromProbabilities } from "@/services/theAnalystService";

/** Forma mínima compartida por Flashscore y Apuestas Royal. */
export type AnalystCrossMatch = {
  id?: string | null;
  match_slug?: string | null;
  fecha_local?: string | null;
  liga?: string | null;
  equipo_local: string;
  equipo_visitante: string;
};

const LEAGUE_ALIASES: Record<string, string> = {
  "premierleague": "Premier League",
  "englishpremierleague": "Premier League",
  "uefachampionsleague": "Champions League",
  "championsleague": "Champions League",
  "ucl": "Champions League",
  "uefaeuropaleague": "Europa League",
  "europaleague": "Europa League",
  "laliga": "LaLiga",
  "spanishlaliga": "LaLiga",
  "seriea": "Serie A",
  "bundesliga": "Bundesliga",
  "ligue1": "Ligue 1",
  "ligafutve": "Liga FUTVE",
  "mls": "MLS",
};

function stableKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function readableName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Los alias se normalizan una sola vez al cargar el módulo. Antes se
// recalculaban ~60 `stableKey` (NFD + regex) por cada comparación de partido.
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const aliases of Object.values(THE_ANALYST_TEAM_ALIASES)) {
  // La variante más larga es la menos ambigua ("manchester city" vs "city").
  const longest = aliases.reduce(
    (best, alias) => (alias.length > best.length ? alias : best),
    aliases[0],
  );
  const canonical = readableName(longest);
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(stableKey(alias), canonical);
}

const LEAGUE_ALIAS_KEYS = Object.entries(LEAGUE_ALIASES).map(([alias, canonical]) => ({
  alias,
  canonical,
}));
const canonicalTeamCache = new Map<string, string>();
const canonicalLeagueCache = new Map<string, string | null>();
const analystNameMatches = createNameMatcher();
const sameSideCache = new Map<string, boolean>();

/** Nombre de equipo canónico y sin ruido para comparar con otros proveedores. */
export function canonicalTeamName(name: string): string {
  const cached = canonicalTeamCache.get(name);
  if (cached !== undefined) return cached;
  const canonical = ALIAS_TO_CANONICAL.get(stableKey(name)) ?? readableName(name);
  canonicalTeamCache.set(name, canonical);
  return canonical;
}

export function canonicalLeagueName(league: string | null): string | null {
  if (!league) return null;
  const cached = canonicalLeagueCache.get(league);
  if (cached !== undefined) return cached;
  const key = stableKey(league);
  let canonical: string | null = LEAGUE_ALIASES[key] ?? null;
  if (!canonical) {
    for (const { alias, canonical: value } of LEAGUE_ALIAS_KEYS) {
      if (key.includes(alias) || alias.includes(key)) {
        canonical = value;
        break;
      }
    }
  }
  canonical ??= normalizeName(league);
  canonicalLeagueCache.set(league, canonical);
  return canonical;
}

function sourceDate(source: AnalystCrossMatch): string | null {
  if (source.fecha_local && /^\d{4}-\d{2}-\d{2}$/.test(source.fecha_local)) {
    return source.fecha_local;
  }
  if (source.match_slug) {
    const fromSlug = /^(\d{4}-\d{2}-\d{2})_/.exec(source.match_slug)?.[1];
    if (fromSlug) return fromSlug;
  }
  return null;
}

function insightDate(
  insight: TheAnalystMatchInsight,
  record: StoredTheAnalystRecord,
): string | null {
  if (insight.fecha_partido && /^\d{4}-\d{2}-\d{2}$/.test(insight.fecha_partido)) {
    return insight.fecha_partido;
  }
  if (insight.match_slug) {
    const fromSlug = /^(\d{4}-\d{2}-\d{2})_/.exec(insight.match_slug)?.[1];
    if (fromSlug) return fromSlug;
  }
  return record.fecha_publicacion.slice(0, 10) || null;
}

/**
 * Ventana de un día de tolerancia. Ambas fechas son calendario (YYYY-MM-DD),
 * así que basta comparar días; crear 3 `Intl.format` por comparación era
 * innecesario y caro dentro del cruce de cientos de partidos.
 */
export function datesWithinVETDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const first = Date.parse(`${a}T00:00:00Z`);
  const second = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return true;
  return Math.abs(first - second) <= 86_400_000;
}

function sameSide(a: string, b: string): boolean {
  const first = canonicalTeamName(a);
  const second = canonicalTeamName(b);
  if (!first || !second) return false;
  const key = first <= second ? `${first}\u0000${second}` : `${second}\u0000${first}`;
  const cached = sameSideCache.get(key);
  if (cached !== undefined) return cached;
  const result =
    first === second ||
    first.includes(second) ||
    second.includes(first) ||
    analystNameMatches(first, second);
  sameSideCache.set(key, result);
  return result;
}

function teamsScore(
  insight: TheAnalystMatchInsight,
  source: AnalystCrossMatch,
): { score: number; swapped: boolean } | null {
  const direct =
    sameSide(insight.equipo_local, source.equipo_local) &&
    sameSide(insight.equipo_visitante, source.equipo_visitante);
  const swapped =
    !direct &&
    sameSide(insight.equipo_local, source.equipo_visitante) &&
    sameSide(insight.equipo_visitante, source.equipo_local);
  if (!direct && !swapped) return null;
  // Penalizar invertidos, pero permitirlos solo con liga/slug fuerte.
  return { score: swapped ? 4 : 10, swapped };
}

interface DetailedAnalystMatchScore {
  score: number;
  swapped: boolean;
}

function scoreTheAnalystMatchDetailed(
  source: AnalystCrossMatch,
  record: StoredTheAnalystRecord,
): DetailedAnalystMatchScore {
  const insight = record.insight;
  if (!insight) return { score: 0, swapped: false };

  if (source.match_slug && insight.match_slug && source.match_slug === insight.match_slug) {
    return { score: 100, swapped: false };
  }
  if (
    source.id &&
    insight.match_slug &&
    source.id === `flashscore-${insight.match_slug}`
  ) {
    return { score: 100, swapped: false };
  }

  const teams = teamsScore(insight, source);
  if (teams === null) return { score: 0, swapped: false };
  if (!datesWithinVETDay(sourceDate(source), insightDate(insight, record))) {
    return { score: 0, swapped: false };
  }

  const sourceLeague = canonicalLeagueName(source.liga ?? null);
  const insightLeague = canonicalLeagueName(insight.liga);
  const sameLeague =
    !sourceLeague || !insightLeague ? 0 : sourceLeague === insightLeague ? 3 : -2;
  const score = teams.score + sameLeague;
  if (teams.swapped && score < 7) return { score: 0, swapped: false };
  return { score, swapped: teams.swapped };
}

/** Puntúa un cruce: 0 = no cruza, valores altos = coincidencia fiable. */
export function scoreTheAnalystMatch(
  source: AnalystCrossMatch,
  record: StoredTheAnalystRecord,
): number {
  return scoreTheAnalystMatchDetailed(source, record).score;
}

export type TheAnalystMatchResult<T extends AnalystCrossMatch> = {
  source: T;
  record: StoredTheAnalystRecord;
  insight: TheAnalystMatchInsight;
  fairOdds: Record<ProbabilityOutcome, number | null>;
  score: number;
  swapped: boolean;
};

/** Busca el mejor insight para una fila de Flashscore/Apuestas Royal. */
export function findTheAnalystMatch<T extends AnalystCrossMatch>(
  source: T,
  records: StoredTheAnalystRecord[],
  minScore = 7,
): TheAnalystMatchResult<T> | null {
  let best: TheAnalystMatchResult<T> | null = null;
  for (const record of records) {
    if (!record.insight) continue;
    const detailed = scoreTheAnalystMatchDetailed(source, record);
    if (detailed.score < minScore) continue;
    if (!best || detailed.score > best.score) {
      best = {
        source,
        record,
        insight: record.insight,
        fairOdds: fairOddsFromProbabilities(record.insight.probabilidades),
        score: detailed.score,
        swapped: detailed.swapped,
      };
    }
  }
  return best;
}

export function applyTheAnalystInsights<T extends AnalystCrossMatch>(
  sources: T[],
  records: StoredTheAnalystRecord[],
): { results: Array<TheAnalystMatchResult<T>>; matched: number; unmatched: number } {
  const results: Array<TheAnalystMatchResult<T>> = [];
  for (const source of sources) {
    const match = findTheAnalystMatch(source, records);
    if (match) results.push(match);
  }
  return {
    results,
    matched: results.length,
    unmatched: sources.length - results.length,
  };
}

function insightNote(insight: TheAnalystMatchInsight): string | null {
  const { home, draw, away } = insight.probabilidades;
  if (home === null && draw === null && away === null) return null;
  const parts = [
    `The Analyst · ${insight.equipo_local} ${home === null ? "—" : formatPercent(home)} / ` +
      `Empate ${draw === null ? "—" : formatPercent(draw)} / ` +
      `${insight.equipo_visitante} ${away === null ? "—" : formatPercent(away)}`,
  ];
  const { xg_local, xg_visitante } = insight.metricas;
  if (xg_local !== null || xg_visitante !== null) {
    parts.push(
      `xG ${xg_local ?? "—"} - ${xg_visitante ?? "—"}`,
    );
  }
  parts.push(`confianza ${insight.confianza}`);
  return parts.join(" · ");
}

/**
 * Enriquece partidos del dashboard sin tocar cuotas ni favoritos: solo añade
 * una nota al intel para que el usuario compare la probabilidad del modelo con
 * la probabilidad de mercado. Los partidos sin insight se devuelven tal cual.
 */
export function enrichSportsMatchesWithTheAnalyst(
  matches: SportsMatch[],
  records: StoredTheAnalystRecord[],
): { matches: SportsMatch[]; applied: number; unmatched: number } {
  if (records.length === 0 || matches.length === 0) {
    return { matches, applied: 0, unmatched: matches.length };
  }

  let applied = 0;
  const enriched = matches.map((match) => {
    const source: AnalystCrossMatch = {
      id: match.id,
      match_slug: match.id.startsWith("flashscore-")
        ? match.id.slice("flashscore-".length)
        : null,
      fecha_local: dateInVET(match.commenceTime),
      liga: match.league.name,
      equipo_local: match.home.name,
      equipo_visitante: match.away.name,
    };
    const found = findTheAnalystMatch(source, records);
    if (!found) return match;
    const note = insightNote(found.insight);
    if (!note) return match;
    applied += 1;
    return {
      ...match,
      intel: {
        ...match.intel,
        note: [match.intel.note, note].filter(Boolean).join(" · "),
      },
    };
  });

  return { matches: enriched, applied, unmatched: matches.length - applied };
}
