import type {
  OutcomeKey,
  SportsMatch,
  StandingRow,
  TeamAdvancedStats,
  VenueSplit,
} from "@/types/sports";

/**
 * Probabilidad de victoria del favorito con un modelo multifactorial.
 *
 * Pesos base: mercado 35%, forma reciente 25%, contexto 15%, disponibilidad 15%.
 * El 10% de H2H se redistribuye al mercado hasta que exista un H2H
 * estructurado (conteo de victorias/empates, no regex en texto).
 *
 * Cuando un factor no tiene datos se imputa con el consenso de mercado y se
 * marca `estimated` para que la tabla pueda mostrar `*`.
 */

export interface FavoriteProbability {
  side: "home" | "away";
  team: string;
  probability: number;
  estimated: boolean;
}

type Distribucion = Record<OutcomeKey, number>;
type Factor = { distribucion: Distribucion; imputado: boolean };

const PESO_MERCADO = 0.45; // 0.35 base + 0.10 ex-H2H
const PESO_FORMA = 0.25;
const PESO_CONTEXTO = 0.15;
const PESO_DISPONIBILIDAD = 0.15;

const VENTANA_FORMA = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function seguro(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function normalizar(dist: Distribucion, conEmpate: boolean): Distribucion {
  const home = Math.max(0, seguro(dist.home));
  const away = Math.max(0, seguro(dist.away));
  const draw = conEmpate ? Math.max(0, seguro(dist.draw)) : 0;
  const total = home + away + draw;
  if (total <= 0) {
    return conEmpate
      ? { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }
      : { home: 0.5, draw: 0, away: 0.5 };
  }
  return { home: home / total, draw: conEmpate ? draw / total : 0, away: away / total };
}

/** Convierte una ventaja (-1..1) en 1X2 o en ganador directo. */
function desdeVentaja(ventaja: number, conEmpate: boolean): Distribucion {
  const margen = clamp(ventaja, -1, 1);
  if (!conEmpate) {
    const home = sigmoid(margen * 6);
    return normalizar({ home, draw: 0, away: 1 - home }, false);
  }
  const draw = clamp(0.3 - Math.abs(margen) * 1.4, 0.1, 0.34);
  const home = sigmoid(margen * 5) * (1 - draw);
  return normalizar({ home, draw, away: 1 - draw - home }, true);
}

function neutra(conEmpate: boolean, mercado: Distribucion | null): Distribucion {
  return mercado ?? normalizar({ home: 1, draw: conEmpate ? 1 : 0, away: 1 }, conEmpate);
}

/** 1. Mercado: consenso ya desvigado; si no, se desviga la mejor cuota. */
function distribucionMercado(match: SportsMatch, conEmpate: boolean): Distribucion | null {
  const consenso = match.odds.consensus;
  if (consenso && consenso.home + consenso.away + consenso.draw > 0) {
    return normalizar(consenso, conEmpate);
  }
  const mejor = match.odds.best;
  const home = mejor.home > 1 ? 1 / mejor.home : 0;
  const away = mejor.away > 1 ? 1 / mejor.away : 0;
  const draw = conEmpate && mejor.draw && mejor.draw > 1 ? 1 / mejor.draw : 0;
  if (home <= 0 && away <= 0) return null;
  return normalizar({ home, draw, away }, conEmpate);
}

function puntosPorPartido(form: readonly string[]): number | null {
  if (form.length === 0) return null;
  const recientes = form.slice(-VENTANA_FORMA);
  const puntos = recientes.reduce((total, resultado) => {
    if (resultado === "W") return total + 3;
    if (resultado === "D") return total + 1;
    return total;
  }, 0);
  return puntos / (recientes.length * 3);
}

function puntosEnSede(split: VenueSplit): number | null {
  const jugados = split.played;
  if (!jugados || jugados <= 0) return null;
  return (split.wins * 3 + split.draws) / (jugados * 3);
}

function eficiencia(stats: TeamAdvancedStats): number | null {
  if (!(stats.avgScored > 0) || !(stats.avgConceded > 0)) return null;
  const total = stats.avgScored + stats.avgConceded;
  return clamp(0.5 + (stats.avgScored - stats.avgConceded) / (2 * total), 0, 1);
}

/** 2. Forma reciente + rendimiento por sede + métricas avanzadas (xG/xGA). */
function fuerzaForma(match: SportsMatch, stats: TeamAdvancedStats, local: boolean): number | null {
  const form = puntosPorPartido(stats.form);
  const sede = puntosEnSede(local ? stats.home : stats.away);
  const eficienciaBruta = eficiencia(stats);
  const xgLocal = seguro(match.analyst?.xgHome, 0);
  const xgVisitante = seguro(match.analyst?.xgAway, 0);
  const xgTotal = xgLocal + xgVisitante;
  const xg = xgTotal > 0 ? (local ? xgLocal : xgVisitante) / xgTotal : null;

  // La corrección clave: antes se dividía por `valores.length`, así 3 señales
  // devolvían (0.45+0.25+0.20)/3=0.30 en vez de normalizar por los pesos
  // presentes. Ahora el denominador es la suma de pesos reales.
  const candidatos: Array<{ valor: number | null; peso: number }> = [
    { valor: form, peso: 0.45 },
    { valor: sede, peso: 0.25 },
    { valor: eficienciaBruta, peso: 0.2 },
    { valor: xg, peso: 0.1 },
  ];
  const activos = candidatos.filter(
    (c): c is { valor: number; peso: number } => c.valor != null,
  );
  if (activos.length === 0) return null;
  const pesoTotal = activos.reduce((sum, current) => sum + current.peso, 0);
  return activos.reduce((sum, current) => sum + current.valor * current.peso, 0) / pesoTotal;
}

function distribucionForma(match: SportsMatch, conEmpate: boolean): Factor | null {
  const casa = fuerzaForma(match, match.intel.stats.home, true);
  const fuera = fuerzaForma(match, match.intel.stats.away, false);
  if (casa == null && fuera == null) return null;
  const ventaja = (seguro(casa, 0.5) - seguro(fuera, 0.5)) + (conEmpate ? 0.04 : 0.02);
  return { distribucion: desdeVentaja(ventaja, conEmpate), imputado: casa == null || fuera == null };
}

function posicionScore(row: StandingRow, tamanoTabla: number): number | null {
  // position=0 o played=0 = sin tabla real, no un 1º artificial.
  if (!(row.position > 0) || !(row.played > 0)) return null;
  return clamp(1 - (row.position - 1) / Math.max(1, tamanoTabla - 1), 0, 1);
}

/** 3. Clasificación, puntos por partido, motivación y fatiga por calendario. */
function distribucionContexto(match: SportsMatch, conEmpate: boolean): Factor | null {
  const casa = match.intel.standings.home;
  const fuera = match.intel.standings.away;
  const tamanoTabla = Math.max(
    4,
    match.intel.standings.table.length,
    casa.position,
    fuera.position,
  );
  const posCasa = posicionScore(casa, tamanoTabla);
  const posFuera = posicionScore(fuera, tamanoTabla);
  if (posCasa == null && posFuera == null) return null;

  const ppgCasa = casa.played > 0 ? casa.points / casa.played : null;
  const ppgFuera = fuera.played > 0 ? fuera.points / fuera.played : null;
  const maximoPpg = Math.max(seguro(ppgCasa), seguro(ppgFuera), 0.001);
  const motivacion = (row: StandingRow) =>
    /titulo|descenso|clasificac|campeon|playoff|europea/i.test(row.note ?? "") ? 0.03 : 0;
  const descanso = clamp((seguro(fuera.played) - seguro(casa.played)) * 0.01, -0.05, 0.05);

  const scoreCasa =
    0.55 * seguro(posCasa, 0.5) +
    0.3 * seguro(ppgCasa == null ? null : ppgCasa / maximoPpg, 0.5) +
    motivacion(casa) +
    descanso;
  const scoreFuera =
    0.55 * seguro(posFuera, 0.5) +
    0.3 * seguro(ppgFuera == null ? null : ppgFuera / maximoPpg, 0.5) +
    motivacion(fuera) -
    descanso;

  return {
    distribucion: desdeVentaja(scoreCasa - scoreFuera, conEmpate),
    imputado: posCasa == null || posFuera == null || ppgCasa == null || ppgFuera == null,
  };
}

const PESO_BAJA: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** 4. Disponibilidad: bajas confirmadas y convocatorias (impacto ponderado). */
function distribucionDisponibilidad(match: SportsMatch, conEmpate: boolean): Factor | null {
  const bajasCasa = match.intel.injuries.home;
  const bajasFuera = match.intel.injuries.away;
  if (bajasCasa.length === 0 && bajasFuera.length === 0) return null;

  const penalizacion = (lista: typeof bajasCasa) =>
    lista.reduce((total, baja) => total + (PESO_BAJA[baja.impact] ?? 1), 0);
  const ventaja = clamp(
    (penalizacion(bajasFuera) - penalizacion(bajasCasa)) * 0.015,
    -0.25,
    0.25,
  );
  return {
    distribucion: desdeVentaja(ventaja, conEmpate),
    imputado: bajasCasa.length === 0 || bajasFuera.length === 0,
  };
}

/**
 * 5. H2H desactivado por defecto: el conteo de menciones en texto no es
 * estadística y era vulnerable a regex no escapadas. Cuando exista un campo
 * estructurado `intel.h2h`, se puede reactivar con peso propio.
 */
function distribucionH2H(_match: SportsMatch, _conEmpate: boolean): Factor | null {
  return null;
}

/** Devuelve el favorito y su probabilidad de victoria (1X2 cuando hay empate). */
export function favoriteProbability(match: SportsMatch): FavoriteProbability {
  const conEmpate = match.sport === "soccer";
  const mercado = distribucionMercado(match, conEmpate);
  const base = neutra(conEmpate, mercado);

  const factores: Factor[] = [
    { distribucion: base, imputado: mercado == null },
    distribucionForma(match, conEmpate) ?? { distribucion: base, imputado: true },
    distribucionContexto(match, conEmpate) ?? { distribucion: base, imputado: true },
    distribucionDisponibilidad(match, conEmpate) ?? { distribucion: base, imputado: true },
  ];
  const pesos = [PESO_MERCADO, PESO_FORMA, PESO_CONTEXTO, PESO_DISPONIBILIDAD];

  const final: Distribucion = { home: 0, draw: 0, away: 0 };
  factores.forEach((factor, indice) => {
    final.home += factor.distribucion.home * pesos[indice];
    final.draw += factor.distribucion.draw * pesos[indice];
    final.away += factor.distribucion.away * pesos[indice];
  });
  const distribucion = normalizar(final, conEmpate);

  const canonical =
    match.canonicalFavorite === "away" || match.canonicalFavorite === "home"
      ? match.canonicalFavorite
      : match.favoriteSide === "away"
        ? "away"
        : "home";
  const side: "home" | "away" =
    Math.abs(distribucion.home - distribucion.away) < 1e-9
      ? canonical
      : distribucion.home > distribucion.away
        ? "home"
        : "away";

  return {
    side,
    team: side === "home" ? match.home.name : match.away.name,
    probability: distribucion[side],
    estimated: factores.some((factor) => factor.imputado),
  };
}
