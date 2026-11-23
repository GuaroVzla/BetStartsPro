"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import type {
  DashboardData,
  MatchDay,
  SportFilter,
  SportKey,
  SportsMatch,
} from "@/types/sports";
import { SPORTS } from "@/config/sports";
import { formatMatchTime, formatPercent, hasMatchStarted, matchDayVET } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Navbar } from "@/components/Navbar";
import { QuickFilters } from "@/components/QuickFilters";
import { TopPicks } from "@/components/TopPicks";
import { MatchesBoard } from "@/components/MatchesBoard";
import { MatchIntelDrawer } from "@/components/MatchIntelDrawer";
import { Footer } from "@/components/Footer";
import { LeagueManager } from "@/components/LeagueManager";
import { MatchAnalyticsTable } from "@/components/MatchAnalyticsTable";
import { MatchAnalyticsFilterPanel } from "@/components/MatchAnalyticsFilterPanel";
import type { Filters } from "@/components/MatchAnalyticsFilterPanel";
import { MatchAnalyticsModal } from "@/components/MatchAnalyticsModal";
import { OddsComparator } from "@/components/OddsComparator";
import { getAnalyticsFromData } from "@/services/ingestionPipeline";
import { buildCrossSourcePicks } from "@/services/valueEngine";
import type { DashboardAnalytics } from "@/types/predictive";

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
  const [dayFilter, setDayFilter] = useState<MatchDay>("today");
  const [activeSport, setActiveSport] = useState<SportFilter>("all");
  const [activeLeague, setActiveLeague] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [showLeagueManager, setShowLeagueManager] = useState(false);
  const [disabledLeagues, setDisabledLeagues] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("betstats-pro-disabled-leagues");
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [analyticsDetail, setAnalyticsDetail] = useState<SportsMatch | null>(null);
  const [analyticsFilters, setAnalyticsFilters] = useState<Filters | null>(null);

  // Reloj vivo: retira partidos iniciados sin recargar la página.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const disabledSet = useMemo(() => new Set(disabledLeagues), [disabledLeagues]);

  const upcomingMatches = useMemo(
    () =>
      data.matches.filter(
        (match) =>
          !disabledSet.has(match.league.id) &&
          matchDayVET(match.commenceTime, now) !== null &&
          !hasMatchStarted(match, now),
      ),
    [data.matches, now, disabledSet],
  );

  const sportCountsByDay = useMemo(() => {
    const counts: Record<MatchDay, Record<string, number>> = {
      today: {},
      tomorrow: {},
    };
    for (const match of upcomingMatches) {
      const day = matchDayVET(match.commenceTime, now);
      if (!day) continue;
      counts[day][match.sport] = (counts[day][match.sport] ?? 0) + 1;
    }
    return counts;
  }, [upcomingMatches, now]);

  const dayMatches = useMemo(
    () =>
      upcomingMatches.filter(
        (match) => matchDayVET(match.commenceTime, now) === dayFilter,
      ),
    [upcomingMatches, dayFilter, now],
  );

  const searchMatches = useMemo(() => {
    const query = normalizeQuery(search);
    if (!query) return dayMatches;
    return dayMatches.filter((match) =>
      normalizeQuery(
        [
          match.home.name,
          match.away.name,
          match.home.shortName,
          match.away.shortName,
          match.league.name,
          match.league.shortName,
          match.league.country,
        ].join(" "),
      ).includes(query),
    );
  }, [dayMatches, search]);

  const filteredMatches = useMemo(
    () =>
      searchMatches
        .filter((match) => activeSport === "all" || match.sport === activeSport)
        .filter((match) => activeLeague === "all" || match.league.id === activeLeague)
        .sort(
          (a, b) =>
            new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime(),
        ),
    [searchMatches, activeSport, activeLeague],
  );

  const availableLeagues = useMemo(() => {
    const activeIds = new Set(dayMatches.map((match) => match.league.id));
    return data.leagues.filter(
      (league) =>
        activeIds.has(league.id) &&
        (activeSport === "all" || league.sport === activeSport),
    );
  }, [data.leagues, dayMatches, activeSport]);

  const analytics = useMemo<DashboardAnalytics>(
    () => getAnalyticsFromData(data),
    [data],
  );

  const crossPicks = useMemo(
    () =>
      buildCrossSourcePicks(upcomingMatches, {
        day: dayFilter,
        now,
        maxPicks: 12,
      }),
    [upcomingMatches, dayFilter, now],
  );

  const picksByMatch = useMemo(() => {
    const map = new Map<string, (typeof crossPicks)[number]>();
    for (const pick of crossPicks) {
      const current = map.get(pick.match.id);
      if (!current || pick.expectedValue > current.expectedValue) {
        map.set(pick.match.id, pick);
      }
    }
    return map;
  }, [crossPicks]);

  const snapshotsByMatch = useMemo(() => {
    const map = new Map<string, (typeof analytics.snapshots)[number]>();
    for (const snapshot of analytics.snapshots) {
      const current = map.get(snapshot.matchId);
      if (!current || snapshot.estimatedProbability > current.estimatedProbability) {
        map.set(snapshot.matchId, snapshot);
      }
    }
    return map;
  }, [analytics.snapshots]);

  const analyticsRows = useMemo(() => {
    const rows = analytics.data.matches.filter(
      (match) => matchDayVET(match.commenceTime, now) === dayFilter,
    );
    if (!analyticsFilters) return rows;
    const f = analyticsFilters;
    let out = rows;
    if (f.sports.length > 0) out = out.filter((m) => f.sports.includes(m.sport));
    if (f.leagueIds.length > 0) out = out.filter((m) => f.leagueIds.includes(m.league.id));
    const query = normalizeQuery(f.search);
    if (query) {
      out = out.filter((m) =>
        normalizeQuery(
          [
            m.home.name,
            m.away.name,
            m.home.shortName,
            m.away.shortName,
            m.league.name,
            m.league.shortName,
            m.league.country,
          ].join(" "),
        ).includes(query),
      );
    }
    if (f.minOdds > 0) {
      out = out.filter((m) =>
        Math.max(m.odds.best.home, m.odds.best.away, m.odds.best.draw ?? 0) >= f.minOdds,
      );
    }
    return out.filter((m) => {
      const snapshot = analytics.snapshots.find((s) => s.matchId === m.id);
      if (f.confidence !== "all" && snapshot?.confidence !== f.confidence) return false;
      if (f.recommendation !== "all" && snapshot?.recommendation !== f.recommendation) {
        return false;
      }
      return true;
    });
  }, [analytics, analyticsFilters, dayFilter, now]);

  const matchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const match of data.matches) {
      counts[match.league.id] = (counts[match.league.id] ?? 0) + 1;
    }
    return counts;
  }, [data.matches]);

  const updateDisabledLeagues = useCallback(
    (updater: (current: string[]) => string[]) => {
      setDisabledLeagues((current) => {
        const next = updater(current);
        try {
          window.localStorage.setItem("betstats-pro-disabled-leagues", JSON.stringify(next));
        } catch {
          // Sin storage la selección no persiste.
        }
        return next;
      });
    },
    [],
  );

  const handleSportChange = useCallback((sport: SportFilter) => {
    setActiveSport(sport);
    setActiveLeague("all");
  }, []);

  const openMatch = useCallback((match: SportsMatch) => setSelectedMatchId(match.id), []);
  const closeMatch = useCallback(() => setSelectedMatchId(null), []);

  const selectedMatch = useMemo(
    () => data.matches.find((match) => match.id === selectedMatchId) ?? null,
    [data.matches, selectedMatchId],
  );

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/matches?refresh=1", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `No se pudo actualizar (HTTP ${response.status})`);
      }
      setData((await response.json()) as DashboardData);
      setShowWarnings(true);
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : "Error de red al actualizar los datos.",
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
  const topPick = crossPicks[0];

  return (
    <div className="min-h-screen">
      <div id="top" />
      <Navbar meta={data.meta} todayCount={sportCountsByDay.today.soccer + sportCountsByDay.today.basketball + sportCountsByDay.today.baseball + sportCountsByDay.today.hockey} onRefresh={refreshData} refreshing={refreshing} />

      <main className="mx-auto max-w-[1480px] px-4 pb-6 pt-4 sm:px-6">
        {refreshError ? (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-3.5 py-2.5 text-[11px] text-rose-700 dark:text-rose-300">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {refreshError}
            </p>
            <button type="button" onClick={() => setRefreshError(null)} aria-label="Cerrar aviso" className="shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {showWarnings && (isDemo || data.meta.warnings.length > 0) ? (
          <div
            className={cn(
              "mb-3 flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5",
              isDemo
                ? "border-amber-400/25 bg-amber-400/[0.065]"
                : "border-sky-400/20 bg-sky-400/[0.055]",
            )}
          >
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {modeCopy} · actualizado a las {formatMatchTime(data.meta.generatedAt)} VET
              </p>
              <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                {data.meta.warnings[0] ?? "Sin incidencias relevantes en las fuentes de datos."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowWarnings(false)}
              className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-white"
              aria-label="Ocultar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">Radar de valor · {SPORTS.length} deportes</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
              Mercado y estadística, en una sola vista
            </h1>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Mejor señal:{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-300">
              {topPick
                ? `${topPick.selection} ${formatPercent(topPick.statisticalProbability)} · +${((topPick.edge) * 100).toFixed(1)}% edge`
                : "sin señales con los umbrales actuales"}
            </span>
          </p>
        </header>

        <QuickFilters
          day={dayFilter}
          dayCounts={data.dayCounts}
          onDayChange={setDayFilter}
          activeSport={activeSport}
          onSportChange={handleSportChange}
          sportCounts={sportCountsByDay}
          activeLeague={activeLeague}
          leagues={availableLeagues}
          onLeagueChange={setActiveLeague}
          search={search}
          onSearchChange={setSearch}
          onOpenLeagueManager={() => setShowLeagueManager(true)}
        />

        <div className="mt-3">
          <TopPicks picks={crossPicks} onOpenMatch={openMatch} />
        </div>

        <div className="mt-3">
          <MatchesBoard
            matches={filteredMatches}
            picksByMatch={picksByMatch}
            snapshotsByMatch={snapshotsByMatch}
            onOpenMatch={openMatch}
          />
        </div>

        <details className="panel mt-3 p-3.5 sm:p-4">
          <summary className="cursor-pointer rounded text-[11px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 dark:text-slate-200">
            Análisis predictivo avanzado
          </summary>
          <div className="mt-3">
            <MatchAnalyticsFilterPanel
              analytics={analytics}
              data={data}
              activeLeague={activeLeague}
              activeSport={activeSport}
              onApplyFilters={setAnalyticsFilters}
            />
            <MatchAnalyticsTable
              matches={analyticsRows}
              analytics={analytics}
              activeLeague={activeLeague}
              activeSport={activeSport}
              onOpenDetail={setAnalyticsDetail}
            />
          </div>
        </details>

        <details className="panel mt-3 p-3.5 sm:p-4">
          <summary className="cursor-pointer rounded text-[11px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 dark:text-slate-200">
            Comparador de cuotas por casa
          </summary>
          <div className="mt-3">
            <OddsComparator
              matches={filteredMatches}
              leagues={availableLeagues}
              activeLeague={activeLeague}
              onLeagueChange={setActiveLeague}
              activeSport={activeSport}
              onSportChange={handleSportChange}
              onOpenMatch={openMatch}
              dayLabel={dayFilter === "today" ? "Hoy" : "Mañana"}
            />
          </div>
        </details>

        <div className="mt-3 flex flex-col items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/60 px-4 py-3 dark:border-white/[0.07] dark:bg-white/[0.02] sm:flex-row sm:items-center">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <RefreshCw className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                Datos con caché de {Math.round(data.meta.cacheTtlSeconds / 60)} min
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                «Actualizar ahora» fuerza una nueva ventana sin esperar al TTL.
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

        <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
          Juego responsable · +18 · Las cuotas y probabilidades son informativas, no una garantía de resultado.
        </p>
      </main>

      <Footer mode={data.meta.mode} />
      <MatchIntelDrawer match={selectedMatch} onClose={closeMatch} />

      {analyticsDetail ? (
        <MatchAnalyticsModal
          match={analyticsDetail}
          outcome={
            analytics.snapshots.find((s) => s.matchId === analyticsDetail.id)?.outcome ?? "home"
          }
          isOpen
          onClose={() => setAnalyticsDetail(null)}
          analytics={analytics}
        />
      ) : null}

      {showLeagueManager ? (
        <LeagueManager
          leagues={data.leagues}
          disabled={disabledLeagues}
          matchCounts={matchCounts}
          onToggle={(leagueId) =>
            updateDisabledLeagues((current) =>
              current.includes(leagueId)
                ? current.filter((id) => id !== leagueId)
                : [...current, leagueId],
            )
          }
          onReset={() => updateDisabledLeagues(() => [])}
          onEnableAll={() => updateDisabledLeagues(() => [])}
          onClose={() => setShowLeagueManager(false)}
        />
      ) : null}
    </div>
  );
}
