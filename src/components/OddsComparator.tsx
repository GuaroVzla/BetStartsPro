"use client";

import { useMemo } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  Crown,
  Info,
  MapPin,
  PanelRightOpen,
  Search,
  Stethoscope,
  Target,
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
  dayLabel: string;
}

function statusLabel(status: SportsMatch["status"]): string {
  if (status === "live") return "En vivo";
  if (status === "finished") return "Finalizado";
  return "Programado";
}

function SPORT_ACCENT_MAP(): Record<string, string> {
  return {
    soccer: "blue",
    basketball: "orange",
    tennis: "green",
    volleyball: "purple",
    hockey: "red",
    baseball: "teal",
  };
}

function OddsCard({
  match,
  onOpenMatch,
}: {
  match: SportsMatch;
  onOpenMatch: (match: SportsMatch) => void;
}) {
  const analysis = useMemo(() => analyzeMatch(match), [match]);
  const sport = SPORT_BY_KEY[match.sport];
  const sportAccent = SPORT_ACCENT_MAP()[match.sport] || "blue";
  const homeOdds = match.odds.best?.home;
  const awayOdds = match.odds.best?.away;

  // Calcular diferencial de valor entre Triunfobet y Apuestas Royal
  const royalQuoteHome = match.odds.bookmakers.find(
    (b) => b.source === "apuestas-royal" && b.outcomes?.home !== null,
  )?.outcomes?.home;
  const royalQuoteAway = match.odds.bookmakers.find(
    (b) => b.source === "apuestas-royal" && b.outcomes?.away !== null,
  )?.outcomes?.away;
  const triumphobetQuoteHome = match.odds.bookmakers.find(
    (b) => b.source === "triunfobet" && b.outcomes?.home !== null,
  )?.outcomes?.home;
  const triumphobetQuoteAway = match.odds.bookmakers.find(
    (b) => b.source === "triunfobet" && b.outcomes?.away !== null,
  )?.outcomes?.away;

  const valueDiffHome = royalQuoteHome && triumphobetQuoteHome
    ? ((royalQuoteHome - triumphobetQuoteHome) / triumphobetQuoteHome * 100).toFixed(1)
    : "—";
  const valueDiffAway = royalQuoteAway && triumphobetQuoteAway
    ? ((royalQuoteAway - triumphobetQuoteAway) / triumphobetQuoteAway * 100).toFixed(1)
    : "—";

  const favoriteSide = match.favoriteSide;

  return (
    <section className="card card-compact border-border bg-card shadow-sm transition-colors hover:border-border/30 hover:shadow-sm">
      <div className="card-header flex flex-col sm:flex-row sm:items-start sm:gap-2 pb-2 border-b border-border/30">
        <div className="card-header-left flex items-center gap-2">
          <span className="sport-badge" style={{ color: sportAccent, borderColor: `${sportAccent}33` }}>
            <SportIcon sport={match.sport} className="h-3 w-3" />
            {sport.label}
          </span>
          <span className="text-xs font-medium truncate">
            {match.league.name}
          </span>
        </div>
        <div className="card-header-right flex items-center gap-2">
          <span className="text-xs text-muted">
            {formatMatchDate(match.commenceTime)}
          </span>
          <span className="text-xs text-muted ml-2">·</span>
          <span className="text-xs text-muted">
            {formatMatchTime(match.commenceTime)}
          </span>
        </div>
      </div>

      <div className="card-content">
        <div className="matchup mb-3">
          <div className="flex items-center gap-1.5">
            <TeamBadge team={match.home} size="sm" className="ring-1 ring-border" />
            <span className="text-sm font-medium truncate">
              {match.home.shortName}
            </span>
            <span className="mx-1">vs</span>
            <TeamBadge team={match.away} size="sm" className="ring-1 ring-border" />
          </div>
          {favoriteSide && (
            <span className="text-xs font-semibold ml-auto">
              <Crown className="h-1.5 w-1.5" />
              {favoriteSide === "home" ? match.home.shortName : match.away.shortName}
            </span>
          )}
        </div>

        <div className="odds-compact mb-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Triunfobet</span>
            <span className="font-medium text-compactOdds">
              {formatOdd(homeOdds)} / {formatOdd(awayOdds)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400">{valueDiffHome}%</span>
            <span className="text-rose-400">{valueDiffAway}%</span>
          </div>
        </div>

        <div className="meta-row mb-3">
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-0.5">
              <Target className="h-2 w-2" />
              {analysis.topPick?.valueFavorite?.favoritePosition ?? "—"}º
            </span>
          </div>
        </div>
      </div>

      <div className="card-footer flex items-center justify-between px-2 py-1.5 border-t border-border/20 text-xs text-muted">
        <span>
          {match.odds.bookmakerCount} casas · {statusLabel(match.status)}
        </span>
        <button
          type="button"
          onClick={() => onOpenMatch(match)}
          className="btn-link underline underline-blue-500 hover:text-blue-400"
        >
          Ver intel
        </button>
      </div>
    </section>
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
  dayLabel,
}: OddsComparatorProps) {
  return (
    <section id="comparador" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-px w-5 bg-blue-500" />
            <span className="eyebrow">Mercado en tiempo real</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/20 bg-blue-400/[0.07] px-2 py-0.5 text-[9px] font-semibold text-blue-600 dark:text-blue-300">
              <CalendarDays className="h-2.5 w-2.5" />
              {dayLabel} · VET · Pendientes
            </span>
          </div>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl">
            Comparador multi-casa
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
            Cruzamos Triunfobet y Apuestas Royal para encontrar el mejor valor en cuota.
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
                ? "border-blue-400/30 bg-blue-400/10 text-blue-700 dark:text-blue-300"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-400/40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300",
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
        <div className="empty-state flex flex-col items-center justify-center px-6 py-8 text-center">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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