#!/usr/bin/env node
/**
 * Valida en vivo las fuentes del motor estadístico.
 * - Fuentes premium: solo se prueban si su API key está configurada.
 * - Fuentes gratuitas: se prueban siempre (ESPN, TheSportsDB, OpenLigaDB).
 * Salida legible + exit code 1 si una fuente configurada falla.
 */
const VET_TZ = "America/Caracas";

function dateVET(offset = 0) {
  const shifted = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

async function fetchJson(url, options = {}, timeout = 12000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Respuestas no JSON se reportan con el texto crudo.
  }
  return { ok: response.ok, status: response.status, json, text, headers: response.headers };
}

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
}

async function probeOddsApi() {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) return record("The Odds API", "not_configured", "falta THE_ODDS_API_KEY");
  try {
    const result = await fetchJson(
      `https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(key)}`,
    );
    record(
      "The Odds API",
      result.ok ? "ok" : "fail",
      result.ok
        ? `${Array.isArray(result.json) ? result.json.length : 0} deportes; remaining=${result.headers?.get?.("x-requests-remaining") ?? "?"}`
        : `HTTP ${result.status} ${result.text.slice(0, 120)}`,
    );
  } catch (error) {
    record("The Odds API", "fail", String(error).slice(0, 160));
  }
}

async function probeApiSports() {
  const key = process.env.APISPORTS_KEY;
  if (!key) return record("API-Sports", "not_configured", "falta APISPORTS_KEY");
  try {
    const result = await fetchJson("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": key },
    });
    const errors = result.json?.errors;
    const hasErrors = errors && Object.keys(errors).length > 0;
    record(
      "API-Sports",
      result.ok && !hasErrors ? "ok" : "fail",
      hasErrors ? JSON.stringify(errors).slice(0, 160) : `HTTP ${result.status}`,
    );
  } catch (error) {
    record("API-Sports", "fail", String(error).slice(0, 160));
  }
}

async function probeSportMonks() {
  const key = process.env.SPORTMONKS_KEY;
  if (!key) return record("SportMonks", "not_configured", "falta SPORTMONKS_KEY");
  try {
    const result = await fetchJson(
      `https://api.sportmonks.com/v3/football/leagues?api_token=${encodeURIComponent(key)}&per_page=1`,
    );
    record(
      "SportMonks",
      result.ok ? "ok" : "fail",
      result.ok ? `HTTP ${result.status}` : `HTTP ${result.status} ${result.text.slice(0, 120)}`,
    );
  } catch (error) {
    record("SportMonks", "fail", String(error).slice(0, 160));
  }
}

async function probeEspn() {
  try {
    const counts = [];
    for (const offset of [0, 1]) {
      const date = dateVET(offset).replace(/-/g, "");
      const result = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${date}&limit=400`,
      );
      if (!result.ok) {
        record("ESPN (gratis)", "fail", `HTTP ${result.status} (${date})`);
        return;
      }
      counts.push(Array.isArray(result.json?.events) ? result.json.events.length : 0);
    }
    record("ESPN (gratis)", "ok", `${counts[0]} eventos hoy / ${counts[1]} mañana (soccer/all)`);
  } catch (error) {
    record("ESPN (gratis)", "fail", String(error).slice(0, 160));
  }
}

async function probeTheSportsDb() {
  const key = process.env.THESPORTSDB_KEY;
  if (!key) return record("TheSportsDB", "not_configured", "falta THESPORTSDB_KEY propia");
  try {
    const result = await fetchJson(
      `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/eventsday.php?d=${dateVET(0)}&s=Soccer`,
    );
    const events = Array.isArray(result.json?.events) ? result.json.events.length : 0;
    record("TheSportsDB (gratis)", result.ok ? "ok" : "fail", result.ok ? `${events} eventos hoy` : `HTTP ${result.status}`);
  } catch (error) {
    record("TheSportsDB (gratis)", "fail", String(error).slice(0, 160));
  }
}

async function probeAllSportsApi() {
  const key = process.env.ALLSPORTSAPI_KEY;
  if (!key) return record("AllSportsAPI", "not_configured", "falta ALLSPORTSAPI_KEY");
  try {
    const result = await fetchJson(
      `https://apiv2.allsportsapi.com/football/?met=Fixtures&APIkey=${encodeURIComponent(key)}&from=${dateVET(0)}&to=${dateVET(1)}`,
    );
    const fixtures = Array.isArray(result.json?.result) ? result.json.result.length : 0;
    const ok = result.ok && result.json?.success === 1;
    record("AllSportsAPI", ok ? "ok" : "fail", ok ? `${fixtures} fixtures hoy/mañana` : `HTTP ${result.status}`);
  } catch {
    record("AllSportsAPI", "fail", "error de red al validar AllSportsAPI");
  }
}

async function probeFootballData() {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) return record("football-data.org", "not_configured", "falta FOOTBALL_DATA_API_KEY");
  try {
    const result = await fetchJson("https://api.football-data.org/v4/competitions", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const competitions = Array.isArray(result.json?.competitions) ? result.json.competitions.length : 0;
    record(
      "football-data.org",
      result.ok ? "ok" : "fail",
      result.ok
        ? `${competitions} competiciones; standings/equipos requieren plan superior`
        : `HTTP ${result.status}`,
    );
  } catch {
    record("football-data.org", "fail", "error de red al validar football-data.org");
  }
}

async function probeTheRundown() {
  const key = process.env.THERUNDOWN_API_KEY;
  if (!key) return record("TheRundown", "not_configured", "falta THERUNDOWN_API_KEY");
  try {
    const result = await fetchJson("https://therundown.io/api/v2/markets?sport_id=4&limit=1", {
      headers: { "X-TheRundown-Key": key, Accept: "application/json" },
    });
    const markets = Array.isArray(result.json) ? result.json.length : 0;
    record(
      "TheRundown",
      result.ok ? "ok" : "fail",
      result.ok ? `${markets} markets; plan con límite de 1 req/s` : `HTTP ${result.status}`,
    );
  } catch {
    record("TheRundown", "fail", "error de red al validar TheRundown");
  }
}

async function probeOpenLigaDb() {
  try {
    const result = await fetchJson("https://api.openligadb.de/getmatchdata/bl1");
    const events = Array.isArray(result.json) ? result.json.length : 0;
    record("OpenLigaDB (gratis)", result.ok ? "ok" : "fail", result.ok ? `${events} partidos recientes` : `HTTP ${result.status}`);
  } catch (error) {
    record("OpenLigaDB (gratis)", "fail", String(error).slice(0, 160));
  }
}

await Promise.all([
  probeOddsApi(),
  probeApiSports(),
  probeSportMonks(),
  probeEspn(),
  probeTheSportsDb(),
  probeAllSportsApi(),
  probeFootballData(),
  probeTheRundown(),
  probeOpenLigaDb(),
]);

for (const item of results) {
  const tag = item.status === "ok" ? "OK  " : item.status === "not_configured" ? "SKIP" : "FAIL";
  console.log(`${tag} ${item.name.padEnd(22)} ${item.detail}`);
}

const failed = results.filter((item) => item.status === "fail");
if (failed.length > 0) {
  console.error(`\n${failed.length} fuente(s) fallaron. Revisa claves, red o endpoints.`);
  process.exit(1);
}
console.log("\nFuentes validadas. Las no configuradas se omiten hasta añadir su API key.");
