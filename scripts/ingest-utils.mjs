#!/usr/bin/env node
/**
 * Utilidades compartidas por los scripts de ingesta (solo scripts/).
 * Replican deliberadamente normalizeName/slugify de src/lib/utils.ts y
 * dateInVETOffset de src/lib/format.ts para que las llaves crucen con la UI.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const VET_TIME_ZONE = "America/Caracas";
export const TARGET_APP = "BetStats Pro";
export const SLUG_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+_vs_[a-z0-9-]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function vetParts(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: VET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(value).map((p) => [p.type, p.value]));
}

/** YYYY-MM-DD en hora de Venezuela para un instante dado. */
export function dateInVET(value = new Date()) {
  const p = vetParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

/** YYYY-MM-DD en VET para hoy (0) / maA�ana (1), sin usar UTC como proxy. */
export function dateInVETOffset(days = 0, base = new Date()) {
  return dateInVET(new Date(base.getTime() + days * 86_400_000));
}

/** ISO con offset real de Venezuela (-04:00, sin DST). */
export function timestampVET(base = new Date()) {
  const p = vetParts(base);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-04:00`;
}

/** Igual a normalizeName() en src/lib/utils.ts. */
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(fc|cf|sc|afc|club|de|del|the|real|sporting|atletico|athletic|city|united|utd|town|county|ac|bc|basket|basketball|hockey|baseball)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Igual a slugify() en src/lib/utils.ts, con fallback seguro para la API. */
export function slugify(value) {
  return normalizeName(value).replace(/\s+/g, "-") || "equipo";
}

export function makeSlug(date, home, away) {
  return `${date}_${slugify(home)}_vs_${slugify(away)}`;
}

/** Acepta "2,35", "2.35", 2.35; rechaza <= 1 y valores no finitos. */
export function parseOdd(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(number) && number > 1 ? number : null;
}

export function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decodifica entidades HTML mA-nimas presentes en el HTML del sitio mA3vil. */
export function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&aacute;/g, "A�")
    .replace(/&eacute;/g, "Ac")
    .replace(/&iacute;/g, "A-")
    .replace(/&oacute;/g, "A3")
    .replace(/&uacute;/g, "A�")
    .replace(/&ntilde;/g, "A�");
}

/** merged = A�ltimo gana, pero conserva cuotas/estadA-sticas no nulas del anterior. */
export function dedupeBySlug(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.match_slug) continue;
    const previous = map.get(item.match_slug);
    if (!previous) {
      map.set(item.match_slug, item);
      continue;
    }
    map.set(item.match_slug, {
      ...previous,
      ...item,
      cuotas_1x2: { ...previous.cuotas_1x2, ...cleanNulls(item.cuotas_1x2) },
      estadisticas_complementarias: {
        ...previous.estadisticas_complementarias,
        ...cleanNulls(item.estadisticas_complementarias),
      },
    });
  }
  return [...map.values()];
}

function cleanNulls(object) {
  return Object.fromEntries(
    Object.entries(object ?? {}).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function isCurrentDate(date, today = dateInVETOffset(0), tomorrow = dateInVETOffset(1)) {
  return date === today || date === tomorrow;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const values = {};
  const positional = [];
  const booleanFlags = new Set(["dry-run", "diagnostico", "allow-stale", "write", "ingest", "help"]);
  const valueFlags = new Set(["file", "url", "out", "report", "site", "kind", "wait"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) {
      if (booleanFlags.has(name)) flags.add(name);
      else values[name] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (!booleanFlags.has(name) && next !== undefined && !next.startsWith("--")) {
      values[name] = next;
      index += 1;
    } else {
      flags.add(name);
    }
  }
  return { flags, values, positional, dryRun: flags.has("dry-run") || flags.has("diagnostico") };
}

export async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function validatePayloadShape(payload, kind) {
  const errors = [];
  if (payload?.target_app !== TARGET_APP) errors.push("target_app debe ser 'BetStats Pro'");
  if (!DATE_RE.test(payload?.fecha_extraccion ?? "")) errors.push("fecha_extraccion invA�lida");
  const key = kind === "flashscore" ? "partidos" : kind === "quotes" ? "cotizaciones" : kind === "analyst" ? "registros" : "matches";
  const items = payload?.[key];
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(`${key} debe ser un arreglo no vacA-o`);
    return errors;
  }
  items.forEach((item, index) => {
    const home = item?.equipo_local ?? item?.home?.name ?? item?.home;
    const away = item?.equipo_visitante ?? item?.away?.name ?? item?.away;
    if (!String(home ?? "").trim() || !String(away ?? "").trim()) {
      errors.push(`${key}[${index}]: equipos vacA-os`);
    }
    if (item?.match_slug && !SLUG_RE.test(item.match_slug)) {
      errors.push(`${key}[${index}]: match_slug invA�lido "${item.match_slug}"`);
    }
  });
  const slugs = items.map((item) => item.match_slug ?? item.match_key).filter(Boolean);
  if (slugs.length !== new Set(slugs).size) errors.push("hay match_slug/match_key duplicados");
  return errors;
}

// Solo idioma/referer: forzar `Accept` rompe los feeds XHR del sitio.
export const BROWSER_HEADERS = {
  "Accept-Language": "es-VE,es;q=0.9,en;q=0.6",
  Referer: "https://www.flashscore.com.ve/",
};

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
