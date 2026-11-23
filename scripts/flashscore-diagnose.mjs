#!/usr/bin/env node
/**
 * Diagnóstico NO destructivo de Flashscore (escritorio + móvil).
 *
 * No escribe ninguna semilla. Sirve para detectar cambios de selectores,
 * bloqueos (Cloudflare / consentimiento) y URLs de XHR antes de cada captura.
 *
 * Uso:
 *   node scripts/flashscore-diagnose.mjs
 *   node scripts/flashscore-diagnose.mjs --url https://www.flashscore.com.ve/futbol/manana/
 *   node scripts/flashscore-diagnose.mjs --timeout 20000
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const URL_DIAG = flag("--url", "https://www.flashscore.com.ve/");
const TIMEOUT = Number(flag("--timeout", "25000"));
const MOBILE = flag("--mobile", "http://m.flashscore.com.ve/?d=0");
const ODDS = args.includes("--odds");
const FEED_BODY = args.includes("--feed-body");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 1) HTML móvil (server-rendered): no necesita navegador.
try {
  const response = await fetch(MOBILE, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "es-VE,es;q=0.9",
    },
    signal: AbortSignal.timeout(10000),
  });
  const html = await response.text();
  const mids = [...html.matchAll(/\/partido\/([A-Za-z0-9]+)\//g)].map((m) => m[1]);
  console.log(`MOBILE_STATUS=${response.status} MOBILE_BYTES=${html.length} MOBILE_MIDS=${new Set(mids).size}`);
  console.log(`MOBILE_HAS_SCORE_DATA=${html.includes('id="score-data"')}`);
} catch (error) {
  console.log(`MOBILE_ERROR=${String(error).slice(0, 200)}`);
}

// 2) Escritorio: render dinámico + XHR.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "es-VE",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
  userAgent: UA,
  extraHTTPHeaders: {
    "Accept-Language": "es-VE,es;q=0.9,en;q=0.6",
    Referer: "https://www.flashscore.com.ve/",
  },
});

const xhr = [];
const feedBodies = [];
page.on("response", async (response) => {
  const url = response.url();
  if (!/\/(feed|api)\/|odds|sport/i.test(url)) return;
  const type = response.headers()["content-type"] ?? "";
  if (/image|font|css|javascript|webp/i.test(type)) return;
  xhr.push({ status: response.status(), url: url.slice(0, 240), type: type.slice(0, 60) });
  if (FEED_BODY && /\/feed\/f[oi]_/.test(url)) {
    try {
      feedBodies.push({ url: url.slice(0, 160), body: (await response.text()).slice(0, 900) });
    } catch {}
  }
});

const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));

try {
  const response = await page.goto(URL_DIAG, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });
  console.log(`DESKTOP_STATUS=${response?.status() ?? "sin-respuesta"}`);
  const reject = page.getByText("Rechazarlas todas", { exact: false }).first();
  if (await reject.count()) await reject.click({ timeout: 3000 }).catch(() => {});
  await page
    .waitForSelector("#live-table .event__match, .event__match, [data-event-id]", { timeout: TIMEOUT })
    .catch(() => console.log("DESKTOP_WAIT=timeout (posible bloqueo o cambio de DOM)"));
  await page.waitForTimeout(2500);

  if (ODDS) {
    const tab = page.locator(".filters__text", { hasText: /^CUOTAS$/i }).first();
    if (await tab.count()) {
      await tab.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(5000);
      console.log(`ODDS_TAB_CLICKED=true`);
    } else {
      console.log(`ODDS_TAB_CLICKED=false (no se encontró .filters__text con CUOTAS)`);
    }
  }

  const dom = await page.evaluate(() => ({
    title: document.title,
    body: document.body.innerText.slice(0, 400),
    counts: Object.fromEntries(
      [
        "#live-table",
        ".event__match",
        ".event__time",
        ".event__homeParticipant",
        ".event__awayParticipant",
        ".event__odd--odd1",
        "a.eventRowLink",
        "[data-event-id]",
        ".filters__text",
        ".headerLeague__wrapper",
      ].map((selector) => [selector, document.querySelectorAll(selector).length]),
    ),
    sample:
      document.querySelector(".event__match, [data-event-id]")?.outerHTML.slice(0, 1800) ?? null,
    links: [...document.querySelectorAll('a[href*="/partido/"]')]
      .slice(0, 5)
      .map((a) => a.getAttribute("href")),
  }));
  console.log("DOM=" + JSON.stringify(dom, null, 2));
  console.log(`XHR_TOTAL=${xhr.length}`);
  console.log("XHR=" + JSON.stringify(xhr.slice(0, 25), null, 2));
  console.log(`PAGE_ERRORS=${errors.length}`, errors.slice(0, 5));
  if (FEED_BODY) console.log("FEED_BODIES=" + JSON.stringify(feedBodies, null, 2));
} catch (error) {
  console.log(`DESKTOP_ERROR=${String(error).slice(0, 400)}`);
} finally {
  await browser.close();
}
