/**
 * Capturador de The Analyst (Opta Analyst).
 *
 *   node scripts/the-analyst-scrape.mjs [salida.json] [límite] [búsqueda] [--discover]
 *
 * Usa Playwright para consultar la REST API pública de WordPress (las páginas
 * HTML del sitio suelen devolver 403 al cliente directo) y, opcionalmente,
 * inspecciona los iframes de dataviz para descubrir sus endpoints XHR/JSON.
 * Todo lo que no se pueda observar se guarda como null + advertencia.
 */

import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const DISCOVER = args.includes("--discover");
const OUT = args.find((arg) => arg.endsWith(".json")) ?? "scripts/the-analyst-payload.json";
const LIMIT = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 20);
const SEARCH = args.find((arg) => /^[a-z]+$/.test(arg) && arg !== "json") ?? "prediction";
const API = "https://theanalyst.com/wp-json/wp/v2/posts";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/html;q=0.9, */*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9,es;q=0.8",
  Referer: "https://theanalyst.com/",
};

const ALIASES = {
  "man city": "Manchester City",
  city: "Manchester City",
  "man utd": "Manchester United",
  spurs: "Tottenham Hotspur",
  brighton: "Brighton & Hove Albion",
  newcastle: "Newcastle United",
  magpies: "Newcastle United",
  leeds: "Leeds United",
  whites: "Leeds United",
  arsenal: "Arsenal",
  gunners: "Arsenal",
  chelsea: "Chelsea",
  blues: "Chelsea",
  napoli: "Napoli",
  bvb: "Borussia Dortmund",
  dortmund: "Borussia Dortmund",
};

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", eacute: "é", iacute: "í", oacute: "ó",
  uacute: "ú", ntilde: "ñ", ccedil: "ç",
};

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const toText = (html) =>
  decode(html ?? "")
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|tr|section)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

const stable = (s) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

const slug = (s) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, "-")
    .replace(/^-|-$/g, "");

function aliasesFor(name) {
  const key = stable(name);
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (stable(alias) === key || stable(canonical) === key) return [name, alias, canonical];
  }
  return [name];
}

function distance(text, aliases, index) {
  let best = Infinity;
  for (const alias of aliases) {
    const needle = alias.toLowerCase();
    if (needle.length < 3) continue;
    let from = 0;
    while (from < text.length) {
      const pos = text.toLowerCase().indexOf(needle, from);
      if (pos < 0) break;
      best = Math.min(best, Math.abs(pos + needle.length - index));
      from = pos + 1;
    }
  }
  return best;
}

function teamsFromTitle(title) {
  const m = /^\s*(.+?)\s+(?:vs\.?|v|against)\s+(.+?)\s+(?:prediction|preview|stats|match|odds|result)\b/i.exec(title);
  if (!m) return null;
  const clean = (s) => s.replace(/[:\-–—|]+$/g, "").replace(/\s+/g, " ").trim();
  const home = clean(m[1]);
  const away = clean(m[2]);
  if (!home || !away) return null;
  const afterColon = title.split(":").slice(1).join(":").trim();
  const liga = afterColon
    ? afterColon.replace(/\b(preview|prediction|match report|stats)\b/gi, "")
        .replace(/[-–—\d]+$/, "").trim() || null
    : null;
  return { home, away, liga };
}

function sentenceAround(text, index) {
  let start = 0;
  for (const m of text.matchAll(/[.!?]\s+|\n+/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > index) return { text: text.slice(start, (m.index ?? 0) + 1), start };
    start = end;
  }
  return { text: text.slice(start), start };
}

function distanceIn(text, needles, index) {
  let best = Infinity;
  for (const needle of needles) {
    const word = needle.toLowerCase();
    if (word.length < 3) continue;
    let from = 0;
    while (from < text.length) {
      const pos = text.toLowerCase().indexOf(word, from);
      if (pos < 0) break;
      best = Math.min(best, Math.abs(pos + word.length - index));
      from = pos + 1;
    }
  }
  return best;
}

function probabilitiesFromText(text, home, away) {
  const ha = aliasesFor(home);
  const aa = aliasesFor(away);
  const signal = /\b(chance|probability|likelihood|simulations?|victory|win|winning|favourit\w*|favorite|outcome|points)\b/i;
  const noise = /\b(possession|shots?|pass(?:es|ing)?|duels?|accuracy|xG|expected goals|tackles|fouls|corners)\b/i;
  const strongHome = /\b(overcam\w*|home win|heavy favourit\w*|come out on top|hosts|prevailed)\b/i;
  const strongAway = /\b(upset|away win|visitors|underdog)\b/i;
  const options = { home: [], draw: [], away: [] };

  for (const m of text.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/g)) {
    const raw = Number(m[1].replace(",", "."));
    if (!Number.isFinite(raw) || raw < 1 || raw > 99) continue;
    const idx = m.index ?? 0;
    const sentence = sentenceAround(text, idx);
    if (noise.test(sentence.text) && !signal.test(sentence.text)) continue;
    const value = Math.round((raw / 100) * 1000) / 1000;
    const local = idx - sentence.start;
    const bonus = signal.test(sentence.text) ? -40 : 40;
    const dh = distanceIn(sentence.text, ha, local);
    const da = distanceIn(sentence.text, aa, local);
    const dd = distanceIn(sentence.text, ["draw", "drawn", "empate", "stalemate"], local);
    const candidates = [
      { outcome: "home", score: (Number.isFinite(dh) ? dh : 420) + bonus + (strongHome.test(sentence.text) ? -70 : 0) },
      { outcome: "away", score: (Number.isFinite(da) ? da : 420) + bonus + (strongAway.test(sentence.text) ? -45 : 0) },
      { outcome: "draw", score: (Number.isFinite(dd) ? dd : 420) + bonus },
    ];
    for (const c of candidates) {
      if (c.score < 340) options[c.outcome].push({ value, score: c.score });
    }
  }

  let best = null;
  for (const h of [null, ...options.home]) {
    for (const d of [null, ...options.draw]) {
      for (const a of [null, ...options.away]) {
        const chosen = [h, d, a].filter(Boolean);
        if (chosen.length < 2) continue;
        const sum = chosen.reduce((acc, c) => acc + c.value, 0);
        if (sum < 0.9 || sum > 1.02) continue;
        const distinct = new Set(chosen.map((c) => c.value)).size;
        const cost = Math.abs(1 - sum) * 1000 +
          chosen.reduce((acc, c) => acc + c.score, 0) +
          (distinct === chosen.length ? 0 : 400) + (chosen.length === 2 ? 20 : 0);
        if (!best || cost < best.cost) {
          best = { cost, values: { home: h?.value ?? null, draw: d?.value ?? null, away: a?.value ?? null } };
        }
      }
    }
  }

  const values = best?.values ?? {
    home: options.home.sort((x, y) => x.score - y.score)[0]?.value ?? null,
    draw: options.draw.sort((x, y) => x.score - y.score)[0]?.value ?? null,
    away: options.away.sort((x, y) => x.score - y.score)[0]?.value ?? null,
  };
  const inferidas = [];
  const present = ["home", "draw", "away"].filter((k) => values[k] !== null);
  if (present.length === 2) {
    const sum = present.reduce((acc, k) => acc + values[k], 0);
    const missing = ["home", "draw", "away"].find((k) => values[k] === null);
    if (missing && sum > 0 && sum < 0.995) {
      values[missing] = Math.round((1 - sum) * 1000) / 1000;
      inferidas.push(missing);
    }
  }
  return { ...values, inferidas };
}

function metricsFromText(text, home, away) {
  const ha = aliasesFor(home);
  const aa = aliasesFor(away);
  let xgLocal = null;
  let xgVisitante = null;
  for (const m of text.matchAll(/\bxG\b/gi)) {
    const idx = m.index ?? 0;
    const context = text.slice(Math.max(0, idx - 180), idx + 180);
    const pair = /xG[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*(?:-|–|—)\s*(\d+(?:[.,]\d+)?)/i.exec(context);
    const single = pair
      ? Number(pair[1].replace(",", "."))
      : Number((/(\d{1,2}(?:[.,]\d{1,2})?)[^0-9]{0,60}xG/i.exec(context)?.[1] ??
          /xG[^0-9]{0,80}?(\d{1,2}(?:[.,]\d{1,2})?)/i.exec(context)?.[1] ?? "0").replace(",", "."));
    if (!Number.isFinite(single) || single <= 0 || single > 5 ||
        /set[- ]piece|this season|this term|last season|average/i.test(context)) continue;
    const dh = distance(context, ha, 180);
    const da = distance(context, aa, 180);
    if (xgLocal === null && (dh <= da || xgVisitante !== null)) xgLocal = single;
    else if (xgVisitante === null) xgVisitante = single;
  }

  const forms = [];
  for (const m of text.matchAll(/\b[WDL]\s*\d+\s*[Dd]\s*\d+\s*[Ll]\s*\d+\b/g)) {
    if (!forms.includes(m[0])) forms.push(m[0]);
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const streakRe = /\b(unbeaten|undefeated|winning run|straight (?:win|victory|victories)|without (?:a win|losing)|won\s+\w+\s+of\s+(?:their|his|the)\s+(?:last|past)|lost\s+\w+\s+of\s+(?:their|the)\s+(?:last|past)|racha)\b/i;
  const streaks = sentences.filter((s) => streakRe.test(s));
  const withHome = streaks.find((s) => ha.some((a) => s.toLowerCase().includes(a.toLowerCase())));
  const withAway = streaks.find((s) => aa.some((a) => s.toLowerCase().includes(a.toLowerCase())));
  const h2hIndex = sentences.findIndex((s) => /\b(head-to-head|head to head|meetings|h2h|enfrentamientos)\b/i.test(s));

  return {
    xg_local: xgLocal,
    xg_visitante: xgVisitante,
    forma_local: forms[0] ?? null,
    forma_visitante: forms[1] ?? null,
    racha_local: withHome?.slice(0, 180) ?? null,
    racha_visitante: withAway?.slice(0, 180) ?? null,
    h2h_resumen: h2hIndex >= 0 ? sentences.slice(h2hIndex, h2hIndex + 2).join(" ").slice(0, 240) : null,
  };
}

function postToRecord(post) {
  const title = toText(post.title?.rendered ?? "");
  if (!title) return null;
  const content = post.content?.rendered ?? post.excerpt?.rendered ?? "";
  const text = toText(content);
  const teams = teamsFromTitle(title);
  const published = new Date(post.date_gmt ?? post.date ?? Date.now()).toISOString();
  const bodyLine = text.split("\n").find((line) => line.length > 70) ?? null;
  let insight = null;

  if (teams) {
    const probabilidades = probabilitiesFromText(text, teams.home, teams.away);
    const metricas = metricsFromText(text, teams.home, teams.away);
    const hasAny = ["home", "draw", "away"].some((k) => probabilidades[k] !== null) ||
      metricas.xg_local !== null || metricas.xg_visitante !== null;
    if (hasAny) {
      const known = ["home", "draw", "away"].filter((k) => probabilidades[k] !== null);
      const sum = known.reduce((acc, k) => acc + probabilidades[k], 0);
      const confianza = known.length === 3 && sum > 0.95 && sum <= 1.02
        ? "media" : known.length >= 2 && sum > 0.8 && sum <= 1.02 ? "media" : "baja";
      insight = {
        match_slug: `${published.slice(0, 10)}_${slug(teams.home)}_vs_${slug(teams.away)}`,
        fecha_partido: null,
        deporte: "Fútbol",
        liga: teams.liga,
        equipo_local: teams.home,
        equipo_visitante: teams.away,
        probabilidades,
        metricas,
        resumen: bodyLine?.slice(0, 260) ?? null,
        metodo: "articulo",
        confianza,
      };
    }
  }

  const lower = title.toLowerCase();
  const tipo = /prediction/.test(lower) ? "match_preview"
    : /stats|match centre|preview/.test(lower) ? "stats" : "otro";

  return {
    articulo_id: String(post.id ?? post.link ?? slug(title)),
    titulo: title,
    url: post.link ?? "",
    fecha_publicacion: published,
    tipo,
    liga: teams?.liga ?? null,
    equipo_local: teams?.home ?? null,
    equipo_visitante: teams?.away ?? null,
    resumen: bodyLine?.slice(0, 260) ?? null,
    insight,
    capturado_en: new Date().toISOString(),
    notas: null,
  };
}

function fechaVET() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-");
  return `${y}-${m}-${d}`;
}

const advertencias = [];
const endpoints = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "en-GB",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
  userAgent: HEADERS["User-Agent"],
  extraHTTPHeaders: { "Accept-Language": HEADERS["Accept-Language"] },
});
const page = await context.newPage();
page.on("response", (response) => {
  const url = response.url();
  if (/dataviz\.theanalyst\.com|theanalyst\.com\/wp-json/i.test(url)) {
    const entry = { url, status: response.status(), contentType: response.headers()["content-type"] ?? "" };
    if (!endpoints.some((e) => e.url === entry.url)) endpoints.push(entry);
  }
});

let posts = [];
try {
  const url = new URL(API);
  url.searchParams.set("search", SEARCH);
  url.searchParams.set("per_page", String(Math.min(100, Math.max(1, LIMIT))));
  url.searchParams.set("orderby", "date");
  url.searchParams.set("order", "desc");
  url.searchParams.set("_fields", "id,date,date_gmt,link,title,content,excerpt,yoast_head_json");
  const response = await context.request.get(url.toString(), { headers: HEADERS, timeout: 30000 });
  if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
  posts = await response.json();
  if (!Array.isArray(posts)) throw new Error("La API no devolvió un arreglo");
} catch (error) {
  advertencias.push(`REST API no accesible (${String(error)}). Se intentará la página JSON con navegador.`);
  try {
    await page.goto(`${API}?search=${encodeURIComponent(SEARCH)}&per_page=${Math.min(100, LIMIT)}`, {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    posts = JSON.parse(await page.locator("pre").first().innerText({ timeout: 10000 }));
  } catch (inner) {
    advertencias.push(`Fallback HTML tampoco disponible (${String(inner)}).`);
  }
}

if (DISCOVER) {
  for (const target of [
    "https://dataviz.theanalyst.com/opta-football-predictions/?ticker=true",
    "https://dataviz.theanalyst.com/opta-football-match-centre/",
  ]) {
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3500);
    } catch (error) {
      advertencias.push(`No se pudo inspeccionar ${target}: ${String(error).slice(0, 120)}`);
    }
  }
}

await browser.close();

let registros = (Array.isArray(posts) ? posts : []).map(postToRecord).filter(Boolean);
if (registros.length === 0) {
  try {
    const seed = JSON.parse(await readFile("scripts/the-analyst-seed.json", "utf8"));
    registros = seed.registros;
    advertencias.push("No se extrajeron artículos nuevos; se usó la semilla verificada de scripts/the-analyst-seed.json.");
  } catch (error) {
    advertencias.push(`Sin artículos y sin semilla disponible: ${String(error)}`);
  }
}

if (DISCOVER) {
  advertencias.push(`Endpoints observados (modo --discover): ${endpoints.length}`);
}

const payload = {
  target_app: "BetStats Pro",
  source: "the_analyst_agent",
  sync_mode: "enrich_or_create",
  fecha_extraccion: fechaVET(),
  zona_horaria: "America/Caracas",
  total_registros: registros.length,
  registros,
  advertencias,
};

await writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`PAYLOAD=${OUT} TOTAL=${payload.total_registros} INSIGHTS=${registros.filter((r) => r.insight).length}`);
if (advertencias.length) console.log(`WARNINGS=${advertencias.length}`);
if (DISCOVER) {
  for (const endpoint of endpoints.slice(0, 30)) {
    console.log(`ENDPOINT ${endpoint.status} ${endpoint.contentType} ${endpoint.url}`);
  }
}
