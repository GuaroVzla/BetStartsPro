"use client";

import { ArrowUpRight, Table2 } from "lucide-react";
import { TeamBadge } from "@/components/TeamBadge";
import { SportIcon } from "@/components/SportIcon";
import type { SportsMatch } from "@/types/sports";
import type { CrossSourcePick } from "@/services/valueEngine";
import { formatMatchTime, formatOdd, formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MatchesBoardProps {
  matches: SportsMatch[];
  picksByMatch: Map<string, CrossSourcePick>;
  onOpenMatch: (match: SportsMatch) => void;
}

/** Tabla escaneable: hora, partido, métrica clave, mejor precio y valor. */
export function MatchesBoard({ matches, picksByMatch, onOpenMatch }: MatchesBoardProps) {
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
          Hora Venezuela (VET) · clic en la fila para el análisis completo
        </p>
      </div>

      {matches.length === 0 ? (
        <p className="px-4 py-10 text-center text-[11px] text-slate-500 dark:text-slate-400">
          No hay partidos pendientes para los filtros seleccionados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-white/[0.06] dark:text-slate-500">
                <th className="px-4 py-2.5">Hora</th>
                <th className="px-3 py-2.5">Partido</th>
                <th className="px-3 py-2.5">Métrica clave</th>
                <th className="px-3 py-2.5">Mejor cuota</th>
                <th className="px-3 py-2.5">Valor</th>
                <th className="px-3 py-2.5 text-right">Análisis</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => {
                const pick = picksByMatch.get(match.id);
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

                return (
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
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        <SportIcon sport={match.sport} className="mr-1 inline h-3 w-3" />
                        {match.league.shortName}
                      </span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
