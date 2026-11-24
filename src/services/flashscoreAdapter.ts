import { dateInVET, isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { normalizeName } from "@/lib/utils";
import type { StoredRecord } from "@/services/flashscoreIngestStore";
import type {
  BookmakerQuote,
  FormResult,
  LeagueInfo,
  MatchIntel,
  SportKey,
  SportsMatch,
  StandingRow,
  TeamAdvancedStats,
  TeamRef,
} from "@/types/sports";

const SPORT_BY_LABEL: Record<string, SportKey> = {
  futbol: "soccer",
  baloncesto: "basketball",
  basketball: "basketball",
  beisbol: "baseball",
  baseball: "baseball",
  hockey: "hockey",
};

function normalizeSportLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const TEAM_COLORS = [
  { color: "#2563eb", secondaryColor: "#bfdbfe" },
  { color: "#dc2626", secondaryColor: "#fecaca" },
  { color: "#059669", secondaryColor: "#a7f3d0" },
  { color: "#d97706", secondaryColor: "#fde68a" },
  { color: "#7c3aed", secondaryColor: "#ddd6fe" },
  { color: "#0e7490", secondaryColor: "#a5f3fc" },
];

function paletteFor(name: string): { color: string; secondaryColor: string } {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return TEAM_COLORS[hash % TEAM_COLORS.length];
}

function buildTeam(name: string): TeamRef {
  const palette = paletteFor(name);
  return {
    id: `fs-${normalizeName(name) || "equipo"}`,
    name,
    shortName: name.length > 18 ? `${name.slice(0, 17)}…` : name,
    ...palette,
  };
}

function toForm(values: Array<"V" | "E" | "D"> | null): FormResult[] {
  if (!values) return [];
  const map: Record<string, FormResult> = { V: "W", E: "D", D: "L" };
  return values.map((value) => map[value]).filter(Boolean);
}

function buildStanding(
  name: string,
  teamId: string,
  position: number | null,
  form: FormResult[],
): StandingRow {
  const hasTable = position !== null && position > 0;
  return {
    teamId,
    teamName: name,
    teamShortName: name,
    position: position ?? 0,
    played: hasTable ? form.length : 0,
    wins: form.filter((result) => result === "W").length,
    draws: form.filter((result) => result === "D").length,
    losses: form.filter((result) => result === "L").length,
    points: 0,
    winPercentage: 0,
    scored: 0,
    conceded: 0,
    difference: 0,
    form,
  };
}

function buildStats(teamId: string, form: FormResult[]): TeamAdvancedStats {
  return {
    teamId,
    form,
    avgScored: 0,
    avgConceded: 0,
    home: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 },
    away: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 },
    streak: "Sin datos",
  };
}

function buildLeague(liga: string | null, sport: SportKey, fecha: string): LeagueInfo {
  const name = liga?.trim() || "Flashscore";
  const [country, rest] = name.split(":");
  const shortName = (rest ?? name).trim();
  return {
    id: `fs-${normalizeName(name) || "liga"}`,
    sport,
    oddsApiKey: "",
    apiSportsId: 0,
    name: shortName,
    shortName,
    country: rest ? country.trim() : "Flashscore",
    season: fecha.slice(0, 4),
  };
}

function favoriteFromOdds(record: StoredRecord): "home" | "away" | null {
  const home = record.cuotas_1x2.local_1;
  const away = record.cuotas_1x2.visitante_2;
  if (home !== null && away !== null) {
    if (home < away) return "home";
    if (away < home) return "away";
    return null;
  }
  if (home !== null && home > 1) return "home";
  if (away !== null && away > 1) return "away";
  return null;
}

function toSportsMatch(record: StoredRecord, now: Date = new Date()): SportsMatch | null {
  if (!record.equipo_local?.trim() || !record.equipo_visitante?.trim()) return null;

  const sport = SPORT_BY_LABEL[normalizeSportLabel(record.deporte)] ?? "soccer";
  // La fecha del encuentro viaja en el slug (YYYY-MM-DD_...) y en fecha_local;
  // fecha_extraccion es solo la fecha de la captura. Priorizar esas claves
  // permite sembrar hoy y mañana en un único payload sin fechar mal los partidos.
  const fecha =
    /^(\d{4}-\d{2}-\d{2})_/.exec(record.match_slug)?.[1] ??
    (/^\d{4}-\d{2}-\d{2}$/.test(record.fecha_extraccion)
      ? record.fecha_extraccion
      : dateInVET());
  const hora = /^\d{2}:\d{2}$/.test(record.hora_local ?? "") ? record.hora_local! : "12:00";
  // Fecha y hora se validan juntas; un día/mes ambiguo o un año lejano se descarta.
  const commenceTime = normalizeCommenceTime(`${fecha} ${hora}`, now);
  if (!commenceTime) return null;
  const status =
    record.estado === "En Vivo"
      ? "live"
      : record.estado === "Finalizado"
        ? "finished"
        : "scheduled";

  const home = buildTeam(record.equipo_local);
  const away = buildTeam(record.equipo_visitante);
  const stats = record.estadisticas_complementarias;
  const homeForm = toForm(stats.racha_local_ultimos_5);
  const awayForm = toForm(stats.racha_visitante_ultimos_5);

  const bookmakers: BookmakerQuote[] = [];
  const local = record.cuotas_1x2.local_1;
  const visitante = record.cuotas_1x2.visitante_2;
  if ((local !== null && local > 1) || (visitante !== null && visitante > 1)) {
    const outcomes = {
      home: local !== null && local > 1 ? local : 0,
      draw: record.cuotas_1x2.empate_x,
      away: visitante !== null && visitante > 1 ? visitante : 0,
    };
    const rawH = outcomes.home > 1 ? 1 / outcomes.home : 0;
    const rawD = outcomes.draw && outcomes.draw > 1 ? 1 / outcomes.draw : 0;
    const rawA = outcomes.away > 1 ? 1 / outcomes.away : 0;
    bookmakers.push({
      id: "flashscore-1x2",
      name: "Flashscore",
      source: "flashscore",
      canonicalName: "flashscore",
      outcomes,
      updatedAt: record.actualizado_en,
      asOf: record.actualizado_en,
      overround: Math.max(0, rawH + rawD + rawA - 1),
    });
  }

  const intel: MatchIntel = {
    standings: {
      home: buildStanding(home.name, home.id, stats.posicion_local, homeForm),
      away: buildStanding(away.name, away.id, stats.posicion_visitante, awayForm),
      table: [],
    },
    stats: {
      home: buildStats(home.id, homeForm),
      away: buildStats(away.id, awayForm),
    },
    injuries: { home: [], away: [] },
    note: stats.h2h_resumen ?? undefined,
  };

  const odds = summarizeMarket(bookmakers);
  return {
    id: `flashscore-${record.match_slug}`,
    sport,
    league: buildLeague(record.liga, sport, commenceTime),
    // ISO 8601 UTC canónico; la UI lo convierte a VET al formatear.
    commenceTime,
    status,
    venue: "Sin especificar",
    home,
    away,
    odds,
    intel,
    favoriteSide: canonicalFavoriteFromSummary(odds),
    canonicalFavorite: canonicalFavoriteFromSummary(odds),
  };
}

/**
 * Convierte los registros ingeridos por el agente a partidos del dashboard.
 * Se incluyen hoy y mañana (VET); el agregador descarta los ya iniciados.
 */
export function flashscoreRecordsToMatches(
  records: StoredRecord[],
  now: Date = new Date(),
): SportsMatch[] {
  return records
    .map((record) => toSportsMatch(record, now))
    .filter((match): match is SportsMatch => match !== null)
    .filter((match) => isWithinMatchWindow(match.commenceTime, now))
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
}
