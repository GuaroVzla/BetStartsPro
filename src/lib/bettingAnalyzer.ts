import type {
  AnalyzerOptions,
  FormResult,
  Injury,
  MatchAnalysis,
  OutcomeAnalysis,
  OutcomeKey,
  SportKey,
  SportsMatch,
  TeamAdvancedStats,
  ValuePick,
} from "@/types/sports";
import { clamp, round } from "@/lib/utils";

const DEFAULT_MIN_PROBABILITY = 0.5;
const DEFAULT_MIN_ODDS = 1.6;
/** Umbral reservado al distintivo "Hembra" (cuota realmente alta). */
const HEMBRA_MIN_ODDS = 1.85;

interface SportModelConfig {
  baseline: number;
  shrink: number;
  homeAdvantage: number;
  awayAdjustment: number;
  minProjection: number;
  maxProjection: number;
  spreadScale?: number;
  poisson: boolean;
}

const SPORT_MODELS: Record<SportKey, SportModelConfig> = {
  soccer: {
    baseline: 1.4,
    shrink: 0.62,
    homeAdvantage: 0.16,
    awayAdjustment: -0.04,
    minProjection: 0.25,
    maxProjection: 4.5,
    poisson: true,
  },
  basketball: {
    baseline: 113,
    shrink: 0.4,
    homeAdvantage: 2.7,
    awayAdjustment: -0.5,
    minProjection: 82,
    maxProjection: 142,
    spreadScale: 10.5,
    poisson: false,
  },
  baseball: {
    baseline: 4.4,
    shrink: 0.58,
    homeAdvantage: 0.12,
    awayAdjustment: -0.04,
    minProjection: 1.4,
    maxProjection: 8,
    poisson: true,
  },
  hockey: {
    baseline: 3,
    shrink: 0.55,
    homeAdvantage: 0.14,
    awayAdjustment: -0.03,
    minProjection: 0.8,
    maxProjection: 6.5,
    poisson: true,
  },
};

function formFactor(form: FormResult[]): number {
  if (form.length === 0) return 1;
  const points = form.reduce((total, result) => {
    if (result === "W") return total + 3;
    if (result === "D") return total + 1;
    return total;
  }, 0);
  const rate = points / (form.length * 3);
  return 0.92 + rate * 0.16;
}

function injuryOffenseFactor(injuries: Injury[]): number {
  let factor = 1;
  for (const injury of injuries) {
    if (injury.impact === "high") factor *= 0.93;
    else if (injury.impact === "medium") factor *= 0.97;
    else factor *= 0.99;
  }
  return clamp(factor, 0.75, 1);
}

function positionFactor(position: number, tableSize: number): number {
  const size = Math.max(4, tableSize);
  const normalized = 1 - (clamp(position, 1, size) - 1) / (size - 1);
  return 0.94 + normalized * 0.12;
}

function poissonPmf(k: number, lambda: number): number {
  let factorial = 1;
  for (let index = 2; index <= k; index += 1) factorial *= index;
  return Math.exp(-lambda) * lambda ** k / factorial;
}

function soccerProbabilities(
  homeLambda: number,
  awayLambda: number,
): Record<OutcomeKey, number> {
  let home = 0;
  let draw = 0;
  let away = 0;

  for (let homeGoals = 0; homeGoals <= 10; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 10; awayGoals += 1) {
      const probability =
        poissonPmf(homeGoals, homeLambda) *
        poissonPmf(awayGoals, awayLambda);
      if (homeGoals > awayGoals) home += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else away += probability;
    }
  }

  return normalizeProbabilities({ home, draw, away }, true);
}

function poissonWinProbabilities(
  homeLambda: number,
  awayLambda: number,
): Record<OutcomeKey, number> {
  let home = 0;
  let away = 0;

  for (let homeGoals = 0; homeGoals <= 14; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 14; awayGoals += 1) {
      const probability =
        poissonPmf(homeGoals, homeLambda) *
        poissonPmf(awayGoals, awayLambda);
      if (homeGoals > awayGoals) home += probability;
      else if (homeGoals < awayGoals) away += probability;
      else {
        home += probability / 2;
        away += probability / 2;
      }
    }
  }

  return normalizeProbabilities({ home, draw: 0, away }, false);
}

function basketballProbabilities(
  homeProjection: number,
  awayProjection: number,
  scale: number,
): Record<OutcomeKey, number> {
  const margin = homeProjection - awayProjection;
  const home = 1 / (1 + Math.exp(-margin / scale));
  return normalizeProbabilities({ home, draw: 0, away: 1 - home }, false);
}

function normalizeProbabilities(
  probabilities: Record<OutcomeKey, number>,
  includeDraw: boolean,
): Record<OutcomeKey, number> {
  const safe = {
    home: Math.max(probabilities.home, 0.0001),
    draw: includeDraw ? Math.max(probabilities.draw, 0.0001) : 0,
    away: Math.max(probabilities.away, 0.0001),
  };
  const total = safe.home + safe.draw + safe.away;
  return {
    home: safe.home / total,
    draw: includeDraw ? safe.draw / total : 0,
    away: safe.away / total,
  };
}

function projectScores(
  match: SportsMatch,
): {
  home: number;
  away: number;
  injuryDragHome: number;
  injuryDragAway: number;
} {
  const model = SPORT_MODELS[match.sport];
  const homeStats: TeamAdvancedStats = match.intel.stats.home;
  const awayStats: TeamAdvancedStats = match.intel.stats.away;
  const tableSize = match.intel.standings.table.length;

  const homeInjuryFactor = injuryOffenseFactor(match.intel.injuries.home);
  const awayInjuryFactor = injuryOffenseFactor(match.intel.injuries.away);
  const homeDefenseVulnerability = 1 + (1 - homeInjuryFactor) * 0.15;
  const awayDefenseVulnerability = 1 + (1 - awayInjuryFactor) * 0.15;

  const homeAttack =
    (clamp(homeStats.avgScored, 0.1, model.baseline * 3) / model.baseline) **
      0.75 *
    formFactor(homeStats.form) *
    positionFactor(match.intel.standings.home.position, tableSize) *
    homeInjuryFactor;

  const awayAttack =
    (clamp(awayStats.avgScored, 0.1, model.baseline * 3) / model.baseline) **
      0.75 *
    formFactor(awayStats.form) *
    positionFactor(match.intel.standings.away.position, tableSize) *
    awayInjuryFactor;

  const homeDefense =
    (clamp(awayStats.avgConceded, 0.1, model.baseline * 3) / model.baseline) **
      0.75 *
    awayDefenseVulnerability;

  const awayDefense =
    (clamp(homeStats.avgConceded, 0.1, model.baseline * 3) / model.baseline) **
      0.75 *
    homeDefenseVulnerability;

  const rawHome = model.baseline * homeAttack * homeDefense;
  const rawAway = model.baseline * awayAttack * awayDefense;

  const shrunkHome = model.baseline + (rawHome - model.baseline) * model.shrink;
  const shrunkAway = model.baseline + (rawAway - model.baseline) * model.shrink;

  return {
    home: round(
      clamp(
        shrunkHome + model.homeAdvantage,
        model.minProjection,
        model.maxProjection,
      ),
      2,
    ),
    away: round(
      clamp(
        shrunkAway + model.awayAdjustment,
        model.minProjection,
        model.maxProjection,
      ),
      2,
    ),
    injuryDragHome: round(1 - homeInjuryFactor, 3),
    injuryDragAway: round(1 - awayInjuryFactor, 3),
  };
}

/**
 * Probabilidades implícitas depuradas de margen (overround) a partir de las
 * cuotas observables. Se usan como prior cuando el partido no publica goles a
 * favor/en contra: es información real del mercado, no una estadística inventada.
 */
function marketProbabilities(
  match: SportsMatch,
  useAverage = false,
): Record<OutcomeKey, number> | null {
  const summary = useAverage ? match.odds.average : match.odds.best;
  const prices: Record<OutcomeKey, number | null> = {
    home: summary.home > 1 ? summary.home : null,
    draw: summary.draw,
    away: summary.away > 1 ? summary.away : null,
  };
  const raw: Record<OutcomeKey, number> = {
    home: prices.home ? 1 / prices.home : 0,
    draw: prices.draw && prices.draw > 1 ? 1 / prices.draw : 0,
    away: prices.away ? 1 / prices.away : 0,
  };
  if (raw.home <= 0 && raw.away <= 0) return null;
  return normalizeProbabilities(raw, match.sport === "soccer" && (prices.draw ?? 0) > 1);
}

function hasGoalStatistics(match: SportsMatch): boolean {
  return [match.intel.stats.home, match.intel.stats.away].every(
    (stats) => stats.avgScored > 0 && stats.avgConceded > 0,
  );
}

function availableOutcomes(match: SportsMatch): OutcomeKey[] {
  return match.sport === "soccer" ? ["home", "draw", "away"] : ["home", "away"];
}

function pickLabel(match: SportsMatch, outcome: OutcomeKey): string {
  if (outcome === "draw") return "Empate";
  return outcome === "home" ? match.home.name : match.away.name;
}

function buildOutcomeAnalyses(
  match: SportsMatch,
  probabilities: Record<OutcomeKey, number>,
  options: Required<AnalyzerOptions>,
): OutcomeAnalysis[] {
  return availableOutcomes(match).map((outcome) => {
    const probability = probabilities[outcome];
    const bestOdds = match.odds.best[outcome];
    const averageOdds = match.odds.average[outcome];
    const usableBest = bestOdds !== null && bestOdds > 1 ? bestOdds : null;
    const usableAverage =
      averageOdds !== null && averageOdds > 1 ? averageOdds : null;
    const impliedProbability = usableBest ? 1 / usableBest : 0;
    const expectedValue = usableBest ? probability * usableBest - 1 : 0;
    const bookmaker = usableBest
      ? (match.odds.bookmakers.find(
          (quote) =>
            Math.abs(quote.outcomes[outcome]! - usableBest) < 0.0001,
        )?.name ?? null)
      : null;
    const isFavorite = match.favoriteSide === outcome;
    const isHembra =
      usableBest !== null &&
      usableBest >= HEMBRA_MIN_ODDS &&
      expectedValue > 0 &&
      (isFavorite || probability >= options.minProbability);

    return {
      outcome,
      label:
        outcome === "home"
          ? "Local"
          : outcome === "away"
            ? "Visitante"
            : "Empate",
      selectionName: pickLabel(match, outcome),
      modelProbability: probability,
      probabilitySource: hasGoalStatistics(match) ? "modelo" : "mercado",
      impliedProbability,
      fairOdds: probability > 0 ? 1 / probability : 0,
      bestOdds: usableBest,
      averageOdds: usableAverage,
      expectedValue,
      edge: usableBest ? probability - impliedProbability : 0,
      qualifies:
        probability >= options.minProbability &&
        usableBest !== null &&
        usableBest >= options.minOdds,
      isFavorite,
      isHembra,
      bookmaker,
    };
  });
}

export function analyzeMatch(
  match: SportsMatch,
  options: AnalyzerOptions = {},
): MatchAnalysis {
  const resolvedOptions: Required<AnalyzerOptions> = {
    minProbability: options.minProbability ?? DEFAULT_MIN_PROBABILITY,
    minOdds: options.minOdds ?? DEFAULT_MIN_ODDS,
  };
  const projections = projectScores(match);
  const sportModel = SPORT_MODELS[match.sport];

  let probabilities: Record<OutcomeKey, number>;

  if (match.sport === "basketball") {
    probabilities = basketballProbabilities(
      projections.home,
      projections.away,
      sportModel.spreadScale ?? 10.5,
    );
  } else if (match.sport === "soccer") {
    probabilities = soccerProbabilities(projections.home, projections.away);
  } else {
    probabilities = poissonWinProbabilities(
      projections.home,
      projections.away,
    );
  }

  // Las fuentes sin goles esperados (p. ej. Flashscore) no pueden alimentar el
  // modelo Poisson: usamos el consenso de mercado depurado de margen como
  // probabilidad, que es información observable y no una estadística inventada.
  const consensus = marketProbabilities(match, true);
  if (!hasGoalStatistics(match)) {
    if (consensus) probabilities = consensus;
  } else {
    const market = marketProbabilities(match);
    if (market) {
      const marketWeight = 0.2;
      probabilities = normalizeProbabilities(
        {
          home: probabilities.home * (1 - marketWeight) + market.home * marketWeight,
          draw: probabilities.draw * (1 - marketWeight) + market.draw * marketWeight,
          away: probabilities.away * (1 - marketWeight) + market.away * marketWeight,
        },
        match.sport === "soccer",
      );
    }
  }

  const picks = buildOutcomeAnalyses(match, probabilities, resolvedOptions);
  const topPick = [...picks].sort(
    (a, b) =>
      b.modelProbability - a.modelProbability ||
      b.expectedValue - a.expectedValue,
  )[0] ?? null;

  return {
    matchId: match.id,
    probabilities,
    picks,
    topPick,
    projectedHome: projections.home,
    projectedAway: projections.away,
    injuryDrag: {
      home: projections.injuryDragHome,
      away: projections.injuryDragAway,
    },
  };
}

export function buildValuePicks(
  matches: SportsMatch[],
  options: AnalyzerOptions = {},
): ValuePick[] {
  const resolvedOptions: Required<AnalyzerOptions> = {
    minProbability: options.minProbability ?? DEFAULT_MIN_PROBABILITY,
    minOdds: options.minOdds ?? DEFAULT_MIN_ODDS,
  };

  return matches
    .flatMap((match) => {
      const analysis = analyzeMatch(match, resolvedOptions);
      return analysis.picks
        .filter((pick) => pick.bestOdds !== null)
        .filter(
          (pick) =>
            pick.modelProbability >= resolvedOptions.minProbability &&
            (pick.bestOdds ?? 0) >= resolvedOptions.minOdds &&
            pick.expectedValue > 0,
        )
        .map((pick) => ({
          id: `${match.id}-${pick.outcome}`,
          match,
          analysis: pick,
          matchAnalysis: analysis,
        }));
    })
    .sort((a, b) => b.analysis.expectedValue - a.analysis.expectedValue);
}

export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

export function expectedValue(probability: number, decimalOdds: number): number {
  return probability * decimalOdds - 1;
}

export function fairOdds(probability: number): number {
  if (probability <= 0) return 0;
  return 1 / probability;
}

export function sportHasDraw(sport: SportKey): boolean {
  return sport === "soccer";
}

export function outcomeLabel(match: SportsMatch, outcome: OutcomeKey): string {
  return pickLabel(match, outcome);
}
