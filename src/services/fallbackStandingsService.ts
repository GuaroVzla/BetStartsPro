/**
 * Fallback resiliente multi-fuente de Clasificaciones (Standings) sin API Keys.
 * 
 * Orígenes integrados:
 * 1. OpenLigaDB (Alemania / Bundesliga) - JSON API directo
 * 2. MLB Stats API Oficial (MLB) - statsapi.mlb.com
 * 3. NHL Web API Oficial (NHL) - api-web.nhle.com
 * 
 * Complementa a ESPN cuando ESPN no responde o para ligas específicas de cobertura primaria.
 */
import { namesLikelyMatch, normalizeName } from "@/lib/utils";
import type { FormResult, SportsMatch, StandingRow } from "@/types/sports";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const standingsCache = new Map<string, { at: number; rows: StandingRow[] }>();

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
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

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Obtiene tabla de Bundesliga desde OpenLigaDB */
async function fetchOpenLigaDbStandings(seasonYear = "2025"): Promise<StandingRow[]> {
  const cacheKey = `openligadb|bl1|${seasonYear}`;
  const cached = standingsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const data = asArray(await fetchJson(`https://api.openligadb.de/getbltable/bl1/${seasonYear}`));
  if (data.length === 0) return cached?.rows ?? [];

  const rows: StandingRow[] = data.map((item, idx) => {
    const obj = asObject(item);
    const teamName = asString(obj.teamName) || "Equipo";
    const teamShortName = asString(obj.shortName) || teamName;
    const played = asNumber(obj.matches) ?? 0;
    const wins = asNumber(obj.won) ?? 0;
    const draws = asNumber(obj.draw) ?? 0;
    const losses = asNumber(obj.lost) ?? 0;
    const scored = asNumber(obj.goals) ?? 0;
    const conceded = asNumber(obj.opponentGoals) ?? 0;
    const points = asNumber(obj.points) ?? (wins * 3 + draws);
    const difference = asNumber(obj.goalDiff) ?? (scored - conceded);

    return {
      teamId: `olb-${asString(obj.teamId) || normalizeName(teamName)}`,
      teamName,
      teamShortName,
      position: idx + 1,
      played,
      wins,
      draws,
      losses,
      points,
      winPercentage: played > 0 ? (wins + draws * 0.5) / played : 0,
      scored,
      conceded,
      difference,
      form: [],
      note: idx < 4 ? "Champions League" : idx === 4 ? "Europa League" : idx >= 16 ? "Descenso" : undefined,
    };
  });

  standingsCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

/** Obtiene tabla de MLB desde MLB Stats API Oficial */
async function fetchMlbStandings(): Promise<StandingRow[]> {
  const cacheKey = "mlb|standings|v1";
  const cached = standingsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const data = asObject(await fetchJson("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104"));
  const records = asArray(data.records);
  if (records.length === 0) return cached?.rows ?? [];

  const rows: StandingRow[] = [];
  for (const group of records) {
    const groupObj = asObject(group);
    const division = asObject(groupObj.division);
    const divisionName = asString(division.name) || "MLB";
    const teamRecords = asArray(groupObj.teamRecords);

    for (const tr of teamRecords) {
      const obj = asObject(tr);
      const team = asObject(obj.team);
      const teamName = asString(team.name);
      if (!teamName) continue;

      const played = asNumber(obj.gamesPlayed) ?? 0;
      const wins = asNumber(obj.wins) ?? 0;
      const losses = asNumber(obj.losses) ?? 0;
      const winPctStr = asString(obj.winningPercentage);
      const winPercentage = winPctStr ? parseFloat(winPctStr) : (played > 0 ? wins / played : 0);
      const scored = asNumber(obj.runsScored) ?? 0;
      const conceded = asNumber(obj.runsAllowed) ?? 0;
      const diff = asNumber(obj.runDifferential) ?? (scored - conceded);
      const rank = asNumber(obj.divisionRank) ?? 0;

      rows.push({
        teamId: `mlb-${asString(team.id) || normalizeName(teamName)}`,
        teamName,
        teamShortName: teamName.split(" ").pop() ?? teamName,
        position: rank,
        played,
        wins,
        draws: 0,
        losses,
        points: wins,
        winPercentage,
        scored,
        conceded,
        difference: diff,
        form: [],
        group: divisionName,
        note: obj.clinched ? "Clinched Postseason" : undefined,
      });
    }
  }

  // Ordenar global por porcentaje de victorias
  rows.sort((a, b) => b.winPercentage - a.winPercentage);
  rows.forEach((r, idx) => {
    if (r.position === 0) r.position = idx + 1;
  });

  standingsCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

/** Obtiene tabla de NHL desde NHL Web API Oficial */
async function fetchNhlStandings(): Promise<StandingRow[]> {
  const cacheKey = "nhl|standings|v1";
  const cached = standingsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const data = asObject(await fetchJson("https://api-web.nhle.com/v1/standings/now"));
  const standings = asArray(data.standings);
  if (standings.length === 0) return cached?.rows ?? [];

  const rows: StandingRow[] = standings.map((item, idx) => {
    const obj = asObject(item);
    const teamNameObj = asObject(obj.teamName);
    const teamName = asString(teamNameObj.default) || "NHL Team";
    const teamCommonObj = asObject(obj.teamCommonName);
    const teamShortName = asString(teamCommonObj.default) || teamName;
    const played = asNumber(obj.gamesPlayed) ?? 0;
    const wins = asNumber(obj.wins) ?? 0;
    const losses = asNumber(obj.losses) ?? 0;
    const otLosses = asNumber(obj.otLosses) ?? 0;
    const points = asNumber(obj.points) ?? (wins * 2 + otLosses);
    const scored = asNumber(obj.goalFor) ?? 0;
    const conceded = asNumber(obj.goalAgainst) ?? 0;
    const diff = asNumber(obj.goalDifferential) ?? (scored - conceded);
    const pointPctg = asNumber(obj.pointPctg) ?? (played > 0 ? points / (played * 2) : 0);
    const confName = asString(obj.conferenceName);

    return {
      teamId: `nhl-${asString(asObject(obj.teamAbbrev).default) || normalizeName(teamName)}`,
      teamName,
      teamShortName,
      position: asNumber(obj.leagueSequence) ?? (idx + 1),
      played,
      wins,
      draws: otLosses,
      losses,
      points,
      winPercentage: pointPctg,
      scored,
      conceded,
      difference: diff,
      form: [],
      group: confName || undefined,
      note: idx < 16 ? "Playoffs Zone" : undefined,
    };
  });

  standingsCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

function findStanding(rows: StandingRow[], name: string, teamId: string): StandingRow | null {
  const byId = rows.find((r) => r.teamId === teamId);
  if (byId) return byId;

  const norm = normalizeName(name);
  const byExact = rows.find((r) => normalizeName(r.teamName) === norm || normalizeName(r.teamShortName) === norm);
  if (byExact) return byExact;

  return rows.find((r) => namesLikelyMatch(r.teamName, name) || namesLikelyMatch(r.teamShortName, name)) ?? null;
}

function dedupeTable(rows: StandingRow[]): StandingRow[] {
  const seen = new Set<string>();
  const out: StandingRow[] = [];
  for (const row of rows) {
    const key = normalizeName(row.teamName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function needsStandings(match: SportsMatch): boolean {
  return (
    match.intel.standings.table.filter((r) => r.played > 0).length === 0 ||
    match.intel.standings.home.played === 0 ||
    match.intel.standings.away.played === 0
  );
}

/** Enriquece partidos que carezcan de standings con fuentes gratuitas especializadas de fallback */
export async function enrichWithFallbackStandings(matches: SportsMatch[]): Promise<{ matches: SportsMatch[]; applied: number }> {
  const candidates = matches.filter(needsStandings);
  if (candidates.length === 0) return { matches, applied: 0 };

  const hasBundesliga = candidates.some((m) => m.league.id === "bundesliga" || /bundesliga/i.test(m.league.name));
  const hasMlb = candidates.some((m) => m.league.id === "mlb" || m.sport === "baseball");
  const hasNhl = candidates.some((m) => m.league.id === "nhl" || m.sport === "hockey");

  const [blRows, mlbRows, nhlRows] = await Promise.all([
    hasBundesliga ? fetchOpenLigaDbStandings() : Promise.resolve([]),
    hasMlb ? fetchMlbStandings() : Promise.resolve([]),
    hasNhl ? fetchNhlStandings() : Promise.resolve([]),
  ]);

  let applied = 0;
  const enriched = matches.map((match) => {
    if (!needsStandings(match)) return match;

    let rows: StandingRow[] = [];
    let sourceName = "";

    if ((match.league.id === "bundesliga" || /bundesliga/i.test(match.league.name)) && blRows.length > 0) {
      rows = blRows;
      sourceName = "OpenLigaDB";
    } else if ((match.league.id === "mlb" || match.sport === "baseball") && mlbRows.length > 0) {
      rows = mlbRows;
      sourceName = "MLB Stats API";
    } else if ((match.league.id === "nhl" || match.sport === "hockey") && nhlRows.length > 0) {
      rows = nhlRows;
      sourceName = "NHL API Oficial";
    }

    if (rows.length === 0) return match;

    const homeRow = findStanding(rows, match.home.name, match.home.id);
    const awayRow = findStanding(rows, match.away.name, match.away.id);
    const table = dedupeTable([...match.intel.standings.table.filter((r) => r.played > 0), ...rows]);

    if (table.length === 0) return match;

    applied += 1;
    return {
      ...match,
      intel: {
        ...match.intel,
        standings: {
          home: homeRow && match.intel.standings.home.played === 0 ? homeRow : match.intel.standings.home,
          away: awayRow && match.intel.standings.away.played === 0 ? awayRow : match.intel.standings.away,
          table,
        },
        note: [match.intel.note, `Clasificación complementada vía ${sourceName}.`].filter(Boolean).join(" · "),
      },
    };
  });

  return { matches: enriched, applied };
}
