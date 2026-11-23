/**
 * Motor de Análisis Predictivo para Matches (PredictiveEngine).
 * 
 * Calcula:
 * 1. Probabilidades implícitas de mercado
 * 2. Diferenciales de valor (Value Bets)
 * 3. Niveles de confianza y probabilidad estimada del favorito
 * 4. Recomendaciones de BUY/PASS/NOT_BET
 */

import type {
  SportsMatch,
  OutcomeKey,
  OutcomePrices,
  OutcomeAnalysis,
  MatchIntel,
} from "@/types/sports";

import type {
  PredictiveSnapshot,
  MarketAnalysis,
} from "@/types/predictive";

import {
  analyzeMatch,
  impliedProbability,
  expectedValue as calculateEV,
} from "@/lib/bettingAnalyzer";

import { clamp, round } from "@/lib/utils";
import { matchDayVET, resolveMatchStatus } from "@/lib/format";

// --- Constants ---

const VALUE_BET_THRESHOLD = 0.05; // 5% EV mínimo
const HIGH_CONFIDENCE_THRESHOLD = 65;
const LOW_CONFIDENCE_THRESHOLD = 35;

// --- Market Analysis ---

function calculateMarketAnalysis(match: SportsMatch): MarketAnalysis {
  const odds = match.odds;
  
  // Best odds por resultado
  const bestOdds: Record<OutcomeKey, number> = {
    home: odds.best.home || 0,
    draw: odds.best.draw || 0,
    away: odds.best.away || 0,
  };
  
  // Best implied probs (teórica, 1/bestOdds)
  const bestImplied: Record<OutcomeKey, number> = {
    home: bestOdds.home > 1 ? 1 / bestOdds.home : 0,
    draw: bestOdds.draw > 1 ? 1 / bestOdds.draw : 0,
    away: bestOdds.away > 1 ? 1 / bestOdds.away : 0,
  };
  
  // Spread = mejor precio vs promedio
  const valueSpreadPct: Record<OutcomeKey, number> = {
    home: bestOdds.home > 0 && odds.average.home > 0 ? ((bestOdds.home - odds.average.home) / odds.average.home) * 100 : 0,
    draw: bestOdds.draw && odds.average.draw ? ((bestOdds.draw - odds.average.draw) / odds.average.draw) * 100 : 0,
    away: bestOdds.away > 0 && odds.average.away > 0 ? ((bestOdds.away - odds.average.away) / odds.average.away) * 100 : 0,
  };
  
  // Source count
  const sourceCount: Record<OutcomeKey, number> = { home: 0, draw: 0, away: 0 };
  const sourcesByOutcome: Record<OutcomeKey, Array<{ name: string; price: number; source: string }>> = { home: [], draw: [], away: [] };
  
  for (const bookmaker of odds.bookmakers) {
    if (bookmaker.outcomes.home > 1) {
      sourceCount.home++;
      sourcesByOutcome.home.push({ name: bookmaker.name, price: bookmaker.outcomes.home, source: bookmaker.source });
    }
    if (bookmaker.outcomes.draw !== null && bookmaker.outcomes.draw > 1) {
      sourceCount.draw++;
      sourcesByOutcome.draw.push({ name: bookmaker.name, price: bookmaker.outcomes.draw, source: bookmaker.source });
    }
    if (bookmaker.outcomes.away > 1) {
      sourceCount.away++;
      sourcesByOutcome.away.push({ name: bookmaker.name, price: bookmaker.outcomes.away, source: bookmaker.source });
    }
  }
  
  // Risk level por resultado
  const riskLevel: Record<OutcomeKey, "safe" | "moderate" | "high"> = { home: "safe", draw: "safe", away: "safe" };
  for (const key of ["home", "draw", "away"] as OutcomeKey[]) {
    if (sourceCount[key] <= 1) riskLevel[key] = "high";
    else if (sourceCount[key] <= 2) riskLevel[key] = "moderate";
    else riskLevel[key] = "safe";
  }
  
  return {
    matchId: match.id,
    bestOdds,
    bestImpliedProb: bestImplied,
    valueSpreadPct,
    sourceCount,
    sourcesByOutcome,
    riskLevel,
  };
}

// --- Predictive Snapshot ---

function generateRationale(analysis: OutcomeAnalysis, ev: number, confidence: "high" | "medium" | "low"): string {
  const parts: string[] = [];
  
  if (ev > 0.05 && confidence === "high") {
    parts.push(`Valor positivo en mercado (+${Math.round(ev * 100)}%)`);
  } else if (ev < -0.03) {
    parts.push("Precio inferior a valor esperado");
  }
  
  return parts.length > 0 ? parts.join(", ") : "Sin factores de alerta - modelo estable";
}

function calculateRiskFactor(match: SportsMatch): number {
  let injuryImpact = 0;
  for (const injury of match.intel.injuries.home) {
    if (injury.impact === "high") injuryImpact += 0.3;
    else if (injury.impact === "medium") injuryImpact += 0.15;
  }
  for (const injury of match.intel.injuries.away) {
    if (injury.impact === "high") injuryImpact += 0.3;
    else if (injury.impact === "medium") injuryImpact += 0.15;
  }
  return Math.min(1, injuryImpact);
}

export function computePredictiveSnapshots(match: SportsMatch): PredictiveSnapshot[] {
  const analysis = analyzeMatch(match);
  const market = calculateMarketAnalysis(match);
  
  const injuryImpact = calculateRiskFactor(match);
  const dataAvailability = (match.intel.stats.home.avgScored > 0 && match.intel.stats.away.avgScored > 0) ? 0.9 : 0.5;
  
  const snapshots: PredictiveSnapshot[] = [];
  
  for (const pick of analysis.picks) {
    if (!pick.isFavorite) continue;
    
    const modelProb = clamp(pick.modelProbability, 0, 1);
    const impliedProb = clamp(pick.impliedProbability, 0, 1);
    const bestOdds = pick.bestOdds || 0;
    
    const fairOdds = modelProb > 0 ? 1 / modelProb : 0;
    const expectedValue = impliedProb - modelProb;
    
    const isValueBet = expectedValue >= VALUE_BET_THRESHOLD;
    
    let confidenceScore = 0;
    let confidence: "high" | "medium" | "low" = "medium";
    
    const evFactor = Math.min(1, Math.max(0, expectedValue * 3));
    const agreementFactor = Math.min(1, Math.max(0, Math.abs(modelProb - impliedProb) * 2));
    const dataFactor = dataAvailability;
    const injuryFactor = 1 - injuryImpact;
    
    confidenceScore = Math.round((evFactor * 0.3 + agreementFactor * 0.3 + dataFactor * 0.2 + injuryFactor * 0.2) * 100);
    
    if (confidenceScore >= HIGH_CONFIDENCE_THRESHOLD) confidence = "high";
    else if (confidenceScore <= LOW_CONFIDENCE_THRESHOLD) confidence = "low";
    
    let recommendation: "BUY" | "PASS" | "NOT_BET";
    if (isValueBet && confidence === "high") {
      recommendation = "BUY";
    } else if (confidence === "low" && expectedValue < 0.02) {
      recommendation = "NOT_BET";
    } else {
      recommendation = "PASS";
    }
    
    const isHembra = isValueBet && confidence === "high";
    
    snapshots.push({
      id: `${match.id}-${pick.outcome}`,
      matchId: match.id,
      outcome: pick.outcome,
      modelProbability: modelProb,
      impliedProbability: impliedProb,
      bestOdds,
      fairOdds,
      expectedValue: round(expectedValue, 4),
      valueSpreadPct: Math.round(((bestOdds - fairOdds) / fairOdds) * 100),
      consensusProbability: impliedProb,
      consensusMarketProbability: impliedProb,
      bestPrice: bestOdds,
      teamWeightedProbability: modelProb,
      marketConsensusProbability: impliedProb,
      h2hProbability: modelProb,
      weightedProbability: (modelProb + impliedProb) / 2,
      estimatedProbability: modelProb,
      confidence,
      confidenceScore,
      recommendation,
      rationale: generateRationale(pick, expectedValue, confidence),
    });
  }
  
  return snapshots;
}

export function computeMarketAnalyses(matches: SportsMatch[]): MarketAnalysis[] {
  return matches.map((match) => calculateMarketAnalysis(match));
}

export function computeRiskAssessments(matches: SportsMatch[]): Array<{ confidence: "high" | "medium" | "low" }> {
  return matches.map((match) => {
    const injuryImpact = calculateRiskFactor(match);
    const dataAvailability = (match.intel.stats.home.avgScored > 0 && match.intel.stats.away.avgScored > 0) ? 0.9 : 0.5;
    
    let confidence: "high" | "medium" | "low" = "medium";
    const dataFactor = dataAvailability;
    const injuryFactor = 1 - injuryImpact;
    const confidenceScore = Math.round((dataFactor * 0.3 + injuryFactor * 0.3 + 0.4) * 100);
    
    if (confidenceScore >= HIGH_CONFIDENCE_THRESHOLD) confidence = "high";
    else if (confidenceScore <= LOW_CONFIDENCE_THRESHOLD) confidence = "low";
    
    return { confidence };
  });
}

export function filterSnapshotsByConfidence(snapshots: PredictiveSnapshot[], minConfidence: number): PredictiveSnapshot[] {
  return snapshots.filter(s => s.confidenceScore >= minConfidence);
}

export function filterValueBets(snapshots: PredictiveSnapshot[], minEV: number = 0.03): PredictiveSnapshot[] {
  return snapshots.filter(s => s.expectedValue >= minEV);
}

export function sortSnapshotsByEV(snapshots: PredictiveSnapshot[], direction: "asc" | "desc" = "desc"): PredictiveSnapshot[] {
  return [...snapshots].sort((a, b) => direction === "desc" ? b.expectedValue - a.expectedValue : a.expectedValue - b.expectedValue);
}

export function getTopValueBets(snapshots: PredictiveSnapshot[], count: number = 10): PredictiveSnapshot[] {
  return snapshots.filter(s => s.expectedValue > 0.05)
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, count);
}
