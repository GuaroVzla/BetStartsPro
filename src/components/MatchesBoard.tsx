"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowUpRight, Table2 } from "lucide-react";
import { TeamBadge } from "@/components/TeamBadge";
import { SportIcon } from "@/components/SportIcon";
import type { SportsMatch } from "@/types/sports";
import type { CrossSourcePick } from "@/services/valueEngine";
import { favoriteProbability } from "@/services/favoriteProbability";
import { leagueOrigin } from "@/lib/leagueOrigin";
import { formatMatchTime, formatOdd, formatPercent, formatSignedPercent } from "@/lib/format";
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
  | "metric"
  | "odds"
  | "value";

interface SortState {
  key: SortKey;
  direction: "asc" | "desc";
}

const COLUMNAS: Array<{ key: SortKey; label: string }> = [
  { key: "time", label: "Hora" },
  { key: "tournament", label: "Torneo" },
  { key: "match", label: "Partido" },
  { key: "favorite", label: "Favorito y Probabilidad" },
  { key: "metric", label: "Métrica clave" },
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
        const edge = pick?.edge ?? 0;
        const timestamp = Date.parse(match.commenceTime);

        return {
          match,
          pick,
          favorito,
          origin,
          metricLabel,
          metricSource,
          edge,
          valores: {
            time: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
            tournament: textoOrden(`${match.league.shortName} ${origin.label}`),
            match: textoOrden(`${match.home.shortName} ${match.away.shortName}`),
            favorite: favorito.probability,
            metric: analyst?.xgHome != null && analyst.xgHome > 0 ? analyst.xgHome : -1,
            odds: pick?.bestOdds ?? match.odds.best.home ?? match.odds.best.away ?? 0,
            value: edge,
          } as Record<SortKey, number | string>,
        };
      }),
    [matches, picksByMatch],
  );

  const filasOrdenadas = useMemo(() => {
    const signo = sort.direction === "asc" ? 1 : -1;
    return [...filas].sort((a, b) => {
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
  }, [filas, sort]);

  return (
    <section aria-labelledby="matches-board-title" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-slate-400" />
          <h2 id="matches-board-title" className="text-[12px] font-bold text-slate-900 dark:text-white">
            Partidos
          </h2>
          <span className="tabular-nums text-[10px] text-slate-400">{matches.length}</span>
        </div>
        <p className="hidden text-[10px] text-slate-400 dark:text-slate-500 sm:block">
          Hora Venezuela (VET) · clic en encabezados para ordenar
        </p>
      </div>

      {matches.length === 0 ? (
        <p className="px-4 py-10 text-center text-[11px] text-slate-500 dark:text-slate-400">
          No hay partidos pendientes para los filtros seleccionados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-white/[0.06] dark:text-slate-500">
                {COLUMNAS.map((columna, indice) => (
                  <SortHeader
                    key={columna.key}
                    label={columna.label}
                    sortKey={columna.key}
                    sort={sort}
                    onSort={handleSort}
                    className={indice === 0 ? "px-4" : "px-3"}
                  />
                ))}
                <th className="px-3 py-2.5 text-right">Análisis</th>
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
                    <td className="whitespace-nowrap px-4 py-3 align-middle">
                      <span className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatMatchTime(match.commenceTime)}
                      </span>
                    </td>
                    <td className="max-w-[210px] px-3 py-3 align-middle">
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
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <TeamBadge team={match.home} size="sm" />
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                          {match.home.shortName}
                        </span>
                        <span className="text-[10px] text-slate-300 dark:text-slate-600">vs</span>
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                          {match.away.shortName}
                        </span>
                        <TeamBadge team={match.away} size="sm" />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className="whitespace-nowrap text-[11px] font-semibold text-slate-800 dark:text-slate-100"
                          title={favorito.team}
                        >
                          {favorito.side === "home" ? match.home.shortName : match.away.shortName}
                          <span className="ml-1 font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                            ({formatPercent(favorito.probability)})
                          </span>
                          {favorito.estimated ? (
                            <sup
                              className="ml-0.5 text-[10px] text-amber-600"
                              title="Estimación con datos imputados. Pesos: mercado 35%, forma 25%, contexto 15%, bajas 15%, H2H 10%."
                            >
                              *
                            </sup>
                          ) : null}
                        </span>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500">
                          Estimación ponderada
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <span className="block text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {metricLabel}
                      </span>
                      <span className="block max-w-[170px] truncate text-[10px] text-slate-400">
                        {metricSource}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <span className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatOdd(pick?.bestOdds ?? match.odds.best.home ?? match.odds.best.away)}
                      </span>
                      <span className="block max-w-[120px] truncate text-[10px] text-slate-400">
                        {pick?.bookmaker ?? match.odds.bookmakers[0]?.name ?? "—"}
                        {pick ? ` · ${pick.selection}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                          edge > 0
                            ? "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400",
                        )}
                      >
                        {formatSignedPercent(edge)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {pick?.supportingSources.length ?? match.odds.bookmakerCount} fuentes
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right align-middle">
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
