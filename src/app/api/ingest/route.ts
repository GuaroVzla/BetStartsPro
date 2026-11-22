import { NextRequest, NextResponse } from "next/server";
import {
  clearMatches,
  listMatches,
  upsertMatches,
  type FlashscoreMatch,
  type FlashscorePayload,
} from "@/services/flashscoreIngestStore";

export const runtime = "nodejs";

const VALID_FORM = new Set(["V", "E", "D"]);
const SLUG_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+_vs_[a-z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

function optionalFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function optionalForm(value: unknown): Array<"V" | "E" | "D"> | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value.filter((v): v is "V" | "E" | "D" => typeof v === "string" && VALID_FORM.has(v));
  return cleaned.length > 0 ? cleaned : null;
}

function validateMatch(value: unknown, index: number): { match?: FlashscoreMatch; error?: string } {
  if (!isRecord(value)) return { error: `partidos[${index}] no es un objeto` };

  const matchSlug = typeof value.match_slug === "string" ? value.match_slug : "";
  if (!SLUG_RE.test(matchSlug)) return { error: `partidos[${index}].match_slug inválido: "${matchSlug}"` };

  const home = typeof value.equipo_local === "string" ? value.equipo_local.trim() : "";
  const away = typeof value.equipo_visitante === "string" ? value.equipo_visitante.trim() : "";
  if (!home || !away) return { error: `partidos[${index}] tiene un nombre de equipo vacío` };

  const rawOdds = isRecord(value.cuotas_1x2) ? value.cuotas_1x2 : {};
  const rawStats = isRecord(value.estadisticas_complementarias) ? value.estadisticas_complementarias : {};

  return {
    match: {
      match_slug: matchSlug,
      deporte: typeof value.deporte === "string" && value.deporte.trim() ? value.deporte.trim() : "Fútbol",
      liga: optionalString(value.liga),
      hora_local: optionalString(value.hora_local),
      estado: typeof value.estado === "string" && value.estado.trim() ? value.estado.trim() : "Programado",
      equipo_local: home,
      equipo_visitante: away,
      cuotas_1x2: {
        local_1: optionalFloat(rawOdds.local_1),
        empate_x: optionalFloat(rawOdds.empate_x),
        visitante_2: optionalFloat(rawOdds.visitante_2),
      },
      estadisticas_complementarias: {
        posicion_local: optionalInt(rawStats.posicion_local),
        posicion_visitante: optionalInt(rawStats.posicion_visitante),
        racha_local_ultimos_5: optionalForm(rawStats.racha_local_ultimos_5),
        racha_visitante_ultimos_5: optionalForm(rawStats.racha_visitante_ultimos_5),
        h2h_resumen: optionalString(rawStats.h2h_resumen),
      },
    },
  };
}

function validatePayload(value: unknown): { payload?: FlashscorePayload; error?: string } {
  if (!isRecord(value)) return { error: "El body debe ser un objeto JSON" };
  if (value.target_app !== "BetStats Pro") return { error: "target_app debe ser 'BetStats Pro'" };
  if (value.source !== "flashscore_agent") return { error: "source debe ser 'flashscore_agent'" };
  if (value.sync_mode !== "enrich_or_create") return { error: "sync_mode debe ser 'enrich_or_create'" };
  if (typeof value.fecha_extraccion !== "string" || !DATE_RE.test(value.fecha_extraccion)) {
    return { error: "fecha_extraccion debe tener formato YYYY-MM-DD" };
  }
  if (!Array.isArray(value.partidos)) return { error: "partidos debe ser un arreglo" };
  if (value.partidos.length === 0) return { error: "partidos no puede estar vacío" };
  if (typeof value.total_partidos === "number" && value.total_partidos !== value.partidos.length) {
    return { error: "total_partidos no coincide con el número de partidos" };
  }

  const partidos: FlashscoreMatch[] = [];
  for (let index = 0; index < value.partidos.length; index += 1) {
    const result = validateMatch(value.partidos[index], index);
    if (result.error) return { error: result.error };
    if (result.match) partidos.push(result.match);
  }

  return {
    payload: {
      target_app: "BetStats Pro",
      source: "flashscore_agent",
      sync_mode: "enrich_or_create",
      fecha_extraccion: value.fecha_extraccion,
      zona_horaria: typeof value.zona_horaria === "string" ? value.zona_horaria : "America/Caracas",
      total_partidos: partidos.length,
      partidos,
    },
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { payload, error } = validatePayload(body);
  if (!payload || error) {
    return NextResponse.json({ error: error ?? "Payload inválido" }, { status: 422 });
  }

  const result = upsertMatches(payload);
  return NextResponse.json(
    {
      ok: true,
      mensaje: "Datos de Flashscore integrados en BetStats Pro",
      ...result,
    },
    { status: 201 },
  );
}

export async function DELETE() {
  clearMatches();
  return NextResponse.json({ ok: true, mensaje: "Registros de Flashscore eliminados", total_partidos: 0 });
}

export async function GET() {
  const partidos = listMatches();
  return NextResponse.json({
    target_app: "BetStats Pro",
    source: "flashscore_agent",
    total_partidos: partidos.length,
    partidos,
  });
}
