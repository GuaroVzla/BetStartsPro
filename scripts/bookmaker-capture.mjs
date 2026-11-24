#!/usr/bin/env node
/**
 * Capturador de cuotas visibles de casas de apuestas (Altenar / widget propio).
 *
 * NUNCA inventa cuotas: solo lee lo que el navegador muestra (shadow DOM) y lo
 * que responses XHR exponen como diagnóstico. Sin sesión autenticada no hay
 * cotizaciones y el script termina en modo diagnóstico.
 *
 * Uso:
 *   node scripts/bookmaker-capture.mjs --casa triunfobet --dry-run
 *   node scripts/bookmaker-capture.mjs --casa triunfobet --profile C:/tmp/perfil --write
 *   node scripts/bookmaker-capture.mjs --casa apuestas-royal --url https://... --dry-run
 */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  DESKTOP_UA,
  dateInVETOffset,
  makeSlug,
  normalizeName,
  parseCliArgs,
  parseOdd,
  timestampVET,
} from "./ingest-utils.mjs";

const CASAS = {
  triunfobet: {
    source: "triunfobet_agent",
    url: "https://triunfobet.com/altenar",
    out: "scripts/triunfobet-quotes.json",
  },
  "apuestas-royal": {
    source: "apuestas_royal_agent",
    url: "https://app.apuestasroyal.com/",
    out: "scripts/apuestas-royal-quotes.json",
  },
};

const SELECTORES_USUARIO =
  'input[name="username"], input[name="login"], input[name="user"], input[name="email"], input[type="email"], #username, #user, #email, input[placeholder*="usuario" i]';
const SELECTORES_PASSWORD =
  'input[type="password"], input[name="password"], #password, #pass';
const SELECTORES_ENVIO =
  'button[type="submit"], input[type="submit"], #login-user, button:has-text("Iniciar sesión"), button:has-text("Iniciar Sesion"), button:has-text("Acceder"), button:has-text("Login")';

function listaSelectores(valor, fallback) {
  return String(valor || fallback)
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean);
}

function configuracionLogin(casa, urlCaptura) {
  if (casa === "triunfobet") {
    return {
      url: process.env.TRIUNFOBET_LOGIN_URL || "https://triunfobet.com/login",
      usuario: process.env.TB_USER ?? process.env.TRIUNFOBET_USER ?? "",
      password: process.env.TB_PASS ?? process.env.TRIUNFOBET_PASS ?? "",
      selectoresUsuario: listaSelectores(process.env.TB_USER_SELECTOR, SELECTORES_USUARIO),
      selectoresPassword: listaSelectores(process.env.TB_PASS_SELECTOR, SELECTORES_PASSWORD),
      selectoresEnvio: listaSelectores(process.env.TB_SUBMIT_SELECTOR, SELECTORES_ENVIO),
    };
  }
  return {
    url:
      process.env.APUESTAS_ROYAL_LOGIN_URL ||
      "https://www.apuestasroyal.com/index.php",
    usuario: process.env.APUESTAS_ROYAL_USER ?? "",
    password: process.env.APUESTAS_ROYAL_PASS ?? "",
    selectoresUsuario: listaSelectores(
      process.env.ROYAL_USER_SELECTOR,
      'input[name="Users"], #Users, input[type="email"], input[placeholder*="E-mail" i]',
    ),
    selectoresPassword: listaSelectores(
      process.env.ROYAL_PASS_SELECTOR,
      'input[name="Pass"], #Pass, input[type="password"]',
    ),
    selectoresEnvio: listaSelectores(
      process.env.ROYAL_SUBMIT_SELECTOR,
      '#entrar, button:has-text("ACCEDER"), button[type="submit"]',
    ),
    abrirModal: "#open-modal",
    esperarCaptcha: "#captcha",
    urlSesion: /app\.apuestasroyal\.com|lobby\.php/i,
  };
}

async function primerVisible(page, selectores) {
  for (const selector of selectores) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 1500 });
      return locator;
    } catch {
      // Probamos el siguiente selector.
    }
  }
  return null;
}

async function asegurarLogin(page, casa, urlCaptura) {
  const cfg = configuracionLogin(casa, urlCaptura);
  if (!cfg.usuario || !cfg.password) {
    console.log(
      "LOGIN_OMITIDO: sin credenciales en el entorno; se usa la sesión existente (--profile/--state) si la hay.",
    );
    return "sin-credenciales";
  }

  console.log(`LOGIN_INTENTO=${casa} URL=${cfg.url}`);
  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);

    if (cfg.abrirModal) {
      const abrir = page.locator(cfg.abrirModal).first();
      if (await abrir.count()) await abrir.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }

    const usuario = await primerVisible(page, cfg.selectoresUsuario);
    const password = await primerVisible(page, cfg.selectoresPassword);
    if (!usuario || !password) {
      console.log(
        "LOGIN_SELECTORES_NO_ENCONTRADOS: ajuste TB_USER_SELECTOR/TB_PASS_SELECTOR " +
          "(o ROYAL_USER_SELECTOR/ROYAL_PASS_SELECTOR) según el formulario real.",
      );
      return "fallido";
    }

    if (cfg.esperarCaptcha) {
      const conToken = await page
        .waitForFunction(
          (selector) => {
            const field = document.querySelector(selector);
            return Boolean(field && String(field.value ?? "").length > 20);
          },
          cfg.esperarCaptcha,
          { timeout: 20000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!conToken) {
        console.log(
          "CAPTCHA_TOKEN_NO_DISPONIBLE: Turnstile bloqueó el login automático. " +
            "Use una sesión exportada con ROYAL_STORAGE_STATE (npm run royal:login).",
        );
        return "fallido";
      }
    }

    await usuario.fill(cfg.usuario);
    await password.fill(cfg.password);
    const enviar = await primerVisible(page, cfg.selectoresEnvio);
    const enviar_login = async () => {
      if (enviar) await enviar.click({ timeout: 5000 }).catch(() => {});
      else await password.press("Enter").catch(() => {});
    };

    if (cfg.urlSesion) {
      await Promise.all([
        page.waitForURL(cfg.urlSesion, { timeout: 20000 }).catch(() => {}),
        enviar_login(),
      ]);
      await page.waitForTimeout(1500);
      const modalSigue = await page
        .locator("#modal-acceso")
        .isVisible()
        .catch(() => false);
      const logueado = cfg.urlSesion.test(page.url()) || !modalSigue;
      console.log(
        logueado
          ? "LOGIN_OK"
          : "LOGIN_FALLIDO: credenciales/CAPTCHA/2FA. NO se escribió ninguna semilla.",
      );
      return logueado ? "ok" : "fallido";
    }

    await enviar_login();
    await page.waitForTimeout(6000);
    const sigueFormulario = await primerVisible(page, cfg.selectoresPassword);
    console.log(
      sigueFormulario
        ? "LOGIN_FALLIDO: el formulario sigue visible (credenciales, CAPTCHA o 2FA). NO se escribió ninguna semilla."
        : "LOGIN_OK",
    );
    return sigueFormulario ? "fallido" : "ok";
  } catch (error) {
    console.log(`LOGIN_ERROR=${String(error).slice(0, 200)}`);
    return "fallido";
  }
}

async function obtenerTokenRoyal(page, storageState) {
  for (const origin of storageState?.origins ?? []) {
    const item = (origin.localStorage ?? []).find((entry) => entry.name === "auth");
    if (!item) continue;
    try {
      const token = JSON.parse(item.value)?.token;
      if (token) return token;
    } catch {}
  }
  try {
    return await page.evaluate(() => {
      const raw = localStorage.getItem("auth");
      if (!raw) return null;
      return JSON.parse(raw)?.token ?? null;
    });
  } catch {
    return null;
  }
}

async function capturarRoyalApi(page, storageState, indice, urlCaptura) {
  const token = await obtenerTokenRoyal(page, storageState);
  if (!token) {
    console.log(
      "TOKEN_ROYAL_NO_DISPONIBLE: exporte la sesión con `npm run royal:login` / `npm run royal:export`.",
    );
    return { cotizaciones: [], sinCruce: [] };
  }

  let data;
  try {
    const response = await fetch(
      "https://apuestasroyal.com/apiFunctions/lobby/sportWidget",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(25000),
      },
    );
    console.log(`API_ROYAL_HTTP=${response.status}`);
    if (!response.ok) return { cotizaciones: [], sinCruce: [] };
    data = await response.json();
  } catch (error) {
    console.log(`API_ROYAL_ERROR=${String(error).slice(0, 180)}`);
    return { cotizaciones: [], sinCruce: [] };
  }

  const eventos = data?.["Fútbol"]?.eventos ?? [];
  console.log(`API_ROYAL_EVENTOS=${eventos.length}`);

  const cotizaciones = [];
  const sinCruce = [];
  for (const event of eventos) {
    const local = event.competidor1 ?? null;
    const visitante = event.competidor2 ?? null;
    const fechaHora = String(event.fecha_hora ?? "");
    const matchFecha = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(fechaHora);
    const fecha = matchFecha?.[1] ?? dateInVETOffset(0);
    const hora = matchFecha?.[2] ?? null;
    const crudos = event.odd_1x2 ?? {};
    const odds = [crudos["1"], crudos["X"], crudos["2"]]
      .map(normalizeOdd)
      .filter((item) => item.decimal !== null);

    if (!local || !visitante || odds.length < 2) {
      sinCruce.push({ motivo: "sin-equipos-o-cuotas", text: event.evento ?? fechaHora });
      continue;
    }

    const found = indice.find(
      (partido) =>
        partido.fecha === fecha &&
        ((namesLikelyMatch(local, partido.home) && namesLikelyMatch(visitante, partido.away)) ||
          (namesLikelyMatch(local, partido.away) && namesLikelyMatch(visitante, partido.home))),
    );
    const swap = found
      ? namesLikelyMatch(local, found.away) && namesLikelyMatch(visitante, found.home)
      : false;
    const [uno, empate, dos] = odds;
    cotizaciones.push({
      match_slug: found?.match_slug ?? makeSlug(fecha, local, visitante),
      deporte: "Fútbol",
      liga: found?.liga ?? event.liga ?? null,
      fecha_local: fecha,
      hora_local: found?.hora ?? hora,
      equipo_local: swap ? found.away : found?.home ?? local,
      equipo_visitante: swap ? found.home : found?.away ?? visitante,
      mercado: "1X2",
      cuotas_1x2: {
        local_1: uno?.decimal ?? null,
        empate_x: empate?.decimal ?? null,
        visitante_2: dos?.decimal ?? null,
      },
      capturado_en: timestampVET(),
      url: urlCaptura,
      nota: "Cuota 1X2 publicada por la API autenticada del lobby de Apuestas Royal",
      _cruzado: Boolean(found),
    });
  }
  return { cotizaciones, sinCruce };
}

function namesLikelyMatch(first, second) {
  const a = normalizeName(first);
  const b = normalizeName(second);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  let common = 0;
  for (const token of aTokens) if (bTokens.has(token)) common += 1;
  return common / Math.min(aTokens.size, bTokens.size) >= 0.5;
}

function americanToDecimal(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]\d+$/.test(text)) return null;
  const number = Number(text);
  const decimal = number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number);
  return Math.round(decimal * 1000) / 1000;
}

/** Acepta decimales y americano; devuelve {decimal, americana|null}. */
function normalizeOdd(value) {
  const text = String(value ?? "").trim();
  if (/^[+-]\d+$/.test(text)) {
    const decimal = americanToDecimal(text);
    return decimal && decimal > 1 ? { decimal, americana: text } : { decimal: null, americana: null };
  }
  const decimal = parseOdd(text);
  return { decimal, americana: null };
}

async function loadFlashscoreIndex() {
  const index = [];
  for (const file of [
    "scripts/flashscore-payload.json",
    "scripts/flashscore-payload-manana.json",
  ]) {
    try {
      const payload = JSON.parse(await readFile(file, "utf8"));
      for (const match of payload.partidos ?? []) {
        index.push({
          file,
          fecha: match.fecha_local ?? payload.fecha_extraccion,
          hora: match.hora_local ?? null,
          home: match.equipo_local,
          away: match.equipo_visitante,
          liga: match.liga ?? null,
          match_slug: match.match_slug,
        });
      }
    } catch {}
  }
  return index;
}

const cli = parseCliArgs();
const casa = cli.values.casa ?? "triunfobet";
const config = CASAS[casa];
if (!config) {
  console.error(`CASA_INVALIDA: ${casa}. Use triunfobet o apuestas-royal`);
  process.exit(1);
}
const URL_CAPTURA =
  cli.values.url ?? process.env.BOOKMAKER_URL ?? config.url;
if (!URL_CAPTURA) {
  console.error(
    "URL_REQUERIDA: no publicamos un endpoint de Apuestas Royal sin verificar. " +
      "Pase --url https://<sitio-verificado> (o BOOKMAKER_URL) con sesión iniciada.",
  );
  process.exit(1);
}
const OUT = cli.values.out ?? config.out;
const WRITE = cli.flags.has("write") && !cli.dryRun;
const WAIT_MS = Number(cli.values.wait ?? 18000);
const FECHA_FORZADA = cli.values.fecha ?? dateInVETOffset(0);
const HEADLESS = !cli.flags.has("headed");

const estadoRaw =
  cli.values.state ??
  (casa === "triunfobet"
    ? process.env.TRIUNFOBET_STORAGE_STATE
    : process.env.ROYAL_STORAGE_STATE) ??
  "";
let storageState;
if (estadoRaw) {
  try {
    storageState = estadoRaw.trim().startsWith("{")
      ? JSON.parse(estadoRaw)
      : JSON.parse(await readFile(estadoRaw, "utf8"));
    console.log("SESION_REUTILIZADA=storageState");
  } catch (error) {
    console.error(`STORAGE_STATE_INVALIDO=${String(error).slice(0, 160)}`);
    process.exit(1);
  }
}

const contextOptions = {
  locale: "es-VE",
  timezoneId: "America/Caracas",
  viewport: { width: 1440, height: 1000 },
  userAgent: DESKTOP_UA,
};
let browser = null;
let context;
if (cli.values.profile) {
  context = await chromium.launchPersistentContext(cli.values.profile, {
    headless: HEADLESS,
    ...contextOptions,
  });
  browser = context.browser();
} else {
  browser = await chromium.launch({ headless: HEADLESS });
  context = await browser.newContext({
    ...contextOptions,
    ...(storageState ? { storageState } : {}),
  });
}

const page = await context.newPage();
const xhr = [];
page.on("response", (response) => {
  const url = response.url();
  if (!/api\/|sb2|feed|odd|event/i.test(url)) return;
  const type = response.headers()["content-type"] ?? "";
  if (/image|font|css|javascript|webp|google/i.test(type + url)) return;
  xhr.push({ status: response.status(), url: url.slice(0, 220), type: type.slice(0, 50) });
});

try {
  const estadoSesion = storageState
    ? "sesion"
    : await asegurarLogin(page, casa, URL_CAPTURA);

  const indice = await loadFlashscoreIndex();
  let cotizaciones = [];
  let sinCruce = [];

  if (casa === "apuestas-royal") {
    const api = await capturarRoyalApi(page, storageState, indice, URL_CAPTURA);
    cotizaciones = api.cotizaciones;
    sinCruce = api.sinCruce;
    console.log(`XHR_RELEVANTES=${xhr.length}`);
  } else {
  const response = await page.goto(URL_CAPTURA, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  console.log(`URL_STATUS=${response?.status() ?? "sin-respuesta"} URL=${URL_CAPTURA}`);
  await page.waitForTimeout(WAIT_MS);

  const entrar = page.getByText("APUESTAS DEPORTIVAS", { exact: true }).first();
  if (await entrar.count()) {
    await entrar.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(Math.min(WAIT_MS, 12000));
  }

  const raw = await page.evaluate(() => {
    const events = [];
    const seenRoots = new Set();
    const textOf = (element) =>
      (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();

    function walk(root) {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) {
          seenRoots.add(element.shadowRoot);
          walk(element.shadowRoot);
        }
        const className =
          typeof element.className === "string"
            ? element.className
            : element.getAttribute?.("class") ?? "";
        if (!/EventBoxRoot|EventBox|eventBox/i.test(className)) continue;
        if (element.dataset?.__captured) continue;
        element.dataset.__captured = "1";

        const oddValues = [
          ...element.querySelectorAll('[class*="OddValue"], [class*="oddValue"]'),
        ].map(textOf).filter(Boolean);
        const oddLabels = [
          ...element.querySelectorAll('[class*="OddLabel"], [class*="oddLabel"]'),
        ].map(textOf).filter(Boolean);
        const participants = [
          ...element.querySelectorAll(
            '[class*="Participant"], [class*="Team"], [class*="Competitor"], [class*="EventName"]',
          ),
        ]
          .map(textOf)
          .filter((text) => text.length > 1 && text.length < 80);
        events.push({
          text: textOf(element).slice(0, 600),
          participants: [...new Set(participants)].slice(0, 8),
          oddValues: oddValues.slice(0, 12),
          oddLabels: oddLabels.slice(0, 8),
        });
      }
    }
    walk(document);
    return { shadowRoots: seenRoots.size, events };
  });

  console.log(
    `DOM_SHADOW_ROOTS=${raw.shadowRoots} EVENT_BOXES=${raw.events.length} XHR_RELEVANTES=${xhr.length}`,
  );
  console.log("XHR=" + JSON.stringify(xhr.slice(0, 20), null, 2));

  for (const event of raw.events) {
    const participantes = event.participants.filter(
      (text) => !/^\d+([.,]\d+)?$/.test(text),
    );
    let local = participantes[0] ?? null;
    let visitante = participantes[1] ?? null;
    if (!local || !visitante) {
      const parts = event.text.split(/\s+-\s+/);
      if (parts.length >= 2) {
        local = local ?? parts[0].trim();
        visitante = visitante ?? parts[1].trim();
      }
    }
    const odds = event.oddValues.map(normalizeOdd).filter((item) => item.decimal !== null);
    if (!local || !visitante || odds.length < 2) {
      sinCruce.push({ motivo: "sin-equipos-o-cuotas", text: event.text.slice(0, 160) });
      continue;
    }
    const horaMatch = event.text.match(/\b([01]\d|2[0-3]):[0-5]\d\b/);
    const fechaMatch = event.text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
    const fecha = fechaMatch
      ? `${fechaMatch[3]}-${fechaMatch[2]}-${fechaMatch[1]}`
      : FECHA_FORZADA;

    const found = indice.find(
      (match) =>
        match.fecha === fecha &&
        ((namesLikelyMatch(local, match.home) && namesLikelyMatch(visitante, match.away)) ||
          (namesLikelyMatch(local, match.away) && namesLikelyMatch(visitante, match.home))),
    );
    let home = local;
    let away = visitante;
    let matchSlug = makeSlug(fecha, local, visitante);
    let horaLocal = horaMatch ? horaMatch[0] : null;
    let liga = null;
    if (found) {
      const swap = namesLikelyMatch(local, found.away) && namesLikelyMatch(visitante, found.home);
      home = swap ? found.away : found.home;
      away = swap ? found.home : found.away;
      matchSlug = found.match_slug;
      horaLocal = found.hora ?? horaLocal;
      liga = found.liga;
    }

    const [uno, empate, dos] = odds;
    cotizaciones.push({
      match_slug: matchSlug,
      deporte: "Fútbol",
      liga,
      fecha_local: fecha,
      hora_local: horaLocal,
      equipo_local: home,
      equipo_visitante: away,
      mercado: "1X2",
      cuotas_1x2: {
        local_1: uno?.decimal ?? null,
        empate_x: empate?.decimal ?? null,
        visitante_2: dos?.decimal ?? null,
      },
      capturado_en: timestampVET(),
      url: URL_CAPTURA,
      nota: "Cuota visible en el widget con sesión; convertida a decimal si venía en formato americano",
      ...(odds.some((item) => item.americana)
        ? {
            cuotas_americanas: {
              local_1: uno?.americana ?? null,
              empate_x: empate?.americana ?? null,
              visitante_2: dos?.americana ?? null,
            },
          }
        : {}),
      _cruzado: Boolean(found),
    });
  }
  }

  if (sinCruce.length) {
    console.log("EVENTOS_OMITIDOS=" + JSON.stringify(sinCruce.slice(0, 5), null, 2));
  }
  console.log(`COTIZACIONES_DETECTADAS=${cotizaciones.length}`);
  for (const quote of cotizaciones.slice(0, 10)) {
    console.log(
      `  ${quote.match_slug} | ${JSON.stringify(quote.cuotas_1x2)} | cruzado=${quote._cruzado}`,
    );
  }

  if (estadoSesion === "fallido") {
    console.log("NO_SE_ESCRIBE_SEMILLA: el inicio de sesión falló.");
  } else if (cotizaciones.length === 0) {
    console.log(
      "SIN_COTIZACIONES: confirme que hay sesión iniciada y que el widget cargó eventos. " +
        "Revise XHR_RELEVANTES y ejecute con --headed para inspeccionar. NO se escribió ninguna semilla.",
    );
  } else if (WRITE) {
    const payload = {
      target_app: "BetStats Pro",
      source: config.source,
      sync_mode: "enrich_or_create",
      fecha_extraccion: dateInVETOffset(0),
      zona_horaria: "America/Caracas",
      total_cotizaciones: cotizaciones.length,
      cotizaciones: cotizaciones.map(({ _cruzado, ...quote }) => quote),
    };
    await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`PAYLOAD=${OUT} TOTAL=${payload.total_cotizaciones}`);
  } else {
    console.log(
      `DRY_RUN: NO se escribió ${OUT}. Use --write para guardar después de revisar las cuotas.`,
    );
  }
} finally {
  await context.close();
  if (browser?.isConnected()) await browser.close();
}
