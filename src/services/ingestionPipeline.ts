/**
 * Ingestion Pipeline - Pipeline de Ingesta Multi-Fuente
 * Integra todas las fuentes de datos: APIs, Adapters personalizados, y Scrapers.
 *
 * Fuentes integradas:
 * - APIs: The Odds API, SportMonks, API-Sports (Flashscore)
 * - Adapters: Apuestas Royal
 * - Database: Flashscore (ingest store)
 */

import { matchDayVET, resolveMatchStatus, dateInVET } from "@/lib/format";

import type {
  LeagueInfo,
  MatchDay,
  SportsMatch,
  DashboardData,
  DataMode,
  DashboardMeta,
} from "@/types/sports";

import { applyApuestasRoyalQuotes } from "@/services/apuestasRoyalAdapter";
import { listQuotes as listApuestasRoyalQuotes } from "@/services/apuestasRoyalIngestStore";
import { flashscoreRecordsToMatches } from "@/services/flashscoreAdapter";
import { listMatches as listFlashscoreRecords } from "./flashscoreIngestStore";
import { listCuratedMatches } from "./curatedIngestStore";

import { getDashboardData as getLiveDashboardData } from "@/services/matchAggregator";

const CACHE_TTL_SECONDS = 3600; // 1 hora

interface IngestionStats {
  totalSources: number;
  enabledSources: string[];
  appliedRoyal: number;
  appliedFlashscore: number;
  cacheAgeSeconds: number;
  warnings: string[];
}

export interface CacheEntry {
  data: DashboardData;
  timestamp: number;
  stats: IngestionStats;
}

const CACHE: { current: CacheEntry | null } = { current: null };

/** Establece datos en cache */
function setToCache(data: DashboardData, stats: IngestionStats) {
  CACHE.current = { data, timestamp: Date.now(), stats };
}

/** Ejecuta la ingesta completa de todas las fuentes */
async function executeFullIngestion(): Promise<{ data: DashboardData; stats: IngestionStats; warnings: string[] }> {
  const warnings: string[] = [];
  const stats: IngestionStats = {
    totalSources: 7,
    enabledSources: [],
    appliedRoyal: 0,
    appliedFlashscore: 0,
    cacheAgeSeconds: 0,
    warnings,
  };

  try {
    const liveData = await getLiveDashboardData();
    stats.appliedRoyal = listApuestasRoyalQuotes().length;
    stats.appliedFlashscore = listFlashscoreRecords().length;
    stats.enabledSources.push(
      ...(liveData.meta.sources.oddsApi ? ["the-odds-api"] : []),
      ...(liveData.meta.sources.sportmonks ? ["sportmonks"] : []),
      ...(liveData.meta.sources.apiSports ? ["api-sports"] : []),
      ...(liveData.meta.sources.flashscore ? ["flashscore"] : []),
      ...(liveData.meta.sources.apuestasRoyal ? ["apuestas-royal"] : []),
      ...(liveData.meta.sources.theAnalyst ? ["the-analyst"] : []),
      ...(liveData.meta.sources.curated || listCuratedMatches().length > 0 ? ["curated-etl"] : []),
      ...(liveData.meta.sources.espn ? ["espn"] : []),
      ...(liveData.meta.sources.sportsdb ? ["thesportsdb"] : []),
      ...(liveData.meta.sources.openligadb ? ["openligadb"] : []),
    );
    return { data: liveData, stats, warnings: liveData.meta.warnings };
  } catch (error) {
    warnings.push(`Error en APIs live: ${error instanceof Error ? error.message : "Desconocido"}`);
  }

  return {
    data: {
      matches: [],
      leagues: [],
      sportCounts: { soccer: 0, basketball: 0, baseball: 0, hockey: 0 },
      dayCounts: { today: 0, tomorrow: 0 },
      meta: {
        mode: "live",
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        oddsCreditsRemaining: null,
        sportmonksRemaining: null,
        apiSportsRemaining: null,
        warnings,
        sources: { oddsApi: false, sportmonks: false, apiSports: false },
      },
    },
    stats,
    warnings,
  };
}

/**
 * Public Interface - IngestAllData
 * Pipeline principal de ingesta: obtiene datos de todas las fuentes y en enriquecedor.
 */
export async function ingestAllData(): Promise<{ data: DashboardData; stats: IngestionStats }> {
  const { data, stats } = await executeFullIngestion();
  setToCache(data, stats);
  return { data, stats };
}

/** Public Interface - executeFullIngestion */
export async function runFullIngestion(): Promise<IngestionStats> {
  const { stats } = await ingestAllData();
  return stats;
}

// Export types
export type { IngestionStats };
