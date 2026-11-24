#!/usr/bin/env node
/**
 * Ingesta de cotizaciones de Apuestas Royal.
 * Valida ventana VET, recalcula match_slug con el mismo slugify que la UI y
 * elimina duplicados antes de POST /api/ingest/apuestas-royal.
 *
 * Uso:
 *   node scripts/ingest-apuestas-royal.mjs --dry-run
 *   node scripts/ingest-apuestas-royal.mjs scripts/apuestas-royal-quotes.json
 */
import { readFile } from "node:fs/promises";
import {
  DATE_RE,
  TIME_RE,
  dateInVETOffset,
  dedupeBySlug,
  makeSlug,
  parseCliArgs,
  validatePayloadShape,
} from "./ingest-utils.mjs";

const cli = parseCliArgs();
const FILE = cli.positional.find((value) => !/^https?:\/\//i.test(value)) ??
  cli.values.file ??
  "scripts/apuestas-royal-quotes.json";
const URL_INGEST =
  cli.values.url ??
  cli.positional.find((value) => /^https?:\/\//i.test(value)) ??
  process.env.ROYAL_INGEST_URL ??
  "http://localhost:3000/api/ingest/apuestas-royal";

const today = dateInVETOffset(0);
const tomorrow = dateInVETOffset(1);
let payload;
try {
  payload = JSON.parse(await readFile(FILE, "utf8"));
} catch (error) {
  console.error(`JSON_INVALIDO ${FILE}: ${String(error).slice(0, 180)}`);
  process.exit(1);
}

const cotizaciones = (payload.cotizaciones ?? []).map((quote) => {
  const fechaLocal =
    (typeof quote.fecha_local === "string" && DATE_RE.test(quote.fecha_local) && quote.fecha_local) ||
    (typeof quote.match_slug === "string" && DATE_RE.test(quote.match_slug.slice(0, 10))
      ? quote.match_slug.slice(0, 10)
      : payload.fecha_extraccion);
  const horaLocal = TIME_RE.test(quote.hora_local ?? "") ? quote.hora_local : null;
  return {
    ...quote,
    fecha_local: fechaLocal,
    hora_local: horaLocal,
    match_slug: makeSlug(fechaLocal, quote.equipo_local, quote.equipo_visitante),
    capturado_en: quote.capturado_en ?? null,
  };
});

const current = cotizaciones.filter((quote) => [today, tomorrow].includes(quote.fecha_local));
const quoteSet = cli.flags.has("allow-stale") ? cotizaciones : current;
payload.cotizaciones = dedupeBySlug(quoteSet);
payload.total_cotizaciones = payload.cotizaciones.length;

const errors = validatePayloadShape(payload, "quotes");
if (payload.cotizaciones.length === 0) {
  errors.push(
    `sin cotizaciones vigentes: no hay fechas hoy (${today})/mañana (${tomorrow}); capture con scripts/bookmaker-capture.mjs --casa apuestas-royal --url <URL> o use --allow-stale`,
  );
}
if (errors.length) {
  console.error("INVALIDO:", errors.join(" | "));
  process.exit(1);
}

const conCuotas = payload.cotizaciones.filter((quote) => quote.cuotas_1x2?.local_1 > 1).length;
console.log(
  `VALIDO ${FILE} fecha=${payload.fecha_extraccion} cotizaciones=${payload.total_cotizaciones} con_cuotas=${conCuotas} vigentes=${current.length}/${cotizaciones.length}`,
);

if (cli.dryRun) {
  for (const quote of payload.cotizaciones.slice(0, 8)) {
    console.log(`  ${quote.match_slug} -> ${JSON.stringify(quote.cuotas_1x2)}`);
  }
  console.log(`DRY_RUN: NO se envió nada a ${URL_INGEST}`);
  process.exit(0);
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
  console.log("HTTP_STATUS:", response.status);
  console.log("RESPONSE:", text.slice(0, 1200));
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error("FETCH_ERROR:", String(error).slice(0, 200));
  process.exit(1);
}
