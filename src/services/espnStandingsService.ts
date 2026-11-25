/**
 * Enriquecimiento de clasificaciones desde ESPN (endpoint público, sin key).
 * Usa `site.web.api.espn.com/apis/v2/sports/{espnPath}/standings`.
 * Solo rellena partidos cuya clasificación está vacía o es placeholder.
 */
import { namesLikelyMatch, normalizeName } from "@/lib/utils";
import type { FormResult, SportsMatch, StandingRow } from "@/types/sports";

type Json = Record<string, unknown>;

const BASE = "https://site.web.api.espn.com/apis/v2/sports";
const CACHE_TTL_MS = 60 * 60 * 1000;
const BUDGET_WINDOW_MS = 60 * 1000;
const MAX_STANDINGS_CALLS = 10;

const standingsCache = new Map<string, { at: number; rows: StandingRow[] }>();
let budgetStartedAt = 0;
let standingsCalls = 0;

function resetBudget(now: number): void {
  if (now - budgetStartedAt >= BUDGET_WINDOW_MS) {
    budgetStartedAt = now;
    standingsCalls = 0;
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

async function fetchJson(url: string): Promise<Json | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return asObject(await response.json());
  } catch {
    return null;
  }
}

function statValue(stats: unknown[], names: string[]): number | null {
  for (const raw of stats) {
    const stat = asObject(raw);
    const name = asString(stat.name).toLowerCase();
    const abbr = asString(stat.abbreviation).toLowerCase();
    const type = asString(stat.type).toLowerCase();
    if (names.some((n) => n === name || n === abbr || n === type)) {
      const value = asNumber(stat.value);
      if (value !== null) return value;
    }
  }
  return null;
}

function parseForm(raw: unknown): FormResult[] {
  return String(raw ?? "")
    .split("")
    .map((ch) => ch.trim().toUpperCase())
    .filter((ch): ch is FormResult => ch === "W" || ch === "D" || ch === "L")
    .slice(-5);
}

function mapEntry(raw: unknown, group?: string): StandingRow | null {
  const entry = asObject(raw);
  const team = asObject(entry.team);
  const teamName = asString(team.displayName) || asString(team.name) || asString(team.shortDisplayName);
  if (!teamName) return null;

  const stats = asArray(entry.stats);
  const played = statValue(stats, ["gamesplayed", "gp"]) ?? 0;
  const wins = statValue(stats, ["wins", "w"]) ?? 0;
  const losses = statValue(stats, ["losses", "l"]) ?? 0;
  const draws = statValue(stats, ["ties", "d", "draws"]) ?? 0;
  const points = statValue(stats, ["points", "p", "pts"]) ?? wins * 3 + draws;
  const scored = statValue(stats, ["pointsfor", "f", "gf", "goalsfor"]) ?? 0;
  const conceded = statValue(stats, ["pointsagainst", "a", "ga", "goalsagainst"]) ?? 0;
  const diff = statValue(stats, ["pointdifferential", "gd", "differential"]) ?? scored - conceded;
  const winPct = statValue(stats, ["winpercent", "pct"]);
  const noteObj = asObject(entry.note);
  const note = asString(noteObj.description) || asString(noteObj.note) || undefined;

  return {
    teamId: `espn-${asString(team.id) || normalizeName(teamName)}`,
    teamName,
    teamShortName: asString(team.shortDisplayName) || asString(team.abbreviation) || teamName,
    position: 0,
    played,
    wins,
    draws,
    losses,
    points,
    winPercentage: winPct !== null ? (winPct > 1 ? winPct / 100 : winPct) : played > 0 ? wins / played : 0,
    scored,
    conceded,
    difference: diff,
    form: parseForm(team.form ?? entry.form),
    group: group || undefined,
    note,
  };
}

function collectEntries(payload: Json): Array<{ entry: unknown; group?: string }> {
  const out: Array<{ entry: unknown; group?: string }> = [];

  const pushEntries = (container: unknown, group?: string) => {
    const obj = asObject(container);
    const standings = asObject(obj.standings);
    const entries = asArray(standings.entries).length > 0 ? asArray(standings.entries) : asArray(obj.entries);
    for (const entry of entries) out.push({ entry, group });
  };

  const children = asArray(payload.children);
  if (children.length > 0) {
    for (const child of children) {
      const childObj = asObject(child);
      const group = asString(childObj.name) || asString(childObj.abbreviation) || undefined;
      // child may itself have children (divisions/conferences)
      const subChildren = asArray(childObj.children);
      if (subChildren.length > 0) {
        for (const sub of subChildren) {
          const subObj = asObject(sub);
          const subGroup = asString(subObj.name) || group;
          pushEntries(sub, subGroup);
        }
      } else {
        pushEntries(child, group);
      }
    }
  }

  if (out.length === 0) {
    pushEntries(payload);
  }

  return out;
}

async function fetchStandings(espnPath: string, season: string): Promise<StandingRow[]> {
  const cacheKey = `${espnPath}|${season}`;
  const cached = standingsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  resetBudget(Date.now());
  if (standingsCalls >= MAX_STANDINGS_CALLS) return cached?.rows ?? [];
  standingsCalls += 1;

  const url = `${BASE}/${espnPath}/standings?season=${encodeURIComponent(season)}`;
  const payload = await fetchJson(url);
  if (!payload) {
    standingsCache.set(cacheKey, { at: Date.now(), rows: cached?.rows ?? [] });
    return cached?.rows ?? [];
  }

  const collected = collectEntries(payload);
  const rows: StandingRow[] = [];
  let pos = 1;
  for (const { entry, group } of collected) {
    const row = mapEntry(entry, group);
    if (!row) continue;
    row.position = pos++;
    rows.push(row);
  }

  standingsCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

function dedupeTable(rows: StandingRow[]): StandingRow[] {
  const byTeam = new Map<string, StandingRow>();
  for (const row of rows) {
    const key = normalizeName(row.teamName);
    const existing = byTeam.get(key);
    if (!existing || row.played > existing.played || (row.position > 0 && existing.position === 0)) {
      byTeam.set(key, row);
    }
  }
  return Array.from(byTeam.values()).sort(
    (a, b) => (a.position || 999) - (b.position || 999) || a.teamName.localeCompare(b.teamName),
  );
}

function findStanding(rows: StandingRow[], teamName: string, teamId: string): StandingRow | null {
  const direct = rows.find(
    (row) => row.teamId === teamId || row.teamId === `espn-${teamId}`,
  );
  if (direct) return direct;
  const target = normalizeName(teamName);
  return (
    rows.find((row) => normalizeName(row.teamName) === target || namesLikelyMatch(row.teamName, teamName)) ??
    null
  );
}

function needsStandings(match: SportsMatch): boolean {
  const table = match.intel?.standings?.table ?? [];
  const realRows = table.filter((r) => r.played > 0 || r.position > 0);
  return realRows.length < 3; // placeholder is usually 2 rows
}

export interface EspnStandingsResult {
  matches: SportsMatch[];
  applied: number;
}

/** Completa clasificaciones faltantes usando ESPN público. */
export async function enrichWithEspnStandings(
  matches: SportsMatch[],
): Promise<EspnStandingsResult> {
  const targets = matches.filter((m) => m.league.espnPath && needsStandings(m));
  if (targets.length === 0) return { matches, applied: 0 };

  // Group by espnPath+season to avoid duplicate fetches
  const groups = new Map<string, { espnPath: string; season: string; matches: SportsMatch[] }>();
  for (const match of targets) {
    const espnPath = match.league.espnPath!;
    const season = match.league.season || String(new Date().getUTCFullYear());
    const key = `${espnPath}|${season}`;
    const group = groups.get(key) ?? { espnPath, season, matches: [] };
    group.matches.push(match);
    groups.set(key, group);
  }

  const standingsByKey = new Map<string, StandingRow[]>();
  await Promise.all(
    Array.from(groups.entries()).map(async ([key, group]) => {
      standingsByKey.set(key, await fetchStandings(group.espnPath, group.season));
    }),
  );

  let applied = 0;
  const enriched = matches.map((match) => {
    if (!match.league.espnPath || !needsStandings(match)) return match;
    const key = `${match.league.espnPath}|${match.league.season || String(new Date().getUTCFullYear())}`;
    const rows = standingsByKey.get(key) ?? [];
    if (rows.length === 0) return match;

    const homeRow = findStanding(rows, match.home.name, match.home.id);
    const awayRow = findStanding(rows, match.away.name, match.away.id);

    const table = dedupeTable([...match.intel.standings.table.filter((r) => r.played > 0), ...rows]);
    if (table.length === 0) return match;

    const standings = {
      home:
        homeRow && match.intel.standings.home.played === 0
          ? homeRow
          : match.intel.standings.home,
      away:
        awayRow && match.intel.standings.away.played === 0
          ? awayRow
          : match.intel.standings.away,
      table,
    };

    applied += 1;
    return {
      ...match,
      sourceTags: Array.from(new Set([...(match.sourceTags ?? []), "espn" as const])),
      intel: {
        ...match.intel,
        standings,
        note: [match.intel.note, "Clasificación completada desde ESPN (web pública)."]
          .filter(Boolean)
          .join(" · "),
      },
    };
  });

  return { matches: enriched, applied };
}
