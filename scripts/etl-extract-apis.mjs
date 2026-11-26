#!/usr/bin/env node
/**
 * Extracción API-only (The Odds API, API-Sports, SportMonks) hacia payloads normalizados.
 * No usa browser. Diseñado para cron/GitHub Actions.
 *
 * Uso:
 *   node scripts/etl-extract-apis.mjs --dry-run
 *   node scripts/etl-extract-apis.mjs --write --out data/curated/api-payload.json
 *   node scripts/etl-extract-apis.mjs --write --ingest --site https://betstats.pro
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dateInVETOffset, parseCliArgs, timestampVET } from "./ingest-utils.mjs";

const cli = parseCliArgs();
const out = cli.values.out ?? "data/curated/api-extract.json";
const reportOut = cli.values.report ?? `data/etl-reports/api-extract-${Date.now()}.json`;
const site = (cli.values.site ?? process.env.SITE_URL ?? "").replace(/\/$/, "");
const ingestToken = process.env.INGEST_TOKEN ?? "";
const allowStale = cli.flags.has("allow-stale");

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY;
const APISPORTS_KEY = process.env.APISPORTS_KEY;

const today = dateInVETOffset(0);
const tomorrow = dateInVETOffset(1);
const windowDates = new Set([today, tomorrow]);

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "equipo";
}

function toVetDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function toVetTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

async function fetchJson(url, headers = {}, timeout = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text, headers: res.headers };
}

const report = {
  captured_at: new Date().toISOString(),
  window_vet: { today, tomorrow },
  sources: {},
  warnings: [],
  counts: { odds_events: 0, api_sports_fixtures: 0, sportmonks_fixtures: 0, espn_events: 0, openligadb_matches: 0, normalized: 0 },
};

const normalized = [];

async function extractOddsApi() {
  if (!ODDS_API_KEY) {
    report.sources.the_odds_api = { enabled: false, reason: "missing THE_ODDS_API_KEY" };
    return;
  }
  const sportsUrl = `https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_API_KEY}`;
  const sports = await fetchJson(sportsUrl);
  if (!sports.ok) {
    report.sources.the_odds_api = { enabled: true, ok: false, status: sports.status, error: sports.text.slice(0, 200) };
    return;
  }
  const active = (sports.json ?? []).filter((s) => s.active && !s.has_outrights).slice(0, 20);
  let events = 0;
  for (const sport of active) {
    const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_API_KEY}&regions=us,eu,uk,au&markets=h2h&oddsFormat=decimal&dateFormat=iso`;
    const odds = await fetchJson(oddsUrl);
    if (!odds.ok) { report.warnings.push(`odds-api ${sport.key}: HTTP ${odds.status}`); continue; }
    for (const ev of odds.json ?? []) {
      const dateVet = toVetDate(ev.commence_time);
      if (!allowStale && (!dateVet || !windowDates.has(dateVet))) continue;
      const matchSlug = `${dateVet}_${slugify(ev.home_team)}_vs_${slugify(ev.away_team)}`;
      const quotes = [];
      for (const bm of ev.bookmakers ?? []) {
        const h2h = bm.markets?.find((m) => m.key === "h2h");
        if (!h2h) continue;
        let home = null, draw = null, away = null;
        for (const o of h2h.outcomes ?? []) {
          const name = String(o.name ?? "").toLowerCase();
          if (name === String(ev.home_team).toLowerCase()) home = o.price;
          else if (name === String(ev.away_team).toLowerCase()) away = o.price;
          else if (name === "draw" || name === "tie") draw = o.price;
        }
        if (!(home > 1) || !(away > 1)) continue;
        quotes.push({ bookmaker: bm.title, canonical: String(bm.key ?? bm.title).toLowerCase(), home, draw: draw > 1 ? draw : null, away, updated_at: bm.last_update ?? null, source: "the-odds-api" });
      }
      if (quotes.length === 0) continue;
      events++;
      normalized.push({
        match_key: matchSlug,
        match_slug: matchSlug,
        sport: sport.group ?? sport.key,
        league: { id: sport.key, name: sport.title ?? sport.key },
        commence_time_utc: ev.commence_time,
        date_local_vet: dateVet,
        time_local_vet: toVetTime(ev.commence_time),
        status: "scheduled",
        home: { name: ev.home_team },
        away: { name: ev.away_team },
        odds_1x2: quotes,
        provenance: "api",
        source: "odds-api",
      });
    }
  }
  report.sources.the_odds_api = { enabled: true, ok: true, events, remaining: sports.headers.get("x-requests-remaining") };
  report.counts.odds_events = events;
}

async function extractApiSports() {
  if (!APISPORTS_KEY) {
    report.sources.api_sports = { enabled: false, reason: "missing APISPORTS_KEY" };
    return;
  }
  let fixtures = 0;
  for (const date of [today, tomorrow]) {
    const url = `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=America/Caracas`;
    const res = await fetchJson(url, { "x-apisports-key": APISPORTS_KEY });
    if (!res.ok) { report.warnings.push(`api-sports ${date}: HTTP ${res.status}`); continue; }
    for (const item of res.json?.response ?? []) {
      const fx = item.fixture ?? {};
      const teams = item.teams ?? {};
      const league = item.league ?? {};
      const home = teams.home?.name;
      const away = teams.away?.name;
      const iso = fx.date;
      const dateVet = date;
      if (!home || !away || !iso) continue;
      const matchSlug = `${dateVet}_${slugify(home)}_vs_${slugify(away)}`;
      fixtures++;
      normalized.push({
        match_key: matchSlug,
        match_slug: matchSlug,
        sport: "soccer",
        league: { id: String(league.id ?? league.name ?? "soccer"), name: league.name ?? "Soccer" },
        commence_time_utc: iso,
        date_local_vet: dateVet,
        time_local_vet: toVetTime(iso),
        status: String(fx.status?.short ?? "NS").toLowerCase(),
        home: { id: String(teams.home?.id ?? home), name: home },
        away: { id: String(teams.away?.id ?? away), name: away },
        score: { home: item.goals?.home ?? null, away: item.goals?.away ?? null },
        odds_1x2: [],
        provenance: "api",
        source: "api-sports",
      });
    }
  }
  report.sources.api_sports = { enabled: true, ok: true, fixtures };
  report.counts.api_sports_fixtures = fixtures;
}

async function extractSportMonks() {
  if (!SPORTMONKS_KEY) {
    report.sources.sportmonks = { enabled: false, reason: "missing SPORTMONKS_KEY" };
    return;
  }
  let fixtures = 0;
  for (const date of [today, tomorrow]) {
    const url = `https://api.sportmonks.com/v3/football/fixtures/date/${date}?api_token=${SPORTMONKS_KEY}&include=participants;league`;
    const res = await fetchJson(url);
    if (!res.ok) { report.warnings.push(`sportmonks ${date}: HTTP ${res.status}`); continue; }
    for (const item of res.json?.data ?? []) {
      const participants = item.participants ?? [];
      const home = participants.find((p) => p.meta?.location === "home")?.name;
      const away = participants.find((p) => p.meta?.location === "away")?.name;
      const iso = item.starting_at ? new Date(item.starting_at.replace(" ", "T") + "Z").toISOString() : null;
      if (!home || !away || !iso) continue;
      const dateVet = toVetDate(iso) ?? date;
      if (!allowStale && !windowDates.has(dateVet)) continue;
      const matchSlug = `${dateVet}_${slugify(home)}_vs_${slugify(away)}`;
      fixtures++;
      normalized.push({
        match_key: matchSlug,
        match_slug: matchSlug,
        sport: "soccer",
        league: { id: String(item.league_id ?? item.league?.id ?? "soccer"), name: item.league?.name ?? "Soccer" },
        commence_time_utc: iso,
        date_local_vet: dateVet,
        time_local_vet: toVetTime(iso),
        status: "scheduled",
        home: { name: home },
        away: { name: away },
        odds_1x2: [],
        provenance: "api",
        source: "sportmonks",
      });
    }
  }
  report.sources.sportmonks = { enabled: true, ok: true, fixtures };
  report.counts.sportmonks_fixtures = fixtures;
}

function dedupeNormalized(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.match_key;
    const prev = map.get(key);
    if (!prev) { map.set(key, item); continue; }
    const oddsByKey = new Map();
    for (const o of [...(prev.odds_1x2 ?? []), ...(item.odds_1x2 ?? [])]) {
      const k = `${o.canonical ?? o.bookmaker}|${o.updated_at ?? ""}`;
      if (!oddsByKey.has(k)) oddsByKey.set(k, o);
    }
    map.set(key, {
      ...prev,
      ...item,
      odds_1x2: Array.from(oddsByKey.values()),
      score: item.score ?? prev.score,
      status: item.status ?? prev.status,
      provenance: prev.provenance === item.provenance ? prev.provenance : "mixed",
    });
  }
  return Array.from(map.values());
}

async function extractEspn() {
  let count = 0;
  for (const d of [today, tomorrow]) {
    const compact = d.replace(/-/g, "");
    const res = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${compact}&limit=400`);
    if (!res.ok || !Array.isArray(res.json?.events)) {
      report.warnings.push(`ESPN ${d}: HTTP ${res.status}`);
      continue;
    }
    for (const ev of res.json.events) {
      const comp = ev.competitions?.[0];
      const competitors = comp?.competitors ?? [];
      const homeObj = competitors.find((c) => c.homeAway === "home");
      const awayObj = competitors.find((c) => c.homeAway === "away");
      const home = homeObj?.team?.displayName ?? homeObj?.team?.name;
      const away = awayObj?.team?.displayName ?? awayObj?.team?.name;
      if (!home || !away) continue;
      const dateVet = toVetDate(ev.date) ?? d;
      if (!windowDates.has(dateVet)) continue;
      const state = ev.status?.type?.state;
      const status = state === "post" ? "finished" : state === "in" ? "live" : "scheduled";
      const hScore = Number(homeObj?.score);
      const aScore = Number(awayObj?.score);
      const score = status !== "scheduled" && Number.isFinite(hScore) && Number.isFinite(aScore)
        ? { home: hScore, away: aScore }
        : undefined;
      count += 1;
      normalized.push({
        match_key: `${dateVet}_${slugify(home)}_vs_${slugify(away)}`,
        sport: "futbol",
        league: ev.season?.slug ?? comp?.league?.name ?? "Fútbol",
        fecha_vet: dateVet,
        hora_vet: toVetTime(ev.date) ?? "00:00",
        status,
        ...(score ? { score } : {}),
        home: { name: home },
        away: { name: away },
        odds_1x2: [],
        provenance: "api",
        source: "espn",
      });
    }
  }
  report.sources.espn = { enabled: true, ok: true, events: count };
  report.counts.espn_events = count;
}

async function extractOpenLigaDb() {
  const res = await fetchJson("https://api.openligadb.de/getmatchdata/bl1");
  if (!res.ok || !Array.isArray(res.json)) {
    report.sources.openligadb = { enabled: true, ok: false, status: res.status };
    return;
  }
  let count = 0;
  for (const m of res.json) {
    const home = m.team1?.teamName;
    const away = m.team2?.teamName;
    const iso = m.matchDateTimeUTC ?? m.matchDateTime;
    const dateVet = toVetDate(iso);
    if (!home || !away || !dateVet || !windowDates.has(dateVet)) continue;
    count += 1;
    normalized.push({
      match_key: `${dateVet}_${slugify(home)}_vs_${slugify(away)}`,
      sport: "futbol",
      league: m.leagueName ?? "Bundesliga",
      fecha_vet: dateVet,
      hora_vet: toVetTime(iso) ?? "00:00",
      status: m.matchIsFinished ? "finished" : "scheduled",
      home: { name: home },
      away: { name: away },
      odds_1x2: [],
      provenance: "api",
      source: "openligadb",
    });
  }
  report.sources.openligadb = { enabled: true, ok: true, matches: count };
  report.counts.openligadb_matches = count;
}

await extractOddsApi();
await extractApiSports();
await extractSportMonks();
await extractEspn();
await extractOpenLigaDb();

const finalMatches = dedupeNormalized(normalized);
report.counts.normalized = finalMatches.length;

const payload = {
  target_app: "BetStats Pro",
  source: "etl_curated",
  sync_mode: "enrich_or_create",
  fecha_extraccion: today,
  zona_horaria: "America/Caracas",
  window_vet: { start: today, end: tomorrow },
  generated_at: timestampVET(),
  total_matches: finalMatches.length,
  matches: finalMatches,
  advertencias: report.warnings,
};

await mkdir(path.dirname(reportOut), { recursive: true });
await writeFile(reportOut, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`REPORT ${reportOut}`);

if (cli.flags.has("write") || cli.values.out) {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`WROTE ${out} matches=${finalMatches.length}`);
}

if (cli.flags.has("ingest")) {
  if (!site) { console.error("Falta --site o SITE_URL para ingest"); process.exit(1); }
  const url = `${site}/api/ingest/curated`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ingestToken ? { Authorization: `Bearer ${ingestToken}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  console.log(`INGEST_STATUS ${res.status}`);
  console.log(text.slice(0, 500));
  if (!res.ok) process.exit(1);
}

if (cli.dryRun) console.log("DRY_RUN: no se escribió/ingestó salvo flags explícitos.");
