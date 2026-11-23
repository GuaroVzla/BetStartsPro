/**
 * MatchAnalyticsModal - Modal de detalles predictivos.
 * Desglosa cuotas por casa, probabilidades, valor esperado, factores de
 * confianza y estadísticas de mercado.
 */

import {
  X,
  Star,
  Activity,
  BarChart3,
  Target,
  Building2,
  Shield,
  CheckCircle,
} from "lucide-react";

import type { SportsMatch, OutcomeKey } from "@/types/sports";
import type { PredictiveSnapshot, DashboardAnalytics } from "@/types/predictive";

import { cn } from "@/lib/utils";
import { formatCompact, formatPercent, formatSignedPercent } from "@/lib/format";
import { SportIcon } from "@/components/SportIcon";
import { TeamBadge } from "@/components/TeamBadge";

interface MatchAnalyticsModalProps {
  match: SportsMatch | null;
  outcome: OutcomeKey | null;
  isOpen: boolean;
  onClose: () => void;
  analytics: DashboardAnalytics;
}

const TONE_BORDER: Record<"blue" | "emerald" | "slate", string> = {
  blue: "border-blue-400/25",
  emerald: "border-emerald-400/25",
  slate: "border-slate-200/80",
};
const TONE_BG: Record<"blue" | "emerald" | "slate", string> = {
  blue: "bg-blue-400/10",
  emerald: "bg-emerald-400/10",
  slate: "bg-slate-50",
};
const TONE_TEXT: Record<"blue" | "emerald" | "slate", string> = {
  blue: "text-blue-700 dark:text-blue-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  slate: "text-slate-600 dark:text-slate-300",
};
const TONE_ICON: Record<"blue" | "emerald" | "slate", string> = {
  blue: "border-blue-400/20 bg-blue-400/10 text-blue-600 dark:text-blue-300",
  emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  slate: "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400",
};

const CONFIDENCE_LABELS: Record<PredictiveSnapshot["confidence"], string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Star;
  label: string;
  value: string;
  hint?: string;
  tone: "blue" | "emerald" | "slate";
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-4",
        TONE_BORDER[tone],
        TONE_BG[tone],
      )}
    >
      <span
        className={cn(
          "absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-lg border",
          TONE_ICON[tone],
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <p className="relative text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={cn(
          "relative mt-1.5 truncate text-lg font-bold text-slate-950 dark:text-white sm:text-xl",
          TONE_TEXT[tone],
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="relative mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function rankName(name: string): number {
  const n = name.toLowerCase();
  if (n.includes("triunfobet")) return 0;
  if (n.includes("royal")) return 1;
  if (n.includes("odds")) return 2;
  if (n.includes("sportmonks")) return 3;
  return 4;
}

function outcomeSpread(home: number, best: number): string {
  if (best <= 0) return "—";
  const pct = ((home - best) / best) * 100;
  return pct >= 0 ? `+${Math.round(pct)}%` : `${Math.round(pct)}%`;
}

export function MatchAnalyticsModal({
  match,
  outcome,
  isOpen,
  onClose,
  analytics,
}: MatchAnalyticsModalProps) {
  if (!isOpen || !match) {
    return null;
  }

  const snapshot =
    analytics.snapshots.find(
      (s) => s.matchId === match.id && s.outcome === (outcome || "home"),
    ) ?? null;

  const bookmakerOdds = match.odds.bookmakers
    .map((b) => ({
      name: b.name,
      home: b.outcomes.home > 1 ? b.outcomes.home : null,
      draw:
        b.outcomes.draw !== null && b.outcomes.draw > 1 ? b.outcomes.draw : null,
      away: b.outcomes.away > 1 ? b.outcomes.away : null,
    }))
    .sort((a, b) => rankName(a.name) - rankName(b.name));

  const risk = {
    injuryImpact: 0.05,
    dataAvailability: 0.9,
    suspendImpact: 0.02,
  };

  const evValue = snapshot?.expectedValue;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md transition-opacity">
      <div className="panel relative max-h-[90vh] w-full max-w-4xl overflow-hidden sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/[0.06] sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-400/10 text-blue-600 dark:text-blue-300">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                Análisis Predictivo
              </h2>
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                Desglose detallado del pronóstico
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button shrink-0"
            aria-label="Cerrar análisis predictivo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-64px)] space-y-5 overflow-y-auto p-5 sm:p-6">
          {/* Cabecera del partido */}
          <div className="panel-inset flex items-center justify-between gap-4 rounded-2xl p-4">
            <div className="flex min-w-0 items-center gap-4">
              <SportIcon sport={match.sport} className="h-8 w-8 text-blue-500" />
              <div>
                <h3 className="truncate font-bold text-slate-950 dark:text-white">
                  {match.league.name}
                </h3>
                <div className="mt-1 flex items-center gap-3">
                  <TeamBadge team={match.home} size="sm" />
                  <span className="text-slate-400">vs</span>
                  <TeamBadge team={match.away} size="sm" />
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                {new Date(match.commenceTime).toLocaleString("es-ES")}
              </p>
              <p className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                En curso
              </p>
            </div>
          </div>

          {/* Resumen: favorito · probabilidad · valor esperado */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Star}
              label="Favorito"
              value={`${match.home.name} vs ${match.away.name}`}
              hint={match.league.country}
              tone="blue"
            />
            <StatCard
              icon={BarChart3}
              label="Probabilidad"
              value={
                snapshot ? formatPercent(snapshot.estimatedProbability) : "N/A"
              }
              hint={
                snapshot
                  ? `${CONFIDENCE_LABELS[snapshot.confidence]} · ${snapshot.confidenceScore}%`
                  : undefined
              }
              tone="slate"
            />
            <StatCard
              icon={Target}
              label="Valor Esperado"
              value={
                evValue !== undefined && evValue !== null
                  ? formatSignedPercent(evValue)
                  : "N/A"
              }
              hint={
                snapshot
                  ? `Spread del mercado · ${Math.round(snapshot.valueSpreadPct)}%`
                  : undefined
              }
              tone="emerald"
            />
          </div>

          {/* Cuotas por casa de apuestas */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              <h4 className="font-bold text-slate-950 dark:text-white">
                Cuotas por casa de apuestas
              </h4>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-100/80 dark:border-white/[0.05]">
              <table className="w-full text-left">
                <thead className="border-b border-slate-100/80 dark:border-white/[0.05]">
                  <tr className="table-head">
                    <th className="px-4 py-3">Casa de apuestas</th>
                    <th className="px-4 py-3 text-right">Local</th>
                    <th className="px-4 py-3 text-right">Empate</th>
                    <th className="px-4 py-3 text-right">Visitante</th>
                    <th className="px-4 py-3 text-right">Variación vs mejor cuota</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/80 dark:divide-white/[0.04]">
                  {bookmakerOdds.map((book, index) => (
                    <tr
                      key={index}
                      className="transition hover:bg-slate-50/60 dark:hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        {book.name}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {book.home === null ? "—" : formatCompact(book.home)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {book.draw === null ? "—" : formatCompact(book.draw)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {book.away === null ? "—" : formatCompact(book.away)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {book.home === null
                          ? "—"
                          : outcomeSpread(book.home, match.odds.best.home)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mejor cuota vs promedio */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={Target}
                label="Mejor cuota"
                value={formatCompact(
                  match.odds.best.home || match.odds.best.away,
                )}
                tone="blue"
              />
              <StatCard
                icon={BarChart3}
                label="Promedio"
                value={formatCompact(
                  match.odds.average.home || match.odds.average.away,
                )}
                tone="slate"
              />
            </div>
          </div>

          {/* Análisis de valor */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500" />
              <h4 className="font-bold text-slate-950 dark:text-white">
                Análisis de valor
              </h4>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <StatCard
                icon={Star}
                label="Confianza"
                value={snapshot ? snapshot.confidence.toUpperCase() : "—"}
                hint={snapshot ? `${snapshot.confidenceScore}%` : undefined}
                tone="blue"
              />
              <StatCard
                icon={Target}
                label="Recomendación"
                value={snapshot ? snapshot.recommendation : "N/A"}
                hint={
                  snapshot
                    ? {
                        BUY: "Valor positivo",
                        PASS: "Sin inflación aparente",
                        NOT_BET: "Evitar por factores negativos",
                      }[snapshot.recommendation]
                    : undefined
                }
                tone="emerald"
              />
              <StatCard
                icon={BarChart3}
                label="Probabilidad estimada"
                value={
                  snapshot
                    ? formatPercent(snapshot.estimatedProbability)
                    : "N/A"
                }
                tone="blue"
              />
              <StatCard
                icon={Target}
                label="Valor Esperado"
                value={
                  snapshot ? formatSignedPercent(snapshot.expectedValue) : "N/A"
                }
                hint={
                  snapshot
                    ? `Confianza ${snapshot.confidence} · ${snapshot.confidenceScore}%`
                    : undefined
                }
                tone="emerald"
              />
            </div>

            {/* Cobertura del mercado */}
            <div className="panel-inset flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-500" />
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                  Cobertura del mercado
                </p>
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {match.odds.bookmakers.length} Casas ofrecen odds
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full border border-blue-400/25 bg-blue-400/10 px-2.5 py-1 text-[10px] text-blue-700 dark:text-blue-300">
                Triunfobet
              </span>
              <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-1 text-[10px] text-rose-600 dark:text-rose-300">
                Apuestas Royal
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                Flashscore
              </span>
            </div>
          </div>

          {/* Factores de riesgo */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-rose-500" />
              <h4 className="font-bold text-slate-950 dark:text-white">
                Factores de riesgo
              </h4>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    label: "Impacto por lesiones",
                    value: formatPercent(risk.injuryImpact),
                  },
                  {
                    label: "Disponibilidad de datos",
                    value: formatPercent(risk.dataAvailability),
                  },
                  {
                    label: "Riesgo de suspensión",
                    value: formatPercent(risk.suspendImpact),
                  },
                ] as const
              ).map((item) => (
                <div key={item.label} className="panel-inset rounded-xl p-3">
                  <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm font-bold text-rose-600 dark:text-rose-300">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-3 border-t border-slate-200/80 pt-4 dark:border-white/[0.06]">
            <button
              type="button"
              className="flex-1 rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
            >
              <CheckCircle className="mr-2 inline h-4 w-4" />
              Marcar Como Revisado
            </button>
            <button
              type="button"
              className="flex-1 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              <Star className="mr-2 inline h-4 w-4 text-amber-500" />
              Añadir a Favoritos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
