#!/usr/bin/env node
/**
 * Ingesta de payloads de Flashscore en http://localhost:3000/api/ingest.
 *
 * Por defecto carga HOY y MAÑANA (ambos archivos si existen). El adaptador usa
 * `fecha_extraccion` global como fecha del partido, por eso se requieren dos
 * payloads separados.
 *
 * Uso:
 *   node scripts/ingest-payload.mjs --dry-run
 *   node scripts/ingest-payload.mjs
 *   node scripts/ingest-payload.mjs scripts/flashscore-payload.json --url http://localhost:3000/api/ingest
 */
import { readFile } from "node:fs/promises";
import {
  dateInVETOffset,
  dedupeBySlug,
  parseCliArgs,
  validatePayloadShape,
} from "./ingest-utils.mjs";

const cli = parseCliArgs();
const DEFAULT_FILES = [
  "scripts/flashscore-payload.json",
  "scripts/flashscore-payload-manana.json",
];
const urlFromArgs = cli.positional.find((value) => /^https?:\/\//i.test(value));
const URL_INGEST =
  cli.values.url ??
  urlFromArgs ??
  process.env.INGEST_URL ??
  "http://localhost:3000/api/ingest";
let files = cli.positional.filter(
  (value) => !/^https?:\/\//i.test(value) && !value.startsWith("--"),
);
if (files.length === 0) files = DEFAULT_FILES;
if (cli.values.file) files.push(cli.values.file);

const today = dateInVETOffset(0);
const tomorrow = dateInVETOffset(1);
let failed = false;

for (const file of files) {
  let payload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`JSON_INVALIDO ${file}: ${String(error).slice(0, 180)}`);
    failed = true;
    continue;
  }

  payload.partidos = dedupeBySlug(payload.partidos ?? []);
  payload.total_partidos = payload.partidos.length;
  const errors = validatePayloadShape(payload, "flashscore");

  if (!cli.flags.has("allow-stale") && ![today, tomorrow].includes(payload.fecha_extraccion)) {
    errors.push(
      `fecha_extraccion=${payload.fecha_extraccion} no es hoy (${today}) ni mañana (${tomorrow}); use --allow-stale solo para datos históricos`,
    );
  }

  if (errors.length) {
    console.error(`INVALIDO ${file}: ${errors.join(" | ")}`);
    failed = true;
    continue;
  }

  const conCuotas = payload.partidos.filter((partido) => partido.cuotas_1x2?.local_1 > 1).length;
  console.log(
    `VALIDO ${file} fecha=${payload.fecha_extraccion} partidos=${payload.total_partidos} con_cuotas=${conCuotas}`,
  );

  if (cli.dryRun) {
    for (const partido of payload.partidos.slice(0, 5)) {
      console.log(`  ${partido.hora_local ?? "--:--"} ${partido.match_slug}`);
    }
    console.log(`DRY_RUN ${file}: NO se envió nada a ${URL_INGEST}`);
    continue;
  }

  try {
    const response = await fetch(URL_INGEST, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INGEST_TOKEN
          ? { Authorization: `Bearer ${process.env.INGEST_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    console.log(`HTTP_STATUS ${file}: ${response.status}`);
    console.log(`RESPONSE ${file}: ${text.slice(0, 800)}`);
    if (!response.ok) failed = true;
  } catch (error) {
    console.error(`FETCH_ERROR ${file}: ${String(error).slice(0, 200)}`);
    failed = true;
  }
}

if (cli.dryRun) console.log("NOTA: --dry-run no modifica los stores ni las semillas.");
process.exit(failed ? 1 : 0);
