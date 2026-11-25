/**
 * Motor de fusión estadística (puro, sin IO).
 *
 * Recibe señales ya normalizadas por adapters y calcula una probabilidad real
 * con seis capas ponderadas. Si una capa no tiene datos reales, su peso se
 * redistribuye proporcionalmente entre las capas vivas:
 *
 *   w'_i = (w_i · r_i) / Σ_j (w_j · r_j)
 *
 * `r_i` es 1 (completa), 0.5 (parcial) o 0 (sin datos / fuente caída).
 * Nunca se rellena un dato ausente con un valor inventado: la neutralidad se
 * usa solo como prior modelo y se declara en `confidence` / `metrics`.
 */
import type {
  DataSourceId,
  FavoriteMetrics,
  FormResult,
  FusionLayer,
  OutcomeKey,
  RankedFavorite,
  RankedFavoritesResult,
  SportsMatch,
  SourceHealthSnapshot,
  VenueSplit,
} from "../types/sports.ts";
import { clamp, round } from "./utils.ts";

// El tipo público de entrada vive aquí para que el módulo sea importable desde
// tests sin depender de servicios con alias de bundler.
export interface ModelSignal {
  probabilities: Record<OutcomeKey, number>;
  confidence: number;
  source: "modelo";
}

export interface MatchFusionInput {
  match: SportsMatch;
  modelSignal: ModelSignal | null;
  sourceHealth?: Record<DataSourceId, SourceHealthSnapshot>;
}

export interface RankOptions {
  now?: Date;
  minEdge?: number;
  minOdds?: number;
  maxEntries?: number;
  extraWarnings?: string[];
}

export const FUSION_LAYER_WEIGHTS: Record<FusionLayer, number> = {
  market: 0.45,
  model: 0.2,
  form: 0.15,
  standings: 0.1,
  venueH2h: 0.06,
  editorial: 0.04,
};

const LAYER_KEYS = Object.keys(FUSION_LAYER_WEIGHTS) as FusionLayer[];
const HOME_ADVANTAGE: Record<SportsMatch["sport"], number> = {
  soccer: 0.07,
  basketball: 0.04,
  baseball: 0.03,
  hockey: 0.035,
};
const EXPECTED_SOURCES = 6;
const MIN_EDGE_DEFAULT = 0.02;
const MIN_ODDS_DEFAULT = 1.5;

interface LayerSignal {
  key: FusionLayer;
  reliability: number;
  probabilities: Record<OutcomeKey, number>;
  sources: DataSourceId[];
}

interface EffectiveLayer extends LayerSignal {
  effective: number;
}

function probabilitySum(probabilities: Record<OutcomeKey, number>): number {
  return probabilities.home + probabilities.draw + probabilities.away;
}

function normalize(
  home: number,
  draw: number,
  away: number,
  includeDraw: boolean,
): Record<OutcomeKey, number> {
  const safeHome = Math.max(0, home);
  const safeDraw = includeDraw ? Math.max(0, draw) : 0;
  const safeAway = Math.max(0, away);
  const total = safeHome + safeDraw + safeAway;
  if (total <= 0) return { home: 0, draw: 0, away: 0 };
  return {
    home: safeHome / total,
    draw: safeDraw / total,
    away: safeAway / total,
  };
}

function formRate(form: FormResult[]): number | null {
  if (form.length === 0) return null;
  const recent = form.slice(-10);
  const points = recent.reduce(
    (total, result) => total + (result === "W" ? 3 : result === "D" ? 1 : 0),
    0,
  );
  return points / (recent.length * 3);
}

function positive(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function venueRate(split: VenueSplit): number | null {
  if (split.played <= 0) return null;
  return (split.wins * 3 + split.draws) / (split.played * 3);
}

function uniqueSources(values: Array<DataSourceId | undefined>): DataSourceId[] {
  return Array.from(new Set(values.filter((value): value is DataSourceId => Boolean(value))));
}

/** Una fuente con circuito abierto deja de respaldar la capa en esta request. */
function healthFactor(
  sources: DataSourceId[],
  health?: Record<DataSourceId, SourceHealthSnapshot>,
): number {
  if (!health) return 1;
  const observed = sources
    .map((source) => health[source])
    .filter((snapshot): snapshot is SourceHealthSnapshot => Boolean(snapshot));
  if (observed.length === 0) return 1;
  const healthy = observed.filter((snapshot) => snapshot.ok).length;
  if (healthy === 0) return 0;
  return healthy / observed.length;
}

function outcomeSignal(
  homeShare: number,
  includeDraw: boolean,
  drawBase: number,
): Record<OutcomeKey, number> {
  const share = clamp(homeShare, 0.05, 0.95);
  const draw = includeDraw ? clamp(drawBase, 0, 0.4) : 0;
  return normalize(share * (1 - draw), draw, (1 - share) * (1 - draw), includeDraw);
}

function marketLayer(
  match: SportsMatch,
  health?: Record<DataSourceId, SourceHealthSnapshot>,
): LayerSignal | null {
  const bookmakers = match.odds.bookmakers ?? [];
  if (bookmakers.length === 0 || probabilitySum(match.odds.consensus) <= 0) return null;
  const includeDraw = match.sport === "soccer";
  const sources = uniqueSources(bookmakers.map((quote) => quote.source));
  const depth =
    bookmakers.length >= 4 ? 1 : bookmakers.length === 3 ? 0.85 : bookmakers.length === 2 ? 0.7 : 0.5;
  return {
    key: "market",
    reliability: depth * healthFactor(sources, health),
    probabilities: normalize(
      match.odds.consensus.home,
      match.odds.consensus.draw,
      match.odds.consensus.away,
      includeDraw,
    ),
    sources,
  };
}

function modelLayer(match: SportsMatch, input: MatchFusionInput): LayerSignal | null {
  const signal = input.modelSignal;
  if (!signal || probabilitySum(signal.probabilities) <= 0) return null;
  return {
    key: "model",
    reliability: clamp(signal.confidence, 0, 1) * healthFactor(["modelo"], input.sourceHealth),
    probabilities: signal.probabilities,
    sources: ["modelo"],
  };
}

function formLayer(
  match: SportsMatch,
  health?: Record<DataSourceId, SourceHealthSnapshot>,
): LayerSignal | null {
  const homeStats = match.intel.stats.home;
  const awayStats = match.intel.stats.away;
  const homeForm = formRate(homeStats.form);
  const awayForm = formRate(awayStats.form);
  const homeXgFor = positive(homeStats.xgFor);
  const homeXgAgainst = positive(homeStats.xgAgainst);
  const awayXgFor = positive(awayStats.xgFor);
  const awayXgAgainst = positive(awayStats.xgAgainst);
  const homeGoals = homeStats.provenance === "none" ? null : positive(homeStats.avgScored);
  const awayGoals = awayStats.provenance === "none" ? null : positive(awayStats.avgScored);

  const signals: Array<{ diff: number; weight: number }> = [];
  if (homeForm !== null && awayForm !== null) {
    signals.push({ diff: homeForm - awayForm, weight: 0.5 });
  }
  if (
    homeXgFor !== null &&
    homeXgAgainst !== null &&
    awayXgFor !== null &&
    awayXgAgainst !== null
  ) {
    signals.push({
      diff: (homeXgFor - homeXgAgainst - (awayXgFor - awayXgAgainst)) / 2,
      weight: 0.35,
    });
  }
  if (homeGoals !== null && awayGoals !== null) {
    signals.push({ diff: (homeGoals - awayGoals) / 3, weight: 0.15 });
  }
  if (signals.length === 0) return null;

  const weightSum = signals.reduce((total, item) => total + item.weight, 0);
  const diff = signals.reduce((total, item) => total + item.diff * item.weight, 0) / weightSum;
  const strength = clamp(diff * 2.2, -1, 1);
  const includeDraw = match.sport === "soccer";
  const reliabilityBase =
    0.4 +
    (homeForm !== null && awayForm !== null ? 0.3 : 0) +
    (homeXgFor !== null && homeXgAgainst !== null && awayXgFor !== null && awayXgAgainst !== null
      ? 0.3
      : 0);
  const sources = uniqueSources(
    (match.sourceTags ?? []).filter((source) => source !== "modelo"),
  );
  return {
    key: "form",
    reliability: clamp(reliabilityBase, 0, 1) * healthFactor(sources, health),
    probabilities: outcomeSignal(0.5 + strength * 0.32, includeDraw, 0.22 + 0.08 * (1 - Math.abs(strength))),
    sources,
  };
}

function standingsLayer(
  match: SportsMatch,
  health?: Record<DataSourceId, SourceHealthSnapshot>,
): LayerSignal | null {
  const home = match.intel.standings.home;
  const away = match.intel.standings.away;
  const homeValid = home.played > 0 && home.position > 0;
  const awayValid = away.played > 0 && away.position > 0;
  if (!homeValid && !awayValid) return null;

  const size = Math.max(4, match.intel.standings.table.length);
  const normalized = (position: number) =>
    1 - (clamp(position, 1, size) - 1) / Math.max(1, size - 1);
  const homeStrength = homeValid
    ? normalized(home.position) * 0.65 + clamp(home.winPercentage, 0, 1) * 0.35
    : 0.5;
  const awayStrength = awayValid
    ? normalized(away.position) * 0.65 + clamp(away.winPercentage, 0, 1) * 0.35
    : 0.5;
  const strength = clamp((homeStrength - awayStrength) * 1.4, -1, 1);
  const includeDraw = match.sport === "soccer";
  const sources = uniqueSources(
    (match.sourceTags ?? []).filter((source) => source !== "modelo"),
  );
  return {
    key: "standings",
    reliability: (homeValid && awayValid ? 1 : 0.5) * healthFactor(sources, health),
    probabilities: outcomeSignal(0.5 + strength * 0.3, includeDraw, 0.23 + 0.08 * (1 - Math.abs(strength))),
    sources,
  };
}

function venueLayer(
  match: SportsMatch,
  health?: Record<DataSourceId, SourceHealthSnapshot>,
): LayerSignal {
  const homeVenue = venueRate(match.intel.stats.home.home);
  const awayVenue = venueRate(match.intel.stats.away.away);
  const hasVenue = homeVenue !== null && awayVenue !== null;
  const advantage = HOME_ADVANTAGE[match.sport];
  const venueDiff = hasVenue ? (homeVenue - awayVenue) * 0.6 : 0;
  const strength = clamp(advantage * 3 + venueDiff, -1, 1);
  const includeDraw = match.sport === "soccer";
  const sources = uniqueSources(
    (match.sourceTags ?? []).filter((source) => source !== "modelo"),
  );
  return {
    key: "venueH2h",
    // Sin splits reales solo queda la ventaja estructural de localía: señal parcial.
    reliability: (hasVenue ? 1 : 0.5) * healthFactor(sources, health),
    probabilities: outcomeSignal(0.5 + strength * 0.5, includeDraw, 0.24 + 0.06 * (1 - Math.abs(strength))),
    sources,
  };
}

function editorialLayer(
  match: SportsMatch,
  health?: Record<DataSourceId, SourceHealthSnapshot>,
): LayerSignal | null {
  const analyst = match.analyst;
  if (
    !analyst?.winProbabilities ||
    (analyst.confidence ?? 0) <= 0 ||
    probabilitySum(analyst.winProbabilities) <= 0
  ) {
    return null;
  }
  return {
    key: "editorial",
    reliability: clamp(analyst.confidence ?? 1, 0, 1) * healthFactor(["the-analyst"], health),
    probabilities: analyst.winProbabilities,
    sources: ["the-analyst"],
  };
}

function effectiveLayers(layers: LayerSignal[]): EffectiveLayer[] {
  const total = layers.reduce(
    (sum, layer) => sum + FUSION_LAYER_WEIGHTS[layer.key] * layer.reliability,
    0,
  );
  if (total <= 0) return [];
  return layers.map((layer) => ({
    ...layer,
    effective: (FUSION_LAYER_WEIGHTS[layer.key] * layer.reliability) / total,
  }));
}

function buildMetrics(match: SportsMatch, outcome: "home" | "away"): FavoriteMetrics {
  const favoriteStats = outcome === "home" ? match.intel.stats.home : match.intel.stats.away;
  const rivalStats = outcome === "home" ? match.intel.stats.away : match.intel.stats.home;
  const favoriteStanding = outcome === "home" ? match.intel.standings.home : match.intel.standings.away;
  const rivalStanding = outcome === "home" ? match.intel.standings.away : match.intel.standings.home;
  const venue = outcome === "home" ? favoriteStats.home : favoriteStats.away;
  return {
    form: favoriteStats.form.slice(-10),
    rivalForm: rivalStats.form.slice(-10),
    goalsFor: positive(favoriteStats.avgScored),
    goalsAgainst: positive(favoriteStats.avgConceded),
    xgFor: positive(favoriteStats.xgFor),
    xgAgainst: positive(favoriteStats.xgAgainst),
    streak: favoriteStats.streak && favoriteStats.streak !== "Sin datos" ? favoriteStats.streak : null,
    position: favoriteStanding.played > 0 && favoriteStanding.position > 0 ? favoriteStanding.position : null,
    rivalPosition: rivalStanding.played > 0 && rivalStanding.position > 0 ? rivalStanding.position : null,
    homeAdvantage: HOME_ADVANTAGE[match.sport],
    venueRecord: venue.played > 0 ? venue : null,
    // El modelo actual no dispone de H2H real; se declara ausente, nunca se simula.
    h2hAvailable: false,
    bookmakerCount: match.odds.bookmakerCount ?? match.odds.bookmakers?.length ?? 0,
    marketOverround: match.odds.overround ?? 0,
  };
}

function confidenceFor(
  layers: LayerSignal[],
  supportingSources: DataSourceId[],
  bookmakerCount: number,
): number {
  const external = supportingSources.filter((source) => source !== "modelo");
  const coverage = Math.min(1, external.length / EXPECTED_SOURCES);
  const depth = Math.min(1, bookmakerCount / 6);
  const completeness = layers.reduce((sum, layer) => sum + layer.reliability, 0) / LAYER_KEYS.length;
  return round(clamp(0.5 * coverage + 0.3 * depth + 0.2 * completeness, 0, 1), 3);
}

export function fuseMatch(input: MatchFusionInput, options: RankOptions = {}): RankedFavorite | null {
  const { match } = input;
  const includeDraw = match.sport === "soccer";
  const layers = [
    marketLayer(match, input.sourceHealth),
    modelLayer(match, input),
    formLayer(match, input.sourceHealth),
    standingsLayer(match, input.sourceHealth),
    venueLayer(match, input.sourceHealth),
    editorialLayer(match, input.sourceHealth),
  ].filter((layer): layer is LayerSignal => layer !== null && layer.reliability > 0);
  const effective = effectiveLayers(layers);
  if (effective.length === 0) return null;

  const probabilities: Record<OutcomeKey, number> = { home: 0, draw: 0, away: 0 };
  for (const layer of effective) {
    probabilities.home += layer.effective * layer.probabilities.home;
    probabilities.draw += layer.effective * layer.probabilities.draw;
    probabilities.away += layer.effective * layer.probabilities.away;
  }
  if (!includeDraw) probabilities.draw = 0;
  const total = probabilitySum(probabilities);
  if (total <= 0) return null;
  probabilities.home /= total;
  probabilities.draw /= total;
  probabilities.away /= total;

  const outcome: "home" | "away" =
    probabilities.home >= probabilities.away ? "home" : "away";
  const modelProbability = probabilities[outcome];
  const bestOdds =
    match.odds.best[outcome] !== null && match.odds.best[outcome] > 1
      ? match.odds.best[outcome]
      : null;
  const marketImpliedDevig = match.odds.impliedDevig[outcome] ?? 0;
  const marketImpliedRaw = bestOdds ? 1 / bestOdds : 0;
  const edge = modelProbability - marketImpliedDevig;
  const expectedValue = bestOdds ? modelProbability * bestOdds - 1 : 0;
  const minEdge = options.minEdge ?? MIN_EDGE_DEFAULT;
  const minOdds = options.minOdds ?? MIN_ODDS_DEFAULT;

  const isHealthySource = (source: DataSourceId) =>
    !input.sourceHealth?.[source] || input.sourceHealth[source].ok;
  const bookmakerSources = (match.odds.bookmakers ?? []).map((quote) => quote.source);
  const supportingSources = uniqueSources(
    [
      ...(match.sourceTags ?? []),
      ...bookmakerSources,
      ...layers.flatMap((layer) => layer.sources),
    ].filter(isHealthySource),
  );
  const bookmakerCount = match.odds.bookmakerCount ?? match.odds.bookmakers?.length ?? 0;
  const layerWeights = Object.fromEntries(
    LAYER_KEYS.map((key) => [key, round(effective.find((layer) => layer.key === key)?.effective ?? 0, 4)]),
  ) as Record<FusionLayer, number>;

  return {
    rank: 0,
    matchId: match.id,
    sport: match.sport,
    league: match.league.name,
    commenceTime: match.commenceTime,
    outcome,
    team: outcome === "home" ? match.home.name : match.away.name,
    opponent: outcome === "home" ? match.away.name : match.home.name,
    modelProbability: round(modelProbability, 4),
    marketImpliedProbability: round(marketImpliedDevig, 4),
    marketImpliedRaw: round(marketImpliedRaw, 4),
    edge: round(edge, 4),
    edgeVsRaw: round(modelProbability - marketImpliedRaw, 4),
    expectedValue: round(expectedValue, 4),
    fairOdds: modelProbability > 0 ? round(1 / modelProbability, 2) : null,
    bestOdds: bestOdds ?? null,
    bookmaker: bestOdds
      ? (match.odds.bookmakers.find(
          (quote) => Math.abs((quote.outcomes[outcome] ?? 0) - bestOdds) < 0.0001,
        )?.name ?? null)
      : null,
    isValueBet: Boolean(bestOdds && bestOdds >= minOdds && edge >= minEdge && expectedValue > 0),
    confidence: confidenceFor(layers, supportingSources, bookmakerCount),
    supportingSources,
    layerWeights,
    metrics: buildMetrics(match, outcome),
  };
}

export function rankFavorites(
  inputs: MatchFusionInput[],
  options: RankOptions = {},
): RankedFavoritesResult {
  const entries: RankedFavorite[] = [];
  let withoutMarket = 0;
  let withoutModel = 0;

  for (const input of inputs) {
    if ((input.match.odds.bookmakers?.length ?? 0) === 0) withoutMarket += 1;
    if (!input.modelSignal) withoutModel += 1;
    const entry = fuseMatch(input, options);
    if (entry) entries.push(entry);
  }

  entries.sort(
    (a, b) =>
      b.modelProbability - a.modelProbability ||
      b.edge - a.edge ||
      b.confidence - a.confidence,
  );
  const maxEntries = options.maxEntries ?? 25;
  const ranked = entries.slice(0, maxEntries).map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));

  const warnings = [...(options.extraWarnings ?? [])];
  if (withoutMarket > 0) {
    warnings.push(
      `${withoutMarket} partido(s) sin consenso de mercado; peso de mercado redistribuido.`,
    );
  }
  if (withoutModel > 0) {
    warnings.push(
      `${withoutModel} partido(s) sin modelo Elo/Poisson disponible; peso del modelo redistribuido.`,
    );
  }

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    weights: { ...FUSION_LAYER_WEIGHTS },
    entries: ranked,
    warnings: Array.from(new Set(warnings)),
  };
}
