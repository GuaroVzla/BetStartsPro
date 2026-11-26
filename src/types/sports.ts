export type SportKey = "soccer" | "basketball" | "baseball" | "hockey";

export type SportFilter = "all" | SportKey;

export type FormResult = "W" | "D" | "L";

export type InjuryImpact = "high" | "medium" | "low";

export type DataMode = "live" | "hybrid";

export type OddsSource =
  | "the-odds-api"
  | "sportmonks"
  | "api-sports"
  | "espn"
  | "flashscore"
  | "allsportsapi"
  | "therundown"
  | "apuestas-royal";

export type AnalyticsSource =
  | "the-analyst"
  | "sportmonks"
  | "api-sports"
  | "modelo";

export type DataProvenance = "api" | "table-derived" | "editorial" | "none";

/** Identificador estable de cada adapter/fuente que participa en la fusión. */
export type DataSourceId =
  | "the-odds-api"
  | "api-sports"
  | "sportmonks"
  | "espn"
  | "sportsdb"
  | "openligadb"
  | "allsportsapi"
  | "therundown"
  | "flashscore"
  | "curated"
  | "apuestas-royal"
  | "the-analyst"
  | "modelo";

export type FusionLayer =
  | "market"
  | "model"
  | "form"
  | "standings"
  | "venueH2h"
  | "editorial";

export type OutcomeKey = "home" | "draw" | "away";

/**
 * Métricas avanzadas cruzadas desde The Analyst u otra fuente editorial.
 * Se guardan en el partido para que el motor de valor pueda comparar
 * probabilidad estadística vs. probabilidad implícita del mercado.
 */
export interface AnalystInsight {
  source: AnalyticsSource;
  xgHome: number | null;
  xgAway: number | null;
  /** Probabilidad 1X2 calculada por la fuente editorial (0-1). */
  winProbabilities: Record<OutcomeKey, number> | null;
  streakHome: string | null;
  streakAway: string | null;
  headline: string | null;
  url: string | null;
  updatedAt: string;
  /** 0-1. Modula el peso del blend; baja confianza => peso ~0. */
  confidence?: number;
  provenance?: DataProvenance;
}

export type MatchStatus = "scheduled" | "live" | "finished";

/** Ventana operativa del radar pre-match: hoy y mañana (hora Venezuela). */
export type MatchDay = "today" | "tomorrow";

/**
 * Resultado de las validaciones estadísticas obligatorias del KPI
 * "Favorables con cuota alta". La cuota americana positiva (>= +100) equivale
 * a una cuota decimal >= 2.00.
 */
export interface FavoriteValidation {
  form: boolean;
  standings: boolean;
  venue: boolean;
}

export interface ValueFavoriteScore {
  qualifies: boolean;
  oddsThresholdMet: boolean;
  validations: FavoriteValidation;
  favoriteFormRate: number | null;
  rivalFormRate: number | null;
  favoritePosition: number | null;
  rivalPosition: number | null;
  venueRecord: VenueSplit | null;
  venuePointsRate: number | null;
  explanation: string[];
}

export interface SportMeta {
  key: SportKey;
  label: string;
  shortLabel: string;
  emoji: string;
  accent: string;
  tagline: string;
}

export interface LeagueInfo {
  id: string;
  sport: SportKey;
  oddsApiKey: string;
  apiSportsId: number;
  sportmonksLeagueId?: number;
  /** Ruta ESPN usada por la fuente gratuita (p. ej. soccer/eng.1). */
  espnPath?: string;
  name: string;
  shortName: string;
  country: string;
  /** Indica competición no nacional; si se omite se infiere de country/nombre. */
  isInternational?: boolean;
  season: string;
}

export interface TeamRef {
  id: string;
  name: string;
  shortName: string;
  color: string;
  secondaryColor: string;
  logo?: string;
}

export interface StandingRow {
  teamId: string;
  teamName: string;
  teamShortName: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  winPercentage: number;
  scored: number;
  conceded: number;
  difference: number;
  form: FormResult[];
  group?: string;
  note?: string;
}

export interface VenueSplit {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scored: number;
  conceded: number;
}

export interface TeamAdvancedStats {
  teamId: string;
  form: FormResult[];
  avgScored: number;
  avgConceded: number;
  home: VenueSplit;
  away: VenueSplit;
  streak: string;
  cleanSheets?: number;
  xgFor?: number;
  xgAgainst?: number;
  xgSample?: number;
  xpts?: number;
  pressureAvg?: number;
  provenance?: DataProvenance;
  asOf?: string;
}

export interface Injury {
  id: string;
  teamId: string;
  player: string;
  position: string;
  status: string;
  reason: string;
  impact: InjuryImpact;
  positionGroup?: "goalkeeper" | "defender" | "midfielder" | "forward";
  /** 0-1 de minutos esperados sobre el total del equipo. */
  minutesShare?: number;
  confirmedOut?: boolean;
  asOf?: string;
}

export interface PredictedLineup {
  teamId: string;
  playerId: string;
  playerName: string;
  position: string;
  isStarter: boolean;
  source: AnalyticsSource;
  updatedAt: string;
}

export interface MatchIntel {
  standings: {
    home: StandingRow;
    away: StandingRow;
    table: StandingRow[];
  };
  stats: {
    home: TeamAdvancedStats;
    away: TeamAdvancedStats;
  };
  injuries: {
    home: Injury[];
    away: Injury[];
  };
  lineups?: {
    home: PredictedLineup[];
    away: PredictedLineup[];
  };
  note?: string;
  provenance?: DataProvenance;
}

export interface OutcomePrices {
  home: number;
  draw: number | null;
  away: number;
}

export interface BookmakerQuote {
  id: string;
  name: string;
  source: OddsSource;
  outcomes: OutcomePrices;
  updatedAt: string;
  /** Casa canónica para dedupe (Bet365, Pinnacle...), sin prefijo de proveedor. */
  canonicalName?: string;
  asOf?: string;
  overround?: number;
}

export interface MarketSummary {
  best: OutcomePrices;
  average: OutcomePrices;
  spreadPercent: OutcomePrices;
  /** Probabilidad consenso del mercado, normalizada sin margen (overround). */
  consensus: Record<OutcomeKey, number>;
  /** Implícita de mejor cuota desvigada con el MISMO método que `consensus`. */
  impliedDevig: Record<OutcomeKey, number>;
  /** Margen medio del mercado (suma de implícitas - 1). */
  overround: number;
  devigMethod: "proportional" | "shin";
  bookmakers: BookmakerQuote[];
  bookmakerCount: number;
}

export interface SportsMatch {
  id: string;
  sport: SportKey;
  league: LeagueInfo;
  commenceTime: string;
  status: MatchStatus;
  venue: string;
  home: TeamRef;
  away: TeamRef;
  odds: MarketSummary;
  intel: MatchIntel;
  /** Favorito de mercado por cuota mínima (legado, derivado). */
  favoriteSide?: "home" | "away" | null;
  /** Favorito canónico: consenso desvigado, con desempate de cuota. */
  canonicalFavorite?: "home" | "away" | null;
  /** 0-1: cuánta señal independiente del mercado tiene el partido. */
  modelConfidence?: number;
  /** Ratings Elo usados en la proyección, cuando hay artefacto disponible. */
  elo?: { home: number; away: number } | null;
  /** Análisis previo y métricas avanzadas, cuando está disponible. */
  analyst?: AnalystInsight | null;
  /** Fuentes reales que aportaron señal a este partido (para trazabilidad). */
  sourceTags?: DataSourceId[];
}

export interface ApiSourceStatus {
  oddsApi: boolean;
  sportmonks: boolean;
  apiSports: boolean;
  flashscore?: boolean;
  theAnalyst?: boolean;
  apuestasRoyal?: boolean;
  curated?: boolean;
  espn?: boolean;
  sportsdb?: boolean;
  openligadb?: boolean;
  allsportsapi?: boolean;
  therundown?: boolean;
}

export type SourceHealthStatus = "closed" | "open" | "half-open";

export interface SourceHealthSnapshot {
  source: DataSourceId;
  status: SourceHealthStatus;
  ok: boolean;
  latencyMs: number;
  dataPoints: number;
  partial: boolean;
  failures: number;
  reason?: string;
}

export interface DashboardMeta {
  mode: DataMode;
  generatedAt: string;
  cacheTtlSeconds: number;
  oddsCreditsRemaining: number | null;
  sportmonksRemaining: number | null;
  apiSportsRemaining: number | null;
  warnings: string[];
  sources: ApiSourceStatus;
  /** Estado del circuit breaker y rendimiento de cada adapter en esta request. */
  sourceHealth?: Record<DataSourceId, SourceHealthSnapshot>;
}

export interface DashboardData {
  matches: SportsMatch[];
  leagues: LeagueInfo[];
  meta: DashboardMeta;
  sportCounts: Record<SportKey, number>;
  /** Conteo de partidos pre-match por ventana operativa (hoy / mañana). */
  dayCounts: Record<MatchDay, number>;
  /** Ranking unificado de favoritos con probabilidad real, edge y confianza. */
  rankedFavorites?: RankedFavoritesResult;
}

export interface FavoriteMetrics {
  form: FormResult[];
  rivalForm: FormResult[];
  goalsFor: number | null;
  goalsAgainst: number | null;
  xgFor: number | null;
  xgAgainst: number | null;
  streak: string | null;
  position: number | null;
  rivalPosition: number | null;
  homeAdvantage: number;
  venueRecord: VenueSplit | null;
  h2hAvailable: false;
  bookmakerCount: number;
  marketOverround: number;
}

export interface RankedFavorite {
  rank: number;
  matchId: string;
  sport: SportKey;
  league: string;
  commenceTime: string;
  outcome: "home" | "away";
  team: string;
  opponent: string;
  modelProbability: number;
  marketImpliedProbability: number;
  marketImpliedRaw: number;
  edge: number;
  edgeVsRaw: number;
  expectedValue: number;
  fairOdds: number | null;
  bestOdds: number | null;
  bookmaker: string | null;
  isValueBet: boolean;
  confidence: number;
  supportingSources: DataSourceId[];
  /** Pesos efectivos tras redistribuir las capas sin datos. */
  layerWeights: Record<FusionLayer, number>;
  metrics: FavoriteMetrics;
}

export interface RankedFavoritesResult {
  generatedAt: string;
  weights: Record<FusionLayer, number>;
  entries: RankedFavorite[];
  warnings: string[];
}

export interface OutcomeAnalysis {
  outcome: OutcomeKey;
  label: string;
  selectionName: string;
  modelProbability: number;
  /** Origen dominante de la probabilidad final. */
  probabilitySource: "modelo" | "mercado" | "analista";
  /** Desglose trazable de la probabilidad final. */
  blend: { model: number; market: number; analyst: number; weights: string };
  /** Implícita raw (observable) y desvigada (comparable con `modelProbability`). */
  impliedProbability: number;
  impliedDevig: number;
  fairOdds: number;
  bestOdds: number | null;
  averageOdds: number | null;
  expectedValue: number;
  /** p_modelo - impliedDevig: métrica canónica de valor. */
  edge: number;
  /** p_modelo - 1/bestOdds: métrica observable, no usada para ranking. */
  edgeVsMarket: number;
  qualifies: boolean;
  /** El resultado corresponde al favorito de mercado del partido. */
  isFavorite: boolean;
  /** Favorito (o selección fuerte) con cuota alta y valor esperado positivo. */
  isHembra: boolean;
  /** Evaluación del KPI cuantitativo de favorito con cuota alta. */
  valueFavorite: ValueFavoriteScore | null;
  bookmaker: string | null;
}

export interface MatchAnalysis {
  matchId: string;
  probabilities: Record<OutcomeKey, number>;
  picks: OutcomeAnalysis[];
  topPick: OutcomeAnalysis | null;
  /** 0-1 de fiabilidad de la probabilidad (señal no-mercado disponible). */
  confidence: number;
  projectedHome: number;
  projectedAway: number;
  injuryDrag: {
    home: number;
    away: number;
  };
}

export interface ValuePick {
  id: string;
  match: SportsMatch;
  analysis: OutcomeAnalysis;
  matchAnalysis: MatchAnalysis;
}

export interface AnalyzerOptions {
  minProbability?: number;
  minOdds?: number;
  /** Edge mínimo sobre la implícita DESVIGADA. */
  minEdge?: number;
  /** Instante de referencia compartido por toda la request (VET). */
  now?: Date;
  /** Ventana a analizar; "all" respeta la ventana del dashboard sin filtrar. */
  day?: MatchDay | "all";
  /** Peso de la probabilidad editorial de The Analyst frente al modelo propio. */
  analystWeight?: number;
}
