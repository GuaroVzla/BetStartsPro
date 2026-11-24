#!/usr/bin/env node
/**
 * Quita de las semillas los partidos/cotizaciones fuera de la ventana del
 * radar (hoy y mañana en hora de Venezuela) o con fechas inválidas.
 *
 * Uso:
 *   npm run clean:dates -- --dry-run              # sólo reporta (por defecto)
 *   npm run clean:dates -- --write                # reescribe los JSON
 *   node scripts/purge-out-of-window.mjs --ref=2026-11-25 --write
 *
 * Los artículos de The Analyst no se tocan: su fecha de publicación es
 * histórica por diseño y no indica la fecha del partido.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VET_OFFSET = "-04:00"; // Venezuela no observa horario de verano.
const VET_TIME_ZONE = "America/Caracas";

const TARGETS = [
  { file: "scripts/flashscore-payload.json", key: "partidos", total: "total_partidos" },
  { file: "scripts/flashscore-payload-manana.json", key: "partidos", total: "total_partidos" },
  { file: "scripts/triunfobet-quotes.json", key: "cotizaciones", total: "total_cotizaciones" },
  { file: "scripts/apuestas-royal-quotes.json", key: "cotizaciones", total: "total_cotizaciones" },
];

/** Fecha civil YYYY-MM-DD en hora de Venezuela. */
export function dateInVET(value = new Date()) {
  const instante = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instante.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** Valida una fecha civil sin depender del fuso horario del servidor. */
export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/** Día siguiente a una fecha civil, calculado en UTC para evitar DST. */
export function nextDate(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/**
 * Extrae la fecha del encuentro. El slug de Flashscore manda (viaja con la
 * captura de hoy y mañana en un mismo payload); luego fecha_local y, como
 * último respaldo, fecha_extraccion. Devuelve "" si no es válida.
 */
export function matchDate(record) {
  const candidates = [
    /^\d{4}-\d{2}-\d{2}(?=_)/.exec(String(record.match_slug ?? ""))?.[0],
    record.fecha_local,
    record.fecha_extraccion,
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (isValidDate(value)) return value;
  }
  return "";
}

/** Ventana operativa: el día de referencia y el siguiente. */
export function isWithinWindow(day, reference) {
  return (
    isValidDate(day) &&
    isValidDate(reference) &&
    (day === reference || day === nextDate(reference))
  );
}

function parseArgs(argv) {
  const options = { write: false, dryRun: false, reference: "", files: [] };
  for (const arg of argv) {
    if (arg === "--write") options.write = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--ref=") || arg.startsWith("--date=")) {
      options.reference = arg.slice(arg.indexOf("=") + 1);
    } else if (arg.startsWith("--file=")) {
      options.files.push(arg.slice(arg.indexOf("=") + 1));
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Uso: node scripts/purge-out-of-window.mjs [--dry-run|--write] [--ref=YYYY-MM-DD] [--file=ruta]",
      );
      process.exit(0);
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return options;
}

function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export async function purge(options = {}) {
  const reference = options.reference ? options.reference.trim() : dateInVET(new Date());
  if (!isValidDate(reference)) {
    throw new Error(`Fecha de referencia inválida: ${options.reference}`);
  }
  // Forzar el mediodía VET para que el día civil no dependa de la hora local.
  const referenceDate = new Date(`${reference}T12:00:00${VET_OFFSET}`);
  const effectiveReference = dateInVET(referenceDate);
  const tomorrow = nextDate(effectiveReference);

  const only = options.files?.length
    ? new Set(options.files.map((file) => path.resolve(ROOT, file)))
    : null;

  let removed = 0;
  let changedFiles = 0;

  for (const target of TARGETS) {
    const absolute = path.resolve(ROOT, target.file);
    if (only && !only.has(absolute)) continue;

    const original = await readFile(absolute, "utf8");
    const payload = JSON.parse(original);
    const records = payload[target.key];
    if (!Array.isArray(records)) {
      throw new Error(`${target.file}: falta el array ${target.key}`);
    }

    const kept = [];
    const discarded = [];
    for (const record of records) {
      const day = matchDate(record);
      if (isWithinWindow(day, effectiveReference)) {
        kept.push(record);
      } else {
        discarded.push(`${day || "fecha-inválida"} ${record.match_slug ?? ""}`.trim());
      }
    }

    if (discarded.length === 0) {
      console.log(`${target.file}: ${kept.length} registros en ventana, sin cambios`);
      continue;
    }

    changedFiles += 1;
    removed += discarded.length;
    console.log(`${target.file}: ${discarded.length} fuera de ventana (${effectiveReference}/${tomorrow})`);
    for (const item of discarded) console.log(`  - ${item}`);

    if (options.write) {
      payload[target.key] = kept;
      if (target.total in payload) payload[target.total] = kept.length;
      const eol = eolOf(original);
      const body = JSON.stringify(payload, null, 2).replace(/\n/g, eol);
      const trailing = original.endsWith("\n") ? eol : "";
      await writeFile(absolute, body + trailing, "utf8");
      console.log(`  escrito: ${kept.length} registros`);
    }
  }

  return { removed, changedFiles };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  // Por seguridad el modo por defecto es sólo lectura; `--write` aplica.
  const { removed, changedFiles } = await purge({
    ...options,
    write: options.write && !options.dryRun,
  });
  if (!options.write) {
    console.log("Modo de sólo lectura: usa --write para aplicar los cambios.");
  }
  console.log(`Resumen: ${removed} registros en ${changedFiles} archivos.`);
}
