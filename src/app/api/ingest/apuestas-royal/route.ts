import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  clearQuotes,
  listQuotes,
  upsertQuotes,
  type ApuestasRoyalQuote,
} from "@/services/apuestasRoyalIngestStore";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+_vs_[a-z0-9-]+$/;
const VALID_MARKETS = new Set(["1X2", "1x2", "ganador", "moneyline"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Solo acepta cuotas decimales > 1. Todo lo demás se almacena como null. */
function nullableOdds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 1 ? value : null;
}

function validateQuote(
  value: unknown,
  index: number,
): { quote?: ApuestasRoyalQuote; error?: string } {
  if (!isRecord(value)) {
    return { error: `cotizaciones[${index}] no es un objeto` };
  }

  const home = nullableString(value.equipo_local) ?? "";
  const away = nullableString(value.equipo_visitante) ?? "";
  if (!home || !away) {
    return {
      error: `cotizaciones[${index}] requiere equipo_local y equipo_visitante`,
    };
  }

  const matchSlug = nullableString(value.match_slug);
  if (matchSlug && !SLUG_RE.test(matchSlug)) {
    return {
      error: `cotizaciones[${index}].match_slug inválido: "${matchSlug}"`,
    };
  }

  const fechaLocal = nullableString(value.fecha_local);
  if (fechaLocal && !DATE_RE.test(fechaLocal)) {
    return {
      error: `cotizaciones[${index}].fecha_local debe ser YYYY-MM-DD`,
    };
  }
  const horaLocal = nullableString(value.hora_local);
  if (horaLocal && !TIME_RE.test(horaLocal)) {
    return { error: `cotizaciones[${index}].hora_local debe ser HH:mm` };
  }

  const mercado = nullableString(value.mercado) ?? "1X2";
  if (!VALID_MARKETS.has(mercado)) {
    return {
      error: `cotizaciones[${index}].mercado no soportado: "${mercado}"`,
    };
  }

  const raw = isRecord(value.cuotas_1x2) ? value.cuotas_1x2 : {};
  const captured = nullableString(value.capturado_en);
  if (captured && Number.isNaN(new Date(captured).getTime())) {
    return {
      error: `cotizaciones[${index}].capturado_en no es una fecha ISO válida`,
    };
  }

  return {
    quote: {
      match_slug: matchSlug,
      deporte: nullableString(value.deporte),
      liga: nullableString(value.liga),
      fecha_local: fechaLocal,
      hora_local: horaLocal,
      equipo_local: home,
      equipo_visitante: away,
      mercado,
      cuotas_1x2: {
        local_1: nullableOdds(raw.local_1),
        empate_x: nullableOdds(raw.empate_x),
        visitante_2: nullableOdds(raw.visitante_2),
      },
      capturado_en: captured,
      url: nullableString(value.url),
      nota: nullableString(value.nota),
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

  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "El body debe ser un objeto JSON" },
      { status: 422 },
    );
  }
  if (body.target_app !== "BetStats Pro") {
    return NextResponse.json(
      { error: "target_app debe ser 'BetStats Pro'" },
      { status: 422 },
    );
  }
  if (body.source !== "apuestas_royal_agent") {
    return NextResponse.json(
      { error: "source debe ser 'apuestas_royal_agent'" },
      { status: 422 },
    );
  }
  if (body.sync_mode !== "enrich_or_create") {
    return NextResponse.json(
      { error: "sync_mode debe ser 'enrich_or_create'" },
      { status: 422 },
    );
  }
  if (
    typeof body.fecha_extraccion !== "string" ||
    !DATE_RE.test(body.fecha_extraccion)
  ) {
    return NextResponse.json(
      { error: "fecha_extraccion debe tener formato YYYY-MM-DD" },
      { status: 422 },
    );
  }
  if (!Array.isArray(body.cotizaciones) || body.cotizaciones.length === 0) {
    return NextResponse.json(
      { error: "cotizaciones debe ser un arreglo no vacío" },
      { status: 422 },
    );
  }
  if (
    typeof body.total_cotizaciones === "number" &&
    body.total_cotizaciones !== body.cotizaciones.length
  ) {
    return NextResponse.json(
      { error: "total_cotizaciones no coincide con el número de cotizaciones" },
      { status: 422 },
    );
  }

  const cotizaciones: ApuestasRoyalQuote[] = [];
  for (let index = 0; index < body.cotizaciones.length; index += 1) {
    const result = validateQuote(body.cotizaciones[index], index);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    if (result.quote) cotizaciones.push(result.quote);
  }

  const result = upsertQuotes({
    target_app: "BetStats Pro",
    source: "apuestas_royal_agent",
    sync_mode: "enrich_or_create",
    fecha_extraccion: body.fecha_extraccion,
    zona_horaria:
      typeof body.zona_horaria === "string"
        ? body.zona_horaria
        : "America/Caracas",
    total_cotizaciones: cotizaciones.length,
    cotizaciones,
  });

  revalidatePath("/");
  revalidatePath("/api/matches");
  return NextResponse.json(
    {
      ok: true,
      mensaje: "Cotizaciones de Apuestas Royal integradas en BetStats Pro",
      ...result,
    },
    { status: 201 },
  );
}

export async function GET() {
  const cotizaciones = listQuotes();
  return NextResponse.json({
    target_app: "BetStats Pro",
    source: "apuestas_royal_agent",
    total_cotizaciones: cotizaciones.length,
    cotizaciones,
  });
}

export async function DELETE() {
  clearQuotes();
  revalidatePath("/");
  revalidatePath("/api/matches");
  return NextResponse.json({
    ok: true,
    mensaje: "Cotizaciones de Apuestas Royal eliminadas",
    total_cotizaciones: 0,
  });
}
