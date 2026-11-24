"use client";

import { useEffect, useMemo, useRef } from "react";
import { Check, ListFilter, RotateCcw, X } from "lucide-react";
import type { LeagueInfo } from "@/types/sports";
import { SPORTS } from "@/config/sports";
import { SportIcon } from "@/components/SportIcon";
import { leagueOrigin } from "@/lib/leagueOrigin";
import { cn } from "@/lib/utils";

interface LeagueManagerProps {
  leagues: LeagueInfo[];
  disabled: string[];
  matchCounts: Record<string, number>;
  onToggle: (leagueId: string) => void;
  onReset: () => void;
  onEnableAll: () => void;
  onClose: () => void;
}

export function LeagueManager({
  leagues,
  disabled,
  matchCounts,
  onToggle,
  onReset,
  onEnableAll,
  onClose,
}: LeagueManagerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const disabledSet = useMemo(() => new Set(disabled), [disabled]);
  const grouped = useMemo(
    () =>
      SPORTS.map((sport) => ({
        sport,
        leagues: leagues
          .filter((league) => league.sport === sport.key)
          .sort((a, b) => a.name.localeCompare(b.name)),
      })).filter((group) => group.leagues.length > 0),
    [leagues],
  );

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const actionButtonClass =
    "rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/[0.07]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="league-manager-title"
        className="panel relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden sm:max-w-md"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/[0.06]">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-400/10 text-blue-600 dark:text-blue-300">
              <ListFilter className="h-4 w-4" />
            </span>
            <div>
              <h2
                id="league-manager-title"
                className="text-sm font-bold text-slate-950 dark:text-white"
              >
                Gestión de ligas
              </h2>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                Las ligas desactivadas se excluyen del radar y los KPIs.
                La selección se guarda en este navegador.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-button shrink-0"
            aria-label="Cerrar gestión de ligas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resumen y acciones rápidas */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-5 py-2.5 dark:border-white/[0.06]">
          <span className="tabular-nums text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {leagues.length - disabled.length} de {leagues.length} ligas activas
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onEnableAll} className={actionButtonClass}>
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" />
                Todas
              </span>
            </button>
            <button type="button" onClick={onReset} className={actionButtonClass}>
              <span className="inline-flex items-center gap-1">
                <RotateCcw className="h-3 w-3" />
                Restablecer
              </span>
            </button>
          </div>
        </div>

        {/* Lista de ligas */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {grouped.map(({ sport, leagues: groupLeagues }) => (
            <div key={sport.key} className="mb-4 last:mb-0">
              <div className="mb-1.5 flex items-center gap-1.5">
                <SportIcon
                  sport={sport.key}
                  className="h-3.5 w-3.5 text-blue-500 dark:text-blue-300"
                />
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                  {sport.label}
                </p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.015]">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_auto] items-center gap-x-2 border-b border-slate-200/70 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.06] dark:text-slate-500 sm:grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)_auto]">
                  <span>Liga</span>
                  <span>País / Torneo</span>
                  <span className="w-9">
                    <span className="sr-only">Estado</span>
                  </span>
                </div>
                <ul className="divide-y divide-slate-100/80 dark:divide-white/[0.05]">
                  {groupLeagues.map((league) => {
                    const enabled = !disabledSet.has(league.id);
                    const origin = leagueOrigin(league);
                    return (
                      <li
                        key={league.id}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_auto] items-center gap-x-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)_auto]"
                      >
                        <div className="min-w-0">
                          <p
                            className="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100"
                            title={league.name}
                          >
                            {league.name}
                          </p>
                          <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                            {matchCounts[league.id] ?? 0} partido(s) en ventana
                          </p>
                        </div>
                        <div className="min-w-0">
                          <span
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold",
                              origin.isInternational
                                ? "border-violet-400/25 bg-violet-400/10 text-violet-700 dark:border-violet-300/20 dark:bg-violet-300/10 dark:text-violet-200"
                                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300",
                            )}
                            title={origin.iso2 ? `${origin.label} (${origin.iso2})` : origin.label}
                          >
                            <span aria-hidden="true">{origin.flag}</span>
                            <span className="truncate">{origin.label}</span>
                          </span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${enabled ? "Desactivar" : "Activar"} ${league.name}`}
                          onClick={() => onToggle(league.id)}
                          className={cn(
                            "relative h-5 w-9 shrink-0 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40",
                            enabled
                              ? "border-blue-400/40 bg-blue-500"
                              : "border-slate-300 bg-slate-200 dark:border-white/15 dark:bg-white/10",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all",
                              enabled ? "left-[18px]" : "left-0.5",
                            )}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 px-5 py-3 dark:border-white/[0.06]">
          <p className="text-[9px] text-slate-400 dark:text-slate-500">
            Persistencia local · se sincroniza al instante con todo el dashboard.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary h-8 px-4 text-[11px]"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
