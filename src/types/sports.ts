export type SportKey = "soccer" | "basketball" | "baseball" | "hockey";

export type SportFilter = "all" | SportKey;

export type FormResult = "W" | "D" | "L";

export type InjuryImpact = "high" | "medium" | "low";

export type DataMode = "mock" | "live" | "hybrid";

export type OddsSource =
  | "the-odds-api"
  | "sportmonks"
  | "api-sports"
  | "flashscore"
  | "triunfobet"
  | "apuestas-royal"
  | "mock";

export type OutcomeKey = "home" | "draw" | "away";

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
  name: string;
  shortName: string;
  country: string;
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
}

export interface Injury {
  id: string;
  teamId: string;
  player: string;
  position: string;
  status: string;
  reason: string;
  impact: InjuryImpact;
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
  note?: string;
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
}

export interface MarketSummary {
  best: OutcomePrices;
  average: OutcomePrices;
  spreadPercent: OutcomePrices;
  /** Probabilidad consenso del mercado, normalizada sin margen (overround). */
  consensus: Record<OutcomeKey, number>;
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
  /** Equipo con la cuota 1X2 más baja (favorito según el mercado). */
  favoriteSide?: "home" | "away" | null;
}

export interface ApiSourceStatus {
  oddsApi: boolean;
  sportmonks: boolean;
  apiSports: boolean;
  flashscore?: boolean;
  triunfobet?: boolean;
  apuestasRoyal?: boolean;
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
}

export interface DashboardData {
  matches: SportsMatch[];
  leagues: LeagueInfo[];
  meta: DashboardMeta;
  sportCounts: Record<SportKey, number>;
  /** Conteo de partidos pre-match por ventana operativa (hoy / mañana). */
  dayCounts: Record<MatchDay, number>;
}

export interface OutcomeAnalysis {
  outcome: OutcomeKey;
  label: string;
  selectionName: string;
  modelProbability: number;
  /** Origen de la probabilidad: modelo propio o consenso de mercado sin margen. */
  probabilitySource: "modelo" | "mercado";
  impliedProbability: number;
  fairOdds: number;
  bestOdds: number | null;
  averageOdds: number | null;
  expectedValue: number;
  edge: number;
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
}
