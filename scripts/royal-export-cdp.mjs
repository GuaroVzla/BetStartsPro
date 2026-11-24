#!/usr/bin/env node
/**
 * Exporta la sesión de un Chrome ya iniciado con --remote-debugging-port=9222.
 * No pide credenciales: reutiliza el login que el usuario hizo en ese Chrome.
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const STATE = ".royal-storage-state.json";
const CDP = process.env.ROYAL_CDP_URL || "http://127.0.0.1:9222";

const browser = await chromium.connectOverCDP(CDP);
const contexts = browser.contexts();
if (contexts.length === 0) throw new Error("No hay contextos de navegador en CDP");

let context = contexts[0];
let pagina = null;
for (const ctx of contexts) {
  for (const page of ctx.pages()) {
    if (/apuestasroyal\.com/i.test(page.url())) {
      context = ctx;
      pagina = page;
      break;
    }
  }
  if (pagina) break;
}

const stateCompleto = await context.storageState();

// connectOverCDP no siempre incluye localStorage en storageState(): lo agregamos
// explícitamente porque la app de Royal guarda ahí el token de autenticación.
const origins = [];
const LOCAL_KEYS = new Set([
  "auth",
  "operation",
  "geo.countryCode",
  "location_confirmation_accepted",
  "settings",
  "pageViewCookie",
]);
for (const page of context.pages()) {
  try {
    const origin = new URL(page.url()).origin;
    if (!/apuestasroyal\.com/i.test(origin)) continue;
    const localStorage = await page.evaluate((keys) =>
      Object.entries(localStorage)
        .filter(([name]) => keys.includes(name))
        .map(([name, value]) => ({ name, value })), [...LOCAL_KEYS]);
    if (localStorage.length === 0) continue;
    const existente = origins.find((entry) => entry.origin === origin);
    if (existente) existente.localStorage = localStorage;
    else origins.push({ origin, localStorage });
  } catch {}
}

const state = {
  cookies: stateCompleto.cookies.filter((cookie) => /apuestasroyal\.com/i.test(cookie.domain)),
  origins,
};

const conSesion = state.cookies.some(
  (c) =>
    /apuestasroyal\.com/i.test(c.domain) &&
    /PHPSESSID|jwt|token/i.test(c.name) &&
    String(c.value).length > 10,
);
const conAuthLocal = origins.some((entry) =>
  (entry.localStorage ?? []).some((item) => item.name === "auth" && String(item.value).includes("fullName")),
);
if (!conSesion && !conAuthLocal) {
  console.log("SIN_SESION: no se encontró sesión en el Chrome conectado.");
  console.log("COOKIES=" + JSON.stringify(state.cookies.map((c) => c.name)));
  await browser.close();
  process.exit(1);
}

await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(`EXPORT_OK STATE=${STATE} URL=${pagina?.url() ?? "n/d"} COOKIES=${state.cookies.length}`);
console.log("Copia el contenido de .royal-storage-state.json al secret ROYAL_STORAGE_STATE de GitHub.");
await browser.close();
