import type {
  AnalyzerOptions,
  FormResult,
  Injury,
  MatchAnalysis,
  MatchDay,
  OutcomeAnalysis,
  OutcomeKey,
  SportKey,
  SportsMatch,
  TeamAdvancedStats,
  ValueFavoriteScore,
  ValuePick,
  VenueSplit,
} from "@/types/sports";
import { clamp, round, normalizeName } from "@/lib/utils";
import { isMatchDayVET, resolveMatchStatus } from "@/lib/format";
import { formatInteger } from "@/lib/format";
import { devigProportional } from "@/lib/marketSummary";
import { dixonColesProbabilities, lambdasForMatch } from "@/lib/dixonColes";
import { eloProbabilities, decayRating } from "@/services/ratingService";
import { loadModelArtifact } from "@/services/modelParamsStore";

const DEFAULT_MIN_PROBABILITY = 0.5;
const DEFAULT_MIN_ODDS = 1.6;
const DEFAULT_MIN_EDGE = 0.02;
const DC_ELO_BLEND = { dc: 0.7, elo: 0.3 } as const;

let cachedArtifact: ReturnType<typeof loadModelArtifact> | null = null;
function getModelArtifact() {
  if (!cachedArtifact) cachedArtifact = loadModelArtifact();
  return cachedArtifact;
}

function findTeamKey(
  map: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, candidate)) return candidate;
  }
  const normalizedCandidates = candidates.map((c) => normalizeName(c)).filter(Boolean);
  for (const key of Object.keys(map)) {
    const nk = normalizeName(key);
    if (normalizedCandidates.some((c) => c === nk)) return key;
  }
  return null;
}

function modelProbabilities(
  match: SportsMatch,
): { probabilities: Record<OutcomeKey, number>; source: "modelo"; confidence: number } | null {
  if (match.sport !== "soccer") return null;
  const artifact = getModelArtifact();
  const hasDc =
    Object.keys(artifact.dixonColes.attack).length > 0 &&
    Object.keys(artifact.dixonColes.defense).length > 0;
  const hasElo = Object.keys(artifact.elo).length > 0;
  if (!hasDc && !hasElo) return null;

  const homeCandidates = [match.home.name, match.home.shortName, match.home.id];
  const awayCandidates = [match.away.name, match.away.shortName, match.away.id];
  const includeDraw = hasDrawMarket(match);

  let dc: Record<OutcomeKey, number> | null = null;
  if (hasDc) {
    const homeKey = findTeamKey(artifact.dixonColes.attack, homeCandidates);
    const awayKey = findTeamKey(artifact.dixonColes.attack, awayCandidates);
    if (homeKey && awayKey) {
      const lambdas = lambdasForMatch(artifact.dixonColes, homeKey, awayKey);
      const raw = dixonColesProbabilities(lambdas.homeLambda, lambdas.awayLambda, artifact.dixonColes.params);
      dc = includeDraw ? raw : normalizeProbabilities({ home: raw.home, draw: 0, away: raw.away }, false);
    }
  }

  let elo: Record<OutcomeKey, number> | null = null;
  if (hasElo) {
    const homeKey = findTeamKey(artifact.elo, homeCandidates);
    const awayKey = findTeamKey(artifact.elo, awayCandidates);
    if (homeKey && awayKey) {
      const homeSnap = artifact.elo[homeKey];
      const awaySnap = artifact.elo[awayKey];
      const asOf = match.commenceTime;
      const homeRating = decayRating(homeSnap.rating, homeSnap.lastMatchAt, asOf, artifact.eloConfig);
      const awayRating = decayRating(awaySnap.rating, awaySnap.lastMatchAt, asOf, artifact.eloConfig);
      elo = eloProbabilities(homeRating, awayRating, includeDraw, artifact.eloConfig);
    }
  }

  if (!dc && !elo) return null;
  if (dc && !elo) return { probabilities: dc, source: "modelo", confidence: 0.45 };
  if (!dc && elo) return { probabilities: elo, source: "modelo", confidence: 0.35 };

  const blended = normalizeProbabilities(
    {
      home: dc!.home * DC_ELO_BLEND.dc + elo!.home * DC_ELO_BLEND.elo,
      draw: dc!.draw * DC_ELO_BLEND.dc + elo!.draw * DC_ELO_BLEND.elo,
      away: dc!.away * DC_ELO_BLEND.dc + elo!.away * DC_ELO_BLEND.elo,
    },
    includeDraw,
  );
  return { probabilities: blended, source: "modelo", confidence: 0.6 };
}
/** Umbral reservado al distintivo "Hembra" (cuota realmente alta). */
const HEMBRA_MIN_ODDS = 1.85;
/** Cuota decimal mínima del KPI: 2.00 equivale a cuota americana +100. */
export const VALUE_FAVORITE_MIN_ODDS = 2;
/** Cantidad de partidos recientes para calcular la forma (rate). */
export const VALUE_FAVORITE_FORM_WINDOW = 10;
/** Peso del consenso de mercado (0-1) en la combinación probabilidad-modelo.
 *  0.2 = el modelo propio tiene el 80% y el mercado 20%.
 *  Se usa cuando no hay estadísticas de goles esperados (p. ej. Flashscore). */
export const VALUE_FAVORITE_MARKET_WEIGHT = 0.2;
/** Diferencia mínima de forma reciente (escala 0-1) frente al rival. */
const VALUE_FAVORITE_FORM_GAP = 0.01;
/** Rendimiento positivo en la condición: al menos 50% de los puntos en juego. */
const VALUE_FAVORITE_MIN_VENUE_RATE = 0.5;
/** Ventana operativa del KPI: solo "today" o "tomorrow" (hora Venezuela). */
export const VALUE_FAVORITE_DAY: "today" | "tomorrow" = "today";

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

function hasDrawMarket(match: SportsMatch): boolean {
  return (
    match.sport === "soccer" &&
    ((match.odds.best.draw ?? 0) > 1 ||
      (match.odds.average.draw ?? 0) > 1 ||
      match.odds.consensus.draw > 0)
  );
}

function marketProbabilities(
  match: SportsMatch,
  useAverage = false,
): Record<OutcomeKey, number> | null {
  const includeDraw = hasDrawMarket(match);
  if (useAverage) {
    const consensus = match.odds.consensus;
    if (consensus && consensus.home + consensus.away + consensus.draw > 0) {
      // Ya está desvigado; sólo aseguramos que el draw no se pierda por un bug
      // de criterio de precio en average.
      return normalizeProbabilities(consensus, includeDraw);
    }
  }
  const summary = useAverage ? match.odds.average : match.odds.best;
  const prices = {
    home: summary.home > 1 ? summary.home : null,
    draw: summary.draw !== null && summary.draw > 1 ? summary.draw : null,
    away: summary.away > 1 ? summary.away : null,
  };
  if (!prices.home && !prices.away) return null;
  // Desvigamos con el mismo método que el consenso para comparar manzanas.
  return devigProportional(
    {
      home: prices.home ?? 0,
      draw: prices.draw ?? null,
      away: prices.away ?? 0,
    },
    includeDraw,
  );
}

function hasGoalStatistics(match: SportsMatch): boolean {
  return [match.intel.stats.home, match.intel.stats.away].every(
    (stats) =>
      stats.provenance !== "table-derived" &&
      stats.provenance !== "none" &&
      stats.avgScored > 0 &&
      stats.avgConceded > 0,
  );
}

function availableOutcomes(match: SportsMatch): OutcomeKey[] {
  return match.sport === "soccer" ? ["home", "draw", "away"] : ["home", "away"];
}

function pickLabel(match: SportsMatch, outcome: OutcomeKey): string {
  if (outcome === "draw") return "Empate";
  return outcome === "home" ? match.home.name : match.away.name;
}

/** Favorito canónico: consenso desvigado; la cuota sólo desempata. */
function marketFavorite(match: SportsMatch): "home" | "away" | null {
  const home = match.odds.best.home;
  const away = match.odds.best.away;
  const homeValid = home > 1;
  const awayValid = away > 1;
  if (!homeValid && !awayValid) return null;
  if (!homeValid) return "away";
  if (!awayValid) return "home";

  const consensus = match.odds.consensus;
  if (consensus && Math.abs(consensus.home - consensus.away) > 1e-9) {
    return consensus.home > consensus.away ? "home" : "away";
  }
  if (home !== away) return home < away ? "home" : "away";
  if (match.canonicalFavorite === "home" || match.canonicalFavorite === "away") {
    return match.canonicalFavorite;
  }
  if (match.favoriteSide === "home" || match.favoriteSide === "away") {
    return match.favoriteSide;
  }
  return "home";
}

/** Puntos obtenidos / puntos en juego (0-1) en una racha W-D-L. */
function formPointsRate(form: FormResult[]): number | null {
  if (form.length === 0) return null;
  const recent = form.slice(-VALUE_FAVORITE_FORM_WINDOW);
  const points = recent.reduce((total, result) => {
    if (result === "W") return total + 3;
    if (result === "D") return total + 1;
    return total;
  }, 0);
  return points / (recent.length * 3);
}

/** Puntos obtenidos / puntos en juego (0-1) en la condición local o visitante. */
function venuePointsRate(split: VenueSplit | null): number | null {
  if (!split || split.played <= 0) return null;
  return (split.wins * 3 + split.draws) / (split.played * 3);
}

function recordLabel(split: VenueSplit | null): string {
  if (!split || split.played <= 0) return "sin muestra";
  const parts =
    split.draws > 0
      ? [split.wins, split.draws, split.losses]
      : [split.wins, split.losses];
  return `${parts.join("-")} (${split.played} PJ)`;
}

/**
 * KPI "Favorables con cuota alta (Value Favorites)".
 *
 * Se cumplen simultáneamente:
 * 1. El favorito paga al menos 2.00 decimal (americana +100).
 * 2. Mejor forma reciente que el rival (últimos 10, normalizada).
 * 3. Mejor posición en la tabla general.
 * 4. Rendimiento positivo en su condición (local o visitante).
 *
 * Si falta cualquiera de las tres validaciones estadísticas, el partido no
 * entra en el KPI: no se inventan datos para rellenar el radar.
 */
function evaluateValueFavorite(
  match: SportsMatch,
  outcome: OutcomeKey,
  bestOdds: number | null,
  options: Required<AnalyzerOptions>,
): ValueFavoriteScore | null {
  // Ventana compartida con el dashboard: se usa el mismo `now` para evitar
  // que el servidor y el cliente discrepen al cruzar la medianoche VET.
  if (
    !isMatchDayVET(match.commenceTime, options.day, options.now) ||
    resolveMatchStatus(match, options.now) !== "scheduled"
  ) {
    return null;
  }
  const favorite = marketFavorite(match);
  if (outcome === "draw" || favorite !== outcome) return null;

  const isHome = outcome === "home";
  const favoriteStats = isHome ? match.intel.stats.home : match.intel.stats.away;
  const rivalStats = isHome ? match.intel.stats.away : match.intel.stats.home;
  const favoriteStanding = isHome
    ? match.intel.standings.home
    : match.intel.standings.away;
  const rivalStanding = isHome
    ? match.intel.standings.away
    : match.intel.standings.home;
  const venueRecord = isHome ? favoriteStats.home : favoriteStats.away;

  const favoriteFormRate = formPointsRate(favoriteStats.form.slice(-10));
  const rivalFormRate = formPointsRate(rivalStats.form.slice(-10));
  const venueRate = venuePointsRate(venueRecord);

  const form =
    favoriteFormRate !== null &&
    rivalFormRate !== null &&
    favoriteFormRate >= rivalFormRate + VALUE_FAVORITE_FORM_GAP;

  const standings =
    favoriteStanding.played > 0 &&
    rivalStanding.played > 0 &&
    favoriteStanding.position > 0 &&
    rivalStanding.position > 0 &&
    favoriteStanding.position < rivalStanding.position;

  const venue =
    venueRate !== null &&
    (venueRecord?.played ?? 0) >= 3 &&
    venueRate >= VALUE_FAVORITE_MIN_VENUE_RATE;

  const oddsThresholdMet = bestOdds !== null && bestOdds >= VALUE_FAVORITE_MIN_ODDS;
  const explanation: string[] = [];

  if (favoriteFormRate === null || rivalFormRate === null) {
    explanation.push("Forma reciente insuficiente para comparar.");
  } else {
    explanation.push(
      `Forma ${Math.round(favoriteFormRate * 100)}% vs ${Math.round(rivalFormRate * 100)}%.`,
    );
  }
  if (
    !(favoriteStanding.played > 0) ||
    !(rivalStanding.played > 0) ||
    favoriteStanding.position <= 0 ||
    rivalStanding.position <= 0
  ) {
    explanation.push("Sin posición de tabla válida para ambos equipos.");
  } else {
    explanation.push(
      `Tabla ${favoriteStanding.position}º vs ${rivalStanding.position}º.`,
    );
  }
  explanation.push(
    `${isHome ? "Casa" : "Visita"}: ${recordLabel(venueRecord)}.`,
  );
  explanation.push(
    oddsThresholdMet
      ? `Cuota ${bestOdds?.toFixed(2)} ≥ 2.00 (americana +100).`
      : "Cuota por debajo de 2.00: no cumple el umbral.",
  );

  return {
    qualifies: oddsThresholdMet && form && standings && venue,
    oddsThresholdMet,
    validations: { form, standings, venue },
    favoriteFormRate,
    rivalFormRate,
    favoritePosition:
      favoriteStanding.position > 0 && favoriteStanding.played > 0
        ? favoriteStanding.position
        : null,
    rivalPosition:
      rivalStanding.position > 0 && rivalStanding.played > 0
        ? rivalStanding.position
        : null,
    venueRecord: venueRecord.played > 0 ? venueRecord : null,
    venuePointsRate: venueRate,
    explanation,
  };
}

function blendDescription(
  match: SportsMatch,
  baseModelWeight: number,
  baseMarketWeight: number,
): OutcomeAnalysis["blend"] {
  const hasAnalyst =
    match.analyst?.winProbabilities &&
    (match.analyst.confidence ?? 1) > 0 &&
    Object.values(match.analyst.winProbabilities).some((value) => value > 0);
  const analystWeight = hasAnalyst ? clamp((match.analyst?.confidence ?? 1) * 0.45, 0, 0.8) : 0;
  const nonAnalystWeight = 1 - analystWeight;
  const totalBase = Math.max(0, baseModelWeight) + Math.max(0, baseMarketWeight);
  const safeModel = totalBase > 0 ? Math.max(0, baseModelWeight) / totalBase : 0;
  const safeMarket = totalBase > 0 ? Math.max(0, baseMarketWeight) / totalBase : 1;
  const model = safeModel * nonAnalystWeight;
  const market = safeMarket * nonAnalystWeight;
  const parts: string[] = [];
  if (model > 0.001) parts.push(`modelo ${(model * 100).toFixed(0)}%`);
  if (market > 0.001) parts.push(`mercado ${(market * 100).toFixed(0)}%`);
  if (analystWeight > 0.001) parts.push(`analista ${(analystWeight * 100).toFixed(0)}%`);
  return {
    model,
    market,
    analyst: analystWeight,
    weights: parts.length > 0 ? parts.join(" · ") : "mercado 100%",
  };
}

function buildOutcomeAnalyses(
  match: SportsMatch,
  probabilities: Record<OutcomeKey, number>,
  options: Required<AnalyzerOptions>,
  blend: OutcomeAnalysis["blend"],
): OutcomeAnalysis[] {
  const includeDraw = hasDrawMarket(match);
  const impliedDevigByOutcome = devigProportional(
    {
      home: match.odds.best.home > 1 ? match.odds.best.home : 0,
      draw: match.odds.best.draw !== null && match.odds.best.draw > 1 ? match.odds.best.draw : null,
      away: match.odds.best.away > 1 ? match.odds.best.away : 0,
    },
    includeDraw,
  );
  // blend provided by analyzeMatch

  return availableOutcomes(match).map((outcome) => {
    const probability = probabilities[outcome];
    const bestOdds = match.odds.best[outcome];
    const averageOdds = match.odds.average[outcome];
    const usableBest = bestOdds !== null && bestOdds > 1 ? bestOdds : null;
    const usableAverage =
      averageOdds !== null && averageOdds > 1 ? averageOdds : null;
    const impliedProbability = usableBest ? 1 / usableBest : 0;
    const impliedDevig = impliedDevigByOutcome[outcome] ?? 0;
    const expectedValue = usableBest ? probability * usableBest - 1 : 0;
    const edge = probability - impliedDevig;
    const edgeVsMarket = usableBest ? probability - impliedProbability : 0;
    const bookmaker = usableBest
      ? (match.odds.bookmakers.find(
          (quote) =>
            Math.abs(quote.outcomes[outcome]! - usableBest) < 0.0001,
        )?.name ?? null)
      : null;
    const isFavorite = marketFavorite(match) === outcome;
    const qualifies =
      probability >= options.minProbability &&
      usableBest !== null &&
      usableBest >= options.minOdds &&
      edge >= options.minEdge &&
      expectedValue > 0;
    const isHembra =
      usableBest !== null &&
      usableBest >= HEMBRA_MIN_ODDS &&
      expectedValue > 0 &&
      edge >= options.minEdge &&
      (isFavorite || probability >= options.minProbability);
    const valueFavorite = isFavorite
      ? evaluateValueFavorite(match, outcome, usableBest, options)
      : null;

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
      probabilitySource: blend.analyst > blend.market && blend.analyst > blend.model
        ? "analista"
        : blend.model > 0
          ? "modelo"
          : "mercado",
      blend,
      impliedProbability,
      impliedDevig,
      fairOdds: probability > 0 ? 1 / probability : 0,
      bestOdds: usableBest,
      averageOdds: usableAverage,
      expectedValue,
      edge,
      edgeVsMarket,
      qualifies,
      isFavorite,
      isHembra,
      valueFavorite,
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
    minEdge: options.minEdge ?? DEFAULT_MIN_EDGE,
    now: options.now ?? new Date(),
    day: options.day ?? "all",
    analystWeight: options.analystWeight ?? 0.45,
  };
  const projections = projectScores(match);
  const sportModel = SPORT_MODELS[match.sport];
  const hasDraw = hasDrawMarket(match);

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
    probabilities = poissonWinProbabilities(projections.home, projections.away);
  }

  const hasGoals = hasGoalStatistics(match);
  const historicalModel = modelProbabilities(match);
  const consensus = marketProbabilities(match, true);
  let confidence = 0.2;
  let modelBlendWeight = hasGoals ? 1 - VALUE_FAVORITE_MARKET_WEIGHT : 0;
  let marketBlendWeight = hasGoals ? VALUE_FAVORITE_MARKET_WEIGHT : 1;

  if (historicalModel) {
    probabilities = historicalModel.probabilities;
    confidence = historicalModel.confidence;
    modelBlendWeight = 1;
    marketBlendWeight = 0;
    const market = marketProbabilities(match);
    if (market) {
      // Historical model is currently weaker than market baseline; keep it as a small signal.
      const marketWeight = 0.85;
      probabilities = normalizeProbabilities(
        {
          home: probabilities.home * (1 - marketWeight) + market.home * marketWeight,
          draw: probabilities.draw * (1 - marketWeight) + market.draw * marketWeight,
          away: probabilities.away * (1 - marketWeight) + market.away * marketWeight,
        },
        hasDraw,
      );
      modelBlendWeight = 1 - marketWeight;
      marketBlendWeight = marketWeight;
      confidence = Math.max(confidence, 0.45);
    }
  } else if (!hasGoals) {
    if (consensus) probabilities = consensus;
    confidence = 0.15;
    modelBlendWeight = 0;
    marketBlendWeight = 1;
  } else {
    const market = marketProbabilities(match);
    if (market) {
      const marketWeight = VALUE_FAVORITE_MARKET_WEIGHT;
      probabilities = normalizeProbabilities(
        {
          home: probabilities.home * (1 - marketWeight) + market.home * marketWeight,
          draw: probabilities.draw * (1 - marketWeight) + market.draw * marketWeight,
          away: probabilities.away * (1 - marketWeight) + market.away * marketWeight,
        },
        hasDraw,
      );
      confidence = 0.55;
      modelBlendWeight = 1 - marketWeight;
      marketBlendWeight = marketWeight;
    } else {
      confidence = 0.45;
      modelBlendWeight = 1;
      marketBlendWeight = 0;
    }
  }

  const analystProbabilities = match.analyst?.winProbabilities;
  const analystConfidence = clamp(match.analyst?.confidence ?? 1, 0, 1);
  if (
    analystProbabilities &&
    Object.values(analystProbabilities).some((value) => value > 0) &&
    resolvedOptions.analystWeight > 0 &&
    analystConfidence > 0
  ) {
    const weight = clamp(resolvedOptions.analystWeight * analystConfidence, 0, 0.8);
    probabilities = normalizeProbabilities(
      {
        home:
          probabilities.home * (1 - weight) + analystProbabilities.home * weight,
        draw:
          probabilities.draw * (1 - weight) + (analystProbabilities.draw ?? 0) * weight,
        away:
          probabilities.away * (1 - weight) + analystProbabilities.away * weight,
      },
      hasDraw,
    );
    confidence = Math.max(confidence, 0.35 + weight * 0.6);
  }
  const blend = blendDescription(match, modelBlendWeight, marketBlendWeight);

  const picks = buildOutcomeAnalyses(match, probabilities, resolvedOptions, blend);
  const topPick = [...picks].sort(
    (a, b) =>
      b.expectedValue - a.expectedValue ||
      b.edge - a.edge ||
      b.modelProbability - a.modelProbability,
  )[0] ?? null;

  return {
    matchId: match.id,
    probabilities,
    picks,
    topPick,
    confidence: round(confidence, 3),
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
    minEdge: options.minEdge ?? DEFAULT_MIN_EDGE,
    now: options.now ?? new Date(),
    day: options.day ?? "all",
    analystWeight: options.analystWeight ?? 0.45,
  };

  return matches
    .filter((match) =>
      isMatchDayVET(match.commenceTime, resolvedOptions.day, resolvedOptions.now),
    )
    .flatMap((match) => {
      const analysis = analyzeMatch(match, resolvedOptions);
      return analysis.picks
        .filter((pick) => pick.qualifies)
        .map((pick) => ({
          id: `${match.id}-${pick.outcome}`,
          match,
          analysis: pick,
          matchAnalysis: analysis,
        }));
    })
    .sort(
      (a, b) =>
        b.analysis.expectedValue - a.analysis.expectedValue ||
        b.analysis.edge - a.analysis.edge ||
        b.analysis.modelProbability - a.analysis.modelProbability,
    );
}

/**
 * Radar "Favorables con cuota alta (Value Favorites)": solo favoritos con
 * cuota decimal >= 2.00 que además superan las tres validaciones
 * estadísticas obligatorias. No se relajan umbrales para llenar la vista.
 */
export function buildValueFavoritePicks(
  matches: SportsMatch[],
  day: MatchDay | "all" = "all",
  options: AnalyzerOptions = {},
): ValuePick[] {
  const resolvedOptions: Required<AnalyzerOptions> = {
    minProbability: options.minProbability ?? DEFAULT_MIN_PROBABILITY,
    minOdds: options.minOdds ?? DEFAULT_MIN_ODDS,
    minEdge: options.minEdge ?? DEFAULT_MIN_EDGE,
    now: options.now ?? new Date(),
    day: options.day ?? day,
    analystWeight: options.analystWeight ?? 0.45,
  };

  // Misma ventana que el dashboard: hoy y/o mañana en VET, siempre pre-match.
  const filteredMatches = matches.filter(
    (match) =>
      isMatchDayVET(match.commenceTime, resolvedOptions.day, resolvedOptions.now) &&
      resolveMatchStatus(match, resolvedOptions.now) === "scheduled",
  );

  return filteredMatches
    .flatMap((match) => {
      const analysis = analyzeMatch(match, resolvedOptions);
      return analysis.picks
        .filter(
          (pick) =>
            pick.isFavorite &&
            pick.bestOdds !== null &&
            pick.bestOdds >= VALUE_FAVORITE_MIN_ODDS &&
            pick.valueFavorite?.qualifies === true &&
            pick.expectedValue > 0 &&
            pick.edge >= DEFAULT_MIN_EDGE,
        )
        .map((pick) => ({
          id: `${match.id}-${pick.outcome}`,
          match,
          analysis: pick,
          matchAnalysis: analysis,
        }));
    })
    .sort(
      (a, b) =>
        b.analysis.expectedValue - a.analysis.expectedValue ||
        b.analysis.edge - a.analysis.edge ||
        (b.analysis.bestOdds ?? 0) - (a.analysis.bestOdds ?? 0),
    );
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
