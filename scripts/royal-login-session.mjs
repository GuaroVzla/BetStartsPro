#!/usr/bin/env node
/**
 * Asistente de sesión de Apuestas Royal.
 * Abre un Chrome visible para que el usuario complete el login/Turnstile una vez,
 * guarda el storageState resultante y lo deja listo como secret de GitHub.
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const PERFIL = ".royal-profile";
const STATE = ".royal-storage-state.json";
const URL = "https://www.apuestasroyal.com/index.php";

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
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1500);
await page.locator("#open-modal").first().click({ timeout: 5000 }).catch(() => {});
console.log(
  "ESPERANDO_LOGIN: en la ventana NUEVA que se abrió, complete el captcha y pulse ACCEDER (máx. 180 s).",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ok = false;
let detalle = "";
for (let i = 0; i < 90; i += 1) {
  await sleep(2000);
  try {
    const pages = context.pages();
    if (pages.length === 0) {
      page = await context.newPage();
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    } else {
      page = pages[pages.length - 1];
    }
    const cookies = await context.cookies();
    const session = cookies.find(
      (c) =>
        /apuestasroyal\.com/i.test(c.domain) &&
        /^(PHPSESSID|jwt|jwt_token|token)$/i.test(c.name) &&
        String(c.value).length > 10,
    );
    const url = page.url();
    const modal = await page.locator("#modal-acceso").isVisible().catch(() => false);
    const alerta = (await page.locator("#alertaMSG").innerText().catch(() => "")) || "";
    if (
      session ||
      /app\.apuestasroyal\.com/i.test(url) ||
      /lobby\.php/i.test(url) ||
      (!modal && /Bienvenido/i.test(alerta))
    ) {
      ok = true;
      detalle = session
        ? `cookie=${session.name}`
        : /app\.apuestasroyal\.com/i.test(url)
          ? "url=app.apuestasroyal.com"
          : /lobby\.php/i.test(url)
            ? "url=lobby.php"
            : "alerta=Bienvenido";
      break;
    }
    if (i % 10 === 0) {
      console.log(`ESPERANDO... url=${url} modal=${modal} cookies=${cookies.length}`);
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

const state = await context.storageState();
await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(`LOGIN_OK (${detalle}) STATE=${STATE} COOKIES=${state.cookies.length} ORIGINS=${state.origins.length}`);
console.log("SECRET_GITHUB=ROYAL_STORAGE_STATE (pega el contenido de .royal-storage-state.json)");
console.log("URL_FINAL=" + page.url());
await context.close();
