import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ingestAuthError } from "@/lib/ingestAuth";
import { dateInVETOffset } from "@/lib/format";
import { upsertCuratedMatches, type CuratedPayload } from "@/services/curatedIngestStore";

export const runtime = "nodejs";

type Json = Record<string, unknown>;
function isRecord(v: unknown): v is Json { return typeof v === "object" && v !== null && !Array.isArray(v); }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validate(payload: unknown): { ok: boolean; errors: string[]; warnings: string[]; normalized?: any } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(payload)) return { ok: false, errors: ["Body debe ser objeto JSON"], warnings };
  if (payload.target_app !== "BetStats Pro") errors.push("target_app debe ser 'BetStats Pro'");
  if (payload.source !== "etl_curated") errors.push("source debe ser 'etl_curated'");
  if (typeof payload.fecha_extraccion !== "string" || !DATE_RE.test(payload.fecha_extraccion)) errors.push("fecha_extraccion inválida");
  const matches = Array.isArray(payload.matches) ? payload.matches : null;
  if (!matches || matches.length === 0) errors.push("matches debe ser arreglo no vacío");
  const today = dateInVETOffset(0);
  const tomorrow = dateInVETOffset(1);
  const allowed = new Set([today, tomorrow]);
  const seen = new Set<string>();
  const cleaned: any[] = [];
  for (let i = 0; i < (matches?.length ?? 0); i++) {
    const m = matches![i];
    if (!isRecord(m)) { errors.push(`matches[${i}] no es objeto`); continue; }
    const key = String(m.match_key ?? m.match_slug ?? "");
    if (!key) { errors.push(`matches[${i}] falta match_key/match_slug`); continue; }
    if (seen.has(key)) { warnings.push(`duplicado ${key}`); continue; }
    seen.add(key);
    const date = String(m.date_local_vet ?? key.slice(0, 10));
    if (DATE_RE.test(date) && !allowed.has(date)) warnings.push(`matches[${i}] fuera de ventana VET: ${date}`);
    const odds = Array.isArray(m.odds_1x2) ? m.odds_1x2 : [];
    for (let j = 0; j < odds.length; j++) {
      const o = odds[j];
      if (!isRecord(o)) continue;
      for (const k of ["home", "draw", "away"]) {
        const v = o[k];
        if (v === null || v === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 1) errors.push(`matches[${i}].odds_1x2[${j}].${k} inválida`);
      }
    }
    cleaned.push(m);
  }
  return { ok: errors.length === 0, errors, warnings, normalized: { ...payload, total_matches: cleaned.length, matches: cleaned } };
}

async function persist(payload: any, report: any) {
  // Filesystem persistence is opt-in for local/dev ETL; not durable in Cloudflare Workers.
  if (process.env.ENABLE_ETL_FS_PERSIST !== "1") {
    report.warnings.push("persistencia fs desactivada (ENABLE_ETL_FS_PERSIST!=1)");
    return;
  }
  const day = payload.fecha_extraccion ?? dateInVETOffset(0);
  const rawDir = path.join(process.cwd(), "data", "raw", "etl_curated");
  const curatedDir = path.join(process.cwd(), "data", "curated");
  const reportDir = path.join(process.cwd(), "data", "etl-reports");
  await mkdir(rawDir, { recursive: true });
  await mkdir(curatedDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  const stamp = Date.now();
  await writeFile(path.join(rawDir, `${day}-${stamp}.json`), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(path.join(curatedDir, `latest.json`), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(path.join(reportDir, `curated-${stamp}.json`), JSON.stringify(report, null, 2) + "\n", "utf8");
}

export async function POST(request: NextRequest) {
  const unauthorized = ingestAuthError(request);
  if (unauthorized) return unauthorized;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const result = validate(body);
  const report = { valid: result.ok, errors: result.errors, warnings: result.warnings, received_at: new Date().toISOString(), count: result.normalized?.matches?.length ?? 0 };
  if (!result.ok || !result.normalized) return NextResponse.json({ ok: false, error: "Payload inválido", ...report }, { status: 422 });
  try { await persist(result.normalized, report); } catch (e) { report.warnings.push(`persistencia falló: ${String(e).slice(0, 120)}`); }
  const upsert = upsertCuratedMatches(result.normalized as CuratedPayload);
  revalidatePath("/");
  revalidatePath("/api/matches");
  return NextResponse.json({ ok: true, mensaje: "Payload curado recibido", ...report, upsert }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ ok: true, source: "etl_curated", hint: "POST payload curado con matches[]" });
}
