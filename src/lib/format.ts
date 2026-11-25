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
// Venezuela no observa horario de verano: el offset es siempre -04:00.
const VET_OFFSET = "-04:00";

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

/** Convierte cuota decimal a formato americano (+100, -150). */
export function toAmericanOdd(decimal: number | null | undefined): number | null {
  if (decimal === null || decimal === undefined || !Number.isFinite(decimal)) {
    return null;
  }
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  if (decimal > 1) return Math.round(-100 / (decimal - 1));
  return null;
}

export function formatAmericanOdd(decimal: number | null | undefined): string {
  const american = toAmericanOdd(decimal);
  if (american === null) return "—";
  return american > 0 ? `+${american}` : String(american);
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
  const instante = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(instante.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** Fecha VET de un día relativo a hoy (0 = hoy, 1 = mañana). */
export function dateInVETOffset(days: number, base: Date = new Date()): string {
  const shifted = new Date(base.getTime() + days * 86_400_000);
  return dateInVET(shifted);
}

/** Comprueba que un partido pertenezca al día actual en hora de Venezuela. */
export function isTodayVET(isoDate: string, now: Date = new Date()): boolean {
  const date = new Date(isoDate);
  return Number.isFinite(date.getTime()) && dateInVET(date) === dateInVET(now);
}

/** Comprueba que un partido pertenezca al día siguiente en hora de Venezuela. */
export function isTomorrowVET(isoDate: string, now: Date = new Date()): boolean {
  const date = new Date(isoDate);
  return (
    Number.isFinite(date.getTime()) &&
    dateInVET(date) === dateInVETOffset(1, now)
  );
}

/** Ventana operativa del partido: hoy, mañana o fuera del radar pre-match. */
export function matchDayVET(
  isoDate: string,
  now: Date = new Date(),
): "today" | "tomorrow" | null {
  if (isTodayVET(isoDate, now)) return "today";
  if (isTomorrowVET(isoDate, now)) return "tomorrow";
  return null;
}

/** Comprueba un partido contra una ventana concreta (hoy, mañana o ambas). */
export function isMatchDayVET(
  isoDate: string,
  day: "today" | "tomorrow" | "all",
  now: Date = new Date(),
): boolean {
  if (day === "all") return matchDayVET(isoDate, now) !== null;
  return matchDayVET(isoDate, now) === day;
}

/** Construye un instante ISO con offset VET a partir de fecha y hora local. */
export function fromVETDateTime(date: string, time: string): string {
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  if (!isValidIsoDate(date) || !isValidHour(normalizedTime)) return "";
  return `${date}T${normalizedTime}:00${VET_OFFSET}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isValidHour(hour: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(hour);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/** Valida una fecha civil YYYY-MM-DD (rechaza, p. ej., 2026-02-31). */
export function isValidIsoDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

function toIsoZ(value: string): string | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  // ISO 8601 canónico sin milisegundos: YYYY-MM-DDTHH:mm:ssZ.
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeOffset(offset: string): string {
  if (/^Z$/i.test(offset)) return "Z";
  const compact = offset.replace(":", "");
  const sign = compact[0] === "-" ? "-" : "+";
  const hours = compact.slice(1, 3);
  const minutes = compact.slice(3, 5) || "00";
  return `${sign}${hours}:${minutes}`;
}

/**
 * Infiere el año de una fecha sin año (DD/MM) eligiendo el candidato más
 * cercano a hoy en VET. Evita el error clásico de asignar el año siguiente
 * en noviembre/diciembre. Solo acepta fechas dentro de la ventana radar.
 */
function inferYear(day: number, month: number, now: Date): number | null {
  const hoy = dateInVET(now);
  if (!hoy) return null;
  const anioHoy = Number(hoy.slice(0, 4));
  const hoyUtc = Date.parse(`${hoy}T12:00:00Z`);
  let mejor: number | null = null;
  let menorDiferencia = Infinity;

  for (const anio of [anioHoy - 1, anioHoy, anioHoy + 1]) {
    const candidato = `${anio}-${pad2(month)}-${pad2(day)}`;
    if (!isValidIsoDate(candidato)) continue;
    const diferencia =
      Math.abs(Date.parse(`${candidato}T12:00:00Z`) - hoyUtc) / 86_400_000;
    if (diferencia < menorDiferencia) {
      menorDiferencia = diferencia;
      mejor = anio;
    }
  }
  return menorDiferencia <= 1 ? mejor : null;
}

/**
 * Normaliza cualquier formato soportado a ISO 8601 UTC canónico, o `null`
 * cuando la fecha es inválida/ambigua. La app es es-VE: DD/MM es canónico;
 * MM/DD se rechaza en vez de invertirse silenciosamente.
 */
export function normalizeCommenceTime(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const texto = String(value ?? "").trim();
  if (!texto) return null;

  // ISO completo (o "YYYY-MM-DD HH:mm"), con o sin offset.
  const completo =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      texto,
    );
  if (completo) {
    const [, date, hour, seconds = "00", offset] = completo;
    if (!isValidIsoDate(date) || !isValidHour(hour)) return null;
    const zona = offset ? normalizeOffset(offset) : VET_OFFSET;
    return toIsoZ(`${date}T${hour}:${seconds}${zona}`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return isValidIsoDate(texto)
      ? toIsoZ(`${texto}T12:00:00${VET_OFFSET}`)
      : null;
  }

  // DD/MM(/YYYY), DD-MM-YYYY y DD.MM.YYYY. Sin año se infiere con inferYear.
  const diaMes = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/.exec(
    texto,
  );
  if (diaMes) {
    const dia = Number(diaMes[1]);
    const mes = Number(diaMes[2]);
    let anio: number | null;
    if (diaMes[3]) {
      anio =
        diaMes[3].length === 2
          ? 2000 + Number(diaMes[3])
          : Number(diaMes[3]);
    } else {
      anio = inferYear(dia, mes, now);
    }
    if (anio == null || anio < 2000 || anio > 2100) return null;
    const fecha = `${anio}-${pad2(mes)}-${pad2(dia)}`;
    return isValidIsoDate(fecha) ? toIsoZ(`${fecha}T12:00:00${VET_OFFSET}`) : null;
  }

  return null;
}

/** True solo si el instante pertenece a hoy o mañana en hora de Venezuela. */
export function isWithinMatchWindow(value: unknown, now: Date = new Date()): boolean {
  const iso = normalizeCommenceTime(value, now);
  return iso !== null && matchDayVET(iso, now) !== null;
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

/**
 * Ventana estimada de un partido para actualizar el estado sin esperar a la API.
 * Si ya pasaron ~3 horas desde el inicio se considera finalizado; entre el
 * inicio y esa ventana, en vivo. Un partido programado pasado de hora nunca
 * permanece como "Programado" en la vista pre-match.
 */
export function resolveMatchStatus(
  match: { commenceTime: string; status: "scheduled" | "live" | "finished" },
  now: Date = new Date(),
  liveWindowMinutes = 180,
): "scheduled" | "live" | "finished" {
  if (match.status === "finished") return "finished";
  if (match.status === "live") return "live";
  const start = new Date(match.commenceTime).getTime();
  if (!Number.isFinite(start)) return match.status;
  if (start > now.getTime()) return "scheduled";
  if (now.getTime() - start <= liveWindowMinutes * 60_000) return "live";
  return "finished";
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

export function formatCredits(value: number | null): string {
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
