"use client";

import { ArrowUpRight, Crosshair, Sparkles } from "lucide-react";
import type { SportsMatch } from "@/types/sports";
import type { CrossSourcePick } from "@/services/valueEngine";
import {
  formatMatchTime,
  formatOdd,
  formatPercent,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

interface TopPicksProps {
  picks: CrossSourcePick[];
  onOpenMatch: (match: SportsMatch) => void;
}

/** Resumen compacto de las mejores oportunidades del día (estilo ticker). */
export function TopPicks({ picks, onOpenMatch }: TopPicksProps) {
  return (
    <section aria-labelledby="top-picks-title" className="panel p-3.5 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
            <Crosshair className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 id="top-picks-title" className="text-[12px] font-bold text-slate-900 dark:text-white">
              Top picks
            </h2>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Cruce de 4 fuentes · ordenado por valor esperado
            </p>
          </div>
        </div>
        <span className="badge-live">
          <Sparkles className="h-3 w-3" />
          {picks.length} señales
        </span>
      </div>

      {picks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
          No hay oportunidades con suficiente respaldo estadístico en esta ventana.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {picks.slice(0, 4).map((pick) => (
            <button
              key={pick.id}
              type="button"
              onClick={() => onOpenMatch(pick.match)}
              className="group rounded-xl border border-slate-200/80 bg-white/70 p-3 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:border-emerald-400/25"
            >
              <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                <span className="truncate">{pick.match.league.shortName}</span>
                <span className="tabular-nums">{formatMatchTime(pick.match.commenceTime)}</span>
              </div>
              <p className="mt-1 truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                {pick.match.home.shortName} <span className="text-slate-300 dark:text-slate-600">vs</span>{" "}
                {pick.match.away.shortName}
              </p>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-[18px] font-bold tabular-nums text-slate-950 dark:text-white">
                    {formatOdd(pick.bestOdds)}
                  </span>
                  <span className="ml-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                    {pick.bookmaker}
                  </span>
                </div>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    pick.edge >= 0.05
                      ? "bg-emerald-400/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-sky-400/15 text-sky-700 dark:text-sky-300",
                  )}
                >
                  {formatSignedPercent(pick.edge)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                <span className="truncate">
                  {pick.selection} · {formatPercent(pick.statisticalProbability)} · {pick.probabilitySource} · conf. {formatPercent(pick.confidence, 0)}
                </span>
                <ArrowUpRight className="h-3 w-3 shrink-0 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
