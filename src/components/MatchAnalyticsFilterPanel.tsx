/**
 * MatchAnalyticsFilterPanel - Panel de filtros avanzados para la tabla de resultados.
 * Permite filtrar por deporte, liga, casa de apuestas, confianza y recomendación.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Search, Filter, X } from "lucide-react";

import type {
  SportsMatch,
  SportKey,
  SportFilter,
  LeagueInfo,
  DashboardData,
} from "@/types/sports";
import type { DashboardAnalytics } from "@/types/predictive";

import { cn } from "@/lib/utils";

type ConfidenceFilter = "all" | "high" | "medium" | "low";
type RecommendationFilter = "all" | "BUY" | "PASS" | "NOT_BET";
type ValueBetFilter = "all" | "value_bet" | "not_value_bet";

export interface Filters {
  search: string;
  sports: SportKey[];
  leagueIds: string[];
  source: string[];
  confidence: ConfidenceFilter;
  recommendation: RecommendationFilter;
  valueBet: ValueBetFilter;
  minOdds: number;
  sortBy: "time" | "confidence" | "ev";
  sortDirection: "asc" | "desc";
}

interface MatchAnalyticsFilterPanelProps {
  analytics: DashboardAnalytics;
  data: DashboardData;
  activeLeague: string;
  activeSport: SportFilter;
  onApplyFilters: (filters: Filters) => void;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  sports: [],
  leagueIds: [],
  source: [],
  confidence: "all",
  recommendation: "all",
  valueBet: "all",
  minOdds: 0,
  sortBy: "confidence",
  sortDirection: "desc",
};

const CONFIDENCE_PILLS: Array<{ value: ConfidenceFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "high", label: "Alta confianza" },
  { value: "medium", label: "Media confianza" },
  { value: "low", label: "Baja confianza" },
];

const RECOMMENDATION_PILLS: Array<{
  value: RecommendationFilter;
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "BUY", label: "Solo BUY" },
  { value: "PASS", label: "Solo PASS" },
  { value: "NOT_BET", label: "Excluir NOT_BET" },
];

const VALUE_BET_PILLS: Array<{ value: ValueBetFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "value_bet", label: "Solo Value Bets" },
  { value: "not_value_bet", label: "Excluir Value Bets" },
];

const PILL_ACTIVE =
  "border-blue-400/40 bg-blue-400/10 text-blue-700 dark:text-blue-300 shadow-sm";
const PILL_INACTIVE =
  "border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300";

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-2.5 py-2 text-[10px] font-semibold transition-all",
        active ? PILL_ACTIVE : PILL_INACTIVE,
      )}
    >
      {children}
    </button>
  );
}

export function MatchAnalyticsFilterPanel({
  analytics,
  data,
  onApplyFilters,
}: MatchAnalyticsFilterPanelProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [isOpen, setIsOpen] = useState(false);

  // Ligas únicas presentes en el conjunto de datos
  const uniqueLeagues = useMemo(() => {
    const map = new Map<string, LeagueInfo>();
    data.matches.forEach((match) => {
      if (!map.has(match.league.id)) {
        map.set(match.league.id, match.league);
      }
    });
    return Array.from(map.values());
  }, [data.matches]);

  // Casas de apuestas únicas presentes en el conjunto de datos
  const uniqueSources = useMemo(() => {
    const set = new Set<string>();
    data.matches.forEach((match) => {
      match.odds.bookmakers.forEach((b) => set.add(b.source));
    });
    return Array.from(set).sort();
  }, [data.matches]);

  // Aplicar filtros
  const applyFilters = () => {
    onApplyFilters({ ...filters });
  };

  const handleToggleSport = (sport: SportKey) => {
    const sports = filters.sports.includes(sport)
      ? filters.sports.filter((s) => s !== sport)
      : [...filters.sports, sport];
    setFilters((f) => ({ ...f, sports }));
  };

  const handleToggleLeague = (leagueId: string) => {
    const leagueIds = filters.leagueIds.includes(leagueId)
      ? filters.leagueIds.filter((l) => l !== leagueId)
      : [...filters.leagueIds, leagueId];
    setFilters((f) => ({ ...f, leagueIds }));
  };

  const handleToggleSource = (source: string) => {
    const sourceList = filters.source.includes(source)
      ? filters.source.filter((s) => s !== source)
      : [...filters.source, source];
    setFilters((f) => ({ ...f, source: sourceList }));
  };

  const activeCount =
    (filters.search !== "" ? 1 : 0) +
    filters.sports.length +
    filters.leagueIds.length +
    filters.source.length +
    (filters.confidence !== "all" ? 1 : 0) +
    (filters.recommendation !== "all" ? 1 : 0) +
    (filters.valueBet !== "all" ? 1 : 0) +
    (filters.minOdds > 0 ? 1 : 0);

  return (
    <div className="panel relative">
      {/* Botón de apertura */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/[0.07]"
      >
        <Filter className="h-4 w-4 shrink-0" />
        Filtrar resultados
        {activeCount > 0 ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
            {activeCount}
          </span>
        ) : null}
        <X className={cn("ml-auto h-4 w-4 shrink-0", isOpen && "hidden")} />
      </button>

      {/* Panel de filtros */}
      {isOpen ? (
        <div className="panel mt-3 overflow-hidden rounded-2xl p-4 dark:bg-ink-850/85">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Campo de búsqueda */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Buscar equipo, liga..."
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                className="input-field pl-10 text-[11px]"
              />
            </div>

            {/* Deportes */}
            <div>
              <label className="eyebrow mb-2 block">Deportes</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  ["soccer", "basketball", "baseball", "hockey"] as const
                ).map((sport) => (
                  <Pill
                    key={sport}
                    active={filters.sports.includes(sport)}
                    onClick={() => handleToggleSport(sport)}
                  >
                    {sport.charAt(0).toUpperCase() + sport.slice(1)}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Nivel de confianza */}
            <div>
              <label className="eyebrow mb-2 block">Nivel de confianza</label>
              <div className="grid grid-cols-2 gap-1.5">
                {CONFIDENCE_PILLS.map((opt) => (
                  <Pill
                    key={opt.value}
                    active={filters.confidence === opt.value}
                    onClick={() =>
                      setFilters({ ...filters, confidence: opt.value })
                    }
                  >
                    {opt.label}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Recomendación */}
            <div>
              <label className="eyebrow mb-2 block">Recomendación</label>
              <div className="grid grid-cols-2 gap-1.5">
                {RECOMMENDATION_PILLS.map((opt) => (
                  <Pill
                    key={opt.value}
                    active={filters.recommendation === opt.value}
                    onClick={() =>
                      setFilters({ ...filters, recommendation: opt.value })
                    }
                  >
                    {opt.label}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Value Bets */}
            <div>
              <label className="eyebrow mb-2 block">Value Bets</label>
              <div className="grid grid-cols-3 gap-1.5">
                {VALUE_BET_PILLS.map((opt) => (
                  <Pill
                    key={opt.value}
                    active={filters.valueBet === opt.value}
                    onClick={() => setFilters({ ...filters, valueBet: opt.value })}
                  >
                    {opt.label}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Cuota mínima */}
            <div>
              <label className="eyebrow mb-2 block">Cuota mínima</label>
              <input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={filters.minOdds}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    minOdds: parseFloat(e.target.value) || 0,
                  })
                }
                className="input-field text-[11px]"
              />
            </div>

            {/* Ligas */}
            <div>
              <label className="eyebrow mb-2 block">Ligas</label>
              <ul className="max-h-36 space-y-1 overflow-y-auto">
                {uniqueLeagues.map((league) => (
                  <li key={league.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={filters.leagueIds.includes(league.id)}
                        onChange={() => handleToggleLeague(league.id)}
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-500 dark:accent-blue-400"
                      />
                      <span className="truncate">{league.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {/* Casa de apuestas */}
            <div>
              <label className="eyebrow mb-2 block">Casa de apuestas</label>
              <div className="grid grid-cols-2 gap-1.5">
                {uniqueSources.map((source) => (
                  <Pill
                    key={source}
                    active={filters.source.includes(source)}
                    onClick={() => handleToggleSource(source)}
                  >
                    {source}
                  </Pill>
                ))}
              </div>
            </div>
          </div>

          {/* Botones de acción */}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="flex-1 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
            >
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="flex-1 rounded-xl border border-slate-200 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              Restablecer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
