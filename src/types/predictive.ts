/**
 * Types for the predictive analytics layer.
 * Defines structures for value bets, confidence scores, market analysis,
 * and the enhanced dashboard analytics.
 */

import type {
  DashboardData,
  LeagueInfo,
  MatchDay,
  MatchIntel,
  OutcomeKey,
  OutcomePrices,
  OutcomeAnalysis,
  SportKey,
  SportsMatch,
  TeamRef,
  ValueFavoriteScore,
  VenueSplit,
} from "@/types/sports";

/** Implied probabilities after vig removal per bookmaker. */
export interface BookmakerRisk {
  name: string;
  source: string;
  /** Implied probability of each outcome. */
  implied: Record<OutcomeKey, number>;
  /** Adjusted fair odds after removing vig. */
  fairOdds: Record<OutcomeKey, number>;
  /** Historical reliability score 0-1. */
  reliability: number;
}

/** Market-level analysis: best odds, implied probabilities, value gaps. */
export interface MarketAnalysis {
  matchId: string;
  /** Best decimal odds available per outcome across all sources. */
  bestOdds: Record<OutcomeKey, number>;
  /** Minimum implied probability (theoretical best). */
  bestImpliedProb: Record<OutcomeKey, number>;
  /** Spread between best and average price as %. */
  valueSpreadPct: Record<OutcomeKey, number>;
  /** Number of sources offering each outcome. */
  sourceCount: Record<OutcomeKey, number>;
  /** Top 3 sources by odds for each outcome. */
  sourcesByOutcome: Record<OutcomeKey, Array<{ name: string; price: number; source: string }>>;
  /** Per-outcome risk level: 'safe' | 'moderate' | 'high'. */
  riskLevel: Record<OutcomeKey, "safe" | "moderate" | "high">;
}

/** Player-specific advanced statistics used for model weighting. */
export interface PlayerAdvancedStats {
  playerId: string;
  name: string;
  team: "home" | "away";
  position: string;
  height: string;
  weight: string;
  appearances: number;
  goals: number;
  assists: number;
  assistsAvg: number;
  goalsAvg: number;
  xGoals: number;
  xGoalsConceded: number;
  defensiveActionsPerGame: number;
  passesPerGame: number;
  disposalsPerGame: number;
  shotsDiff: number;
  formScore: number;
}

/** Historical head-to-head statistics. */
export interface HeadToHeadStats {
  homeGames: number;
  awayGames: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  lastEncounterTime: Date | null;
  recentForm: string[];
}

/** Combined predictive snapshot for a match + outcome. */
export interface PredictiveSnapshot {
  /** Unique ID: matchId-outcome */
  id: string;
  /** Match identifier. */
  matchId: string;
  /** Outcome analyzed. */
  outcome: OutcomeKey;
  /** Model probability from team statistics (0-1). */
  modelProbability: number;
  /** Implied probability from market (vig-removed) (0-1). */
  impliedProbability: number;
  /** Best available odds (0). */
  bestOdds: number;
  /** Fair odds calculated (1/modelProbability) (0). */
  fairOdds: number;
  /** Expected value = impliedProb - modelProb (0). */
  expectedValue: number;
  /** Value spread (odds - fair odds) as %. */
  valueSpreadPct: number;
  /** Consensus from team + market (0-1). */
  consensusProbability: number;
  /** True consensus from market sources with robust weights. */
  consensusMarketProbability: number;
  /** Best available price for this outcome across books. */
  bestPrice: number;
  /** Probability if we trust team stats more (0-1). */
  teamWeightedProbability: number;
  /** Probability if we trust market consensus (0-1). */
  marketConsensusProbability: number;
  /** Historical head-to-head based probability (0-1). */
  h2hProbability: number;
  /** Weighted average of all probability sources (0-1). */
  weightedProbability: number;
  /** Final estimated probability (0-1). */
  estimatedProbability: number;
  /** Confidence level of the estimate: "high" | "medium" | "low". */
  confidence: "high" | "medium" | "low";
  /** Confidence score 0-100. */
  confidenceScore: number;
  /** Recommendation: "BUY" | "PASS" | "NOT_BET". */
  recommendation: "BUY" | "PASS" | "NOT_BET";
  /** Why this outcome is recommended or rejected. */
  rationale: string;
}

/** Market analysis summary for a match. */
export interface MatchMarketAnalysis {
  matchId: string;
  analysis: MarketAnalysis;
  /** Value Bet: EV > 0 (high confidence or high odds). */
  valueBet: boolean;
  /** Flag for Hembra: high-odds favorite with positive EV. */
  isHembra: boolean;
  /** Value EV threshold used (0.10 = 10% value). */
  minEV: number;
  /** Match risk level. */
  riskLevel: "low" | "medium" | "high";
  /** Bookmaker synergy opportunity description. */
  bookmakerSynergy: string;
}

/** Enhanced dashboard analytics structure. */
export interface DashboardAnalytics {
  /** Original dashboard data. */
  data: DashboardData;
  /** Predictive snapshots per match-outcome. */
  snapshots: PredictiveSnapshot[];
  /** Market analyses per match. */
  matchMarkets: MatchMarketAnalysis[];
  /** Generated at timestamp. */
  generatedAt: Date;
  /** Stats for this analytics run. */
  stats: {
    totalMatches: number;
    totalValueBets: number;
    highConfidenceCount: number;
    avgEV: number;
    topRecommendations: Array<{
      match: SportsMatch;
      outcome: OutcomeKey;
      snapshot: PredictiveSnapshot;
      recommendation: "BUY" | "PASS" | "NOT_BET";
      rationale: string;
    }>;
  };
}
