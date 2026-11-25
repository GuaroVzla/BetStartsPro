export interface HistoricalMatch {
  id: string;
  date: string;
  leagueId?: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

export interface DixonColesParams {
  rho: number;
  xiPerDay: number;
  homeAdvantage: number;
}

export const DEFAULT_DIXON_COLES_PARAMS: DixonColesParams = {
  rho: -0.13,
  xiPerDay: 0.0018,
  homeAdvantage: 0.16,
};

export interface DixonColesModel {
  params: DixonColesParams;
  leagueAverage: number;
  attack: Record<string, number>;
  defense: Record<string, number>;
}

const MS_PER_DAY = 86_400_000;
const MAX_GOALS = 12;
const EPSILON = 1e-9;
const MIN_STRENGTH = 0.05;
const MAX_STRENGTH = 20;
const MIN_LAMBDA = 1e-4;
const MAX_LAMBDA = 25;
const DEFAULT_LEAGUE_AVERAGE = 1.4;
const FIT_ITERATIONS = 24;
const PRIOR_MATCHES = 3;
const PRIOR_TEAM_MATCHES = 1.5;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function numberOr(value: number | undefined | null, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasOwn(record: Record<string, number>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function setStrength(record: Record<string, number>, key: string, value: number): void {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function strengthFor(record: Record<string, number> | undefined, team: string): number {
  if (!record || !hasOwn(record, team)) return 1;
  const value = record[team];
  if (!Number.isFinite(value) || value <= 0) return 1;
  return clamp(value, MIN_STRENGTH, MAX_STRENGTH);
}

function resolveParams(params?: Partial<DixonColesParams>): DixonColesParams {
  const source = params ?? {};
  return {
    rho: clamp(numberOr(source.rho, DEFAULT_DIXON_COLES_PARAMS.rho), -0.5, 0.5),
    xiPerDay: clamp(numberOr(source.xiPerDay, DEFAULT_DIXON_COLES_PARAMS.xiPerDay), 0, 0.05),
    homeAdvantage: clamp(
      numberOr(source.homeAdvantage, DEFAULT_DIXON_COLES_PARAMS.homeAdvantage),
      -0.5,
      2,
    ),
  };
}

/** Corrección de Dixon-Coles para los cuatro marcadores de baja puntuación. */
export function dixonColesTau(
  h: number,
  a: number,
  homeLambda: number,
  awayLambda: number,
  rho: number,
): number {
  const home = clamp(numberOr(homeLambda, DEFAULT_LEAGUE_AVERAGE), MIN_LAMBDA, MAX_LAMBDA);
  const away = clamp(numberOr(awayLambda, DEFAULT_LEAGUE_AVERAGE), MIN_LAMBDA, MAX_LAMBDA);
  const correlation = clamp(numberOr(rho, DEFAULT_DIXON_COLES_PARAMS.rho), -0.5, 0.5);

  let tau = 1;
  if (h === 0 && a === 0) {
    tau = 1 - home * away * correlation;
  } else if (h === 0 && a === 1) {
    tau = 1 + home * correlation;
  } else if (h === 1 && a === 0) {
    tau = 1 + away * correlation;
  } else if (h === 1 && a === 1) {
    tau = 1 - correlation;
  }

  return Number.isFinite(tau) && tau > 0 ? tau : EPSILON;
}

function truncatedPoissonWeights(lambda: number): number[] {
  const safeLambda = clamp(numberOr(lambda, DEFAULT_LEAGUE_AVERAGE), MIN_LAMBDA, MAX_LAMBDA);
  const weights = new Array<number>(MAX_GOALS + 1);
  weights[0] = Math.exp(-safeLambda);
  for (let goals = 1; goals <= MAX_GOALS; goals += 1) {
    weights[goals] = weights[goals - 1] * (safeLambda / goals);
  }
  return weights;
}

/** Probabilidades 1X2 truncadas a 0..12 goles por equipo y renormbradas. */
export function dixonColesProbabilities(
  homeLambda: number,
  awayLambda: number,
  params: DixonColesParams,
): Record<"home" | "draw" | "away", number> {
  const resolved = resolveParams(params);
  const homeWeights = truncatedPoissonWeights(homeLambda);
  const awayWeights = truncatedPoissonWeights(awayLambda);

  let homeMass = 0;
  let drawMass = 0;
  let awayMass = 0;

  for (let homeGoals = 0; homeGoals <= MAX_GOALS; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= MAX_GOALS; awayGoals += 1) {
      const mass =
        homeWeights[homeGoals] *
        awayWeights[awayGoals] *
        dixonColesTau(homeGoals, awayGoals, homeLambda, awayLambda, resolved.rho);
      if (homeGoals > awayGoals) {
        homeMass += mass;
      } else if (homeGoals === awayGoals) {
        drawMass += mass;
      } else {
        awayMass += mass;
      }
    }
  }

  const total = homeMass + drawMass + awayMass;
  if (!Number.isFinite(total) || total <= 0) {
    return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  }

  return {
    home: homeMass / total,
    draw: drawMass / total,
    away: awayMass / total,
  };
}

interface FitRow {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  time: number;
  weight: number;
}

/** Fuerzas con media geométrica 1; el desplazamiento se absorbe en leagueAverage. */
function normalizeStrengths(
  attack: Map<string, number>,
  defense: Map<string, number>,
  mu: number,
): number {
  let attackLogSum = 0;
  let defenseLogSum = 0;
  let count = 0;

  for (const [team, value] of attack.entries()) {
    attackLogSum += Math.log(Math.max(EPSILON, value));
    defenseLogSum += Math.log(Math.max(EPSILON, defense.get(team) ?? 1));
    count += 1;
  }

  if (count === 0) return mu;

  const attackMean = attackLogSum / count;
  const defenseMean = defenseLogSum / count;

  for (const [team, value] of attack.entries()) {
    const nextAttack = Math.exp(Math.log(Math.max(EPSILON, value)) - attackMean);
    const nextDefense = Math.exp(
      Math.log(Math.max(EPSILON, defense.get(team) ?? 1)) - defenseMean,
    );
    attack.set(team, clamp(nextAttack, MIN_STRENGTH, MAX_STRENGTH));
    defense.set(team, clamp(nextDefense, MIN_STRENGTH, MAX_STRENGTH));
  }

  return mu + attackMean - defenseMean;
}

/**
 * Ajuste MLE simple por conteo ponderado. La fecha de referencia es el partido
 * más reciente del propio dataset, de modo que el resultado es determinista.
 */
export function fitDixonColesModel(
  matches: HistoricalMatch[],
  params?: Partial<DixonColesParams>,
): DixonColesModel {
  const resolved = resolveParams(params);
  const emptyModel = (): DixonColesModel => ({
    params: resolved,
    leagueAverage: DEFAULT_LEAGUE_AVERAGE,
    attack: {},
    defense: {},
  });

  if (!Array.isArray(matches)) return emptyModel();

  const rows: FitRow[] = [];
  for (const match of matches) {
    if (!match || typeof match !== "object") continue;
    if (typeof match.home !== "string" || match.home.length === 0) continue;
    if (typeof match.away !== "string" || match.away.length === 0) continue;
    if (!Number.isFinite(match.homeGoals) || !Number.isFinite(match.awayGoals)) continue;
    if (match.homeGoals < 0 || match.awayGoals < 0) continue;
    const time = Date.parse(match.date);
    if (!Number.isFinite(time)) continue;

    rows.push({
      home: match.home,
      away: match.away,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      time,
      weight: 1,
    });
  }

  if (rows.length === 0) return emptyModel();

  let referenceTime = rows[0].time;
  for (const row of rows) {
    if (row.time > referenceTime) referenceTime = row.time;
  }
  for (const row of rows) {
    const ageDays = Math.max(0, (referenceTime - row.time) / MS_PER_DAY);
    row.weight = Math.exp(-resolved.xiPerDay * ageDays);
  }

  const teams = new Set<string>();
  for (const row of rows) {
    teams.add(row.home);
    teams.add(row.away);
  }

  const attack = new Map<string, number>();
  const defense = new Map<string, number>();
  for (const team of teams) {
    attack.set(team, 1);
    defense.set(team, 1);
  }

  let totalWeight = 0;
  let weightedGoals = 0;
  let weightedHomeGoals = 0;
  let weightedAwayGoals = 0;
  for (const row of rows) {
    totalWeight += row.weight;
    weightedGoals += row.weight * (row.homeGoals + row.awayGoals);
    weightedHomeGoals += row.weight * row.homeGoals;
    weightedAwayGoals += row.weight * row.awayGoals;
  }
  const observedPerTeam = totalWeight > 0 ? weightedGoals / (2 * totalWeight) : DEFAULT_LEAGUE_AVERAGE;
  const observedHomePerTeam = totalWeight > 0 ? weightedHomeGoals / totalWeight : observedPerTeam;
  const observedAwayPerTeam = totalWeight > 0 ? weightedAwayGoals / totalWeight : observedPerTeam;

  let mu = Math.log(clamp(observedPerTeam, 0.8, 2.2));
  let fitGamma = Math.log(
    clamp(observedHomePerTeam / Math.max(EPSILON, observedAwayPerTeam), 0.75, 1.6),
  );

  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    let totalGoals = 0;
    let totalExpected = 0;
    let homeGoals = 0;
    let homeExpected = 0;
    const goalsFor = new Map<string, number>();
    const expectedFor = new Map<string, number>();
    const goalsAgainst = new Map<string, number>();
    const expectedAgainst = new Map<string, number>();
    for (const team of teams) {
      goalsFor.set(team, 0);
      expectedFor.set(team, 0);
      goalsAgainst.set(team, 0);
      expectedAgainst.set(team, 0);
    }

    for (const row of rows) {
      const homeAttack = attack.get(row.home) ?? 1;
      const awayDefense = defense.get(row.away) ?? 1;
      const awayAttack = attack.get(row.away) ?? 1;
      const homeDefense = defense.get(row.home) ?? 1;

      const homeLambda = clamp(
        Math.exp(mu + fitGamma) * (homeAttack / Math.max(EPSILON, awayDefense)),
        0.05,
        6,
      );
      const awayLambda = clamp(Math.exp(mu) * (awayAttack / Math.max(EPSILON, homeDefense)), 0.05, 6);
      const weight = row.weight;
      const hg = row.homeGoals;
      const ag = row.awayGoals;

      totalGoals += weight * (hg + ag);
      totalExpected += weight * (homeLambda + awayLambda);
      homeGoals += weight * hg;
      homeExpected += weight * homeLambda;

      goalsFor.set(row.home, (goalsFor.get(row.home) ?? 0) + weight * hg);
      expectedFor.set(row.home, (expectedFor.get(row.home) ?? 0) + weight * homeLambda);
      goalsFor.set(row.away, (goalsFor.get(row.away) ?? 0) + weight * ag);
      expectedFor.set(row.away, (expectedFor.get(row.away) ?? 0) + weight * awayLambda);

      goalsAgainst.set(row.home, (goalsAgainst.get(row.home) ?? 0) + weight * ag);
      expectedAgainst.set(row.home, (expectedAgainst.get(row.home) ?? 0) + weight * awayLambda);
      goalsAgainst.set(row.away, (goalsAgainst.get(row.away) ?? 0) + weight * hg);
      expectedAgainst.set(row.away, (expectedAgainst.get(row.away) ?? 0) + weight * homeLambda);
    }

    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    const observedAvg = totalGoals / Math.max(EPSILON, 2 * totalWeight);
    const muTarget = Math.log(clamp(observedAvg, 0.8, 2.2));
    const muStep = clamp(
      0.35 * Math.log((totalGoals + 8) / Math.max(EPSILON, totalExpected + 8)),
      -0.08,
      0.08,
    );
    mu = clamp(mu + muStep + 0.15 * (muTarget - mu), Math.log(0.8), Math.log(2.2));

    const gammaStep = clamp(
      0.35 * Math.log((homeGoals + 4) / Math.max(EPSILON, homeExpected + 4)),
      -0.08,
      0.08,
    );
    fitGamma = clamp(fitGamma + gammaStep, -0.4, 0.7);

    const teamPrior = Math.max(6, 8 * Math.exp(mu));
    for (const team of teams) {
      const currentAttack = attack.get(team) ?? 1;
      const currentDefense = defense.get(team) ?? 1;
      const gf = goalsFor.get(team) ?? 0;
      const ef = expectedFor.get(team) ?? 0;
      const ga = goalsAgainst.get(team) ?? 0;
      const ea = expectedAgainst.get(team) ?? 0;

      const nextAttack =
        (gf + teamPrior) / Math.max(EPSILON, ef + teamPrior / Math.max(EPSILON, currentAttack));
      const nextDefense =
        (ga + teamPrior) / Math.max(EPSILON, ea + teamPrior / Math.max(EPSILON, currentDefense));

      const smoothAttack = Math.exp(
        clamp(Math.log(Math.max(EPSILON, nextAttack / Math.max(EPSILON, currentAttack))), -0.15, 0.15),
      );
      const smoothDefense = Math.exp(
        clamp(Math.log(Math.max(EPSILON, nextDefense / Math.max(EPSILON, currentDefense))), -0.15, 0.15),
      );

      attack.set(team, clamp(currentAttack * smoothAttack, 0.35, 2.8));
      defense.set(team, clamp(currentDefense * smoothDefense, 0.35, 2.8));
    }

    mu = clamp(normalizeStrengths(attack, defense, mu), Math.log(0.8), Math.log(2.2));
  }

  const fitted: DixonColesModel = {
    params: {
      ...resolved,
      homeAdvantage: Math.expm1(fitGamma),
    },
    leagueAverage: clamp(Math.exp(mu), 0.05, 10),
    attack: {},
    defense: {},
  };

  for (const team of teams) {
    setStrength(fitted.attack, team, clamp(attack.get(team) ?? 1, MIN_STRENGTH, MAX_STRENGTH));
    setStrength(fitted.defense, team, clamp(defense.get(team) ?? 1, MIN_STRENGTH, MAX_STRENGTH));
  }

  return fitted;
}

/** Lambdas esperados para un partido; equipos desconocidos tienen fuerza 1. */
export function lambdasForMatch(
  model: DixonColesModel,
  homeId: string,
  awayId: string,
): { homeLambda: number; awayLambda: number } {
  const leagueAverage = clamp(
    numberOr(model?.leagueAverage, DEFAULT_LEAGUE_AVERAGE),
    0.05,
    10,
  );
  const homeAdvantage = clamp(
    numberOr(model?.params?.homeAdvantage, DEFAULT_DIXON_COLES_PARAMS.homeAdvantage),
    -0.5,
    2,
  );
  const homeAttack = strengthFor(model?.attack, homeId);
  const homeDefense = strengthFor(model?.defense, homeId);
  const awayAttack = strengthFor(model?.attack, awayId);
  const awayDefense = strengthFor(model?.defense, awayId);

  return {
    homeLambda: clamp(
      leagueAverage * (1 + homeAdvantage) * (homeAttack / Math.max(EPSILON, awayDefense)),
      MIN_LAMBDA,
      MAX_LAMBDA,
    ),
    awayLambda: clamp(
      leagueAverage * (awayAttack / Math.max(EPSILON, homeDefense)),
      MIN_LAMBDA,
      MAX_LAMBDA,
    ),
  };
}
