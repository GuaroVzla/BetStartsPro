#!/usr/bin/env node
/**
 * Purga registros con fecha fuera de la ventana radar (hoy y mañana en VET).
 *
 * Uso:
 *   node scripts/purge-out-of-window.mjs            # dry-run (no escribe)
 *   node scripts/purge-out-of-window.mjs --write    # reescribe los JSON
 *   node scripts/purge-out-of-window.mjs --file scripts/flashscore-payload.json --write
 *
 * Los archivos están versionados: git sirve de copia de seguridad.
 */
import fs from "node:fs";
import path from "node:path";

import {
  dateInVET,
  dateInVETOffset,
  isWithinMatchWindow,
  normalizeCommenceTime,
} from "../src/lib/format.ts";

const WRITE = process.argv.includes("--write");
const fileArg = process.argv.indexOf("--file");
const ARCHIVOS =
  fileArg >= 0
    ? [path.resolve(process.argv[fileArg + 1] ?? "")]
    : [
        "scripts/flashscore-payload.json",
        "scripts/flashscore-payload-manana.json",
        "scripts/triunfobet-quotes.json",
        "scripts/apuestas-royal-quotes.json",
      ].map((file) => path.resolve(file));

const ahora = new Date();
const ventana = `${dateInVET(ahora)} .. ${dateInVETOffset(1, ahora)}`;
console.log(`VENTANA_VET=${ventana} MODO=${WRITE ? "WRITE" : "DRY-RUN"}`);

for (const archivo of ARCHIVOS) {
  if (!fs.existsSync(archivo)) {
    console.log(`SKIP ${path.basename(archivo)}: no existe`);
    continue;
  }

  const contenido = fs.readFileSync(archivo, "utf8");
  const json = JSON.parse(contenido);
  const clave = Array.isArray(json.partidos)
    ? "partidos"
    : Array.isArray(json.cotizaciones)
      ? "cotizaciones"
      : null;
  if (!clave) {
    console.log(`SKIP ${path.basename(archivo)}: sin partidos/cotizaciones`);
    continue;
  }

  const validos = [];
  const purgados = [];
  const corregidos = [];

  for (const registro of json[clave]) {
    const texto = `${registro?.fecha_local ?? ""} ${registro?.hora_local ?? "12:00"}`.trim();
    const iso = normalizeCommenceTime(texto, ahora);
    if (!iso || !isWithinMatchWindow(iso, ahora)) {
      purgados.push({
        equipo_local: registro?.equipo_local,
        equipo_visitante: registro?.equipo_visitante,
        fecha_local: registro?.fecha_local,
      });
      continue;
    }

    // La fecha canónica es la fecha VET del instante normalizado (no la UTC).
    const fechaCanonica = dateInVET(iso);
    if (registro.fecha_local !== fechaCanonica) {
      corregidos.push({ antes: registro.fecha_local, despues: fechaCanonica });
      registro.fecha_local = fechaCanonica;
      if (/^\d{4}-\d{2}-\d{2}_/.test(registro.match_slug ?? "")) {
        registro.match_slug = `${fechaCanonica}_${registro.match_slug.slice(11)}`;
      }
    }
    validos.push(registro);
  }

  console.log(
    `${path.basename(archivo)}: total=${json[clave].length} validos=${validos.length} purgados=${purgados.length} corregidos=${corregidos.length}`,
  );
  for (const item of purgados.slice(0, 5)) console.log(`  PURGAR ${JSON.stringify(item)}`);
  for (const item of corregidos.slice(0, 5)) console.log(`  CORREGIR ${JSON.stringify(item)}`);

  if (WRITE && (purgados.length > 0 || corregidos.length > 0)) {
    json[clave] = validos;
    if ("total_partidos" in json) json.total_partidos = validos.length;
    if ("total_cotizaciones" in json) json.total_cotizaciones = validos.length;
    fs.writeFileSync(archivo, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`  ESCRITO ${archivo}`);
  }
}
