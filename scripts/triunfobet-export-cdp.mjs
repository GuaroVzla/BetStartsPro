#!/usr/bin/env node
/**
 * Exporta la sesión REAL de un Chrome ya iniciado con --remote-debugging-port=9222.
 * No pide credenciales: reutiliza el login y el cf_clearance del perfil abierto.
 *
 * Uso típico:
 *   node scripts/triunfobet-export-cdp.mjs
 *   gh secret set TRIUNFOBET_STORAGE_STATE < <archivo exportado>
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const CDP = process.env.TRIUNFOBET_CDP_URL || "http://127.0.0.1:9222";
const OUT = process.env.TRIUNFOBET_STATE_OUT || join(tmpdir(), "triunfobet-storage-state.json");
const URL_CAPTURA = process.env.BOOKMAKER_URL || "https://triunfobet.com/altenar";

const browser = await chromium.connectOverCDP(CDP);
const contexts = browser.contexts();
if (contexts.length === 0) throw new Error("No hay contextos de navegador en CDP");

let context = contexts[0];
let pagina = context.pages().find((page) => /triunfobet\.com/i.test(page.url()));
if (!pagina) {
  pagina = await context.newPage();
  await pagina.goto(URL_CAPTURA, { waitUntil: "domcontentloaded", timeout: 60000 });
} else {
  await pagina.bringToFront();
}
await pagina.waitForTimeout(5000);

const completo = await context.storageState();
const cookies = completo.cookies.filter((cookie) => /triunfobet\.com/i.test(cookie.domain));

// connectOverCDP no siempre incluye localStorage en storageState().
const origins = [];
try {
  const origin = new URL(pagina.url()).origin;
  if (/triunfobet\.com/i.test(origin)) {
    const localStorage = await pagina.evaluate(() =>
      Object.entries(localStorage)
        .slice(0, 40)
        .map(([name, value]) => ({ name, value: String(value).slice(0, 4096) })),
    );
    if (localStorage.length > 0) origins.push({ origin, localStorage });
  }
} catch {}

const conSesion = cookies.some(
  (cookie) => /whitelabels_session/i.test(cookie.name) && String(cookie.value).length > 10,
);
const conClearance = cookies.some((cookie) => /cf_clearance/i.test(cookie.name));
if (!conSesion) {
  console.log("SIN_SESION: el Chrome conectado no tiene whitelabels_session de Triunfobet.");
  console.log("COOKIES=" + JSON.stringify(cookies.map((cookie) => cookie.name)));
  await browser.close();
  process.exit(1);
}

await writeFile(OUT, `${JSON.stringify({ cookies, origins }, null, 2)}\n`, "utf8");
console.log(
  `EXPORT_OK STATE=${OUT} URL=${pagina.url()} COOKIES=${cookies.length} ` +
    `WHITELABELS_SESSION=1 CF_CLEARANCE=${conClearance ? 1 : 0}`,
);
await browser.close();
