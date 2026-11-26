import {
  ArrowLeftRight,
  CalendarDays,
  Sparkles,
  Target,
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
  valueFavoriteCount: number;
  dayLabel: string;
}

export function MetricCards({
  matches,
  leagueCount,
  bestPick,
  valueFavoriteCount,
  dayLabel,
}: MetricCardsProps) {
  const quoteCount = matches.reduce(
    (total, match) => total + match.odds.bookmakerCount,
    0,
  );

  const cards = [
    {
      label: `Eventos de ${dayLabel.toLowerCase()}`,
      value: formatInteger(matches.length),
      hint: "Fútbol · Básquet · Béisbol · Hockey",
      icon: CalendarDays,
      tone: "default" as const,
    },
    {
      label: "Ligas activas",
      value: formatInteger(leagueCount),
      hint: "Filtradas por tu gestor de ligas",
      icon: Trophy,
      tone: "default" as const,
    },
    {
      label: "Cotizaciones cruzadas",
      value: formatInteger(quoteCount),
      hint: "APIs + Apuestas Royal",
      icon: ArrowLeftRight,
      tone: "default" as const,
    },
    {
      label: "Favoritos +2.00",
      value: formatInteger(valueFavoriteCount),
      hint:
        valueFavoriteCount > 0
          ? "Cuota alta + forma + tabla + localía"
          : "Sin favoritos que cumplan las 3 validaciones",
      icon: Target,
      tone: "cyan" as const,
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
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={cn(
              "group relative overflow-hidden rounded-2xl border p-4 transition duration-300 sm:p-5",
              card.tone === "accent"
                ? "border-blue-500/25 bg-gradient-to-br from-blue-500/[0.14] via-blue-400/[0.07] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-blue-400/20"
                : card.tone === "cyan"
                  ? "border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.12] via-sky-400/[0.05] to-transparent dark:border-cyan-400/20"
                  : "border-slate-200/80 bg-white/80 dark:border-white/[0.07] dark:bg-white/[0.025]",
            )}
          >
            <div
              className={cn(
                "absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-100",
                card.tone === "accent"
                  ? "bg-blue-400/20 opacity-70"
                  : card.tone === "cyan"
                    ? "bg-cyan-400/20 opacity-70"
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
                      ? "text-blue-700 dark:text-blue-300"
                      : card.tone === "cyan"
                        ? "text-cyan-700 dark:text-cyan-300"
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
                    ? "border-blue-400/20 bg-blue-400/10 text-blue-600 dark:text-blue-300"
                    : card.tone === "cyan"
                      ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300"
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
