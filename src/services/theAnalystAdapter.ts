/**
 * Adaptador de cruce: lleva nombres de equipos/ligas de The Analyst al mismo
 * espacio de Flashscore, TriunfoBet y Apuestas Royal. No modifica los stores
 * de esas fuentes; devuelve datos listos para que el agregador los consuma.
 */

import { dateInVET, dateInVETOffset, formatPercent } from "@/lib/format";
import { namesLikelyMatch, normalizeName } from "@/lib/utils";
import {
  THE_ANALYST_TEAM_ALIASES,
  fairOddsFromProbabilities,
  type ProbabilityOutcome,
  type TheAnalystMatchInsight,
} from "@/services/theAnalystService";
import type { StoredTheAnalystRecord } from "@/services/theAnalystStore";
import type { SportsMatch } from "@/types/sports";

export { fairOddsFromProbabilities } from "@/services/theAnalystService";

/** Forma mínima compartida por Flashscore, TriunfoBet y Apuestas Royal. */
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

/** Nombre de equipo canónico y sin ruido para comparar con otros proveedores. */
export function canonicalTeamName(name: string): string {
  const key = stableKey(name);
  for (const aliases of Object.values(THE_ANALYST_TEAM_ALIASES)) {
    if (aliases.some((alias) => stableKey(alias) === key)) {
      // La variante más larga es la menos ambigua ("manchester city" vs "city").
      const longest = aliases.reduce(
        (best, alias) => (alias.length > best.length ? alias : best),
        aliases[0],
      );
      return readableName(longest);
    }
  }
  return readableName(name);
}

export function canonicalLeagueName(league: string | null): string | null {
  if (!league) return null;
  const key = stableKey(league);
  if (LEAGUE_ALIASES[key]) return LEAGUE_ALIASES[key];
  for (const [alias, canonical] of Object.entries(LEAGUE_ALIASES)) {
    if (key.includes(alias) || alias.includes(key)) return canonical;
  }
  return normalizeName(league);
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

/** Ventana de un día de tolerancia usando la zona de Venezuela del repo. */
export function datesWithinVETDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const base = new Date(`${a}T12:00:00Z`);
  if (!Number.isFinite(base.getTime())) return true;
  const allowed = new Set([
    dateInVETOffset(-1, base),
    dateInVETOffset(0, base),
    dateInVETOffset(1, base),
  ]);
  return allowed.has(b);
}

function sameSide(a: string, b: string): boolean {
  const first = canonicalTeamName(a);
  const second = canonicalTeamName(b);
  if (!first || !second) return false;
  if (first === second || first.includes(second) || second.includes(first)) return true;
  return namesLikelyMatch(first, second);
}

function teamsScore(
  insight: TheAnalystMatchInsight,
  source: AnalystCrossMatch,
): number | null {
  const direct =
    sameSide(insight.equipo_local, source.equipo_local) &&
    sameSide(insight.equipo_visitante, source.equipo_visitante);
  const swapped =
    sameSide(insight.equipo_local, source.equipo_visitante) &&
    sameSide(insight.equipo_visitante, source.equipo_local);
  if (!direct && !swapped) return null;
  return swapped ? 8 : 10;
}

/** Puntúa un cruce: 0 = no cruza, valores altos = coincidencia fiable. */
export function scoreTheAnalystMatch(
  source: AnalystCrossMatch,
  record: StoredTheAnalystRecord,
): number {
  const insight = record.insight;
  if (!insight) return 0;

  if (source.match_slug && insight.match_slug && source.match_slug === insight.match_slug) {
    return 100;
  }
  if (
    source.id &&
    insight.match_slug &&
    source.id === `flashscore-${insight.match_slug}`
  ) {
    return 100;
  }

  const teams = teamsScore(insight, source);
  if (teams === null) return 0;
  if (!datesWithinVETDay(sourceDate(source), insightDate(insight, record))) return 0;

  const sourceLeague = canonicalLeagueName(source.liga ?? null);
  const insightLeague = canonicalLeagueName(insight.liga);
  const sameLeague =
    !sourceLeague || !insightLeague ? 0 : sourceLeague === insightLeague ? 3 : -2;
  return teams + sameLeague;
}

export type TheAnalystMatchResult<T extends AnalystCrossMatch> = {
  source: T;
  record: StoredTheAnalystRecord;
  insight: TheAnalystMatchInsight;
  fairOdds: Record<ProbabilityOutcome, number | null>;
  score: number;
};

/** Busca el mejor insight para una fila de Flashscore/TriunfoBet/Apuestas Royal. */
export function findTheAnalystMatch<T extends AnalystCrossMatch>(
  source: T,
  records: StoredTheAnalystRecord[],
  minScore = 7,
): TheAnalystMatchResult<T> | null {
  let best: TheAnalystMatchResult<T> | null = null;
  for (const record of records) {
    if (!record.insight) continue;
    const score = scoreTheAnalystMatch(source, record);
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = {
        source,
        record,
        insight: record.insight,
        fairOdds: fairOddsFromProbabilities(record.insight.probabilidades),
        score,
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
