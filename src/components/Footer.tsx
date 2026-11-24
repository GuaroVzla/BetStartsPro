import { AlertTriangle, HeartPulse, ShieldCheck } from "lucide-react";
import type { DataMode } from "@/types/sports";
import { cn } from "@/lib/utils";

interface FooterProps {
  mode: DataMode;
}

export function Footer({ mode }: FooterProps) {
  return (
    <footer className="mt-16 border-t border-slate-200/80 bg-white/55 dark:border-white/[0.06] dark:bg-black/20">
      <div className="mx-auto max-w-[1480px] px-4 py-10 sm:px-6">
        <div
          id="legal"
          className="scroll-mt-36 rounded-2xl border border-amber-400/20 bg-amber-400/[0.055] p-4 dark:border-amber-300/10 dark:bg-amber-300/[0.035]"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-600 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                Aviso legal y juego responsable
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-100/65">
                BetStats Pro es una herramienta de análisis estadístico e
                información de cuotas. No es una casa de apuestas, no acepta
                depósitos y no garantiza resultados. Las probabilidades, el valor
                esperado y las recomendaciones son estimaciones basadas en datos
                históricos y de mercado que pueden contener errores o retrasos.
                Ninguna estrategia elimina el riesgo. Si apuestas, hazlo solo con
                dinero que puedas permitirte perder y con límites claros.
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium text-amber-800/75 dark:text-amber-100/55">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Solo mayores de 18 años
                </span>
                <span className="inline-flex items-center gap-1">
                  <HeartPulse className="h-3 w-3" />
                  Si el juego deja de ser un entretenimiento, busca ayuda
                  profesional.
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500 text-blue-950">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 19V9m5.5 10V5M15 19v-7m5 7V8"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                BetStats Pro
              </span>
              <span className="rounded border border-slate-200 bg-white/60 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-500">
                Analytics
              </span>
            </div>
            <p className="mt-3 max-w-md text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Inteligencia de mercado para fútbol, básquet, béisbol y hockey.
              Cruzamos cuotas, medimos el valor esperado y ponemos el contexto
              estadístico al servicio de decisiones más informadas.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-[9px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                Fútbol · 5 ligas
              </span>
              <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-[9px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                NBA + Euroliga
              </span>
              <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-[9px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                MLB + LIDOM
              </span>
              <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-[9px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                NHL
              </span>
            </div>
          </div>

          <div>
            <p className="eyebrow">Fuentes de datos</p>
            <ul className="mt-3 space-y-2 text-[11px] text-slate-500 dark:text-slate-400">
              <li>Clasificaciones y estadísticas: API-Sports</li>
              <li>Cuotas multi-casa: The Odds API</li>
              <li>Modelo probabilístico: cálculo propio</li>
              <li>
                Estado:{" "}
                <span
                  className={cn(
                    "font-semibold",
                    mode === "live"
                      ? "text-blue-600 dark:text-blue-300"
                      : mode === "hybrid"
                        ? "text-sky-600 dark:text-sky-300"
                        : "text-amber-600 dark:text-amber-300",
                  )}
                >
                  {mode === "live"
                    ? "Datos en vivo"
                    : mode === "hybrid"
                      ? "Datos híbridos"
                      : "Modo demo"}
                </span>
              </li>
            </ul>
          </div>

          <div>
            <p className="eyebrow">Metodología</p>
            <ul className="mt-3 space-y-2 text-[11px] text-slate-500 dark:text-slate-400">
              <li>Probabilidad implícita: 1 / cuota</li>
              <li>Valor esperado: p × cuota − 1</li>
              <li>Forma, localía, tabla y bajas ponderadas</li>
              <li>Caché de datos de 60 minutos</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-slate-200/80 pt-5 text-[9px] text-slate-400 dark:border-white/[0.06] dark:text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} BetStats Pro. Todos los derechos
            reservados.
          </p>
          <p>
            Las cuotas mostradas son referencias informativas y pueden variar
            hasta el inicio del evento.
          </p>
        </div>
      </div>
    </footer>
  );
}
