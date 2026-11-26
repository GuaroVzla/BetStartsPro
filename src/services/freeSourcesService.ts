/**
 * Orquestador de fuentes gratuitas sin API key.
 * ESPN cubre fútbol (soccer/all) y varios feeds de básquet, béisbol y hockey;
 * OpenLigaDB respalda Bundesliga y TheSportsDB solo si hay key propia.
 * Los duplicados se resuelven conservando la entrada con cuotas.
 */
import { dateInVET } from "@/lib/format";
import { normalizeName } from "@/lib/utils";
import { fetchEspnMatches } from "@/services/espnService";
import { fetchOpenLigaDbMatches } from "@/services/openLigaDbService";
import { fetchTheSportsDbMatches } from "@/services/theSportsDbService";
import type { DataSourceId, SportsMatch } from "@/types/sports";

export interface FreeSourcesResult {
  matches: SportsMatch[];
  warnings: string[];
  sources: {
    espn: boolean;
    sportsdb: boolean;
    openligadb: boolean;
  };
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache: { at: number; data: FreeSourcesResult | null } = { at: 0, data: null };

function dedupeKey(match: SportsMatch): string {
  return `${dateInVET(match.commenceTime)}|${normalizeName(match.home.name)}|${normalizeName(match.away.name)}`;
}

/** Etiqueta cada partido con la fuente que realmente lo aportó. */
function tagSource(matches: SportsMatch[], source: DataSourceId): SportsMatch[] {
  return matches.map((match) => ({
    ...match,
    sourceTags: Array.from(new Set([...(match.sourceTags ?? []), source])),
  }));
}

export async function fetchFreeSourceMatches(now: Date = new Date()): Promise<FreeSourcesResult> {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const [espn, sportsdb, openligadb] = await Promise.all([
    fetchEspnMatches(now),
    fetchTheSportsDbMatches(now),
    fetchOpenLigaDbMatches(now),
  ]);

  const taggedEspn = tagSource(espn.matches, "espn");
  const taggedSportsDb = tagSource(sportsdb.matches, "sportsdb");
  const taggedOpenLigaDb = tagSource(openligadb.matches, "openligadb");

  const byKey = new Map<string, SportsMatch>();
  for (const match of [...taggedEspn, ...taggedSportsDb, ...taggedOpenLigaDb]) {
    const key = dedupeKey(match);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, match);
      continue;
    }
    // Fusionar procedencia real: un partido puede venir de varias fuentes gratuitas.
    const mergedTags = Array.from(
      new Set([...(existing.sourceTags ?? []), ...(match.sourceTags ?? [])]),
    );
    // Preferir la entrada que trae cuotas; si ambas tienen, conservar la primera.
    if (existing.odds.bookmakers.length === 0 && match.odds.bookmakers.length > 0) {
      byKey.set(key, { ...match, sourceTags: mergedTags });
    } else {
      byKey.set(key, { ...existing, sourceTags: mergedTags });
    }
  }

  const matches = Array.from(byKey.values());
  const result: FreeSourcesResult = {
    matches,
    warnings: [...espn.warnings, ...sportsdb.warnings, ...openligadb.warnings],
    sources: {
      espn: espn.connected,
      sportsdb: sportsdb.connected,
      openligadb: openligadb.connected,
    },
  };
  cache.at = Date.now();
  cache.data = result;
  return result;
}
