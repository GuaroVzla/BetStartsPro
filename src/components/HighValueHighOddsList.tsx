"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Crown,
  Flame,
  Percent,
  SlidersHorizontal,
  Stethoscope,
  Target,
  TrendingUp,
} from "lucide-react";
import type { SportFilter, SportsMatch, ValuePick } from "@/types/sports";
import { hasMatchStarted, isTodayVET } from "@/lib/format";
import { SPORTS, SPORT_BY_KEY } from "@/config/sports";
import { buildValuePicks } from "@/lib/bettingAnalyzer";
import {
  formatMatchDate,
  formatMatchTime,
  formatOdd,
  formatPercent,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { SportIcon } from "@/components/SportIcon";
import { TeamBadge } from "@/components/TeamBadge";

type SortMode = "probability" | "odds" | "ev";

interface HighValueHighOddsListProps {
  matches: SportsMatch[];
  activeSport: SportFilter;
  onSportChange: (sport: SportFilter) => void;
  onOpenMatch: (match: SportsMatch) => void;
}

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "probability", label: "Probabilidad" },
  { value: "odds", label: "Cuota alta" },
  { value: "ev", label: "Mejor EV" },
];

function sortPicks(picks: ValuePick[], mode: SortMode): ValuePick[] {
  return [...picks].sort((a, b) => {
    if (mode === "probability") {
      return (
        b.analysis.modelProbability - a.analysis.modelProbability ||
        b.analysis.expectedValue - a.analysis.expectedValue
      );
    }
    if (mode === "odds") {
      return (
        (b.analysis.bestOdds ?? 0) - (a.analysis.bestOdds ?? 0) ||
        b.analysis.expectedValue - a.analysis.expectedValue
      );
    }
    return (
      b.analysis.expectedValue - a.analysis.expectedValue ||
      b.analysis.modelProbability - a.analysis.modelProbability
    );
  });
}

function ValueCard({
  pick,
  rank,
  onOpenMatch,
}: {
  pick: ValuePick;
  rank: number;
  onOpenMatch: (match: SportsMatch) => void;
}) {
  const { match, analysis, matchAnalysis } = pick;
  const sport = SPORT_BY_KEY[match.sport];
  const odds = analysis.bestOdds ?? 0;
  const isHembra = analysis.isHembra;
  const fromTriunfobet = analysis.bookmaker === "Triunfobet";
  const injuryDrag =
    analysis.outcome === "home"
      ? matchAnalysis.injuryDrag.home
      : analysis.outcome === "away"
        ? matchAnalysis.injuryDrag.away
        : 0;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 transition duration-300 hover:border-emerald-400/25 hover:bg-white/[0.055]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg border text-[10px] font-bold tabular-nums",
              rank === 1
                ? "border-amber-300/30 bg-amber-300/15 text-amber-200"
                : rank === 2
                  ? "border-slate-300/20 bg-slate-300/10 text-slate-200"
                  : rank === 3
                    ? "border-orange-400/20 bg-orange-400/10 text-orange-200"
                    : "border-white/10 bg-white/[0.04] text-slate-400",
            )}
          >
            {String(rank).padStart(2, "0")}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{
              color: sport.accent,
              borderColor: `${sport.accent}33`,
              backgroundColor: `${sport.accent}12`,
            }}
          >
            <SportIcon sport={match.sport} className="h-3 w-3" />
            {sport.shortLabel}
          </span>
          {isHembra ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
              <Flame className="h-2.5 w-2.5" />
              Hembra{fromTriunfobet ? " · Triunfobet" : ""}
            </span>
          ) : null}
        </div>
        <span className="tabular-nums shrink-0 text-[9px] text-slate-500">
          {formatMatchDate(match.commenceTime)} · {formatMatchTime(match.commenceTime)}
        </span>
      </div>

      <div className="mt-3 min-w-0">
        <p className="truncate text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500">
          {match.league.name}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex -space-x-1.5">
            <TeamBadge team={match.home} size="sm" className="ring-2 ring-[#07130f]" />
            <TeamBadge team={match.away} size="sm" className="ring-2 ring-[#07130f]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-200">
              {match.home.shortName}
              <span className="mx-1.5 text-slate-600">vs</span>
              {match.away.shortName}
            </p>
            {match.favoriteSide ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-200">
                <Crown className="h-2.5 w-2.5" />
                Favorito:{" "}
                {match.favoriteSide === "home"
                  ? match.home.shortName
                  : match.away.shortName}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Selección del modelo
            </p>
            <p className="mt-0.5 truncate text-sm font-bold text-white">
              {analysis.selectionName}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
            {analysis.label}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 divide-x divide-white/[0.07] rounded-lg border border-white/[0.06] bg-white/[0.025]">
          <div className="px-2.5 py-2">
            <p className="flex items-center gap-1 text-[9px] text-slate-500">
              <Percent className="h-2.5 w-2.5" />
              Prob. {analysis.probabilitySource}
            </p>
            <p className="mt-1 tabular-nums text-lg font-bold leading-none text-white">
              {formatPercent(analysis.modelProbability)}
            </p>
          </div>
          <div className="px-2.5 py-2">
            <p className="flex items-center gap-1 text-[9px] text-slate-500">
              <CircleDollarSign className="h-2.5 w-2.5" />
              Mejor cuota
            </p>
            <p
              className={cn(
                "mt-1 tabular-nums text-lg font-bold leading-none",
                isHembra ? "text-amber-300" : "text-emerald-300",
              )}
            >
              {formatOdd(odds)}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-slate-500">
              Valor esperado
            </p>
            <p className="tabular-nums mt-0.5 text-lg font-bold text-emerald-300">
              {formatSignedPercent(analysis.expectedValue)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-slate-500">Implícita / edge</p>
            <p className="tabular-nums text-[10px] font-medium text-slate-300">
              {formatPercent(analysis.impliedProbability, 1)} /{" "}
              <span className="text-emerald-300">
                {formatSignedPercent(analysis.edge)}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700"
            style={{ width: `${Math.min(100, analysis.modelProbability * 100)}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-slate-500">
          <span className="truncate">{analysis.bookmaker ?? "Mercado"}</span>
          {injuryDrag > 0.03 ? (
            <span className="inline-flex items-center gap-1 text-amber-300/70">
              <Stethoscope className="h-2.5 w-2.5" />
              −{formatPercent(injuryDrag, 1)} proyección
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onOpenMatch(match)}
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-emerald-300 transition hover:text-emerald-200"
        >
          Ver intel
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

export function HighValueHighOddsList({
  matches,
  activeSport,
  onSportChange,
  onOpenMatch,
}: HighValueHighOddsListProps) {
  const [minOdds, setMinOdds] = useState(1.6);
  const [sortMode, setSortMode] = useState<SortMode>("ev");

  const picks = useMemo(() => {
    // Red de seguridad: el radar "hembra del día" solo opera con partidos
    // de hoy en VET que todavía no han comenzado, con independencia del
    // filtro que aplique el Dashboard antes de pasarlos.
    const ahora = new Date();
    const scoped = matches
      .filter(
        (match) =>
          isTodayVET(match.commenceTime) && !hasMatchStarted(match, ahora),
      )
      .filter((match) => activeSport === "all" || match.sport === activeSport);
    const valuePicks = buildValuePicks(scoped, {
      minProbability: 0.5,
      minOdds,
    });
    const bestPerMatch = valuePicks.filter(
      (pick, index, list) =>
        list.findIndex((candidate) => candidate.match.id === pick.match.id) ===
        index,
    );
    return sortPicks(bestPerMatch, sortMode);
  }, [matches, activeSport, minOdds, sortMode]);

  return (
    <section
      id="radar"
      className="relative scroll-mt-36 overflow-hidden rounded-3xl border border-emerald-500/20 bg-[#07130f] text-white shadow-[0_30px_100px_-50px_rgba(16,185,129,0.55)]"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 -top-24 h-80 w-80 rounded-full bg-emerald-500/15 blur-[100px]" />
        <div className="absolute -right-16 top-10 h-64 w-64 rounded-full bg-teal-400/10 blur-[90px]" />
        <div className="glass-grid absolute inset-0 opacity-40" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#07130f] to-transparent" />
      </div>

      <div className="relative p-5 sm:p-6 lg:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 shadow-[0_0_30px_-10px_rgba(52,211,153,0.7)]">
                <Target className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                Radar de valor
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium text-slate-400">
                Prob. ≥ 50% + EV positivo
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[9px] font-semibold text-emerald-300">
                <CalendarDays className="h-2.5 w-2.5" />
                Solo hoy · VET · Pendientes
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              Favorables con cuota alta
              <span className="ml-2 bg-gradient-to-r from-emerald-300 to-lime-200 bg-clip-text text-transparent">
                / hembra del día
              </span>
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400 sm:text-[13px]">
              Selecciones con probabilidad alta y valor esperado positivo. 🔥
              Hembra se reserva para favoritos con cuota ≥ 1,85 y EV positivo
              en el radar. Ordena por probabilidad, cuota o rentabilidad.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="radar-sport">
              Filtrar radar por deporte
            </label>
            <div className="relative">
              <select
                id="radar-sport"
                value={activeSport}
                onChange={(event) =>
                  onSportChange(event.target.value as SportFilter)
                }
                className="h-9 appearance-none rounded-xl border border-white/10 bg-white/[0.055] pl-8 pr-8 text-[11px] font-semibold text-slate-200 outline-none transition hover:border-white/20 focus:border-emerald-400/40"
              >
                <option value="all" className="bg-[#0b1712]">
                  Todos los deportes
                </option>
                {SPORTS.map((sport) => (
                  <option
                    key={sport.key}
                    value={sport.key}
                    className="bg-[#0b1712]"
                  >
                    {sport.label}
                  </option>
                ))}
              </select>
              <SportIcon
                sport={activeSport === "all" ? "soccer" : activeSport}
                className={cn(
                  "pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2",
                  activeSport === "all" ? "text-slate-500" : "text-emerald-300",
                )}
              />
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            </div>

            <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.035] p-0.5">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSortMode(option.value)}
                  aria-pressed={sortMode === option.value}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition",
                    sortMode === option.value
                      ? "bg-white/[0.1] text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-medium">Cuota mínima</span>
            <span className="tabular-nums rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
              {formatOdd(minOdds)}
            </span>
          </div>
          <div className="flex flex-1 items-center gap-3 sm:max-w-md">
            <span className="tabular-nums text-[9px] text-slate-500">1.60</span>
            <input
              type="range"
              min={1.6}
              max={2.6}
              step={0.05}
              value={minOdds}
              onChange={(event) => setMinOdds(Number(event.target.value))}
              className="range-emerald"
              aria-label="Cuota mínima para el radar de valor"
            />
            <span className="tabular-nums text-[9px] text-slate-500">2.60</span>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="tabular-nums">{picks.length} picks cumplen</span>
          </div>
        </div>

        {picks.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-500">
              <Target className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">
              Ningún pick supera ambos filtros
            </h3>
            <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-slate-500">
              Baja la cuota mínima o cambia el deporte. El radar solo muestra
              selecciones con EV positivo; cuando Triunfobet aporte una cuota
              superior al consenso, el partido aparecerá aquí.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {picks.map((pick, index) => (
              <ValueCard
                key={pick.id}
                pick={pick}
                rank={index + 1}
                onOpenMatch={onOpenMatch}
              />
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[9px] text-slate-500">
          <p>
            EV = probabilidad modelo × cuota decimal − 1. 1.85 equivale a cuota
            americana +100. Cuota alta no implica valor sin respaldo estadístico.
          </p>
          <a
            href="#comparador"
            className="inline-flex items-center gap-1 font-semibold text-emerald-400 transition hover:text-emerald-300"
          >
            <TrendingUp className="h-3 w-3" />
            Explorar todas las cuotas
          </a>
        </div>
      </div>
    </section>
  );
}
