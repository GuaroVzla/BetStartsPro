"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  Crown,
  Flame,
  Info,
  MapPin,
  PanelRightOpen,
  Search,
  Stethoscope,
} from "lucide-react";
import type {
  LeagueInfo,
  OddsSource,
  OutcomeKey,
  SportFilter,
  SportsMatch,
} from "@/types/sports";
import { SPORT_BY_KEY } from "@/config/sports";
import { analyzeMatch } from "@/lib/bettingAnalyzer";
import {
  formatMatchDate,
  formatMatchTime,
  formatOdd,
  formatPercent,
  formatRecord,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { SportIcon } from "@/components/SportIcon";
import { TeamBadge } from "@/components/TeamBadge";

interface OddsComparatorProps {
  matches: SportsMatch[];
  leagues: LeagueInfo[];
  activeLeague: string;
  onLeagueChange: (leagueId: string) => void;
  activeSport: SportFilter;
  onSportChange: (sport: SportFilter) => void;
  onOpenMatch: (match: SportsMatch) => void;
}

function statusLabel(status: SportsMatch["status"]): string {
  if (status === "live") return "En vivo";
  if (status === "finished") return "Finalizado";
  return "Programado";
}

function sourceLabel(source: OddsSource): string {
  if (source === "the-odds-api") return "The Odds API";
  if (source === "sportmonks") return "SportMonks";
  if (source === "api-sports") return "API-Sports";
  if (source === "flashscore") return "Flashscore";
  if (source === "triunfobet") return "Triunfobet";
  return "Demo";
}

const HEMBRA_MIN_ODDS = 1.8;

/** Favorito con cuota alta cuyo mejor precio proviene de Triunfobet. */
function isTriunfobetHembra(match: SportsMatch, outcome: OutcomeKey): boolean {
  const price = match.odds.best[outcome];
  if (match.favoriteSide !== outcome || price === null || price < HEMBRA_MIN_ODDS) {
    return false;
  }
  return match.odds.bookmakers.some(
    (bookmaker) =>
      bookmaker.source === "triunfobet" &&
      bookmaker.outcomes[outcome] !== null &&
      Math.abs((bookmaker.outcomes[outcome] as number) - price) < 0.0001,
  );
}

function OddsCard({
  match,
  onOpenMatch,
}: {
  match: SportsMatch;
  onOpenMatch: (match: SportsMatch) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const analysis = useMemo(() => analyzeMatch(match), [match]);
  const sport = SPORT_BY_KEY[match.sport];
  const outcomes: Array<{
    key: OutcomeKey;
    label: string;
    shortLabel: string;
  }> = [
    { key: "home", label: "Local", shortLabel: "1" },
    ...(match.sport === "soccer"
      ? [{ key: "draw" as const, label: "Empate", shortLabel: "X" }]
      : []),
    { key: "away", label: "Visitante", shortLabel: "2" },
  ];
  const injuryCount =
    match.intel.injuries.home.length + match.intel.injuries.away.length;
  const triunfobetHembra = new Set(
    outcomes.filter((outcome) => isTriunfobetHembra(match, outcome.key)).map((outcome) => outcome.key),
  );
  const hasTriunfobetHembra = triunfobetHembra.size > 0;

  return (
    <article className="panel group overflow-hidden transition duration-300 hover:border-slate-300 hover:shadow-[0_30px_80px_-50px_rgba(15,23,42,0.5)] dark:hover:border-white/[0.13] dark:hover:shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-white/[0.055] sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
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
          <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
            {match.league.name}
          </span>
          <span className="hidden text-[10px] text-slate-400 sm:inline dark:text-slate-500">
            {match.league.country}
          </span>
          {analysis.picks.some((pick) => pick.isHembra) ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">
              <Flame className="h-2.5 w-2.5" />
              Hembra
            </span>
          ) : hasTriunfobetHembra ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/[0.08] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300">
              <Flame className="h-2.5 w-2.5" />
              Hembra · Triunfobet
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatMatchDate(match.commenceTime)}
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <Clock3 className="h-3.5 w-3.5" />
            {formatMatchTime(match.commenceTime)}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
              match.status === "live"
                ? "border-rose-400/20 bg-rose-400/10 text-rose-600 dark:text-rose-300"
                : match.status === "finished"
                  ? "border-slate-300/50 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400"
                  : "border-sky-400/15 bg-sky-400/[0.08] text-sky-600 dark:text-sky-300",
            )}
          >
            {statusLabel(match.status)}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(220px,0.95fr)_minmax(0,1.45fr)] lg:gap-6">
        <div className="min-w-0">
          <div className="space-y-2.5">
            {[
              { team: match.home, side: "Local", outcome: "home" as const, standing: match.intel.standings.home },
              { team: match.away, side: "Visitante", outcome: "away" as const, standing: match.intel.standings.away },
            ].map(({ team, side, outcome, standing }) => {
              const isFavorite = match.favoriteSide === outcome;
              return (
                <div
                  key={team.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-1.5 py-1 transition",
                    isFavorite &&
                      "bg-amber-300/[0.07] ring-1 ring-amber-300/25",
                  )}
                >
                  <TeamBadge team={team} size="md" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
                        {team.name}
                      </p>
                      {isFavorite ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">
                          <Crown className="h-2.5 w-2.5" />
                          Favorito
                          </span>
                          ) : null}
                          {analysis.picks.find((pick) => pick.outcome === outcome)?.isHembra ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/[0.08] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                              <Flame className="h-2.5 w-2.5" />
                              Hembra
                            </span>
                          ) : triunfobetHembra.has(outcome) ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/[0.08] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                              <Flame className="h-2.5 w-2.5" />
                              Hembra · Triunfobet
                            </span>
                          ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      <span>{side}</span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="tabular-nums">
                        {standing.played > 0
                          ? `${standing.position}º${standing.group ? ` ${standing.group}` : ""}`
                          : "Sin ranking"}
                      </span>
                      {standing.played > 0 ? (
                        <>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span className="tabular-nums">
                            {formatRecord(standing)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {match.venue}
            </span>
            {injuryCount > 0 ? (
              <span className="flex items-center gap-1">
                <Stethoscope className="h-3 w-3" />
                <span className="tabular-nums">{injuryCount}</span> bajas
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <div
            className={cn(
              "grid gap-2",
              outcomes.length === 3 ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            {outcomes.map((outcome) => {
              const best = match.odds.best[outcome.key];
              const average = match.odds.average[outcome.key];
              const spread = match.odds.spreadPercent[outcome.key];
              const bestBookmaker = match.odds.bookmakers.find(
                (bookmaker) =>
                  best !== null &&
                  Math.abs((bookmaker.outcomes[outcome.key] ?? 0) - best) <
                    0.0001,
              );
              const hasOdds = best !== null && best > 1;

              return (
                <div
                  key={outcome.key}
                  className={cn(
                    "relative flex min-w-0 flex-col rounded-xl border px-2.5 py-2.5 transition",
                    hasOdds
                      ? "border-emerald-500/20 bg-emerald-500/[0.055] dark:border-emerald-400/[0.16] dark:bg-emerald-400/[0.065]"
                      : "border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.02]",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-500 dark:text-slate-400">
                      {outcome.label}
                    </span>
                    <span className="rounded bg-white/70 px-1 text-[8px] font-semibold text-slate-400 dark:bg-black/20 dark:text-slate-500">
                      {outcome.shortLabel}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-1.5 tabular-nums text-[23px] font-bold leading-none tracking-tight",
                      hasOdds
                        ? "text-emerald-600 dark:text-emerald-300"
                        : "text-slate-400",
                    )}
                  >
                    {formatOdd(best)}
                  </p>
                  <p className="mt-1 truncate text-[9px] font-medium text-slate-500 dark:text-slate-400">
                    {hasOdds ? bestBookmaker?.name ?? "Mejor precio" : "Sin cuota"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
                    <span>Media {formatOdd(average)}</span>
                    {spread !== null ? (
                      <span
                        className={cn(
                          "font-semibold",
                          spread > 0
                            ? "text-emerald-600/80 dark:text-emerald-400/80"
                            : "text-slate-400",
                        )}
                      >
                        {formatSignedPercent(spread)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {analysis.topPick ? (
                <span className="flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  <span className="truncate">
                    {analysis.topPick.probabilitySource}: {analysis.topPick.selectionName}
                  </span>
                  <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-300">
                    {formatPercent(analysis.topPick.modelProbability)}
                  </span>
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                aria-expanded={expanded}
              >
                {match.odds.bookmakerCount} casas
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => onOpenMatch(match)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 transition hover:border-emerald-400/40 hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-emerald-400/30 dark:hover:text-emerald-300"
              >
                <PanelRightOpen className="h-3 w-3" />
                Inteligencia
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-white/[0.055] dark:bg-black/15 sm:px-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500 dark:text-slate-400">
              Comparativa por casa
            </p>
            <p className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500">
              <Info className="h-3 w-3" />
              Verde = mejor cuota
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[430px] border-separate border-spacing-y-1 text-left text-[11px]">
              <thead>
                <tr className="table-head">
                  <th className="px-2 py-1 font-semibold">Casa</th>
                  <th className="px-2 py-1 font-semibold">Fuente</th>
                  {outcomes.map((outcome) => (
                    <th
                      key={outcome.key}
                      className="px-2 py-1 text-right font-semibold"
                    >
                      {outcome.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {match.odds.bookmakers.map((bookmaker) => (
                  <tr
                    key={`${bookmaker.source}-${bookmaker.id}`}
                    className="rounded-lg bg-white/70 dark:bg-white/[0.025]"
                  >
                    <td className="rounded-l-lg px-2 py-1.5 font-medium text-slate-700 dark:text-slate-200">
                      {bookmaker.name}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-medium",
                          bookmaker.source === "the-odds-api"
                            ? "bg-sky-400/10 text-sky-600 dark:text-sky-300"
                            : bookmaker.source === "sportmonks"
                              ? "bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                              : bookmaker.source === "api-sports"
                                ? "bg-violet-400/10 text-violet-600 dark:text-violet-300"
                                : bookmaker.source === "triunfobet" ? "bg-rose-400/10 text-rose-600 dark:text-rose-300" : "bg-amber-400/10 text-amber-600 dark:text-amber-300",
                        )}
                      >
                        {sourceLabel(bookmaker.source)}
                      </span>
                    </td>
                    {outcomes.map((outcome, outcomeIndex) => {
                      const price = bookmaker.outcomes[outcome.key];
                      const isBest =
                        price !== null &&
                        price > 1 &&
                        match.odds.best[outcome.key] !== null &&
                        Math.abs(price - (match.odds.best[outcome.key] ?? 0)) <
                          0.0001;
                      return (
                        <td
                          key={outcome.key}
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums font-semibold",
                            outcomeIndex === outcomes.length - 1 && "rounded-r-lg",
                            isBest
                              ? "text-emerald-600 dark:text-emerald-300"
                              : "text-slate-500 dark:text-slate-400",
                          )}
                        >
                          {formatOdd(price)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-white/[0.055] sm:px-5">
        <p className="text-[9px] text-slate-400 dark:text-slate-500">
          Mejor cuota disponible frente a media de mercado y spread porcentual.
        </p>
        <button
          type="button"
          onClick={() => onOpenMatch(match)}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 transition hover:text-emerald-600 dark:text-emerald-300 dark:hover:text-emerald-200"
        >
          Ver clasificación y bajas
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

export function OddsComparator({
  matches,
  leagues,
  activeLeague,
  onLeagueChange,
  activeSport,
  onSportChange,
  onOpenMatch,
}: OddsComparatorProps) {
  return (
    <section id="comparador" className="scroll-mt-36">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-px w-5 bg-emerald-500" />
            <span className="eyebrow">Mercado en tiempo real</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
              <CalendarDays className="h-2.5 w-2.5" />
              Solo hoy · VET · Pendientes
            </span>
          </div>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl">
            Comparador multi-casa
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
            Cruzamos Flashscore, The Odds API, API-Sports y Triunfobet para
            encontrar dónde paga más cada resultado. El verde señala el mejor
            precio y 🔥 Hembra destaca favoritos con cuota ≥ 1,80; el radar exige además EV positivo.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <button
            type="button"
            onClick={() => onSportChange(activeSport === "soccer" ? "all" : "soccer")}
            aria-pressed={activeSport === "soccer"}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition",
              activeSport === "soccer"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-400/40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300",
            )}
          >
            ⚽ Solo fútbol
          </button>
          <label className="sr-only" htmlFor="league-filter">
            Filtrar por liga
          </label>
          <select
            id="league-filter"
            value={activeLeague}
            onChange={(event) => onLeagueChange(event.target.value)}
            className="input-field h-9 min-w-[190px] appearance-none py-0 pr-8 text-xs font-medium"
          >
            <option value="all">Todas las ligas</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name} · {league.country}
              </option>
            ))}
          </select>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/10 dark:bg-white/[0.03]">
            <Search className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">
            No hay partidos con estos filtros
          </h3>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Prueba con otro deporte, cambia la liga o limpia la búsqueda para
            recuperar todos los eventos disponibles.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {matches.map((match) => (
            <OddsCard
              key={match.id}
              match={match}
              onOpenMatch={onOpenMatch}
            />
          ))}
        </div>
      )}
    </section>
  );
}
