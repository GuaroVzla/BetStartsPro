"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Database,
  LayoutGrid,
  Moon,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { SPORTS } from "@/config/sports";
import { SportIcon } from "@/components/SportIcon";
import type { DashboardMeta, SportFilter, SportKey } from "@/types/sports";
import { cn } from "@/lib/utils";
import { formatCredits, formatInteger } from "@/lib/format";

interface NavbarProps {
  activeSport: SportFilter;
  onSportChange: (sport: SportFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sportCounts: Record<SportKey, number>;
  totalCount: number;
  meta: DashboardMeta;
  onRefresh: () => void;
  refreshing: boolean;
}

function modeLabel(mode: DashboardMeta["mode"]): string {
  if (mode === "live") return "Live";
  if (mode === "hybrid") return "Híbrido";
  return "Demo";
}

export function Navbar({
  activeSport,
  onSportChange,
  search,
  onSearchChange,
  sportCounts,
  totalCount,
  meta,
  onRefresh,
  refreshing,
}: NavbarProps) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const isLight = !document.documentElement.classList.contains("dark");
    setTheme(isLight ? "light" : "dark");
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const details = detailsRef.current;
      if (!details || !details.open) return;
      if (!details.contains(event.target as Node)) {
        details.open = false;
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.style.colorScheme = next;
    try {
      window.localStorage.setItem("betstats-theme", next);
    } catch {
      // El tema sigue funcionando durante la sesión aunque localStorage no esté disponible.
    }
  }

  const tabs: Array<{
    key: SportFilter;
    label: string;
    count: number;
    icon: React.ReactNode;
  }> = [
    {
      key: "all",
      label: "Todos",
      count: totalCount,
      icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />,
    },
    ...SPORTS.map((sport) => ({
      key: sport.key,
      label: sport.label,
      count: sportCounts[sport.key] ?? 0,
      icon: <SportIcon sport={sport.key} />,
    })),
  ];

  const isDemo = meta.mode === "mock";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-2xl supports-[backdrop-filter]:bg-white/75 dark:border-white/[0.06] dark:bg-ink-950/85 dark:supports-[backdrop-filter]:bg-ink-950/75">
      <div className="mx-auto max-w-[1480px] px-4 sm:px-6">
        <div className="flex h-[66px] items-center gap-3">
          <a href="#top" className="group flex shrink-0 items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-emerald-500 text-emerald-950 shadow-[0_8px_26px_-10px_rgba(16,185,129,0.9)]">
              <span className="absolute inset-0 bg-gradient-to-br from-emerald-300/80 via-emerald-500 to-teal-700" />
              <svg
                viewBox="0 0 24 24"
                className="relative z-[1] h-[19px] w-[19px]"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 19V9m5.5 10V5M15 19v-7m5 7V8"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[17px] font-bold tracking-tight text-slate-950 dark:text-white">
                BetStats
              </span>
              <span className="rounded-md border border-emerald-500/20 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                Pro
              </span>
            </span>
          </a>

          <div className="ml-4 hidden min-w-0 flex-1 md:block">
            <label className="relative block max-w-[360px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                className="input-field h-10 pl-9 pr-9"
                placeholder="Buscar equipo, liga o país..."
                aria-label="Buscar equipo, liga o país"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
          </div>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <details ref={detailsRef} className="group relative">
              <summary
                className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/[0.07] [&::-webkit-details-marker]:hidden"
                aria-label="Consumo de APIs y estado de datos"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isDemo
                      ? "bg-amber-400"
                      : meta.mode === "hybrid"
                        ? "bg-sky-400"
                        : "bg-emerald-400 animate-pulse-soft",
                  )}
                />
                <Database className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{modeLabel(meta.mode)}</span>
                {!isDemo ? (
                  <span className="tabular-nums text-slate-900 dark:text-white">
                    {formatCredits(meta.oddsCreditsRemaining, false)}
                  </span>
                ) : null}
                <ChevronDown className="h-3 w-3 text-slate-400 transition group-open:rotate-180" />
              </summary>

              <div className="absolute right-0 top-11 z-50 w-[292px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-ink-800">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">Estado del motor</span>
                    <span
                      className={cn(
                        "sport-chip border-emerald-400/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
                        isDemo &&
                          "border-amber-400/20 bg-amber-400/10 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {modeLabel(meta.mode)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {isDemo
                      ? "Datos simulados. Añade tus claves en .env.local para usar las APIs reales."
                      : "Datos de eventos y cuotas con caché de 60 minutos."}
                  </p>
                </div>
                <dl className="divide-y divide-slate-100 px-3 dark:divide-white/[0.06]">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">
                      The Odds API
                    </dt>
                    <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                      {isDemo
                        ? "No disponible"
                        : formatCredits(meta.oddsCreditsRemaining, false)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">
                      SportMonks
                    </dt>
                    <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                      {isDemo
                        ? "No disponible"
                        : formatCredits(meta.sportmonksRemaining, false)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">
                      API-Sports
                    </dt>
                    <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                      {isDemo
                        ? "No disponible"
                        : formatCredits(meta.apiSportsRemaining, false)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">
                      Caché de datos
                    </dt>
                    <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                      {formatInteger(meta.cacheTtlSeconds / 60)} min
                    </dd>
                  </div>
                </dl>
                <div className="px-3 pb-2 pt-1">
                  <button
                    type="button"
                    onClick={onRefresh}
                    disabled={refreshing}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.05]"
                  >
                    <RefreshCw
                      className={cn("h-3 w-3", refreshing && "animate-spin")}
                    />
                    Actualizar datos
                  </button>
                </div>
              </div>
            </details>

            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="icon-button hidden sm:inline-flex"
              aria-label="Actualizar datos"
              title="Actualizar datos"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="icon-button"
              aria-label={
                theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
              }
              title={
                theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
              }
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200/70 py-2 dark:border-white/[0.05]">
          <nav
            className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 pb-0.5"
            aria-label="Filtrar por deporte"
          >
            {tabs.map((tab) => {
              const active = activeSport === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onSportChange(tab.key)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold transition",
                    active
                      ? "border-emerald-500/25 bg-emerald-400/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
                      : "border-transparent text-slate-500 hover:bg-slate-100/80 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100",
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "tabular-nums rounded-md px-1.5 py-0.5 text-[10px]",
                      active
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400",
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Motor probabilístico activo
            </span>
          </div>
        </div>

        <div className="pb-3 md:hidden">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="input-field h-10 pl-9 pr-9"
              placeholder="Buscar equipo, liga o país..."
              aria-label="Buscar equipo, liga o país"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>
      </div>
    </header>
  );
}
