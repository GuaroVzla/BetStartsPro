"use client";

import { CalendarDays, ListFilter, Search, X } from "lucide-react";
import { SPORTS, SPORT_BY_KEY } from "@/config/sports";
import { SportIcon } from "@/components/SportIcon";
import type {
  DashboardData,
  LeagueInfo,
  MatchDay,
  SportFilter,
} from "@/types/sports";
import { cn } from "@/lib/utils";

interface QuickFiltersProps {
  day: MatchDay;
  dayCounts: DashboardData["dayCounts"];
  onDayChange: (day: MatchDay) => void;
  activeSport: SportFilter;
  onSportChange: (sport: SportFilter) => void;
  sportCounts: Record<MatchDay, Record<string, number>>;
  activeLeague: string;
  leagues: LeagueInfo[];
  onLeagueChange: (leagueId: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenLeagueManager: () => void;
}

/** Barra única de filtros operativos: fecha, deporte, liga y búsqueda. */
export function QuickFilters({
  day,
  dayCounts,
  onDayChange,
  activeSport,
  onSportChange,
  sportCounts,
  activeLeague,
  leagues,
  onLeagueChange,
  search,
  onSearchChange,
  onOpenLeagueManager,
}: QuickFiltersProps) {
  const counts = sportCounts[day];

  return (
    <section className="panel overflow-hidden p-3 sm:p-4" aria-label="Filtros rápidos">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/[0.03]"
            role="group"
            aria-label="Ventana de fecha"
          >
            {(["today", "tomorrow"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onDayChange(value)}
                aria-pressed={day === value}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50",
                  day === value
                    ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
                )}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {value === "today" ? "Hoy" : "Mañana"}
                <span className="tabular-nums rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] dark:bg-white/10">
                  {dayCounts[value]}
                </span>
              </button>
            ))}
          </div>

          <div className="hidden h-6 w-px bg-slate-200 dark:bg-white/10 lg:block" />

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Deporte">
            {(["all", ...SPORTS.map((sport) => sport.key)] as SportFilter[]).map((key) => {
              const meta = key === "all" ? null : SPORT_BY_KEY[key];
              const count = key === "all" ? dayCounts[day] : (counts[key] ?? 0);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSportChange(key)}
                  aria-pressed={activeSport === key}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50",
                    activeSport === key
                      ? "border-blue-500/25 bg-blue-400/10 text-blue-700 dark:text-blue-300"
                      : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-100",
                  )}
                >
                  {meta ? <SportIcon sport={meta.key} className="h-3.5 w-3.5" /> : null}
                  {meta?.label ?? "Todos"}
                  <span className="tabular-nums opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[180px] flex-1 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Equipo o liga…"
              aria-label="Buscar equipo o liga"
              className="input-field h-9 pl-8 pr-8 text-[11px]"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 dark:hover:text-white"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </label>

          <label className="relative">
            <ListFilter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              value={activeLeague}
              onChange={(event) => onLeagueChange(event.target.value)}
              aria-label="Filtrar por liga"
              className="input-field h-9 appearance-none pl-8 pr-7 text-[11px]"
            >
              <option value="all">Todas las ligas</option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.shortName}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={onOpenLeagueManager} className="btn-ghost h-9 text-[10px]">
            Gestionar ligas
          </button>
        </div>
      </div>
    </section>
  );
}
