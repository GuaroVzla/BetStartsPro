#!/usr/bin/env node
/**
 * Captura de partidos y cuotas 1X2 de Flashscore.com.ve para HOY y MAÑANA (VET).
 *
 * Fuentes (en orden de robustez):
 *  1. m.flashscore.com.ve/?d=0|1 -> HTML server-rendered, sin JS. Da fixture,
 *     hora local, liga y `mid`. Es el fallback si el escritorio falla.
 *  2. Escritorio con Playwright (user-agent realista, locale es-VE,
 *     timezone America/Caracas), filtro "CUOTAS" activado y DOM .event__match.
 *  3. XHR interceptados `global.flashscore.ninja/.../x/feed/fo_*`: cuotas
 *     actuales en YA/YB/YC (XA/XB/XC como apertura). Se leen desde la
 *     respuesta del navegador porque fetch directo devuelve 401.
 *  4. Detalle móvil (?t=clasificacion / ?t=enfrentamiento-directo) para
 *     posiciones, rachas y H2H (opcional, --details N).
 *
 * Se emite UN payload por día porque el adaptador usa `fecha_extraccion`
 * global como fecha del partido (no lee `fecha_local` por partido).
 *
 * Uso:
 *   node scripts/flashscore-scrape.mjs --dry-run
 *   node scripts/flashscore-scrape.mjs --details 30
 *   node scripts/flashscore-scrape.mjs --days 1 --out scripts/flashscore-payload-manana.json
 *   node scripts/flashscore-scrape.mjs --no-desktop   # solo versión móvil
 */
import { chromium } from "playwright";
import {
  BROWSER_HEADERS,
  DESKTOP_UA,
  MOBILE_UA,
  dateInVETOffset,
  decodeHtml,
  dedupeBySlug,
  makeSlug,
  normalizeName,
  parseCliArgs,
  parseOdd,
  timestampVET,
  writeJson,
} from "./ingest-utils.mjs";

const cli = parseCliArgs();
const days = (cli.values.days ?? "0,1")
  .split(",")
  .map(Number)
  .filter((day) => day === 0 || day === 1);
if (days.length === 0) {
  console.error("DAY_INVALIDO: use --days 0,1 | 0 | 1");
  process.exit(1);
}

const OUT_HOY = cli.values.out ?? "scripts/flashscore-payload.json";
const OUT_MANANA =
  cli.values["out-manana"] ?? OUT_HOY.replace(/\.json$/i, "-manana.json");
const MAX_DETAILS = Number(cli.values.details ?? 0);
const TIMEOUT = Number(cli.values.timeout ?? 25000);
const MOBILE_BASE = (cli.values["mobile-base"] ?? "http://m.flashscore.com.ve").replace(/\/$/, "");
const DESKTOP_BASE = (cli.values["desktop-base"] ?? "https://www.flashscore.com.ve").replace(/\/$/, "");
const DRY = cli.dryRun;

const FECHA = { 0: dateInVETOffset(0), 1: dateInVETOffset(1) };
const desktopUrls = {
  0: `${DESKTOP_BASE}/`,
  1: `${DESKTOP_BASE}/futbol/manana/`,
};

const rowsByDay = { 0: [], 1: [] };
const diagnostico = {
  capturado_en: timestampVET(),
  fechas_vet: FECHA,
  movil: {},
  escritorio: {},
  feeds_xhr: [],
  errores: [],
};

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function normalizeHour(raw) {
  const value = decodeHtml(String(raw ?? "")).trim();
  return /^\d{1,2}:\d{2}$/.test(value)
    ? value.replace(/^(\d)(:)/, "0$1$2")
    : null;
}

function oddFromText(value) {
  return parseOdd(stripTags(value).match(/^\d+[.,]\d+$/)?.[0] ?? null);
}

function mergeRows(base, extra) {
  if (!base) return extra;
  return {
    ...base,
    ...extra,
    hora: base.hora ?? extra.hora,
    liga: base.liga ?? extra.liga,
    pais: base.pais ?? extra.pais,
    href: base.href ?? extra.href,
    cuotas: {
      local_1: extra.cuotas?.local_1 ?? base.cuotas?.local_1 ?? null,
      empate_x: extra.cuotas?.empate_x ?? base.cuotas?.empate_x ?? null,
      visitante_2: extra.cuotas?.visitante_2 ?? base.cuotas?.visitante_2 ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// 1) Fuente móvil (HTML estático)
// ---------------------------------------------------------------------------
async function fetchMobileDay(day) {
  const url = `${MOBILE_BASE}/?d=${day}`;
  const response = await fetch(url, {
    headers: { "User-Agent": MOBILE_UA, "Accept-Language": "es-VE,es;q=0.9" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const html = await response.text();
  const start = html.indexOf('id="score-data"');
  if (start < 0) throw new Error(`Sin #score-data en ${url} (posible bloqueo/cambio de layout)`);
  const end = html.indexOf("REFRESCAR", start);
  const section = html.slice(start, end > start ? end : undefined);
  const chunks = section.split(/<br\s*\/?>/i);

  let liga = null;
  const rows = [];
  for (const rawChunk of chunks) {
    let chunk = rawChunk;
    const heading = chunk.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    if (heading) {
      liga = stripTags(heading[1]).replace(/\s+Clasificación\s*$/i, "").trim() || null;
      chunk = chunk.replace(heading[0], " ");
    }
    const match = chunk.match(
      /<span[^>]*>([^<]+)<\/span>([\s\S]*?)<a\s+href="\/partido\/([A-Za-z0-9]+)\//i,
    );
    if (!match) continue;

    const hora = normalizeHour(match[1]);
    const teams = stripTags(match[2])
      .replace(/^Aplazado\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/\s+-\s+/);
    if (teams.length < 2) continue;
    const home = teams[0].trim();
    const away = teams.slice(1).join(" - ").trim();
    if (!home || !away) continue;

    const mid = match[3];
    const [pais, nombreLiga] = (liga ?? "").includes(":")
      ? [liga.split(":")[0].trim(), liga.slice(liga.indexOf(":") + 1).trim()]
      : [null, liga];
    rows.push({
      mid,
      hora,
      estado: hora ? "Programado" : "En Vivo",
      home,
      away,
      liga: nombreLiga,
      pais,
      href: `${MOBILE_BASE}/partido/${mid}/?d=${day}`,
      cuotas: { local_1: null, empate_x: null, visitante_2: null },
      origen: "movil",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2) XHR de cuotas (leídos desde la respuesta de Playwright)
// ---------------------------------------------------------------------------
export function parseOddsFeed(text) {
  const odds = new Map();
  for (const record of String(text ?? "").split("¬~")) {
    const fields = new Map();
    for (const part of record.split("¬")) {
      const separator = part.indexOf("÷");
      if (separator > 0) {
        fields.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
      }
    }
    const mid = fields.get("AA");
    if (!mid) continue;
    odds.set(mid, {
      local_1: parseOdd(fields.get("YA") ?? fields.get("XA")),
      empate_x: parseOdd(fields.get("YB") ?? fields.get("XB")),
      visitante_2: parseOdd(fields.get("YC") ?? fields.get("XC")),
    });
  }
  return odds;
}

// ---------------------------------------------------------------------------
// 3) Fuente escritorio (Playwright + DOM + XHR)
// ---------------------------------------------------------------------------
async function captureDesktopDay(browser, day) {
  const page = await browser.newPage({
    locale: "es-VE",
    timezoneId: "America/Caracas",
    viewport: { width: 1440, height: 1000 },
    userAgent: DESKTOP_UA,
    extraHTTPHeaders: BROWSER_HEADERS,
  });
  const feeds = [];
  page.on("response", async (response) => {
    if (!/\/x\/feed\/fo_/.test(response.url())) return;
    try {
      feeds.push({ url: response.url(), text: await response.text() });
    } catch {}
  });

  try {
    const response = await page.goto(desktopUrls[day], {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT,
    });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status()} en ${desktopUrls[day]}`);

    const reject = page.getByText("Rechazarlas todas", { exact: false }).first();
    if (await reject.count()) await reject.click({ timeout: 3000 }).catch(() => {});
    await page
      .waitForSelector("#live-table .event__match, .event__match", { timeout: TIMEOUT })
      .catch(() => diagnostico.errores.push(`day=${day} sin .event__match (DOM cambiado o bloqueo)`));
    await page.waitForTimeout(2500);
    const tab = page.locator(".filters__text", { hasText: /^cuotas$/i }).first();
    let oddsTab = false;
    if (await tab.count()) {
      await tab.click({ timeout: 3000 }).catch(() => {});
      oddsTab = true;
      await page.waitForTimeout(4000);
    }

    const domRows = await page.evaluate(() => {
      const out = [];
      let current = null;
      const container = document.querySelector("#live-table") ?? document;
      for (const node of container.querySelectorAll("*")) {
        if (node.classList?.contains("headerLeague__wrapper")) {
          const title =
            node.querySelector(".headerLeague__title-text")?.textContent?.trim() ?? "";
          const category =
            node.querySelector(".headerLeague__category-text")?.textContent?.trim() ?? "";
          const flag = node.querySelector(".headerLeague__flag")?.getAttribute("title")?.trim() ?? "";
          current = { league: title, country: category || flag };
          continue;
        }
        if (!node.classList?.contains("event__match") || node.querySelector(".event__match")) continue;
        const home = node.querySelector(".event__homeParticipant")?.innerText?.trim() ?? "";
        const away = node.querySelector(".event__awayParticipant")?.innerText?.trim() ?? "";
        if (!home || !away) continue;
        const odd = (className) => {
          const el = node.querySelector(`.${className}`);
          const value = (el?.textContent ?? "").trim().match(/^\d+[.,]\d+$/);
          return value ? Number(value[0].replace(",", ".")) : null;
        };
        const href = node.querySelector("a.eventRowLink")?.getAttribute("href") ?? null;
        const mid =
          href?.match(/[?&]mid=([^&]+)/)?.[1] ??
          node.id?.match(/^g_\d+_(.+)$/)?.[1] ??
          null;
        const classNames = node.className || "";
        out.push({
          mid,
          href,
          home,
          away,
          hora: node.querySelector(".event__time")?.innerText?.trim() ?? null,
          estado: /event__match--live/.test(classNames)
            ? "En Vivo"
            : /event__match--finished/.test(classNames)
              ? "Finalizado"
              : "Programado",
          liga: current?.league ?? null,
          pais: current?.country ?? null,
          cuotas: {
            local_1: odd("event__odd--odd1"),
            empate_x: odd("event__odd--odd2"),
            visitante_2: odd("event__odd--odd3"),
          },
          origen: "escritorio",
        });
      }
      return out;
    });

    const oddsFromFeed = new Map();
    for (const feed of feeds) {
      diagnostico.feeds_xhr.push({ dia: day, url: feed.url, bytes: feed.text.length });
      for (const [mid, odds] of parseOddsFeed(feed.text)) oddsFromFeed.set(mid, odds);
    }

    diagnostico.escritorio[day] = {
      url: desktopUrls[day],
      titulo: await page.title(),
      bodyPreview: domRows.length === 0 ? (await page.evaluate(() => document.body.innerText.slice(0, 300))) : null,
      filas: domRows.length,
      pestaña_cuotas: oddsTab,
      feeds_cuotas: feeds.length,
      con_cuotas_dom: domRows.filter((r) => r.cuotas.local_1 !== null).length,
    };

    return domRows.map((row) => ({
      ...row,
      hora: normalizeHour(row.hora),
      cuotas: {
        local_1: row.cuotas.local_1 ?? oddsFromFeed.get(row.mid)?.local_1 ?? null,
        empate_x: row.cuotas.empate_x ?? oddsFromFeed.get(row.mid)?.empate_x ?? null,
        visitante_2: row.cuotas.visitante_2 ?? oddsFromFeed.get(row.mid)?.visitante_2 ?? null,
      },
    }));
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 4) Enriquecimiento desde el detalle móvil
// ---------------------------------------------------------------------------
async function fetchDetailHtml(mid, day, tab) {
  const url = `${MOBILE_BASE}/partido/${mid}/?d=${day}&t=${tab}`;
  const response = await fetch(url, {
    headers: { "User-Agent": MOBILE_UA, "Accept-Language": "es-VE,es;q=0.9" },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

function tableRows(html, className) {
  const start = html.indexOf(`<table class="${className}">`);
  if (start < 0) return [];
  const section = html.slice(start, html.indexOf("</table>", start) + 8);
  return [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      stripTags(cell[1]).trim(),
    ),
  );
}

function parseStandings(html, home, away) {
  const positions = new Map();
  for (const cells of tableRows(html, "standings")) {
    const match = cells[0]?.match(/^(\d+)\.$/);
    if (match && cells[1]) positions.set(normalizeName(cells[1]), Number(match[1]));
  }
  return {
    posicion_local: positions.get(normalizeName(home)) ?? null,
    posicion_visitante: positions.get(normalizeName(away)) ?? null,
  };
}

function resultFor(team, homeTeam, awayTeam, homeGoals, awayGoals) {
  const target = normalizeName(team);
  const isHome = target === normalizeName(homeTeam);
  const isAway = target === normalizeName(awayTeam);
  if (!isHome && !isAway) return null;
  const scored = isHome ? homeGoals : awayGoals;
  const conceded = isHome ? awayGoals : homeGoals;
  return scored > conceded ? "V" : scored === conceded ? "E" : "D";
}

function parseH2H(html, home, away) {
  const result = {
    racha_local_ultimos_5: null,
    racha_visitante_ultimos_5: null,
    h2h_resumen: null,
  };
  const sectionStart = html.indexOf('id="detail-tab-content"');
  const section = sectionStart >= 0 ? html.slice(sectionStart) : html;
  const blocks = [...section.matchAll(/<h4>([^<]*)<\/h4>\s*<table class="h2h">/gi)];
  for (let index = 0; index < blocks.length; index += 1) {
    const title = stripTags(blocks[index][1]);
    const end = blocks[index + 1]?.index ?? section.length;
    const body = section.slice(blocks[index].index, end);
    const matches = [];
    for (const cells of tableRows(body, "h2h")) {
      // En el sitio móvil fecha, equipos y marcador están en un mismo <td>.
      const text = cells.join(" ").replace(/\s+/g, " ").trim();
      const parsed = text.match(
        /(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(\d+)\s*[-–]\s*(\d+)(?:\s|$)/,
      );
      if (!parsed) continue;
      const parts = parsed[2].split(/\s+-\s+/);
      if (parts.length < 2) continue;
      matches.push({
        date: parsed[1],
        home: parts[0].trim(),
        away: parts.slice(1).join(" - ").trim(),
        homeGoals: Number(parsed[3]),
        awayGoals: Number(parsed[4]),
      });
    }
    if (/^últimos partidos:/i.test(title)) {
      const team = title.replace(/^últimos partidos:\s*/i, "").trim();
      const form = matches
        .map((match) => resultFor(team, match.home, match.away, match.homeGoals, match.awayGoals))
        .filter(Boolean)
        .slice(0, 5);
      if (/^últimos partidos:/i.test(title) && normalizeName(team) === normalizeName(home)) {
        if (form.length) result.racha_local_ultimos_5 = form;
      } else if (normalizeName(team) === normalizeName(away) && form.length) {
        result.racha_visitante_ultimos_5 = form;
      }
    } else if (/enfrentamientos/i.test(title) && matches.length) {
      result.h2h_resumen =
        "Últimos " +
        Math.min(3, matches.length) +
        " H2H: " +
        matches
          .slice(0, 3)
          .map((match) => `${match.home} ${match.homeGoals}-${match.awayGoals} ${match.away}`)
          .join("; ");
    }
  }
  return result;
}

async function enrich(row, day) {
  if (!row.mid) return row;
  try {
    const [standingsHtml, h2hHtml] = await Promise.all([
      fetchDetailHtml(row.mid, day, "clasificacion"),
      fetchDetailHtml(row.mid, day, "enfrentamiento-directo"),
    ]);
    return {
      ...row,
      ...parseStandings(standingsHtml, row.home, row.away),
      ...parseH2H(h2hHtml, row.home, row.away),
    };
  } catch (error) {
    diagnostico.errores.push(`detalle ${row.mid}: ${String(error).slice(0, 120)}`);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------
for (const day of days) {
  try {
    const rows = await fetchMobileDay(day);
    rowsByDay[day] = rows;
    diagnostico.movil[day] = { url: `${MOBILE_BASE}/?d=${day}`, filas: rows.length };
  } catch (error) {
    diagnostico.movil[day] = { error: String(error).slice(0, 200) };
    diagnostico.errores.push(`móvil día=${day}: ${String(error).slice(0, 160)}`);
  }
}

if (!cli.flags.has("no-desktop")) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const day of days) {
      try {
        const rows = await captureDesktopDay(browser, day);
        const byMid = new Map(rowsByDay[day].map((row) => [row.mid, row]));
        for (const row of rows) {
          if (!row.mid) continue;
          byMid.set(row.mid, mergeRows(byMid.get(row.mid), row));
        }
        // Filas vistas solo en escritorio (ej. el móvil no cargó una región).
        for (const row of rows) {
          if (row.mid && rowsByDay[day].some((base) => base.mid === row.mid)) continue;
          if (!rowsByDay[day].some((base) => base.home === row.home && base.away === row.away)) {
            rowsByDay[day].push(row);
          }
        }
        rowsByDay[day] = [...byMid.values()];
      } catch (error) {
        diagnostico.errores.push(`escritorio día=${day}: ${String(error).slice(0, 200)}`);
      }
    }
  } finally {
    await browser?.close();
  }
}

if (MAX_DETAILS > 0) {
  for (const day of days) {
    const candidates = rowsByDay[day]
      .filter((row) => row.mid)
      .sort((a, b) => (b.cuotas.local_1 ?? 0) - (a.cuotas.local_1 ?? 0))
      .slice(0, MAX_DETAILS);
    for (const row of candidates) {
      const enriched = await enrich(row, day);
      Object.assign(row, enriched);
    }
  }
}

const payloads = [];
for (const day of days) {
  const fecha = FECHA[day];
  const partidos = dedupeBySlug(
    rowsByDay[day]
      .filter((row) => row.home && row.away)
      .map((row) => ({
        match_slug: makeSlug(fecha, row.home, row.away),
        deporte: "Fútbol",
        liga: row.pais && row.liga ? `${row.pais}: ${row.liga}` : row.liga ?? null,
        fecha_local: fecha,
        hora_local: row.hora ?? null,
        estado: row.estado ?? "Programado",
        equipo_local: row.home,
        equipo_visitante: row.away,
        cuotas_1x2: {
          local_1: row.cuotas?.local_1 ?? null,
          empate_x: row.cuotas?.empate_x ?? null,
          visitante_2: row.cuotas?.visitante_2 ?? null,
        },
        estadisticas_complementarias: {
          posicion_local: row.posicion_local ?? null,
          posicion_visitante: row.posicion_visitante ?? null,
          racha_local_ultimos_5: row.racha_local_ultimos_5 ?? null,
          racha_visitante_ultimos_5: row.racha_visitante_ultimos_5 ?? null,
          h2h_resumen: row.h2h_resumen ?? null,
        },
        mid: row.mid ?? null,
        url: row.href ?? null,
      })),
  );

  const payload = {
    target_app: "BetStats Pro",
    source: "flashscore_agent",
    sync_mode: "enrich_or_create",
    fecha_extraccion: fecha,
    fecha_local: fecha,
    dia: day === 0 ? "hoy" : "manana",
    zona_horaria: "America/Caracas",
    capturado_en: timestampVET(),
    total_partidos: partidos.length,
    partidos,
  };
  payloads.push({ day, file: day === 0 ? OUT_HOY : OUT_MANANA, payload });
}

console.log("DIAGNOSTICO=" + JSON.stringify(diagnostico, null, 2));

for (const { day, file, payload } of payloads) {
  const conCuotas = payload.partidos.filter((partido) => partido.cuotas_1x2.local_1 !== null).length;
  if (DRY) {
    console.log(
      `DRY_RUN dia=${day} fecha=${payload.fecha_extraccion} partidos=${payload.total_partidos} con_cuotas=${conCuotas} destino=${file} (NO se escribió)`,
    );
    for (const partido of payload.partidos.slice(0, 8)) {
      console.log(
        `  ${partido.hora_local ?? "--:--"} ${partido.equipo_local} vs ${partido.equipo_visitante} | ${JSON.stringify(partido.cuotas_1x2)} | ${partido.match_slug}`,
      );
    }
    continue;
  }
  if (payload.total_partidos === 0) {
    console.error(`PAYLOAD_VACIO dia=${day}; no se sobreescribe ${file}`);
    continue;
  }
  await writeJson(file, payload);
  console.log(
    `PAYLOAD=${file} FECHA=${payload.fecha_extraccion} TOTAL=${payload.total_partidos} CON_CUOTAS=${conCuotas}`,
  );
}

if (DRY) console.log("NOTA: --dry-run no modifica ninguna semilla.");
