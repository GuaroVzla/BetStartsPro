"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Database, Moon, RefreshCw, Sun } from "lucide-react";
import type { DashboardMeta } from "@/types/sports";
import { cn } from "@/lib/utils";
import { formatCredits, formatInteger } from "@/lib/format";

interface NavbarProps {
  meta: DashboardMeta;
  todayCount: number;
  onRefresh: () => void;
  refreshing: boolean;
}

function modeLabel(mode: DashboardMeta["mode"]): string {
  return mode === "hybrid" ? "Híbrido" : "Live";
}

/** Barra global: marca, estado de las fuentes, tema y recarga. Los filtros
 *  operativos (fecha/deporte/liga/búsqueda) viven en QuickFilters. */
export function Navbar({ meta, todayCount, onRefresh, refreshing }: NavbarProps) {
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
      if (!details.contains(event.target as Node)) details.open = false;
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
      // El tema sigue funcionando durante la sesión.
    }
  }

  const hasLiveSources =
    meta.sources.oddsApi ||
    meta.sources.sportmonks ||
    meta.sources.apiSports ||
    meta.sources.espn ||
    meta.sources.sportsdb ||
    meta.sources.curated ||
    meta.sources.flashscore;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-2xl supports-[backdrop-filter]:bg-white/75 dark:border-white/[0.06] dark:bg-ink-950/85 dark:supports-[backdrop-filter]:bg-ink-950/75">
      <div className="mx-auto flex h-[62px] max-w-[1480px] items-center gap-3 px-4 sm:px-6">
        <a href="#top" className="group flex shrink-0 items-center gap-2.5">
          <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-blue-500 text-blue-950 shadow-[0_8px_26px_-10px_rgba(37,99,235,0.9)]">
            <span className="absolute inset-0 bg-gradient-to-br from-blue-300/80 via-blue-500 to-sky-700" />
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
            <span className="rounded-md border border-blue-500/20 bg-blue-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
              Pro
            </span>
          </span>
        </a>

        <span className="ml-2 hidden items-center gap-2 rounded-full border border-slate-200/80 px-3 py-1.5 text-[10px] font-medium text-slate-500 dark:border-white/10 dark:text-slate-400 sm:inline-flex">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              meta.mode === "hybrid" ? "bg-sky-400" : "bg-emerald-400 animate-pulse-soft",
            )}
          />
          {modeLabel(meta.mode)} · {formatInteger(todayCount)} hoy
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <details ref={detailsRef} className="group relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/20 [&::-webkit-details-marker]:hidden">
              <Database className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Fuentes</span>
              <ChevronDown className="h-3 w-3 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 top-11 z-50 w-[292px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-ink-800">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Estado del motor</span>
                  <span className="sport-chip border-blue-400/20 bg-blue-400/10 text-blue-700 dark:text-blue-300">
                    {modeLabel(meta.mode)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {hasLiveSources
                    ? "Datos de eventos y cuotas de las fuentes conectadas."
                    : "Faltan claves/fuentes configuradas. Configura las APIs para obtener datos reales."}
                </p>
              </div>
              <dl className="divide-y divide-slate-100 px-3 dark:divide-white/[0.06]">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">The Odds API</dt>
                  <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                    {formatCredits(meta.oddsCreditsRemaining)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">SportMonks</dt>
                  <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                    {formatCredits(meta.sportmonksRemaining)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">API-Sports</dt>
                  <dd className="tabular-nums text-xs font-semibold text-slate-900 dark:text-white">
                    {formatCredits(meta.apiSportsRemaining)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">ESPN (gratis)</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.espn ? "Conectado" : "Sin datos hoy"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">TheSportsDB (gratis)</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.sportsdb ? "Conectado" : "Sin key/datos"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">OpenLigaDB (gratis)</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.openligadb ? "Conectado" : "Sin datos hoy"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Flashscore</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.flashscore ? "Conectado" : "Sin captura"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">ETL curado</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.curated ? "Conectado" : "Sin captura"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">The Analyst</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.theAnalyst ? "Conectado" : "Sin captura"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Triunfobet</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.triunfobet ? "Conectado" : "Sin captura"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Apuestas Royal</dt>
                  <dd className="text-xs font-semibold text-slate-900 dark:text-white">
                    {meta.sources.apuestasRoyal ? "Conectado" : "Sin captura"}
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
                  <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
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
            aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
            title={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
