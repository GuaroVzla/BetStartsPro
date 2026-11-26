#!/usr/bin/env node
/**
 * Valida payloads de ingesta BetStats Pro.
 * Uso:
 *   node scripts/validate-ingest-payload.mjs scripts/flashscore-payload.json
 *   node scripts/validate-ingest-payload.mjs --kind quotes scripts/apuestas-royal-quotes.json --allow-stale
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DATE_RE,
  dateInVETOffset,
  dedupeBySlug,
  parseCliArgs,
  validatePayloadShape,
} from "./ingest-utils.mjs";

const cli = parseCliArgs();
const files = cli.positional.filter((v) => !/^https?:\/\//i.test(v) && !v.startsWith("--") && v !== cli.values.kind);
if (files.length === 0) {
  console.error("Uso: node scripts/validate-ingest-payload.mjs [--kind flashscore|quotes|analyst|auto] <archivo...>");
  process.exit(2);
}

const today = dateInVETOffset(0);
const tomorrow = dateInVETOffset(1);
const allowedDates = new Set([today, tomorrow]);
let failed = false;

function detectKind(payload, explicit) {
  if (explicit && explicit !== "auto") return explicit;
  if (Array.isArray(payload?.partidos)) return "flashscore";
  if (Array.isArray(payload?.cotizaciones)) return "quotes";
  if (Array.isArray(payload?.registros)) return "analyst";
  if (Array.isArray(payload?.matches)) return "curated";
  return "unknown";
}

function checkOdds(obj, pathLabel, errors, warnings) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 1) {
      errors.push(`${pathLabel}.${k} debe ser número > 1 o null`);
    } else if (v > 200) {
      warnings.push(`${pathLabel}.${k} inusualmente alto (${v})`);
    }
  }
}

for (const file of files) {
  let payload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`INVALIDO ${file}: JSON inválido (${String(error).slice(0, 120)})`);
    failed = true;
    continue;
  }

  const kind = detectKind(payload, cli.values.kind);
  const errors = [];
  const warnings = [];
  if (payload?.target_app !== "BetStats Pro") errors.push("target_app debe ser 'BetStats Pro'");
  if (!DATE_RE.test(payload?.fecha_extraccion ?? "")) errors.push("fecha_extraccion debe ser YYYY-MM-DD");
  if (kind === "unknown") errors.push("no se pudo detectar kind (partidos/cotizaciones/registros/matches)");

  const shapeKind = kind === "flashscore" ? "flashscore" : kind === "quotes" ? "quotes" : kind;
  if (kind === "flashscore" || kind === "quotes") {
    errors.push(...validatePayloadShape(payload, shapeKind));
  }

  if (kind === "flashscore") {
    const items = Array.isArray(payload.partidos) ? payload.partidos : [];
    const slugs = items.map((i) => i?.match_slug).filter(Boolean);
    const deduped = dedupeBySlug(items);
    if (deduped.length !== items.length) warnings.push(`duplicados por slug: ${items.length - deduped.length}`);
    if (new Set(slugs).size !== slugs.length) errors.push("match_slug duplicados");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const date = String(it?.match_slug ?? "").slice(0, 10);
      if (DATE_RE.test(date) && !allowedDates.has(date) && !cli.flags.has("allow-stale")) {
        errors.push(`partidos[${i}] fuera de ventana VET hoy/mañana: ${date}`);
      }
      checkOdds(it?.cuotas_1x2, `partidos[${i}].cuotas_1x2`, errors, warnings);
      const withOdds = ["local_1", "empate_x", "visitante_2"].filter((k) => Number(it?.cuotas_1x2?.[k]) > 1).length;
      if (withOdds === 0) warnings.push(`partidos[${i}] sin cuotas 1X2`);
    }
  }

  if (kind === "quotes") {
    const items = Array.isArray(payload.cotizaciones) ? payload.cotizaciones : [];
    const deduped = dedupeBySlug(items);
    if (deduped.length !== items.length) warnings.push(`duplicados por slug: ${items.length - deduped.length}`);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const date = it?.fecha_local ?? String(it?.match_slug ?? "").slice(0, 10);
      if (DATE_RE.test(date) && !allowedDates.has(date) && !cli.flags.has("allow-stale")) {
        errors.push(`cotizaciones[${i}] fuera de ventana VET hoy/mañana: ${date}`);
      }
      checkOdds(it?.cuotas_1x2, `cotizaciones[${i}].cuotas_1x2`, errors, warnings);
    }
  }

  if (kind === "analyst") {
    const items = Array.isArray(payload.registros) ? payload.registros : [];
    if (items.length === 0) errors.push("registros no puede estar vacío");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it?.articulo_id || !it?.titulo || !it?.url) errors.push(`registros[${i}] requiere articulo_id, titulo, url`);
      const probs = it?.insight?.probabilidades;
      if (probs) {
        for (const k of ["home", "draw", "away"]) {
          const v = probs[k];
          if (v === null || v === undefined) continue;
          if (typeof v !== "number" || v < 0 || v > 1) errors.push(`registros[${i}].insight.probabilidades.${k} fuera de 0..1`);
        }
      }
    }
  }

  if (kind === "curated") {
    const items = Array.isArray(payload.matches) ? payload.matches : [];
    if (items.length === 0) errors.push("matches no puede estar vacío");
  }

  const status = errors.length ? "INVALIDO" : "VALIDO";
  const rel = path.relative(process.cwd(), file) || file;
  console.log(`${status} ${rel} kind=${kind} errors=${errors.length} warnings=${warnings.length}`);
  for (const w of warnings.slice(0, 20)) console.warn(`  WARN: ${w}`);
  for (const e of errors.slice(0, 40)) console.error(`  ERROR: ${e}`);
  if (errors.length) failed = true;
}

process.exit(failed ? 1 : 0);
