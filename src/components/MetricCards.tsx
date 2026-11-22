import {
  ArrowLeftRight,
  CalendarDays,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import type { SportsMatch, ValuePick } from "@/types/sports";
import { formatInteger, formatOdd, formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MetricCardsProps {
  matches: SportsMatch[];
  leagueCount: number;
  bestPick: ValuePick | null;
}

export function MetricCards({ matches, leagueCount, bestPick }: MetricCardsProps) {
  const quoteCount = matches.reduce(
    (total, match) => total + match.odds.bookmakerCount,
    0,
  );

  const cards = [
    {
      label: "Eventos analizados",
      value: formatInteger(matches.length),
      hint: "Fútbol · Básquet · Béisbol · Hockey",
      icon: CalendarDays,
      tone: "default" as const,
    },
    {
      label: "Ligas activas",
      value: formatInteger(leagueCount),
      hint: "Solo mercados de las 4 disciplinas",
      icon: Trophy,
      tone: "default" as const,
    },
    {
      label: "Cotizaciones cruzadas",
      value: formatInteger(quoteCount),
      hint: "The Odds API + API-Sports",
      icon: ArrowLeftRight,
      tone: "default" as const,
    },
    {
      label: "Mejor valor esperado",
      value: bestPick
        ? formatSignedPercent(bestPick.analysis.expectedValue)
        : "Sin picks",
      hint: bestPick
        ? `${bestPick.analysis.selectionName} · cuota ${formatOdd(bestPick.analysis.bestOdds)}`
        : "Ajusta los umbrales del radar",
      icon: TrendingUp,
      tone: "accent" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={cn(
              "group relative overflow-hidden rounded-2xl border p-4 transition duration-300 sm:p-5",
              card.tone === "accent"
                ? "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.14] via-emerald-400/[0.07] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-emerald-400/20"
                : "border-slate-200/80 bg-white/80 dark:border-white/[0.07] dark:bg-white/[0.025]",
            )}
          >
            <div
              className={cn(
                "absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-100",
                card.tone === "accent"
                  ? "bg-emerald-400/20 opacity-70"
                  : "bg-slate-400/[0.06] opacity-40 dark:bg-white/[0.03]",
              )}
            />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500 dark:text-slate-400">
                  {card.label}
                </p>
                <p
                  className={cn(
                    "mt-2 tabular-nums text-2xl font-bold tracking-tight sm:text-[28px]",
                    card.tone === "accent"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-slate-950 dark:text-white",
                  )}
                >
                  {card.value}
                </p>
              </div>
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                  card.tone === "accent"
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                    : "border-slate-200/80 bg-slate-50 text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-slate-400",
                )}
              >
                {card.tone === "accent" && !bestPick ? (
                  <Sparkles className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                )}
              </span>
            </div>
            <p className="relative mt-3 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {card.hint}
            </p>
          </div>
        );
      })}
    </div>
  );
}
