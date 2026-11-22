const oddFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactNumberFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 0,
});

const VET_TIME_ZONE = "America/Caracas";

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: VET_TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: VET_TIME_ZONE,
});

export function formatOdd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return oddFormatter.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value * 100)}%`;
}

export function formatSignedPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const formatted = formatPercent(Math.abs(value), digits);
  return `${value >= 0 ? "+" : "−"}${formatted}`;
}

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatAverage(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompact(value: number): string {
  return compactNumberFormatter.format(value);
}

/** Fecha (YYYY-MM-DD) en hora de Venezuela para un instante dado. */
export function dateInVET(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

/** Comprueba que un partido pertenezca al día actual en hora de Venezuela. */
export function isTodayVET(isoDate: string): boolean {
  const date = new Date(isoDate);
  return Number.isFinite(date.getTime()) && dateInVET(date) === dateInVET();
}

/**
 * Comprueba si un encuentro ya comenzó respecto a un instante dado.
 * Los partidos en vivo o finalizados se consideran comenzados por definición;
 * uno programado se considera comenzado en el momento exacto de su inicio.
 */
export function hasMatchStarted(
  match: { commenceTime: string; status: "scheduled" | "live" | "finished" },
  now: Date = new Date(),
): boolean {
  if (match.status !== "scheduled") return true;
  const start = new Date(match.commenceTime).getTime();
  return Number.isFinite(start) && start <= now.getTime();
}

/** Comprueba si un encuentro todavía está por disputarse. */
export function isUpcomingMatch(
  match: { commenceTime: string; status: "scheduled" | "live" | "finished" },
  now: Date = new Date(),
): boolean {
  return !hasMatchStarted(match, now);
}

export function formatMatchDate(isoDate: string): string {
  return dateFormatter.format(new Date(isoDate)).replace(".", "");
}

export function formatMatchTime(isoDate: string): string {
  return timeFormatter.format(new Date(isoDate));
}

export function formatMatchDateTime(isoDate: string): string {
  return `${formatMatchDate(isoDate)} · ${formatMatchTime(isoDate)}`;
}

export function formatRelativeRefresh(isoDate: string): string {
  const diffMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000),
  );

  if (diffMinutes < 1) return "ahora mismo";
  if (diffMinutes === 1) return "hace 1 min";
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;

  const hours = Math.floor(diffMinutes / 60);
  return hours === 1 ? "hace 1 h" : `hace ${hours} h`;
}

export function formatCredits(value: number | null, isMock: boolean): string {
  if (isMock) return "Demo";
  if (value === null) return "N/D";
  return `${formatInteger(value)} cr.`;
}

export function formatRecord(row: { wins: number; draws: number; losses: number }): string {
  const parts = [row.wins, row.draws, row.losses].filter(
    (part, index) => index !== 1 || part > 0,
  );
  return parts.join("-");
}

export function formatStreak(streak: string): string {
  return streak.replace(/^([WDL])/, (match) => match);
}

export function outcomeLabel(outcome: "home" | "draw" | "away", home: string, away: string): string {
  if (outcome === "draw") return "Empate";
  return outcome === "home" ? home : away;
}
