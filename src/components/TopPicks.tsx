"use client";

import { ArrowUpRight, Crosshair, Flame, Sparkles } from "lucide-react";
import type { OutcomeKey, SportsMatch } from "@/types/sports";
import type { CrossSourcePick } from "@/services/valueEngine";
import { favoriteProbability } from "@/services/favoriteProbability";
import {
  formatAmericanOdd,
  formatMatchTime,
  formatOdd,
  formatPercent,
  formatSignedPercent,
  toAmericanOdd,
} from "@/lib/format";
import { cn } from "@/lib/utils";

interface TopPicksProps {
  picks: CrossSourcePick[];
  matches?: SportsMatch[];
  onOpenMatch: (match: SportsMatch) => void;
}

interface TopOpportunityItem {
  id: string;
  match: SportsMatch;
  leagueShortName: string;
  commenceTime: string;
  homeShortName: string;
  awayShortName: string;
  selection: string;
  bestOdds: number;
  edge: number;
  probability: number;
  source: string;
}

/** Resumen compacto de las mejores oportunidades del día: 🔥 Fuego Esmeralda (+EV y cuota >= +100 / >= 2.00 decimal). */
export function TopPicks({ picks, matches = [], onOpenMatch }: TopPicksProps) {
  // 1. Picks del valueEngine tradicional
  const enginePicks: TopOpportunityItem[] = picks
    .filter((pick) => {
      const american = toAmericanOdd(pick.bestOdds);
      // Cuota positiva (+100 o más) con Valor Esperado positivo
      return american !== null && american >= 100 && pick.edge > 0 && pick.expectedValue > 0;
    })
    .map((pick) => ({
      id: pick.id,
      match: pick.match,
      leagueShortName: pick.match.league.shortName,
      commenceTime: pick.match.commenceTime,
      homeShortName: pick.match.home.shortName,
      awayShortName: pick.match.away.shortName,
      selection: pick.selection,
      bestOdds: pick.bestOdds,
      edge: pick.edge,
      probability: pick.statisticalProbability,
      source: pick.probabilitySource,
    }));

  // 2. Oportunidades directas de MatchesBoard (Favorito o Empate con Fuego Esmeralda 🔥 +EV y cuota >= 2.00)
  const boardOpportunities: TopOpportunityItem[] = [];
  for (const match of matches) {
    const fav = favoriteProbability(match);
    const favOutcome: OutcomeKey = fav.side;
    const bestFavOdd = match.odds.best[favOutcome] ?? 0;
    const isPlusMoney = bestFavOdd >= 2.0;
    const impliedProb = bestFavOdd > 1 ? 1 / bestFavOdd : 1;
    const edge = fav.probability - impliedProb;

    if (isPlusMoney && edge > 0) {
      boardOpportunities.push({
        id: `board-fav-${match.id}`,
        match,
        leagueShortName: match.league.shortName,
        commenceTime: match.commenceTime,
        homeShortName: match.home.shortName,
        awayShortName: match.away.shortName,
        selection: fav.side === "home" ? match.home.shortName : match.away.shortName,
        bestOdds: bestFavOdd,
        edge,
        probability: fav.probability,
        source: "favorito +EV",
      });
    }

    // Empate de alto pago en fútbol con ventaja estadística
    if (match.sport === "soccer") {
      const drawOdd = match.odds.best.draw ?? 0;
      const drawImplied = drawOdd > 1 ? 1 / drawOdd : 1;
      const drawProb = fav.drawProbability ?? 0;
      const drawEdge = drawProb - drawImplied;
      if (drawOdd >= 2.0 && drawEdge > 0 && drawProb >= 0.28) {
        boardOpportunities.push({
          id: `board-draw-${match.id}`,
          match,
          leagueShortName: match.league.shortName,
          commenceTime: match.commenceTime,
          homeShortName: match.home.shortName,
          awayShortName: match.away.shortName,
          selection: "Empate",
          bestOdds: drawOdd,
          edge: drawEdge,
          probability: drawProb,
          source: "empate +EV",
        });
      }
    }
  }

  // Combinar y deduplicar por matchId, ordenando por Edge (+EV) descendente
  const combinedMap = new Map<string, TopOpportunityItem>();
  for (const item of [...enginePicks, ...boardOpportunities]) {
    const key = `${item.match.id}-${item.selection}`;
    const existing = combinedMap.get(key);
    if (!existing || item.edge > existing.edge) {
      combinedMap.set(key, item);
    }
  }

  const allPlusMoneyEV = Array.from(combinedMap.values()).sort((a, b) => b.edge - a.edge);

  return (
    <section aria-labelledby="top-picks-title" className="panel p-3.5 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Flame className="h-4 w-4" />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 id="top-picks-title" className="text-[12px] font-bold text-slate-900 dark:text-white">
                Top Picks 🔥 +EV
              </h2>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-black text-emerald-700 dark:text-emerald-300">
                Cuotas Positivas
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Oportunidades de alto pago (cuotas positivas / plus-money) con Valor Esperado (+EV)
            </p>
          </div>
        </div>
        <span className="badge-live border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Sparkles className="h-3 w-3" />
          {allPlusMoneyEV.length} señales 🔥
        </span>
      </div>

      {allPlusMoneyEV.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
          No hay selecciones que alcancen 🔥 +EV con cuota ≥ +100 en este momento. Revisa el tablero general para cuotas intermedias.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {allPlusMoneyEV.slice(0, 4).map((pick) => (
            <button
              key={pick.id}
              type="button"
              onClick={() => onOpenMatch(pick.match)}
              className="group rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3 text-left transition hover:border-emerald-500/60 hover:bg-emerald-500/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 dark:border-emerald-500/25 dark:bg-emerald-500/[0.03] dark:hover:border-emerald-400/40"
            >
              <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                <span className="truncate font-semibold text-slate-600 dark:text-slate-300">{pick.leagueShortName}</span>
                <span className="tabular-nums">{formatMatchTime(pick.commenceTime)}</span>
              </div>
              <p className="mt-1 truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                {pick.homeShortName} <span className="text-slate-300 dark:text-slate-600">vs</span>{" "}
                {pick.awayShortName}
              </p>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[18px] font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatAmericanOdd(pick.bestOdds)}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                    ({formatOdd(pick.bestOdds)})
                  </span>
                </div>
                <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                  <Flame className="h-3 w-3" />
                  {formatSignedPercent(pick.edge)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-emerald-500/10 pt-2 text-[10px] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                <span className="truncate font-medium">
                  {pick.selection} · {formatPercent(pick.probability)} prob. ({pick.source})
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-600 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-emerald-400" />
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
