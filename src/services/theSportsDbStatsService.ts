/**
 * Enriquecimiento gratuito con TheSportsDB v1 (key pública `123` o THESPORTSDB_KEY).
 * Solo usa endpoints del tier gratuito:
 * - `lookuptable.php`: posiciones de liga (tier gratis: 5 filas, ligas de fútbol destacadas).
 * - `eventslast.php`: último partido de un equipo (tier gratis: 1 evento, solo de local).
 * El tier gratuito permite 30 requests/minuto, así que se limitan las llamadas
 * por actualización y se cachean las respuestas en memoria durante 1 hora.
 */
import { namesLikelyMatch, normalizeName } from "@/lib/utils";
import type {
  FormResult,
  SportsMatch,
  StandingRow,
  TeamAdvancedStats,
} from "@/types/sports";

type Json = Record<string, unknown>;

const BASE = "https://www.thesportsdb.com/api/v1/json";
const CACHE_TTL_MS = 60 * 60 * 1000;
const BUDGET_WINDOW_MS = 60 * 1000;
const MAX_STANDINGS_CALLS = 6;
const MAX_FORM_CALLS = 8;

/** IDs de TheSportsDB para las ligas configuradas en el proyecto. */
const LEAGUE_IDS: Record<string, string> = {
  epl: "4328",
  laliga: "4335",
  "serie-a": "4332",
  bundesliga: "4331",
  mlb: "4424",
  nhl: "4399",
};

const standingsCache = new Map<string, { at: number; rows: StandingRow[] }>();
const formCache = new Map<string, { at: number; form: FormResult[] }>();
let budgetStartedAt = 0;
let standingsCalls = 0;
let formCalls = 0;

function apiKey(): string {
  return process.env.THESPORTSDB_KEY ?? "";
}

function resetBudget(now: number): void {
  if (now - budgetStartedAt >= BUDGET_WINDOW_MS) {
    budgetStartedAt = now;
    standingsCalls = 0;
    formCalls = 0;
  }
}

function asObject(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(path: string): Promise<Json | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const response = await fetch(`${BASE}/${encodeURIComponent(key)}/${path}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return asObject(await response.json());
  } catch {
    return null;
  }
}

function parseForm(value: unknown): FormResult[] {
  return String(value ?? "")
    .split(/[,;|\s]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token): token is FormResult =>
      token === "W" || token === "D" || token === "L",
    )
    .slice(0, 5);
}

function mapStanding(raw: unknown): StandingRow | null {
  const row = asObject(raw);
  const name = asString(row.strTeam);
  const played = asNumber(row.intPlayed) ?? 0;
  if (!name || played <= 0) return null;

  const wins = asNumber(row.intWin) ?? 0;
  const draws = asNumber(row.intDraw) ?? 0;
  const losses = asNumber(row.intLoss) ?? 0;
  const scored = asNumber(row.intGF) ?? 0;
  const conceded = asNumber(row.intGA) ?? 0;

  return {
    teamId: `tsdb-${asString(row.idTeam)}`,
    teamName: name,
    teamShortName: asString(row.strTeamShort) || name,
    position: asNumber(row.intRank) ?? 0,
    played,
    wins,
    draws,
    losses,
    points: asNumber(row.intPoints) ?? wins * 3 + draws,
    winPercentage: wins / played,
    scored,
    conceded,
    difference: scored - conceded,
    form: parseForm(row.strForm),
    group: asString(row.strGroup) || undefined,
    note: "TheSportsDB (tier gratuito: tabla parcial)",
  };
}

async function fetchStandings(leagueId: string): Promise<StandingRow[]> {
  const cached = standingsCache.get(leagueId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  resetBudget(Date.now());
  if (standingsCalls >= MAX_STANDINGS_CALLS) return cached?.rows ?? [];
  standingsCalls += 1;

  const payload = await fetchJson(
    `lookuptable.php?l=${encodeURIComponent(leagueId)}`,
  );
  const rows = asArray(payload?.table)
    .map(mapStanding)
    .filter((row): row is StandingRow => row !== null);
  standingsCache.set(leagueId, { at: Date.now(), rows });
  return rows;
}

async function fetchTeamForm(teamId: string): Promise<FormResult[]> {
  if (!/^\d+$/.test(teamId)) return [];

  const cached = formCache.get(teamId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.form;

  resetBudget(Date.now());
  if (formCalls >= MAX_FORM_CALLS) return cached?.form ?? [];
  formCalls += 1;

  const payload = await fetchJson(
    `eventslast.php?id=${encodeURIComponent(teamId)}`,
  );
  const form: FormResult[] = [];
  for (const raw of asArray(payload?.results)) {
    const event = asObject(raw);
    const homeId = asString(event.idHomeTeam);
    const awayId = asString(event.idAwayTeam);
    const homeScore = asNumber(event.intHomeScore);
    const awayScore = asNumber(event.intAwayScore);
    if (homeScore === null || awayScore === null) continue;

    const isHome = homeId === teamId;
    if (!isHome && awayId !== teamId) continue;
    const won = isHome ? homeScore > awayScore : awayScore > homeScore;
    form.push(homeScore === awayScore ? "D" : won ? "W" : "L");
  }
  formCache.set(teamId, { at: Date.now(), form });
  return form;
}

function tsdbLeagueId(internalId: string): string | null {
  if (internalId.startsWith("tsdb-")) {
    const tail = internalId.slice("tsdb-".length);
    return /^\d+$/.test(tail) ? tail : null;
  }
  return LEAGUE_IDS[internalId] ?? null;
}

function findStanding(
  rows: StandingRow[],
  teamId: string,
  teamName: string,
): StandingRow | null {
  const direct = rows.find(
    (row) => row.teamId === teamId || row.teamId === `tsdb-${teamId}`,
  );
  if (direct) return direct;
  const target = normalizeName(teamName);
  return (
    rows.find(
      (row) =>
        normalizeName(row.teamName) === target ||
        namesLikelyMatch(row.teamName, teamName),
    ) ?? null
  );
}

function dedupeTable(rows: StandingRow[]): StandingRow[] {
  const byTeam = new Map<string, StandingRow>();
  for (const row of rows) {
    const key = normalizeName(row.teamName);
    const existing = byTeam.get(key);
    if (!existing || row.played > existing.played) byTeam.set(key, row);
  }
  return Array.from(byTeam.values()).sort(
    (a, b) =>
      a.position - b.position || a.teamName.localeCompare(b.teamName),
  );
}

function emptySplit() {
  return { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 };
}

function buildStats(row: StandingRow, form: FormResult[]): TeamAdvancedStats {
  const usedForm = form.length > 0 ? form : row.form;
  const last = usedForm[usedForm.length - 1];
  return {
    teamId: row.teamId,
    form: usedForm,
    avgScored: row.played > 0 ? row.scored / row.played : 0,
    avgConceded: row.played > 0 ? row.conceded / row.played : 0,
    home: emptySplit(),
    away: emptySplit(),
    streak: last ? `${last === "W" ? "V" : last === "D" ? "E" : "D"} · forma TheSportsDB` : "Sin datos",
    provenance: "table-derived",
    asOf: new Date().toISOString(),
  };
}

export interface TheSportsDbStatsResult {
  matches: SportsMatch[];
  applied: number;
}

/** Completa posiciones y forma donde la fuente original no tenía datos reales. */
export async function enrichWithTheSportsDbStats(
  matches: SportsMatch[],
): Promise<TheSportsDbStatsResult> {
  if (!apiKey() || matches.length === 0) return { matches, applied: 0 };

  const leagueIds = new Set<string>();
  for (const match of matches) {
    const id = tsdbLeagueId(match.league.id);
    if (id) leagueIds.add(id);
  }

  const standingsByLeague = new Map<string, StandingRow[]>();
  await Promise.all(
    Array.from(leagueIds).map(async (id) => {
      standingsByLeague.set(id, await fetchStandings(id));
    }),
  );

  let applied = 0;
  const enriched = await Promise.all(
    matches.map(async (match) => {
      const id = tsdbLeagueId(match.league.id);
      const rows = id ? standingsByLeague.get(id) ?? [] : [];
      if (rows.length === 0) return match;

      const homeRow = findStanding(rows, match.home.id, match.home.name);
      const awayRow = findStanding(rows, match.away.id, match.away.name);
      if (!homeRow && !awayRow) return match;

      const homeForm = homeRow
        ? await fetchTeamForm(homeRow.teamId.replace(/^tsdb-/, ""))
        : [];
      const awayForm = awayRow
        ? await fetchTeamForm(awayRow.teamId.replace(/^tsdb-/, ""))
        : [];

      const standings = {
        home:
          homeRow && match.intel.standings.home.played === 0
            ? homeRow
            : match.intel.standings.home,
        away:
          awayRow && match.intel.standings.away.played === 0
            ? awayRow
            : match.intel.standings.away,
        table: dedupeTable([...match.intel.standings.table, ...rows]),
      };
      const stats = {
        home:
          homeRow && match.intel.stats.home.provenance === "none"
            ? buildStats(homeRow, homeForm)
            : match.intel.stats.home,
        away:
          awayRow && match.intel.stats.away.provenance === "none"
            ? buildStats(awayRow, awayForm)
            : match.intel.stats.away,
      };

      applied += 1;
      return {
        ...match,
        sourceTags: Array.from(
          new Set([...(match.sourceTags ?? []), "sportsdb" as const]),
        ),
        intel: {
          ...match.intel,
          standings,
          stats,
          note: [
            match.intel.note,
            "TheSportsDB: posiciones/forma del tier gratuito (tabla parcial).",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      };
    }),
  );

  return { matches: enriched, applied };
}
