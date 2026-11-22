"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Database,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import type {
  DashboardData,
  SportFilter,
  SportKey,
  SportsMatch,
} from "@/types/sports";
import { SPORTS, SPORT_BY_KEY } from "@/config/sports";
import { buildValuePicks } from "@/lib/bettingAnalyzer";
import {
  formatMatchTime,
  formatPercent,
  formatSignedPercent,
  hasMatchStarted,
  isTodayVET,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Navbar } from "@/components/Navbar";
import { MetricCards } from "@/components/MetricCards";
import { HighValueHighOddsList } from "@/components/HighValueHighOddsList";
import { OddsComparator } from "@/components/OddsComparator";
import { MatchIntelDrawer } from "@/components/MatchIntelDrawer";
import { Footer } from "@/components/Footer";
import { SportIcon } from "@/components/SportIcon";

interface DashboardProps {
  initialData: DashboardData;
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function Dashboard({ initialData }: DashboardProps) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [activeSport, setActiveSport] = useState<SportFilter>("all");
  const [activeLeague, setActiveLeague] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(true);
  const [now, setNow] = useState(() => new Date());

  // Reloj vivo: reevalúa periódicamente qué partidos ya comenzaron para
  // retirarlos de la interfaz sin necesidad de recargar la página.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Red de seguridad en cliente: solo partidos de hoy en VET y que aún no
  // hayan comenzado respecto a la hora actual.
  const todayMatches = useMemo(
    () =>
      data.matches.filter(
        (match) =>
          isTodayVET(match.commenceTime) && !hasMatchStarted(match, now),
      ),
    [data.matches, now],
  );

  const todaySportCounts = useMemo(() => {
    const counts: Record<SportKey, number> = {
      soccer: 0,
      basketball: 0,
      baseball: 0,
      hockey: 0,
    };
    for (const match of todayMatches) counts[match.sport] += 1;
    return counts;
  }, [todayMatches]);

  const searchMatches = useMemo(() => {
    const query = normalizeQuery(search);
    if (!query) return todayMatches;
    return todayMatches.filter((match) => {
      const haystack = normalizeQuery(
        [
          match.home.name,
          match.away.name,
          match.home.shortName,
          match.away.shortName,
          match.league.name,
          match.league.shortName,
          match.league.country,
        ].join(" "),
      );
      return haystack.includes(query);
    });
  }, [todayMatches, search]);

  const filteredMatches = useMemo(() => {
    return searchMatches
      .filter((match) => activeSport === "all" || match.sport === activeSport)
      .filter((match) => activeLeague === "all" || match.league.id === activeLeague)
      .sort(
        (a, b) =>
          new Date(a.commenceTime).getTime() -
          new Date(b.commenceTime).getTime(),
      );
  }, [searchMatches, activeSport, activeLeague]);

  const availableLeagues = useMemo(() => {
    const activeIds = new Set(todayMatches.map((match) => match.league.id));
    return data.leagues.filter(
      (league) =>
        activeIds.has(league.id) &&
        (activeSport === "all" || league.sport === activeSport),
    );
  }, [data.leagues, todayMatches, activeSport]);

  const bestValue = useMemo(() => {
    return buildValuePicks(filteredMatches, {
      minProbability: 0.5,
      minOdds: 1.6,
    })[0] ?? null;
  }, [filteredMatches]);

  const selectedMatch = useMemo(() => {
    if (!selectedMatchId) return null;
    return data.matches.find((match) => match.id === selectedMatchId) ?? null;
  }, [data.matches, selectedMatchId]);

  const handleSportChange = useCallback((sport: SportFilter) => {
    setActiveSport(sport);
    setActiveLeague("all");
  }, []);

  const openMatch = useCallback((match: SportsMatch) => {
    setSelectedMatchId(match.id);
  }, []);

  const closeMatch = useCallback(() => {
    setSelectedMatchId(null);
  }, []);

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/matches", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          payload?.error ?? `No se pudo actualizar (HTTP ${response.status})`,
        );
      }
      const next = (await response.json()) as DashboardData;
      setData(next);
      setShowWarnings(true);
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Error de red al actualizar los datos.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  const isDemo = data.meta.mode === "mock";
  const modeCopy =
    data.meta.mode === "live"
      ? "Datos en vivo"
      : data.meta.mode === "hybrid"
        ? "Datos híbridos"
        : "Modo demostración";

  const maxSportCount = Math.max(
    1,
    ...SPORTS.map((sport) => todaySportCounts[sport.key] ?? 0),
  );

  return (
    <div className="min-h-screen">
      <div id="top" />
      <Navbar
        activeSport={activeSport}
        onSportChange={handleSportChange}
        search={search}
        onSearchChange={setSearch}
        sportCounts={todaySportCounts}
        totalCount={todayMatches.length}
        meta={data.meta}
        onRefresh={refreshData}
        refreshing={refreshing}
      />

      <main className="mx-auto max-w-[1480px] px-4 pb-6 pt-5 sm:px-6">
        {refreshError ? (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-3.5 py-2.5 text-[11px] text-rose-700 dark:text-rose-300">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {refreshError}
            </p>
            <button
              type="button"
              onClick={() => setRefreshError(null)}
              className="shrink-0 text-rose-500 hover:text-rose-700 dark:hover:text-rose-200"
              aria-label="Cerrar aviso de error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {showWarnings && (isDemo || data.meta.warnings.length > 0) ? (
          <div
            className={cn(
              "mb-4 flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5",
              isDemo
                ? "border-amber-400/25 bg-amber-400/[0.065]"
                : "border-sky-400/20 bg-sky-400/[0.055]",
            )}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border",
                  isDemo
                    ? "border-amber-400/20 bg-amber-400/10 text-amber-600 dark:text-amber-300"
                    : "border-sky-400/20 bg-sky-400/10 text-sky-600 dark:text-sky-300",
                )}
              >
                {isDemo ? (
                  <Database className="h-3.5 w-3.5" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[11px] font-semibold",
                    isDemo
                      ? "text-amber-800 dark:text-amber-200"
                      : "text-sky-800 dark:text-sky-200",
                  )}
                >
                  {modeCopy}
                  {isDemo
                    ? " · dataset realista simulado para explorar la plataforma"
                    : " · hay avisos de cobertura de las APIs"}
                </p>
                <p
                  className={cn(
                    "mt-0.5 line-clamp-2 text-[10px] leading-relaxed",
                    isDemo
                      ? "text-amber-800/70 dark:text-amber-100/60"
                      : "text-sky-800/70 dark:text-sky-100/60",
                  )}
                >
                  {data.meta.warnings[0] ??
                    "Sin incidencias relevantes en las fuentes de datos."}
                </p>
                {data.meta.warnings.length > 1 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[9px] font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
                      Ver todos los avisos ({data.meta.warnings.length})
                    </summary>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[9px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {data.meta.warnings.slice(1).map((warning, index) => (
                        <li key={`${index}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowWarnings(false)}
              className="shrink-0 text-slate-400 transition hover:text-slate-700 dark:hover:text-white"
              aria-label="Ocultar aviso de datos"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <section className="relative mt-1">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
            <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-emerald-400/[0.09] blur-[90px] dark:bg-emerald-400/[0.12]" />
            <div className="absolute right-0 top-10 h-64 w-64 rounded-full bg-sky-400/[0.07] blur-[90px] dark:bg-sky-500/[0.09]" />
          </div>

          <div className="grid items-center gap-8 py-5 lg:grid-cols-[minmax(0,1fr)_370px] lg:py-8">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-live">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-soft dark:bg-emerald-400" />
                  {modeCopy}
                </span>
                <span className="rounded-full border border-slate-200 bg-white/65 px-2.5 py-1 text-[10px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                  Actualizado a las {formatMatchTime(data.meta.generatedAt)} · hora Venezuela
                </span>
                <span className="rounded-full border border-slate-200 bg-white/65 px-2.5 py-1 text-[10px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                  Caché {Math.round(data.meta.cacheTtlSeconds / 60)} min
                </span>
              </div>

              <h1 className="mt-5 max-w-3xl text-balance text-[34px] font-bold leading-[1.07] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-5xl lg:text-[54px]">
                El valor no está en la suerte.
                <br />
                <span className="bg-gradient-to-r from-emerald-500 via-emerald-400 to-lime-400 bg-clip-text text-transparent dark:from-emerald-300 dark:via-emerald-400 dark:to-lime-300">
                  Está en los datos.
                </span>
              </h1>
              <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-slate-600 dark:text-slate-400 sm:text-sm">
                Cuotas cruzadas de múltiples casas, clasificaciones, forma,
                localía y bajas para fútbol, básquet, béisbol y hockey. Un único
                radar para detectar dónde el precio paga más que la probabilidad.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <a href="#radar" className="btn-primary">
                  <TrendingUp className="h-4 w-4" />
                  Ver radar de valor
                </a>
                <a href="#comparador" className="btn-ghost">
                  Comparar cuotas
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  Solo 4 deportes, sin ruido
                </span>
                <span className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-emerald-500" />
                  APIs con fallback automático
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  EV y probabilidad implícita
                </span>
              </div>
            </div>

            <div className="panel relative overflow-hidden p-4 sm:p-5 lg:justify-self-end">
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-400/10 blur-2xl" />
              <div className="relative flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Cobertura del día</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                    Una sola capa de datos
                  </p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
                  <Database className="h-4 w-4" />
                </span>
              </div>

              <div className="relative mt-4 space-y-2.5">
                {SPORTS.map((sport) => {
                  const meta = SPORT_BY_KEY[sport.key];
                  const count = todaySportCounts[sport.key] ?? 0;
                  return (
                    <button
                      key={sport.key}
                      type="button"
                      onClick={() => handleSportChange(sport.key)}
                      className="group flex w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border"
                        style={{
                          color: meta.accent,
                          borderColor: `${meta.accent}25`,
                          backgroundColor: `${meta.accent}10`,
                        }}
                      >
                        <SportIcon sport={sport.key} className="h-3.5 w-3.5" />
                      </span>
                      <span className="w-[72px] shrink-0 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        {meta.label}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
                        <span
                          className="block h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max(4, (count / maxSportCount) * 100)}%`,
                            backgroundColor: meta.accent,
                          }}
                        />
                      </span>
                      <span className="tabular-nums w-5 text-right text-[11px] font-bold text-slate-800 dark:text-slate-100">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[9px] text-slate-400 dark:border-white/[0.06] dark:text-slate-500">
                <span className="tabular-nums">
                  {todayMatches.length} eventos de hoy ·{" "}
                  {new Set(todayMatches.map((match) => match.league.id)).size} ligas
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Motor activo
                </span>
              </div>
            </div>
          </div>
        </section>

        <MetricCards
          matches={filteredMatches}
          leagueCount={
            new Set(filteredMatches.map((match) => match.league.id)).size
          }
          bestPick={bestValue}
        />

        <div className="mt-5">
          <HighValueHighOddsList
            matches={filteredMatches}
            activeSport={activeSport}
            onSportChange={handleSportChange}
            onOpenMatch={openMatch}
          />
        </div>

        <div className="mt-9">
          <OddsComparator
            matches={filteredMatches}
            leagues={availableLeagues}
            activeLeague={activeLeague}
            onLeagueChange={setActiveLeague}
            activeSport={activeSport}
            onSportChange={handleSportChange}
            onOpenMatch={openMatch}
          />
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/60 px-4 py-4 dark:border-white/[0.07] dark:bg-white/[0.02] sm:flex-row sm:items-center">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <RefreshCw className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                Datos con caché de 60 minutos
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                Protegemos las claves y la cuota gratuita de las APIs. Pulsa
                actualizar para solicitar la última ventana de datos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshData}
            disabled={refreshing}
            className="btn-ghost w-full shrink-0 text-xs sm:w-auto"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Actualizando..." : "Actualizar ahora"}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400 dark:text-slate-500">
          <p>
            Mejor EV visible:{" "}
            <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-300">
              {bestValue
                ? `${formatSignedPercent(bestValue.analysis.expectedValue)} · ${formatPercent(bestValue.analysis.modelProbability)}`
                : "sin picks con los umbrales actuales"}
            </span>
          </p>
          <a
            href="#legal"
            className="inline-flex items-center gap-1 transition hover:text-slate-700 dark:hover:text-slate-300"
          >
            Juego responsable · +18
          </a>
        </div>
      </main>

      <Footer mode={data.meta.mode} />
      <MatchIntelDrawer match={selectedMatch} onClose={closeMatch} />
    </div>
  );
}
