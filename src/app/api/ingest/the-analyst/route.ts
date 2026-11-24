import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ingestAuthError } from "@/lib/ingestAuth";
import {
  clearRecords,
  listRecords,
  upsertRecords,
} from "@/services/theAnalystStore";
import type {
  ProbabilityOutcome,
  TheAnalystAdvancedMetrics,
  TheAnalystMatchInsight,
  TheAnalystPayload,
  TheAnalystRecord,
} from "@/services/theAnalystService";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+_vs_[a-z0-9-]+$/;
const VALID_OUTCOMES = new Set<ProbabilityOutcome>(["home", "draw", "away"]);
const VALID_TYPES = new Set(["match_preview", "prediction", "stats", "otro"]);
const VALID_METHODS = new Set(["articulo", "dataviz", "manual"]);
const VALID_CONFIDENCE = new Set(["alta", "media", "baja"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableIso(value: unknown): string | null {
  const text = nullableString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nullableProbability(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return Math.round(value * 1000) / 1000;
}

function nullableMetric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 100 ? value : null;
}

function validateMetrics(
  value: unknown,
  index: number,
): { metricas?: TheAnalystAdvancedMetrics; error?: string } {
  if (!isRecord(value)) {
    return { error: `registros[${index}].insight.metricas debe ser un objeto` };
  }
  return {
    metricas: {
      xg_local: nullableMetric(value.xg_local),
      xg_visitante: nullableMetric(value.xg_visitante),
      forma_local: nullableString(value.forma_local),
      forma_visitante: nullableString(value.forma_visitante),
      racha_local: nullableString(value.racha_local),
      racha_visitante: nullableString(value.racha_visitante),
      h2h_resumen: nullableString(value.h2h_resumen),
    },
  };
}

function validateInsight(
  value: unknown,
  index: number,
): { insight?: TheAnalystMatchInsight; error?: string } {
  if (!isRecord(value)) {
    return { error: `registros[${index}].insight debe ser un objeto o null` };
  }
  const home = nullableString(value.equipo_local) ?? "";
  const away = nullableString(value.equipo_visitante) ?? "";
  if (!home || !away) {
    return {
      error: `registros[${index}].insight requiere equipo_local y equipo_visitante`,
    };
  }

  const matchSlug = nullableString(value.match_slug);
  if (matchSlug && !SLUG_RE.test(matchSlug)) {
    return {
      error: `registros[${index}].insight.match_slug inválido: "${matchSlug}"`,
    };
  }
  const fechaPartido = nullableString(value.fecha_partido);
  if (fechaPartido && !DATE_RE.test(fechaPartido)) {
    return {
      error: `registros[${index}].insight.fecha_partido debe ser YYYY-MM-DD`,
    };
  }

  const rawProbabilities = isRecord(value.probabilidades) ? value.probabilidades : {};
  const rawInferred = Array.isArray(rawProbabilities.inferidas)
    ? rawProbabilities.inferidas
    : [];
  const inferidas = rawInferred.filter(
    (key): key is ProbabilityOutcome =>
      typeof key === "string" && VALID_OUTCOMES.has(key as ProbabilityOutcome),
  );
  const probabilities = {
    home: nullableProbability(rawProbabilities.home),
    draw: nullableProbability(rawProbabilities.draw),
    away: nullableProbability(rawProbabilities.away),
    inferidas,
  };
  if (
    probabilities.home === null &&
    probabilities.draw === null &&
    probabilities.away === null
  ) {
    return {
      error: `registros[${index}].insight.probabilidades requiere al menos una probabilidad`,
    };
  }

  const metrics = validateMetrics(value.metricas, index);
  if (metrics.error) return { error: metrics.error };

  const metodo = nullableString(value.metodo) ?? "articulo";
  if (!VALID_METHODS.has(metodo)) {
    return { error: `registros[${index}].insight.metodo no soportado: "${metodo}"` };
  }
  const confianza = nullableString(value.confianza) ?? "baja";
  if (!VALID_CONFIDENCE.has(confianza)) {
    return {
      error: `registros[${index}].insight.confianza no soportada: "${confianza}"`,
    };
  }

  return {
    insight: {
      match_slug: matchSlug,
      fecha_partido: fechaPartido,
      deporte: nullableString(value.deporte) ?? "Fútbol",
      liga: nullableString(value.liga),
      equipo_local: home,
      equipo_visitante: away,
      probabilidades: probabilities,
      metricas: metrics.metricas!,
      resumen: nullableString(value.resumen),
      metodo: metodo as TheAnalystMatchInsight["metodo"],
      confianza: confianza as TheAnalystMatchInsight["confianza"],
    },
  };
}

function validateRecord(value: unknown, index: number): { record?: TheAnalystRecord; error?: string } {
  if (!isRecord(value)) {
    return { error: `registros[${index}] no es un objeto` };
  }
  const articuloId = nullableString(value.articulo_id) ?? "";
  const titulo = nullableString(value.titulo) ?? "";
  const url = nullableString(value.url) ?? "";
  if (!articuloId || !titulo || !url) {
    return {
      error: `registros[${index}] requiere articulo_id, titulo y url`,
    };
  }
  const fechaPublicacion = nullableIso(value.fecha_publicacion);
  if (!fechaPublicacion) {
    return {
      error: `registros[${index}].fecha_publicacion debe ser una fecha ISO válida`,
    };
  }
  const capturado = nullableIso(value.capturado_en);
  if (value.capturado_en !== null && value.capturado_en !== undefined && !capturado) {
    return {
      error: `registros[${index}].capturado_en debe ser una fecha ISO válida`,
    };
  }
  const tipo = nullableString(value.tipo) ?? "otro";
  if (!VALID_TYPES.has(tipo)) {
    return { error: `registros[${index}].tipo no soportado: "${tipo}"` };
  }

  let insight: TheAnalystMatchInsight | null = null;
  if (value.insight !== null && value.insight !== undefined) {
    const result = validateInsight(value.insight, index);
    if (result.error) return { error: result.error };
    insight = result.insight ?? null;
  }

  return {
    record: {
      articulo_id: articuloId,
      titulo,
      url,
      fecha_publicacion: fechaPublicacion,
      tipo: tipo as TheAnalystRecord["tipo"],
      liga: nullableString(value.liga),
      equipo_local: nullableString(value.equipo_local),
      equipo_visitante: nullableString(value.equipo_visitante),
      resumen: nullableString(value.resumen),
      insight,
      capturado_en: capturado,
      notas: nullableString(value.notas),
    },
  };
}

function validatePayload(value: unknown): { payload?: TheAnalystPayload; error?: string } {
  if (!isRecord(value)) return { error: "El body debe ser un objeto JSON" };
  if (value.target_app !== "BetStats Pro") return { error: "target_app debe ser 'BetStats Pro'" };
  if (value.source !== "the_analyst_agent") {
    return { error: "source debe ser 'the_analyst_agent'" };
  }
  if (value.sync_mode !== "enrich_or_create") {
    return { error: "sync_mode debe ser 'enrich_or_create'" };
  }
  if (
    typeof value.fecha_extraccion !== "string" ||
    !DATE_RE.test(value.fecha_extraccion)
  ) {
    return { error: "fecha_extraccion debe tener formato YYYY-MM-DD" };
  }
  if (!Array.isArray(value.registros) || value.registros.length === 0) {
    return { error: "registros debe ser un arreglo no vacío" };
  }
  if (
    typeof value.total_registros === "number" &&
    value.total_registros !== value.registros.length
  ) {
    return { error: "total_registros no coincide con el número de registros" };
  }

  const advertencias = Array.isArray(value.advertencias)
    ? value.advertencias.filter((item): item is string => typeof item === "string")
    : [];

  const registros: TheAnalystRecord[] = [];
  for (let index = 0; index < value.registros.length; index += 1) {
    const result = validateRecord(value.registros[index], index);
    if (result.error) return { error: result.error };
    if (result.record) registros.push(result.record);
  }

  return {
    payload: {
      target_app: "BetStats Pro",
      source: "the_analyst_agent",
      sync_mode: "enrich_or_create",
      fecha_extraccion: value.fecha_extraccion,
      zona_horaria:
        typeof value.zona_horaria === "string" && value.zona_horaria.trim()
          ? value.zona_horaria.trim()
          : "America/Caracas",
      total_registros: registros.length,
      registros,
      advertencias,
    },
  };
}

export async function POST(request: NextRequest) {
  const unauthorized = ingestAuthError(request);
  if (unauthorized) return unauthorized;

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

  const result = upsertRecords(payload);
  revalidatePath("/");
  revalidatePath("/api/matches");
  return NextResponse.json(
    {
      ok: true,
      mensaje: "Datos de The Analyst integrados en BetStats Pro",
      ...result,
    },
    { status: 201 },
  );
}

export async function GET() {
  const registros = listRecords();
  return NextResponse.json({
    target_app: "BetStats Pro",
    source: "the_analyst_agent",
    total_registros: registros.length,
    total_insights: registros.filter((record) => record.insight !== null).length,
    registros,
  });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = ingestAuthError(request);
  if (unauthorized) return unauthorized;

  clearRecords();
  return NextResponse.json({
    ok: true,
    mensaje: "Registros de The Analyst eliminados",
    total_registros: 0,
  });
}
