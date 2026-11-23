"use client";

import { useState } from "react";
import type {
  SportsMatch,
  OutcomeKey,
  SportFilter,
} from "@/types/sports";
import type {
  PredictiveSnapshot,
  DashboardAnalytics,
} from "@/types/predictive";
import { cn } from "@/lib/utils";
import {
  formatPercent,
  formatCompact,
  formatSignedPercent,
} from "@/lib/format";
import { SportIcon } from "@/components/SportIcon";
import { TeamBadge } from "@/components/TeamBadge";

interface MatchAnalyticsTableProps {
  matches: SportsMatch[];
  analytics: DashboardAnalytics;
  activeLeague: string;
  activeSport: SportFilter;
  onOpenDetail: (match: SportsMatch, outcome?: OutcomeKey) => void;
}

type SortField = "time" | "confidence";
type SortDirection = "asc" | "desc";

interface RowData {
  match: SportsMatch;
  snapshot: PredictiveSnapshot | null;
}

const CONFIDENCE_PILLS: Record<PredictiveSnapshot["confidence"], string> = {
  high:
    "border-emerald-400/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
  medium:
    "border-amber-400/25 bg-amber-400/10 text-amber-700 dark:text-amber-300",
  low:
    "border-rose-400/25 bg-rose-400/10 text-rose-700 dark:text-rose-300",
};

const CONFIDENCE_LABELS: Record<PredictiveSnapshot["confidence"], string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const EV_TONE: Record<"up" | "flat" | "down", string> = {
  up: "text-emerald-600 dark:text-emerald-300",
  flat: "text-slate-500 dark:text-slate-400",
  down: "text-rose-600 dark:text-rose-300",
};

function evTone(ev: number): "up" | "flat" | "down" {
  return ev > 0 ? "up" : ev < 0 ? "down" : "flat";
}

export function MatchAnalyticsTable({
  analytics,
  activeLeague,
  activeSport,
  onOpenDetail,
}: MatchAnalyticsTableProps) {
  const [sort, setSort] = useState<{
    field: SortField;
    direction: SortDirection;
  }>({
    field: "confidence",
    direction: "desc",
  });

  // Datos de partidos con el snapshot predictivo asociado
  const allMatches: RowData[] = analytics.data.matches.map(
    (match: SportsMatch) => {
      const snapshot =
        analytics.snapshots.find((s) => s.matchId === match.id) || null;
      return { match, snapshot };
    },
  );

  // Filtrar por liga y deporte
  const filtered = allMatches.filter((item) => {
    if (activeSport !== "all" && item.match.sport !== activeSport) return false;
    if (activeLeague !== "all" && item.match.league.id !== activeLeague) {
      return false;
    }
    return true;
  });

  // Ordenar: por confianza (desc/asc) o por hora
  const sorted = filtered.sort((a, b) => {
    if (sort.field === "time") {
      const aTime = new Date(a.match.commenceTime).getTime();
      const bTime = new Date(b.match.commenceTime).getTime();
      return sort.direction === "asc" ? aTime - bTime : bTime - aTime;
    }
    const aConf = a.snapshot?.confidenceScore ?? 0;
    const bConf = b.snapshot?.confidenceScore ?? 0;
    return sort.direction === "asc" ? aConf - bConf : bConf - aConf;
  });

  const handleSort = (field: SortField) => {
    setSort((current) => ({
      field,
      direction:
        current.field === field && current.direction === "desc"
          ? "asc"
          : "desc",
    }));
  };

  const handleRowClick = (match: SportsMatch) => {
    onOpenDetail(match);
  };

  return (
    <div className="panel overflow-hidden">
      {/* Cabecera de la tabla */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-4 sm:px-5 dark:border-white/[0.07]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="eyebrow">Análisis de partidos</span>
          <h2 className="truncate text-lg font-bold text-slate-950 dark:text-white sm:text-xl">
            Resultados del día
          </h2>
          <span className="hidden sm:block rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-[10px] text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
            {new Date().toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
          </span>
        </div>
        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
          {sorted.length} partidos{" "}
          {activeSport !== "all"
            ? `de ${activeSport.charAt(0).toUpperCase() + activeSport.slice(1)}`
            : ""}
        </p>
      </div>

      {/* Contenedor de la tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b border-slate-100/80 dark:border-white/[0.05]">
            <tr className="table-head">
              <th className="px-4 py-3.5">Hora</th>
              <th className="px-4 py-3.5">Liga</th>
              <th className="px-4 py-3.5">Evento</th>
              <th className="px-4 py-3.5">Cuotas de mercado</th>
              <th className="px-4 py-3.5">Favorito · probabilidad</th>
              <th className="px-4 py-3.5">Confianza · valor esperado</th>
              <th className="px-4 py-3.5 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80 dark:divide-white/[0.04]">
            {sorted.map((item) => (
              <tr
                key={item.match.id}
                className="cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.035]"
                onClick={() => handleRowClick(item.match)}
              >
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                    {new Date(item.match.commenceTime).toLocaleTimeString(
                      "es-ES",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Caracas",
                      },
                    )}
                  </span>
                </td>

                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <SportIcon
                      sport={item.match.sport}
                      className="h-3.5 w-3.5 text-blue-500 dark:text-blue-300"
                    />
                    <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      {item.match.league.name}
                    </span>
                  </div>
                </td>

                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <TeamBadge team={item.match.home} size="sm" />
                    <span
                      className="h-px w-6 bg-slate-100 dark:bg-white/[0.06]"
                      aria-hidden="true"
                    />
                    <TeamBadge team={item.match.away} size="sm" />
                  </div>
                </td>

                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-1.5">
                    {item.match.odds.best.home > 1 ? (
                      <span className="rounded-lg border border-blue-400/25 bg-blue-400/10 px-2.5 py-1.5 text-[11px] font-bold text-blue-600 dark:text-blue-300">
                        Triunfobet · {formatCompact(item.match.odds.best.home)}
                      </span>
                    ) : null}
                    {item.match.odds.best.away > 1 ? (
                      <span className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-300">
                        Apuestas Royal · {formatCompact(item.match.odds.best.away)}
                      </span>
                    ) : null}
                    {item.match.odds.best.draw &&
                    item.match.odds.best.draw > 1 ? (
                      <span className="rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200">
                        Empate · {formatCompact(item.match.odds.best.draw)}
                      </span>
                    ) : null}
                  </div>
                </td>

                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      {item.match.favoriteSide === "home"
                        ? item.match.home.name
                        : item.match.away.name}
                    </span>
                    {item.snapshot ? (
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[10px] font-bold tabular-nums",
                          CONFIDENCE_PILLS[item.snapshot.confidence],
                        )}
                      >
                        {formatPercent(item.snapshot.estimatedProbability)}%
                      </span>
                    ) : null}
                  </div>
                </td>

                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    {item.snapshot ? (
                      <>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase",
                            CONFIDENCE_PILLS[item.snapshot.confidence],
                          )}
                        >
                          {CONFIDENCE_LABELS[item.snapshot.confidence]} ·{" "}
                          {item.snapshot.confidenceScore}%
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-bold tabular-nums",
                            EV_TONE[evTone(item.snapshot.expectedValue)],
                          )}
                        >
                          {formatSignedPercent(item.snapshot.expectedValue)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </td>

                <td className="px-4 py-3.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleRowClick(item.match)}
                    className="rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:border-blue-400/40 hover:text-blue-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-blue-300"
                  >
                    Ver detalles →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
