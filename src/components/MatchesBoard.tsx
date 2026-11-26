"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowUpRight, Flame, Sparkles, Table2 } from "lucide-react";
import { TeamBadge } from "@/components/TeamBadge";
import { SportIcon } from "@/components/SportIcon";
import type { SportsMatch } from "@/types/sports";
import type { CrossSourcePick } from "@/services/valueEngine";
import { favoriteProbability } from "@/services/favoriteProbability";
import { leagueOrigin } from "@/lib/leagueOrigin";
import { formatAmericanOdd, formatMatchTime, formatOdd, formatPercent, formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MatchesBoardProps {
  matches: SportsMatch[];
  picksByMatch: Map<string, CrossSourcePick>;
  onOpenMatch: (match: SportsMatch) => void;
}

type SortKey =
  | "time"
  | "tournament"
  | "match"
  | "favorite"
  | "odds"
  | "value";

interface SortState {
  key: SortKey;
  direction: "asc" | "desc";
}

const COLUMNAS: Array<{ key: SortKey; label: string; mobileHidden?: boolean }> = [
  { key: "time", label: "Hora" },
  { key: "tournament", label: "Torneo", mobileHidden: true },
  { key: "match", label: "Partido" },
  { key: "favorite", label: "Favorito / Prob." },
  { key: "odds", label: "Mejor cuota" },
  { key: "value", label: "Valor" },
];

/** Normaliza para comparar texto sin distinguir mayúsculas ni acentos. */
function textoOrden(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortHeader({ label, sortKey, sort, onSort, className }: SortHeaderProps) {
  const activo = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={activo ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("py-2.5", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Ordenar por ${label}`}
        title={`Ordenar por ${label}`}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 dark:hover:text-slate-200",
          activo && "text-blue-600 dark:text-blue-300",
        )}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[10px] leading-none tabular-nums">
          {activo ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

/** Tabla escaneable: torneo, hora, partido, probabilidad, precio y valor. */
export function MatchesBoard({ matches, picksByMatch, onOpenMatch }: MatchesBoardProps) {
  const [sort, setSort] = useState<SortState>({ key: "time", direction: "asc" });
  const [onlyPlusMoney, setOnlyPlusMoney] = useState(false);

  const handleSort = useCallback((key: SortKey) => {
    setSort((actual) =>
      actual.key === key
        ? { key, direction: actual.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }, []);

  const filas = useMemo(
    () =>
      matches.map((match) => {
        const pick = picksByMatch.get(match.id);
        const favorito = favoriteProbability(match);
        const origin = leagueOrigin(match.league);
        const analyst = match.analyst;
        const hasXg =
          analyst?.xgHome != null &&
          analyst?.xgAway != null &&
          (analyst.xgHome > 0 || analyst.xgAway > 0);
        const metricLabel = hasXg
          ? `xG ${analyst!.xgHome!.toFixed(2)} – ${analyst!.xgAway!.toFixed(2)}`
          : "Sin métrica";
        const metricSource = hasXg
          ? "The Analyst"
          : analyst?.streakHome
            ? `Racha ${analyst.streakHome}`
            : "Modelo propio";
        const edge = pick?.edge ?? null;
        const timestamp = Date.parse(match.commenceTime);

        // Cuota decimal del resultado favorito proyectado
        const favOutcome = favorito.side;
        const bestFavOdd = match.odds.best[favOutcome] ?? pick?.bestOdds ?? 0;
        const isPlusMoney = bestFavOdd >= 2.0;

        // Detección de Valor Esperado positivo (+EV): probabilidad modelada > probabilidad implícita
        const impliedProb = bestFavOdd > 1 ? 1 / bestFavOdd : 1;
        const hasPositiveEV = isPlusMoney && favorito.probability > impliedProb;

        // Oportunidad en Empate (Fútbol): si paga cuota positiva (>= 2.00) y tiene probabilidad relevante
        const drawOdd = match.odds.best.draw ?? 0;
        const isDrawPlusMoney = match.sport === "soccer" && drawOdd >= 2.0;
        const drawImplied = drawOdd > 1 ? 1 / drawOdd : 1;
        const isDrawPositiveEV = isDrawPlusMoney && (favorito.drawProbability ?? 0) > drawImplied;

        const qualifiesPlusMoney = isPlusMoney || (isDrawPlusMoney && (favorito.drawProbability ?? 0) >= 0.28);

        return {
          match,
          pick,
          favorito,
          origin,
          metricLabel,
          metricSource,
          edge,
          bestFavOdd,
          isPlusMoney,
          hasPositiveEV,
          isDrawPlusMoney,
          isDrawPositiveEV,
          drawOdd,
          qualifiesPlusMoney,
          valores: {
            time: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
            tournament: textoOrden(`${match.league.shortName} ${origin.label}`),
            match: textoOrden(`${match.home.shortName} ${match.away.shortName}`),
            favorite: favorito.probability,
            odds: bestFavOdd || pick?.bestOdds || match.odds.best.home || match.odds.best.away || 0,
            value: edge ?? -999,
          } as Record<SortKey, number | string>,
        };
      }),
    [matches, picksByMatch],
  );

  const filasFiltradas = useMemo(() => {
    if (!onlyPlusMoney) return filas;
    return filas.filter((f) => f.qualifiesPlusMoney);
  }, [filas, onlyPlusMoney]);

  const filasOrdenadas = useMemo(() => {
    const signo = sort.direction === "asc" ? 1 : -1;
    return [...filasFiltradas].sort((a, b) => {
      const va = a.valores[sort.key];
      const vb = b.valores[sort.key];
      const comparacion =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "es", {
            sensitivity: "base",
            numeric: true,
          });
      if (comparacion !== 0) return comparacion * signo;
      // Desempate cronológico para que filas equivalentes mantengan coherencia.
      return Number(a.valores.time) - Number(b.valores.time);
    });
  }, [filasFiltradas, sort]);

  return (
    <section aria-labelledby="matches-board-title" className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-slate-400" />
          <h2 id="matches-board-title" className="text-[12px] font-bold text-slate-900 dark:text-white">
            Partidos
          </h2>
          <span className="tabular-nums text-[10px] text-slate-400">
            {filasFiltradas.length}{onlyPlusMoney ? ` de ${matches.length}` : ""}
          </span>
        </div>

        {/* Toggle / Filtro Rápido de Cuotas Positivas (+ / Plus-Money / +EV) */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOnlyPlusMoney((prev) => !prev)}
            aria-pressed={onlyPlusMoney}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50",
              onlyPlusMoney
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shadow-sm"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200",
            )}
          >
            <Flame className={cn("h-3.5 w-3.5", onlyPlusMoney ? "text-emerald-500" : "text-slate-400")} />
            <span>Solo Cuotas Positivas (+)</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.2 text-[9px] tabular-nums font-black",
                onlyPlusMoney
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-300",
              )}
            >
              {filas.filter((f) => f.qualifiesPlusMoney).length}
            </span>
          </button>
          <p className="hidden text-[10px] text-slate-400 dark:text-slate-500 md:block">
            Hora Venezuela (VET) · clic en encabezados para ordenar
          </p>
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="px-4 py-10 text-center text-[11px] text-slate-500 dark:text-slate-400">
          No hay partidos pendientes para los filtros seleccionados.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1 sm:mx-0">
          <table className="w-full min-w-[620px] sm:min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-white/[0.06] dark:text-slate-500">
                {COLUMNAS.map((columna, indice) => (
                  <SortHeader
                    key={columna.key}
                    label={columna.label}
                    sortKey={columna.key}
                    sort={sort}
                    onSort={handleSort}
                    className={cn(
                      indice === 0 ? "px-2.5 sm:px-4" : "px-2 sm:px-3",
                      columna.mobileHidden && "hidden md:table-cell",
                    )}
                  />
                ))}
                <th className="px-2 py-2.5 text-right sm:px-3">Análisis</th>
              </tr>
            </thead>
            <tbody>
              {filasOrdenadas.map(({
                match,
                pick,
                favorito,
                origin,
                metricLabel,
                metricSource,
                edge,
                bestFavOdd,
                isPlusMoney,
                hasPositiveEV,
                isDrawPlusMoney,
                isDrawPositiveEV,
                drawOdd,
              }) => (
                <tr
                  key={match.id}
                  onClick={() => onOpenMatch(match)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenMatch(match);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Ver análisis de ${match.home.name} contra ${match.away.name}`}
                  className="group cursor-pointer border-b border-slate-100/80 transition last:border-0 hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/50 dark:border-white/[0.04] dark:hover:bg-white/[0.03]"
                >
                  <td className="whitespace-nowrap px-2.5 py-2.5 sm:px-4 sm:py-3 align-middle">
                    <span className="text-[12px] sm:text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatMatchTime(match.commenceTime)}
                    </span>
                  </td>
                  <td className="hidden md:table-cell max-w-[210px] px-2 sm:px-3 py-2.5 sm:py-3 align-middle">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                        title={match.league.name}
                      >
                        <SportIcon
                          sport={match.sport}
                          className="mr-1 inline h-3 w-3 align-[-1px]"
                        />
                        {match.league.shortName}
                      </span>
                      <span
                        className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500"
                        title={origin.iso2 ? `${origin.label} (${origin.iso2})` : origin.label}
                      >
                        <span aria-hidden="true">{origin.flag}</span>
                        <span className="truncate">{origin.label}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2.5 sm:py-3 align-middle">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <div className="flex items-center gap-1.5">
                        <TeamBadge team={match.home} size="sm" />
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                          {match.home.shortName}
                        </span>
                      </div>
                      <span className="hidden sm:inline text-[10px] text-slate-300 dark:text-slate-600">vs</span>
                      <div className="flex items-center gap-1.5">
                        <TeamBadge team={match.away} size="sm" />
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                          {match.away.shortName}
                        </span>
                      </div>
                      {/* En móvil mostramos el torneo pequeño aquí debajo */}
                      <span className="text-[9px] text-slate-400 md:hidden flex items-center gap-1">
                        <SportIcon sport={match.sport} className="h-2.5 w-2.5" />
                        {match.league.shortName}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2.5 sm:py-3 align-middle">
                    <div className="flex flex-col gap-1.5 min-w-[130px] sm:min-w-[145px]">
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className="whitespace-nowrap text-[11px] font-bold text-slate-900 dark:text-white"
                          title={favorito.team}
                        >
                          {favorito.side === "home" ? match.home.shortName : match.away.shortName}
                        </span>
                        <span className="font-extrabold text-[11px] tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatPercent(favorito.probability)}
                          {favorito.estimated ? (
                            <sup
                              className="ml-0.5 text-[9px] text-amber-500"
                              title="Estimación con imputación de datos. Pesos: mercado 35%, forma 25%, contexto 15%, bajas 15%."
                            >
                              *
                            </sup>
                          ) : null}
                        </span>
                      </div>

                      {/* Barra segmentada de distribución 1X2 o Moneyline */}
                      {match.sport === "soccer" && favorito.probabilities ? (
                        <div
                          className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
                          title={`Local: ${formatPercent(favorito.probabilities.home)} · Empate: ${formatPercent(favorito.probabilities.draw)} · Visita: ${formatPercent(favorito.probabilities.away)}`}
                        >
                          <div
                            className="bg-emerald-500 transition-all duration-300"
                            style={{ width: `${Math.round(favorito.probabilities.home * 100)}%` }}
                          />
                          <div
                            className="bg-amber-400 transition-all duration-300"
                            style={{ width: `${Math.round(favorito.probabilities.draw * 100)}%` }}
                          />
                          <div
                            className="bg-blue-500 transition-all duration-300"
                            style={{ width: `${Math.round(favorito.probabilities.away * 100)}%` }}
                          />
                        </div>
                      ) : (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              favorito.probability >= 0.65
                                ? "bg-emerald-500"
                                : favorito.probability >= 0.50
                                  ? "bg-blue-500"
                                  : "bg-amber-500",
                            )}
                            style={{ width: `${Math.min(100, Math.max(5, favorito.probability * 100))}%` }}
                          />
                        </div>
                      )}

                      {/* Subtítulo con píldora de empate si aplica */}
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-medium text-slate-400 dark:text-slate-400">
                          {match.sport === "soccer" ? "1X2 Ponderado" : "Moneyline Pro"}
                        </span>
                        {match.sport === "soccer" && (favorito.drawProbability ?? 0) > 0 ? (
                          <span
                            className={cn(
                              "rounded px-1 py-0.2 font-semibold tabular-nums",
                              (favorito.drawProbability ?? 0) >= 0.30
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold"
                                : "text-slate-500 dark:text-slate-400",
                            )}
                            title="Probabilidad modelada de Empate"
                          >
                            X: {formatPercent(favorito.drawProbability ?? 0)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2.5 sm:py-3 align-middle">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] sm:text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                          {formatOdd(bestFavOdd || pick?.bestOdds || match.odds.best.home || match.odds.best.away)}
                        </span>
                        {/* Insignia / Badge de Cuota Positiva / Plus-Money / +EV */}
                        {hasPositiveEV ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-black tracking-tight text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm"
                            title={`Cuota Positiva con Valor Esperado (+EV). Americana: ${formatAmericanOdd(bestFavOdd)}. Probabilidad de nuestro motor: ${formatPercent(favorito.probability)}`}
                          >
                            <Flame className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
                            <span>{formatAmericanOdd(bestFavOdd)}</span>
                          </span>
                        ) : isPlusMoney ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black tracking-tight text-amber-700 dark:text-amber-300 border border-amber-500/25"
                            title={`Cuota Positiva (Plus-Money: duplica la apuesta). Americana: ${formatAmericanOdd(bestFavOdd)}`}
                          >
                            <Sparkles className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
                            <span>{formatAmericanOdd(bestFavOdd)}</span>
                          </span>
                        ) : null}
                      </div>

                      <span className="block max-w-[130px] sm:max-w-[140px] truncate text-[10px] text-slate-400">
                        {pick?.bookmaker ?? match.odds.bookmakers[0]?.name ?? "Consenso"}
                        {` · ${favorito.side === "home" ? match.home.shortName : match.away.shortName}`}
                      </span>

                      {/* Oportunidad destacada en Empate con Cuota Positiva */}
                      {isDrawPlusMoney && (favorito.drawProbability ?? 0) >= 0.28 ? (
                        <span
                          className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 dark:text-amber-300"
                          title={`Oportunidad en Empate: cuota ${formatOdd(drawOdd)} (${formatAmericanOdd(drawOdd)}) con ${formatPercent(favorito.drawProbability ?? 0)} de probabilidad estimada.`}
                        >
                          <span className="rounded bg-amber-500/20 px-1 py-0.2">
                            Empate {formatAmericanOdd(drawOdd)}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2.5 sm:py-3 align-middle">
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                        edge != null && edge > 0
                          ? "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400",
                      )}
                    >
                      {edge == null ? "—" : formatSignedPercent(edge)}
                    </span>
                    {(() => {
                      const dataSources = new Set<string>(match.sourceTags ?? []);
                      for (const b of match.odds.bookmakers ?? []) dataSources.add(b.source);
                      const count = dataSources.size;
                      return (
                        <span
                          className="mt-0.5 block text-[10px] text-slate-400"
                          title={
                            count > 0
                              ? `Fuentes: ${Array.from(dataSources).join(", ")}`
                              : "Sin fuentes de datos"
                          }
                        >
                          {count} fuentes
                          {match.odds.bookmakerCount > 0 ? ` · ${match.odds.bookmakerCount} casas` : ""}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-2 sm:px-3 py-2.5 sm:py-3 text-right align-middle">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition group-hover:border-emerald-400/40 group-hover:text-emerald-600 dark:border-white/10 dark:group-hover:text-emerald-300">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
