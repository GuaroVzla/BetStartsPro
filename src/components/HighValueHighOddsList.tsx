"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Crown,
  Minus,
  Percent,
  Stethoscope,
  Target,
} from "lucide-react";
import type {
  MatchDay,
  SportFilter,
  SportsMatch,
  ValuePick,
} from "@/types/sports";
import { SPORTS, SPORT_BY_KEY } from "@/config/sports";
import { buildValueFavoritePicks } from "@/lib/bettingAnalyzer";
import {
  formatAmericanOdd,
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
  dayLabel: string;
}

function CriterionPill({
  passed,
  label,
  detail,
}: {
  passed: boolean;
  label: string;
  detail: string;
}) {
  return (
    <span
      title={detail}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] font-semibold",
        passed
          ? "border-blue-400/20 bg-blue-400/10 text-blue-700 dark:text-blue-300"
          : "border-rose-400/20 bg-rose-400/10 text-rose-600 dark:text-rose-300",
      )}
    >
      {passed ? (
        <Check className="h-2.5 w-2.5 shrink-0" />
      ) : (
        <Minus className="h-2.5 w-2.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
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
  const score = analysis.valueFavorite;
  const fromTriunfobet = analysis.bookmaker === "Triunfobet";
  const fromRoyal = analysis.bookmaker === "Apuestas Royal";
  const injuryDrag =
    analysis.outcome === "home"
      ? matchAnalysis.injuryDrag.home
      : analysis.outcome === "away"
        ? matchAnalysis.injuryDrag.away
        : 0;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 transition duration-300 hover:border-blue-400/25 hover:bg-white/[0.055]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent opacity-0 transition group-hover:opacity-100" />
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
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-200">
            <Target className="h-2.5 w-2.5" />
            Value favorite
            {fromRoyal ? " · Royal" : fromTriunfobet ? " · Triunfobet" : ""}
          </span>
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
            <TeamBadge team={match.home} size="sm" className="ring-2 ring-[#050d1a]" />
            <TeamBadge team={match.away} size="sm" className="ring-2 ring-[#050d1a]" />
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
                "text-cyan-300",
              )}
            >
              {formatOdd(odds)}
            </p>
            <p className="tabular-nums text-[8px] font-semibold text-cyan-400/80">
              {formatAmericanOdd(odds)} americana
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-slate-500">
              Valor esperado
            </p>
            <p className="tabular-nums mt-0.5 text-lg font-bold text-blue-300">
              {formatSignedPercent(analysis.expectedValue)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-slate-500">Implícita / edge</p>
            <p className="tabular-nums text-[10px] font-medium text-slate-300">
              {formatPercent(analysis.impliedProbability, 1)} /{" "}
              <span className="text-blue-300">
                {formatSignedPercent(analysis.edge)}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-300 transition-all duration-700"
            style={{ width: `${Math.min(100, analysis.modelProbability * 100)}%` }}
          />
        </div>

        {score ? (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <CriterionPill
              passed={score.validations.form}
              label={`Forma ${score.favoriteFormRate !== null ? Math.round(score.favoriteFormRate * 100) : "—"}%`}
              detail={score.explanation[0] ?? ""}
            />
            <CriterionPill
              passed={score.validations.standings}
              label={`Tabla ${score.favoritePosition ?? "—"}º`}
              detail={score.explanation[1] ?? ""}
            />
            <CriterionPill
              passed={score.validations.venue}
              label={
                analysis.outcome === "home" ? "Casa" : "Visita"
              }
              detail={score.explanation[2] ?? ""}
            />
          </div>
        ) : null}
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
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-blue-300 transition hover:text-blue-200"
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
  dayLabel,
}: HighValueHighOddsListProps) {
  const [sortMode, setSortMode] = useState<SortMode>("odds");

  const picks = useMemo(() => {
    // El Dashboard ya entrega solo partidos pendientes de la ventana
    // Hoy/Mañana; aquí se aplica el deporte y el KPI cuantitativo estricto.
    const scoped = matches.filter(
      (match) => activeSport === "all" || match.sport === activeSport,
    );
    const valuePicks = buildValueFavoritePicks(scoped);
    const bestPerMatch = valuePicks.filter(
      (pick, index, list) =>
        list.findIndex((candidate) => candidate.match.id === pick.match.id) ===
        index,
    );
    return sortPicks(bestPerMatch, sortMode);
  }, [matches, activeSport, sortMode]);

  return (
    <section
      id="radar"
      className="relative scroll-mt-36 overflow-hidden rounded-3xl border border-blue-500/20 bg-[#050d1a] text-white shadow-[0_30px_100px_-50px_rgba(37, 99, 235,0.55)]"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 -top-24 h-80 w-80 rounded-full bg-blue-500/15 blur-[100px]" />
        <div className="absolute -right-16 top-10 h-64 w-64 rounded-full bg-sky-400/10 blur-[90px]" />
        <div className="glass-grid absolute inset-0 opacity-40" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#050d1a] to-transparent" />
      </div>

      <div className="relative p-5 sm:p-6 lg:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-400/10 text-blue-300 shadow-[0_0_30px_-10px_rgba(96, 165, 250,0.7)]">
                <Target className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">
                Radar de valor
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium text-slate-400">
                Cuota americana ≥ +100
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-2 py-0.5 text-[9px] font-semibold text-cyan-300">
                <CalendarDays className="h-2.5 w-2.5" />
                {dayLabel} · VET · Pendientes
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              Favorables con cuota alta
              <span className="ml-2 bg-gradient-to-r from-blue-300 to-cyan-200 bg-clip-text text-transparent">
                / Value Favorites
              </span>
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400 sm:text-[13px]">
              Solo favoritos con cuota decimal ≥ 2.00 (+100 americana) que
              además tienen mejor forma reciente, mejor posición en la tabla y
              rendimiento positivo en su condición de local o visitante.
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
                className="h-9 appearance-none rounded-xl border border-white/10 bg-white/[0.055] pl-8 pr-8 text-[11px] font-semibold text-slate-200 outline-none transition hover:border-white/20 focus:border-blue-400/40"
              >
                <option value="all" className="bg-[#0a1428]">
                  Todos los deportes
                </option>
                {SPORTS.map((sport) => (
                  <option
                    key={sport.key}
                    value={sport.key}
                    className="bg-[#0a1428]"
                  >
                    {sport.label}
                  </option>
                ))}
              </select>
              <SportIcon
                sport={activeSport === "all" ? "soccer" : activeSport}
                className={cn(
                  "pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2",
                  activeSport === "all" ? "text-slate-500" : "text-blue-300",
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

        <div className="mt-5 flex flex-col gap-2 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-400">
            <span className="inline-flex items-center gap-1 text-cyan-300">
              <Check className="h-3 w-3" /> Cuota ≥ 2.00 / +100
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Forma superior
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Mejor tabla
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Split local/visita
            </span>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-slate-500">
            <span className="tabular-nums rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-bold text-cyan-300">
              {picks.length} picks
            </span>
          </div>
        </div>

        {picks.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-500">
              <Target className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">
              Ningún favorito cumple las 4 condiciones
            </h3>
            <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-slate-500">
              El radar no relaja umbrales: exige cuota ≥ 2.00, mejor forma,
              mejor tabla y split positivo. Cambia de día, deporte o activa más
              ligas en el gestor para ampliar la muestra.
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
            EV = probabilidad × cuota − 1. Cuota 2.00 equivale a +100 americana.
            El KPI muestra el EV como contexto, pero filtra por las validaciones
            estadísticas obligatorias, no por el EV.
          </p>
        </div>
      </div>
    </section>
  );
}
