import { dateInVET, isWithinMatchWindow, normalizeCommenceTime } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { normalizeName } from "@/lib/utils";
import type { StoredCuratedMatch } from "@/services/curatedIngestStore";
import type {
  BookmakerQuote,
  FormResult,
  LeagueInfo,
  SportsMatch,
  StandingRow,
  TeamAdvancedStats,
  TeamRef,
} from "@/types/sports";

const SPORT_MAP: Record<string, SportsMatch["sport"]> = {
  soccer: "soccer",
  football: "soccer",
  futbol: "soccer",
  basketball: "basketball",
  baloncesto: "basketball",
  baseball: "baseball",
  beisbol: "baseball",
  hockey: "hockey",
};

function teamName(v: StoredCuratedMatch["home"]): string {
  if (!v) return "Equipo";
  return typeof v === "string" ? v : v.name ?? "Equipo";
}

function teamId(v: StoredCuratedMatch["home"], fallback: string): string {
  if (v && typeof v === "object" && v.id) return String(v.id);
  return `curated-${normalizeName(fallback) || "equipo"}`;
}

function paletteFor(name: string) {
  const colors = [
    { color: "#2563eb", secondaryColor: "#bfdbfe" },
    { color: "#dc2626", secondaryColor: "#fecaca" },
    { color: "#059669", secondaryColor: "#a7f3d0" },
    { color: "#d97706", secondaryColor: "#fde68a" },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return colors[hash % colors.length];
}

function buildTeam(v: StoredCuratedMatch["home"], fallback: string): TeamRef {
  const name = teamName(v) || fallback;
  return { id: teamId(v, name), name, shortName: name.length > 18 ? `${name.slice(0, 17)}…` : name, ...paletteFor(name) };
}

function buildStanding(name: string, id: string): StandingRow {
  return { teamId: id, teamName: name, teamShortName: name, position: 0, played: 0, wins: 0, draws: 0, losses: 0, points: 0, winPercentage: 0, scored: 0, conceded: 0, difference: 0, form: [] };
}

function buildStats(teamId: string): TeamAdvancedStats {
  return { teamId, form: [] as FormResult[], avgScored: 0, avgConceded: 0, home: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }, away: { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }, streak: "Sin datos", provenance: "none" };
}

function buildBookmaker(q: NonNullable<StoredCuratedMatch["odds_1x2"]>[number], idx: number, matchKey: string): BookmakerQuote | null {
  const home = q.home;
  const draw = q.draw;
  const away = q.away;
  if (!(Number(home) > 1) && !(Number(draw) > 1) && !(Number(away) > 1)) return null;
  const h = Number(home) > 1 ? Number(home) : 0;
  const d = Number(draw) > 1 ? Number(draw) : 0;
  const a = Number(away) > 1 ? Number(away) : 0;
  const raw = (h > 0 ? 1 / h : 0) + (d > 0 ? 1 / d : 0) + (a > 0 ? 1 / a : 0);
  const updatedAt = q.updated_at ?? q.as_of ?? new Date().toISOString();
  return {
    id: `curated-${normalizeName(q.canonical ?? q.bookmaker ?? "book")}-${idx}-${normalizeName(matchKey)}`,
    name: q.bookmaker || "Casa",
    canonicalName: q.canonical ?? q.bookmaker ?? "Casa",
    source: "the-odds-api",
    outcomes: { home: h, draw: d > 0 ? d : null, away: a },
    updatedAt,
    asOf: updatedAt,
    overround: Math.max(0, raw - 1),
  };
}

function statusOf(value: string | null | undefined): SportsMatch["status"] {
  const v = String(value ?? "").toLowerCase();
  if (["live", "inprogress", "in_progress", "1h", "2h", "ht"].includes(v)) return "live";
  if (["finished", "final", "ft", "aet", "pen"].includes(v)) return "finished";
  return "scheduled";
}

export function curatedRecordsToMatches(records: StoredCuratedMatch[], now: Date = new Date()): SportsMatch[] {
  const matches: SportsMatch[] = [];
  for (const record of records) {
    const homeName = teamName(record.home);
    const awayName = teamName(record.away);
    if (!homeName || !awayName) continue;
    const dateVet = record.date_local_vet ?? (record.commence_time_utc ? dateInVET(record.commence_time_utc) : null);
    const timeVet = /^\d{2}:\d{2}$/.test(record.time_local_vet ?? "") ? record.time_local_vet! : "12:00";
    const commenceTime = record.commence_time_utc && !Number.isNaN(new Date(record.commence_time_utc).getTime())
      ? new Date(record.commence_time_utc).toISOString()
      : (dateVet ? normalizeCommenceTime(`${dateVet} ${timeVet}`, now) : null);
    if (!commenceTime) continue;
    if (!isWithinMatchWindow(commenceTime, now)) continue;

    const sport = SPORT_MAP[String(record.sport ?? "soccer").toLowerCase()] ?? "soccer";
    const leagueName = record.league?.name ?? "Curated ETL";
    const league: LeagueInfo = {
      id: `curated-${normalizeName(String(record.league?.id ?? leagueName)) || "liga"}`,
      sport,
      oddsApiKey: "",
      apiSportsId: 0,
      name: leagueName,
      shortName: leagueName,
      country: "ETL",
      season: String(dateVet ?? dateInVET()).slice(0, 4),
    };
    const home = buildTeam(record.home, "Local");
    const away = buildTeam(record.away, "Visitante");
    const bookmakers = (record.odds_1x2 ?? []).map((q, i) => buildBookmaker(q, i, record.match_key)).filter((q): q is BookmakerQuote => Boolean(q));
    const odds = summarizeMarket(bookmakers);
    const homeStanding = buildStanding(home.name, home.id);
    const awayStanding = buildStanding(away.name, away.id);
    const match: SportsMatch = {
      id: `curated-${record.match_key}`,
      sport,
      league,
      commenceTime,
      status: statusOf(record.status),
      venue: record.venue ?? "Por definir",
      home,
      away,
      odds,
      intel: {
        standings: { home: homeStanding, away: awayStanding, table: [homeStanding, awayStanding] },
        stats: { home: buildStats(home.id), away: buildStats(away.id) },
        injuries: { home: [], away: [] },
        note: record.context_key ?? undefined,
        provenance: record.provenance === "api" ? "api" : record.provenance === "editorial" ? "editorial" : "none",
      },
    };
    match.favoriteSide = canonicalFavoriteFromSummary(match.odds);
    match.canonicalFavorite = match.favoriteSide;
    matches.push(match);
  }
  return matches;
}
