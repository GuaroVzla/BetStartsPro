#!/usr/bin/env node
/**
 * Asistente de sesión de Triunfobet (widget Altenar).
 * Abre un navegador visible para que el usuario complete el login/Turnstile una
 * vez, guarda el storageState resultante y lo deja listo como secret de GitHub.
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const PERFIL = ".triunfobet-profile";
const STATE = ".triunfobet-storage-state.json";
const LOGIN_URL = "https://triunfobet.com/login";
const WIDGET_URL = "https://triunfobet.com/altenar";

let context;
try {
  context = await chromium.launchPersistentContext(PERFIL, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
    locale: "es-VE",
    timezoneId: "America/Caracas",
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  console.log("BROWSER=chrome-persistente");
} catch {
  context = await chromium.launchPersistentContext(PERFIL, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    locale: "es-VE",
    timezoneId: "America/Caracas",
    viewport: { width: 1440, height: 1000 },
  });
  console.log("BROWSER=chromium-persistente");
}

await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

let page = context.pages()[0] ?? (await context.newPage());
await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
console.log(
  "ESPERANDO_LOGIN: complete el login y el CAPTCHA en la ventana abierta (máx. 180 s).",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ok = false;
let detalle = "";
for (let i = 0; i < 90; i += 1) {
  await sleep(2000);
  try {
    const pages = context.pages();
    page = pages.length ? pages[pages.length - 1] : await context.newPage();
    const url = page.url();
    const cookies = await context.cookies();
    const session = cookies.find(
      (c) =>
        /triunfobet\.com/i.test(c.domain) &&
        /^(session|sessionid|token|jwt|jwt_token|auth|phpSESSID)$/i.test(c.name) &&
        String(c.value).length > 8,
    );
    const loginVisible = await page.locator('input[name="login"]').isVisible().catch(() => false);
    if (session || (!loginVisible && !/\/login/i.test(url))) {
      ok = true;
      detalle = session ? `cookie=${session.name}` : `url=${url}`;
      break;
    }
    if (i % 10 === 0) {
      console.log(`ESPERANDO... url=${url} loginVisible=${loginVisible} cookies=${cookies.length}`);
    }
  } catch (error) {
    console.log(`POLL_ERROR=${String(error).slice(0, 120)}`);
  }
}

if (!ok) {
  console.log("LOGIN_TIMEOUT: no se detectó sesión iniciada. No se guardó storageState.");
  await context.close();
  process.exit(1);
}

await page.goto(WIDGET_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(8000);
const state = await context.storageState();
await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(`LOGIN_OK (${detalle}) STATE=${STATE} COOKIES=${state.cookies.length} ORIGINS=${state.origins.length}`);
console.log("SECRET_GITHUB=TRIUNFOBET_STORAGE_STATE (pega el contenido de .triunfobet-storage-state.json)");
console.log("URL_FINAL=" + page.url());
await context.close();
