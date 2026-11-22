"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Info,
  MapPin,
  ShieldCheck,
  Stethoscope,
  X,
} from "lucide-react";
import type {
  FormResult,
  InjuryImpact,
  OutcomeKey,
  SportsMatch,
  VenueSplit,
} from "@/types/sports";
import { SPORT_BY_KEY } from "@/config/sports";
import { analyzeMatch, sportHasDraw } from "@/lib/bettingAnalyzer";
import {
  formatAverage,
  formatMatchDateTime,
  formatOdd,
  formatPercent,
  formatRecord,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { SportIcon } from "@/components/SportIcon";
import { TeamBadge } from "@/components/TeamBadge";

type DrawerTab = "standings" | "performance" | "injuries";

interface MatchIntelDrawerProps {
  match: SportsMatch | null;
  onClose: () => void;
}

const TAB_ITEMS: Array<{
  key: DrawerTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "standings", label: "Clasificación", icon: BarChart3 },
  { key: "performance", label: "Rendimiento", icon: Activity },
  { key: "injuries", label: "Bajas", icon: Stethoscope },
];

function formLetter(result: FormResult): string {
  if (result === "W") return "V";
  if (result === "D") return "E";
  return "D";
}

function FormPills({ form }: { form: FormResult[] }) {
  if (form.length === 0) {
    return <span className="text-[10px] text-slate-400">Sin datos</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {form.map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md text-[9px] font-bold",
            result === "W"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
              : result === "D"
                ? "bg-amber-400/15 text-amber-600 dark:text-amber-300"
                : "bg-rose-500/15 text-rose-600 dark:text-rose-300",
          )}
        >
          {formLetter(result)}
        </span>
      ))}
    </div>
  );
}

function impactLabel(impact: InjuryImpact): string {
  if (impact === "high") return "Impacto alto";
  if (impact === "medium") return "Impacto medio";
  return "Impacto bajo";
}

function splitRecord(split: VenueSplit): string {
  return split.draws > 0
    ? `${split.wins}G · ${split.draws}E · ${split.losses}P`
    : `${split.wins}G · ${split.losses}P`;
}

function scoreUnit(sport: SportsMatch["sport"]): string {
  if (sport === "basketball") return "puntos";
  if (sport === "baseball") return "carreras";
  return "goles";
}

function standingLabel(sport: SportsMatch["sport"]): string {
  if (sport === "basketball") return "PCT";
  if (sport === "baseball") return "PCT";
  return "PTS";
}

function probabilityLabel(match: SportsMatch, outcome: OutcomeKey): string {
  if (outcome === "home") return match.home.shortName;
  if (outcome === "away") return match.away.shortName;
  return "Empate";
}

function TeamSplitCard({
  title,
  teamName,
  split,
  unit,
  accent,
}: {
  title: string;
  teamName: string;
  split: VenueSplit;
  unit: string;
  accent: "home" | "away";
}) {
  const avgScored = split.played > 0 ? split.scored / split.played : 0;
  const avgConceded = split.played > 0 ? split.conceded / split.played : 0;

  return (
    <div className="panel-inset p-3">
      <p className="eyebrow">{title}</p>
      <p className="mt-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
        {teamName}
      </p>
      <p
        className={cn(
          "mt-2 tabular-nums text-sm font-bold",
          accent === "home"
            ? "text-emerald-600 dark:text-emerald-300"
            : "text-sky-600 dark:text-sky-300",
        )}
      >
        {splitRecord(split)}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
        <span>
          {formatAverage(avgScored, 1)} {unit}/PJ
        </span>
        <span>{formatAverage(avgConceded, 1)} encajados</span>
      </div>
    </div>
  );
}

export function MatchIntelDrawer({ match, onClose }: MatchIntelDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("standings");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const analysis = useMemo(() => (match ? analyzeMatch(match) : null), [match]);

  useEffect(() => {
    setTab("standings");
  }, [match?.id]);

  useEffect(() => {
    if (!match) return;
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
    };
  }, [match, onClose]);

  if (!match || !analysis) return null;

  const sport = SPORT_BY_KEY[match.sport];
  const hasDraw = sportHasDraw(match.sport);
  const unit = scoreUnit(match.sport);
  const totalInjuries =
    match.intel.injuries.home.length + match.intel.injuries.away.length;
  const outcomes: OutcomeKey[] = hasDraw
    ? ["home", "draw", "away"]
    : ["home", "away"];
  const showsDrawColumn = match.sport === "soccer" || match.sport === "hockey";
  const scoredLabel =
    match.sport === "basketball"
      ? "PF"
      : match.sport === "baseball"
        ? "CF"
        : "GF";
  const concededLabel =
    match.sport === "basketball"
      ? "PC"
      : match.sport === "baseball"
        ? "CC"
        : "GC";
  const tableColumnsNote = showsDrawColumn
    ? `PJ · G · E · P · ${scoredLabel}/${concededLabel} · DIF`
    : `PJ · G · P · ${scoredLabel}/${concededLabel} · DIF`;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-intel-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-3xl animate-slide-in flex-col border-l border-slate-200 bg-[#f7f9fc] shadow-2xl dark:border-white/10 dark:bg-ink-900"
      >
        <div
          className="relative shrink-0 overflow-hidden border-b border-slate-200/80 px-5 py-4 dark:border-white/[0.07] sm:px-6"
          style={{
            backgroundImage: `radial-gradient(circle at 85% 0%, ${sport.accent}20, transparent 24rem)`,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="sport-chip"
                style={{
                  color: sport.accent,
                  borderColor: `${sport.accent}33`,
                  backgroundColor: `${sport.accent}12`,
                }}
              >
                <SportIcon sport={match.sport} className="h-3.5 w-3.5" />
                {sport.label}
              </span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {match.league.name}
              </span>
              <span className="hidden text-[10px] text-slate-400 sm:inline dark:text-slate-500">
                {match.league.country} · {match.league.season}
              </span>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="icon-button shrink-0"
              aria-label="Cerrar ficha del partido"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex flex-1 items-center justify-end gap-3 text-right">
              <div className="min-w-0">
                <h2
                  id="match-intel-title"
                  className="truncate text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg"
                >
                  {match.home.name}
                </h2>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {match.intel.standings.home.played > 0
                    ? `${match.intel.standings.home.position}º · ${formatRecord(match.intel.standings.home)}`
                    : "Local"}
                </p>
              </div>
              <TeamBadge team={match.home} size="lg" />
            </div>

            <div className="flex shrink-0 flex-col items-center px-1">
              <span className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-500">
                VS
              </span>
              <span className="mt-1 text-[9px] font-medium text-slate-400 dark:text-slate-500">
                {analysis.topPick
                  ? formatPercent(analysis.topPick.modelProbability)
                  : "—"}
              </span>
            </div>

            <div className="flex flex-1 items-center gap-3">
              <TeamBadge team={match.away} size="lg" />
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg">
                  {match.away.name}
                </h3>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {match.intel.standings.away.played > 0
                    ? `${match.intel.standings.away.position}º · ${formatRecord(match.intel.standings.away)}`
                    : "Visitante"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              {formatMatchDateTime(match.commenceTime)}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {match.venue}
            </span>
            <span className="flex items-center gap-1">
              <Stethoscope className="h-3 w-3" />
              <span className="tabular-nums">{totalInjuries}</span> bajas
            </span>
          </div>

          <div
            className={cn(
              "mt-4 grid gap-2",
              outcomes.length === 3 ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            {outcomes.map((outcome) => {
              const probability = analysis.probabilities[outcome];
              return (
                <div
                  key={outcome}
                  className="rounded-xl border border-slate-200/80 bg-white/65 px-2.5 py-2 dark:border-white/[0.07] dark:bg-white/[0.035]"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {probabilityLabel(match, outcome)}
                    </span>
                    <span className="tabular-nums text-[11px] font-bold text-slate-900 dark:text-white">
                      {formatPercent(probability)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${probability * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 border-b border-slate-200/80 bg-white/50 px-4 dark:border-white/[0.07] dark:bg-white/[0.015] sm:px-6">
          <div className="-mb-px flex gap-1" role="tablist" aria-label="Ficha del partido">
            {TAB_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-[11px] font-semibold transition",
                    active
                      ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                  {item.key === "injuries" && totalInjuries > 0 ? (
                    <span className="tabular-nums rounded bg-slate-100 px-1 text-[9px] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                      {totalInjuries}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {tab === "standings" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    title: "Posición local",
                    row: match.intel.standings.home,
                    tone: "home" as const,
                  },
                  {
                    title: "Posición visitante",
                    row: match.intel.standings.away,
                    tone: "away" as const,
                  },
                ].map(({ title, row, tone }) => (
                  <div key={title} className="panel-inset p-3">
                    <p className="eyebrow">{title}</p>
                    <div className="mt-1.5 flex items-end justify-between gap-2">
                      <div>
                        <p className="tabular-nums text-xl font-bold text-slate-950 dark:text-white">
                          {row.played > 0 ? `${row.position}º` : "N/D"}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                          {row.teamShortName}
                          {row.group ? ` · ${row.group}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "tabular-nums text-lg font-bold",
                            tone === "home"
                              ? "text-emerald-600 dark:text-emerald-300"
                              : "text-sky-600 dark:text-sky-300",
                          )}
                        >
                          {formatPercent(row.winPercentage)}
                        </p>
                        <p className="text-[9px] text-slate-400">victorias</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.07]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    {match.league.name} · {standingLabel(match.sport)}
                  </p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500">
                    {tableColumnsNote}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[590px] border-collapse text-left text-[10px]">
                    <thead>
                      <tr className="bg-white/60 dark:bg-white/[0.015]">
                        <th className="table-head px-2 py-2 text-center font-semibold">#</th>
                        <th className="table-head px-2 py-2 font-semibold">Equipo</th>
                        <th className="table-head px-2 py-2 text-center font-semibold">PJ</th>
                        <th className="table-head px-2 py-2 text-center font-semibold">G</th>
                        {showsDrawColumn ? (
                          <th className="table-head px-2 py-2 text-center font-semibold">E</th>
                        ) : null}
                        <th className="table-head px-2 py-2 text-center font-semibold">P</th>
                        <th className="table-head px-2 py-2 text-right font-semibold">
                          {scoredLabel}
                        </th>
                        <th className="table-head px-2 py-2 text-right font-semibold">
                          {concededLabel}
                        </th>
                        <th className="table-head px-2 py-2 text-right font-semibold">DIF</th>
                        <th className="table-head px-2 py-2 text-right font-semibold">
                          {standingLabel(match.sport)}
                        </th>
                        {showsDrawColumn ? (
                          <th className="table-head px-2 py-2 text-right font-semibold">%</th>
                        ) : null}
                        <th className="table-head px-2 py-2 font-semibold">Forma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {match.intel.standings.table.map((row, index) => {
                        const isHome = row.teamId === match.home.id;
                        const isAway = row.teamId === match.away.id;
                        return (
                          <tr
                            key={`${row.teamId}-${row.position}-${index}`}
                            className={cn(
                              "border-t border-slate-100 dark:border-white/[0.045]",
                              isHome
                                ? "bg-emerald-500/[0.06] dark:bg-emerald-400/[0.055]"
                                : isAway
                                  ? "bg-sky-500/[0.05] dark:bg-sky-400/[0.045]"
                                  : "hover:bg-slate-50 dark:hover:bg-white/[0.015]",
                            )}
                          >
                            <td className="px-2 py-2 text-center tabular-nums font-semibold text-slate-500 dark:text-slate-400">
                              {row.position}
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="max-w-[130px] truncate font-medium text-slate-800 dark:text-slate-100">
                                  {row.teamName}
                                </span>
                                {isHome ? (
                                  <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold uppercase text-emerald-600 dark:text-emerald-300">
                                    Local
                                  </span>
                                ) : isAway ? (
                                  <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[8px] font-bold uppercase text-sky-600 dark:text-sky-300">
                                    Visita
                                  </span>
                                ) : null}
                              </div>
                              {row.group ? (
                                <span className="text-[8px] text-slate-400 dark:text-slate-500">
                                  {row.group}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums text-slate-600 dark:text-slate-300">
                              {row.played}
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums text-slate-600 dark:text-slate-300">
                              {row.wins}
                            </td>
                            {showsDrawColumn ? (
                              <td className="px-2 py-2 text-center tabular-nums text-slate-600 dark:text-slate-300">
                                {row.draws}
                              </td>
                            ) : null}
                            <td className="px-2 py-2 text-center tabular-nums text-slate-600 dark:text-slate-300">
                              {row.losses}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                              {row.scored}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                              {row.conceded}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-2 text-right tabular-nums font-semibold",
                                row.difference > 0
                                  ? "text-emerald-600 dark:text-emerald-300"
                                  : row.difference < 0
                                    ? "text-rose-500 dark:text-rose-300"
                                    : "text-slate-500",
                              )}
                            >
                              {row.difference > 0 ? "+" : ""}
                              {row.difference}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                              {sport.key === "soccer" || sport.key === "hockey"
                                ? row.points
                                : formatPercent(row.winPercentage, 0)}
                            </td>
                            {showsDrawColumn ? (
                              <td className="px-2 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                                {formatPercent(row.winPercentage, 0)}
                              </td>
                            ) : null}
                            <td className="px-2 py-2">
                              <FormPills form={row.form} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="flex items-start gap-1.5 text-[9px] leading-relaxed text-slate-400 dark:text-slate-500 sm:hidden">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Desliza la tabla horizontalmente para ver toda la clasificación
                y la forma reciente.
              </p>
              <p className="hidden items-start gap-1.5 text-[9px] leading-relaxed text-slate-400 dark:text-slate-500 sm:flex">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Clasificación de la temporada actual. En ligas con conferencias o
                grupos, la posición corresponde al grupo indicado.
              </p>
            </div>
          ) : null}

          {tab === "performance" ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Últimos 5 y splits</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                    Rendimiento reciente
                  </h3>
                </div>
                <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
                  Media por partido
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { team: match.home, stats: match.intel.stats.home, tone: "home" as const },
                  { team: match.away, stats: match.intel.stats.away, tone: "away" as const },
                ].map(({ team, stats, tone }) => (
                  <div key={team.id} className="panel p-4">
                    <div className="flex items-center gap-2.5">
                      <TeamBadge team={team} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                          {team.name}
                        </p>
                        <p className="text-[9px] text-slate-400 dark:text-slate-500">
                          {tone === "home" ? "Local" : "Visitante"} · {stats.streak}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">
                        Forma
                      </span>
                      <FormPills form={stats.form} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="panel-inset p-2.5">
                        <p className="text-[9px] text-slate-400">Anotados/PJ</p>
                        <p className="tabular-nums mt-0.5 text-lg font-bold text-emerald-600 dark:text-emerald-300">
                          {formatAverage(stats.avgScored, 1)}
                        </p>
                        <p className="text-[8px] text-slate-400">{unit}</p>
                      </div>
                      <div className="panel-inset p-2.5">
                        <p className="text-[9px] text-slate-400">Recibidos/PJ</p>
                        <p className="tabular-nums mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100">
                          {formatAverage(stats.avgConceded, 1)}
                        </p>
                        <p className="text-[8px] text-slate-400">{unit}</p>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <TeamSplitCard
                        title="Como local"
                        teamName={team.shortName}
                        split={stats.home}
                        unit={unit}
                        accent="home"
                      />
                      <TeamSplitCard
                        title="Como visitante"
                        teamName={team.shortName}
                        split={stats.away}
                        unit={unit}
                        accent="away"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.07]">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    Proyección estadística
                  </p>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500">
                    Modelo propio
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                  <div className="panel-inset p-3">
                    <p className="text-[9px] text-slate-400">Marcador proyectado</p>
                    <p className="tabular-nums mt-1 text-lg font-bold text-slate-900 dark:text-white">
                      {formatAverage(analysis.projectedHome, 1)} –{" "}
                      {formatAverage(analysis.projectedAway, 1)}
                    </p>
                  </div>
                  {outcomes.map((outcome) => (
                    <div key={outcome} className="panel-inset p-3">
                      <p className="truncate text-[9px] text-slate-400">
                        {probabilityLabel(match, outcome)}
                      </p>
                      <p className="tabular-nums mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-300">
                        {formatPercent(analysis.probabilities[outcome])}
                      </p>
                      <p className="tabular-nums text-[8px] text-slate-400">
                        Cuota justa {formatOdd(1 / analysis.probabilities[outcome])}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 border-t border-slate-200/70 px-3 py-2.5 dark:border-white/[0.06] sm:grid-cols-2">
                  <p className="text-[9px] text-slate-400 dark:text-slate-500">
                    Ajuste por bajas locales:{" "}
                    <span className="tabular-nums text-amber-600 dark:text-amber-300">
                      −{formatPercent(analysis.injuryDrag.home)}
                    </span>
                  </p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500">
                    Ajuste por bajas visitantes:{" "}
                    <span className="tabular-nums text-amber-600 dark:text-amber-300">
                      −{formatPercent(analysis.injuryDrag.away)}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "injuries" ? (
            <div className="space-y-4">
              <div>
                <p className="eyebrow">Disponibilidad de plantilla</p>
                <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  Jugadores importantes y bajas
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Impacto estimado sobre la probabilidad del equipo según rol,
                  minutos y peso ofensivo.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { team: match.home, injuries: match.intel.injuries.home, side: "Local" },
                  { team: match.away, injuries: match.intel.injuries.away, side: "Visitante" },
                ].map(({ team, injuries, side }) => (
                  <div key={team.id} className="panel overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-white/[0.06]">
                      <div className="flex min-w-0 items-center gap-2">
                        <TeamBadge team={team} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                            {team.name}
                          </p>
                          <p className="text-[9px] text-slate-400">{side}</p>
                        </div>
                      </div>
                      <span className="tabular-nums rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                        {injuries.length}
                      </span>
                    </div>
                    {injuries.length === 0 ? (
                      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                        <ShieldCheck className="h-6 w-6 text-emerald-500/70" />
                        <p className="mt-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          Sin bajas registradas
                        </p>
                        <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                          Puede actualizarse hasta el inicio.
                        </p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-white/[0.055]">
                        {injuries.map((injury) => (
                          <li key={injury.id} className="px-3.5 py-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                                  {injury.player}
                                </p>
                                <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                                  {injury.position} · {injury.status}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  "shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide",
                                  injury.impact === "high"
                                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
                                    : injury.impact === "medium"
                                      ? "bg-amber-400/10 text-amber-600 dark:text-amber-300"
                                      : "bg-sky-400/10 text-sky-600 dark:text-sky-300",
                                )}
                                title={impactLabel(injury.impact)}
                              >
                                {injury.impact === "high"
                                  ? "Alto"
                                  : injury.impact === "medium"
                                    ? "Medio"
                                    : "Bajo"}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[9px] leading-relaxed text-slate-500 dark:text-slate-400">
                              {injury.reason}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {match.intel.note ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2.5 text-[9px] leading-relaxed text-amber-700 dark:text-amber-300/90">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {match.intel.note}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="mt-5 border-t border-slate-200/70 pt-3 text-[9px] leading-relaxed text-slate-400 dark:border-white/[0.06] dark:text-slate-500">
            Las probabilidades son estimaciones estadísticas y no garantizan el
            resultado. Las cuotas y alineaciones pueden cambiar. Juega con
            responsabilidad; solo mayores de 18 años.
          </p>
        </div>
      </aside>
    </div>
  );
}
