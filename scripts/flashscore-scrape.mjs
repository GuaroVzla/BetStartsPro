import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const OUT = process.argv[2] ?? "scripts/flashscore-payload.json";
const MAX_DETAILS = Number(process.argv[3] ?? 300);

function normalize(s) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function slug(date, home, away) {
  return `${date}_${normalize(home)}_vs_${normalize(away)}`;
}
function parseForm(codes) {
  return codes.map((c) => ({ G: "V", E: "E", P: "D", W: "V", D: "E", L: "D" })[c]).filter(Boolean);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "es-VE", timezoneId: "America/Caracas", viewport: { width: 1440, height: 1000 } });

await page.goto("https://www.flashscore.com.ve/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
const reject = page.getByText("Rechazarlas todas", { exact: false }).first();
if (await reject.count()) { try { await reject.click({ timeout: 3000 }); } catch {} }
await page.waitForTimeout(500);

const oddsTab = page.locator("div.filters__text", { hasText: /^Cuotas$/ }).first();
if (await oddsTab.count()) { await oddsTab.click(); await page.waitForTimeout(6000); }

const fechaExtraccion = await page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

const rows = await page.evaluate(() => {
  const out = [];
  let current = null;
  const container = document.querySelector("#live-table") ?? document;
  for (const node of container.querySelectorAll("*")) {
    if (node.classList?.contains("headerLeague__wrapper")) {
      const title = node.querySelector(".headerLeague__title-text")?.textContent?.trim() ?? "";
      const category = node.querySelector(".headerLeague__category-text")?.textContent?.trim() ?? "";
      const flag = node.querySelector(".headerLeague__flag")?.getAttribute("title")?.trim() ?? "";
      current = { league: title, country: category || flag };
      continue;
    }
    if (!node.classList?.contains("event__match") || node.querySelector(".event__match")) continue;
    const home = node.querySelector(".event__homeParticipant")?.innerText?.trim() ?? "";
    const away = node.querySelector(".event__awayParticipant")?.innerText?.trim() ?? "";
    if (!home || !away) continue;
    const timeEl = node.querySelector(".event__time");
    const odd = (cls) => {
      const el = node.querySelector(`.${cls}`);
      if (!el) return null;
      const m = (el.textContent ?? "").trim().match(/^\d+([.,]\d+)?$/);
      return m ? parseFloat(m[0].replace(",", ".")) : null;
    };
    const cls = node.className || "";
    const status = /event__match--live/.test(cls) ? "En Vivo" : /event__match--finished/.test(cls) ? "Finalizado" : "Programado";
    const href = node.querySelector("a.eventRowLink")?.getAttribute("href") ?? null;
    const mid = href?.match(/[?&]mid=([^&]+)/)?.[1] ?? null;
    out.push({
      league: current?.league ?? null,
      country: current?.country ?? null,
      hora: timeEl?.innerText?.trim() ?? null,
      estado: status,
      home, away, href, mid,
      cuotas: { local_1: odd("event__odd--odd1"), empate_x: odd("event__odd--odd2"), visitante_2: odd("event__odd--odd3") },
      esHoy: Boolean(timeEl),
    });
  }
  return out;
});

console.log(`FILAS_LISTADO=${rows.length}`);

const details = new Map();
let processed = 0;
for (const row of rows.filter((r) => r.href && r.esHoy).slice(0, MAX_DETAILS)) {
  try {
    await page.goto(row.href, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(900);
    const reject2 = page.getByText("Rechazarlas todas", { exact: false }).first();
    if (await reject2.count()) { try { await reject2.click({ timeout: 2000 }); } catch {} }
    // Capturar clasificación (posiciones): esperar a que la pestaña exista, hacer clic
    // y esperar a que la tabla se renderice antes de leerla.
    let standText = "";
    const standTab = page.getByText("Clasificación", { exact: true }).first();
    for (let i = 0; i < 12; i++) {
      if (await standTab.count()) break;
      await page.waitForTimeout(400);
    }
    if (await standTab.count()) {
      await standTab.click({ timeout: 2000 }).catch(() => {});
      for (let i = 0; i < 12; i++) {
        standText = await page.evaluate(() => document.body.innerText);
        if (standText.includes("#\nEQUIPO") || standText.includes("CLASIFICACIÓN\n#")) break;
        await page.waitForTimeout(400);
      }
    }

    const h2hTab = page.getByText("H2H", { exact: true }).first();
    if (await h2hTab.count()) await h2hTab.click({ timeout: 1500 }).catch(() => {});
    for (let i = 0; i < 5; i++) {
      const ready = await page.evaluate(() => document.body.innerText.includes("ENFRENTAMIENTOS"));
      if (ready) break;
      await page.waitForTimeout(400);
    }

    const detail = await page.evaluate(() => document.body.innerText);
    const dateMatch = detail.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const fechaDetalle = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    const h2hIdx = detail.lastIndexOf("ENFRENTAMIENTOS");
    let posLocal = null, posVisitante = null, rachaLocal = [], rachaVisitante = [], h2h = [];

    // Rachas: bloques "ÚLTIMOS PARTIDOS: <EQUIPO>" con resultados G/E/P
    const formSegments = [...detail.matchAll(/ÚLTIMOS PARTIDOS:\s*([^\n]+)/g)];
    const forms = formSegments.map((m, idx) => {
      const start = m.index + m[0].length;
      const next = formSegments[idx + 1]?.index ?? h2hIdx > start ? h2hIdx : detail.length;
      const lines = detail.slice(start, next).split("\n").map((l) => l.trim()).filter(Boolean);
      return parseForm(lines.filter((l) => /^[GEP]$/.test(l))).slice(0, 5);
    });
    rachaLocal = forms[0] ?? [];
    rachaVisitante = forms[1] ?? [];

    // Posiciones: desde la pestaña CLASIFICACIÓN (buscar el equipo en la tabla)
    const standIdx = Math.max(standText.indexOf("#\nEQUIPO"), standText.lastIndexOf("CLASIFICACIÓN\n#"));
    if (standIdx >= 0) {
      const table = standText.slice(standIdx).split("\n").map((l) => l.trim()).filter(Boolean);
      const findPos = (name) => {
        const target = normalize(name);
        for (let i = 1; i < table.length - 1; i++) {
          if (/^\d+\.$/.test(table[i]) && normalize(table[i + 1]) === target) return Number(table[i].replace(".", ""));
        }
        return null;
      };
      posLocal = findPos(row.home);
      posVisitante = findPos(row.away);
    }

    if (h2hIdx >= 0) {
      const lines = detail.slice(h2hIdx + "ENFRENTAMIENTOS".length).split("\n").map((l) => l.trim()).filter(Boolean);
      const block = [];
      for (let i = 0; i < lines.length - 5; i++) {
        if (/^\d{2}\.\d{2}\.\d{2}$/.test(lines[i]) && /^\d+$/.test(lines[i + 4]) && /^\d+$/.test(lines[i + 5])) {
          block.push(lines.slice(i, i + 6));
          i += 5;
        }
      }
      h2h = block.slice(0, 3);
    }

    if (row.mid) details.set(row.mid, { fechaDetalle, posLocal, posVisitante, rachaLocal, rachaVisitante, h2h });
    processed += 1;
  } catch (e) {
    console.log("DETAIL_ERROR:", row.home, "-", row.away, String(e).slice(0, 100));
  }
}

await browser.close();

const partidos = rows.filter((r) => r.esHoy).map((r) => {
  const d = r.mid ? details.get(r.mid) : null;
  const h2hResumen = d?.h2h?.length
    ? `Últimos ${d.h2h.length} H2H: ` + d.h2h.map((m) => `${m[2]} ${m[4]}-${m[5]} ${m[3]} (${m[1]})`).join("; ")
    : null;
  return {
    match_slug: slug(fechaExtraccion, r.home, r.away),
    deporte: "Fútbol",
    liga: r.country && r.league ? `${r.country}: ${r.league}` : (r.league ?? null),
    hora_local: r.hora,
    estado: r.estado,
    equipo_local: r.home,
    equipo_visitante: r.away,
    cuotas_1x2: r.cuotas,
    estadisticas_complementarias: {
      posicion_local: d?.posLocal ?? null,
      posicion_visitante: d?.posVisitante ?? null,
      racha_local_ultimos_5: d?.rachaLocal?.length ? d.rachaLocal : null,
      racha_visitante_ultimos_5: d?.rachaVisitante?.length ? d.rachaVisitante : null,
      h2h_resumen: h2hResumen,
    },
  };
}).filter((p) => p.equipo_local && p.equipo_visitante);

const payload = {
  target_app: "BetStats Pro",
  source: "flashscore_agent",
  sync_mode: "enrich_or_create",
  fecha_extraccion: fechaExtraccion,
  zona_horaria: "America/Caracas",
  total_partidos: partidos.length,
  partidos,
};

await writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`PAYLOAD=${OUT} TOTAL=${payload.total_partidos} DETAILS=${processed}`);
