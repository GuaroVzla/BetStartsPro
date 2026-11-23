/**
 * Ingestion Pipeline - Pipeline de Ingesta Multi-Fuente
 * Integra todas las fuentes de datos: APIs, Adapters personalizados, y Scrapers.
 *
 * Fuentes integradas:
 * - APIs: The Odds API, SportMonks, API-Sports (Flashscore)
 * - Adapters: Triunfobet, Apuestas Royal
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

import type {
  PredictiveSnapshot,
  MatchMarketAnalysis,
  MarketAnalysis,
  DashboardAnalytics,
} from "@/types/predictive";

import { getMockDashboardData } from "@/data/mockData";
import { applyTriunfobetQuotes } from "@/services/triunfobetAdapter";
import { listQuotes as listTriunfobetQuotes } from "@/services/triunfobetIngestStore";
import { applyApuestasRoyalQuotes } from "@/services/apuestasRoyalAdapter";
import { listQuotes as listApuestasRoyalQuotes } from "@/services/apuestasRoyalIngestStore";
import { flashscoreRecordsToMatches } from "@/services/flashscoreAdapter";
import { listMatches as listFlashscoreRecords } from "@/services/flashscoreIngestStore";

import { getDashboardData as getLiveDashboardData } from "@/services/matchAggregator";
import { computePredictiveSnapshots, computeMarketAnalyses, computeRiskAssessments } from "@/services/matchPredictiveEngine";

const CACHE_TTL_SECONDS = 3600; // 1 hora

interface IngestionStats {
  totalSources: number;
  enabledSources: string[];
  appliedTriunfobet: number;
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
    totalSources: 5,
    enabledSources: [],
    appliedTriunfobet: 0,
    appliedRoyal: 0,
    appliedFlashscore: 0,
    cacheAgeSeconds: 0,
    warnings,
  };

  try {
    const liveData = await getLiveDashboardData();
    stats.appliedTriunfobet = liveData.matches.length > 0 ? liveData.matches.length : 0;
    stats.appliedRoyal = liveData.matches.length > 0 ? liveData.matches.length : 0;
    stats.enabledSources.push("the-odds-api", "sportmonks", "api-sports", "triunfobet", "apuestas-royal", "flashscore");
    return { data: liveData, stats, warnings: liveData.meta.warnings };
  } catch (error) {
    warnings.push(`Error en APIs live: ${error instanceof Error ? error.message : "Desconocido"}`);
  }

  // Fallback: datos mock
  const mockData = getMockDashboardData();
  stats.enabledSources.push("mock", "triunfobet", "apuestas-royal");
  return { data: mockData, stats, warnings };
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

/**
 * Public Interface - getDashboardWithAnalytics
 * Obtiene DashboardData + análisis predictivo integrado.
 */
export async function getDashboardWithAnalytics(): Promise<{
  data: DashboardData;
  snapshots: PredictiveSnapshot[];
  marketAnalyses: MarketAnalysis[];
  stats: IngestionStats;
}> {
  const { data, stats } = await ingestAllData();
  
  const snapshots = data.matches.flatMap(match => computePredictiveSnapshots(match));
  const marketAnalyses = computeMarketAnalyses(data.matches);
  
  return { data, snapshots, marketAnalyses, stats };
}

/** Public Interface - executeFullIngestion */
export async function runFullIngestion(): Promise<IngestionStats> {
  const { stats } = await ingestAllData();
  return stats;
}

/** Public Interface - getAnalytics */
export function getAnalyticsFromData(data: DashboardData): DashboardAnalytics {
  const snapshots = data.matches.flatMap(match => computePredictiveSnapshots(match));
  return {
    data,
    snapshots,
    matchMarkets: data.matches.map((match): MatchMarketAnalysis => ({
      matchId: match.id,
      analysis: { matchId: match.id, bestOdds: {home: match.odds.best.home, draw: match.odds.best.draw || 0, away: match.odds.best.away}, bestImpliedProb: {home: 0, draw: 0, away: 0}, valueSpreadPct: {home: 0, draw: 0, away: 0}, sourceCount: {home: match.odds.bookmakerCount, draw: 0, away: 0}, sourcesByOutcome: {home: [], draw: [], away: []}, riskLevel: {home: "safe", draw: "safe", away: "safe"} },
      valueBet: false,
      isHembra: false,
      minEV: 0.05,
      riskLevel: "medium",
      bookmakerSynergy: "Sin información",
    })),
    generatedAt: new Date(),
    stats: {
      totalMatches: data.matches.length,
      totalValueBets: 0,
      highConfidenceCount: 0,
      avgEV: 0,
      topRecommendations: [],
    },
  };
}

// Export types
export type { IngestionStats };
