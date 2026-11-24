import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchTheAnalyst } from "@/services/theAnalystService";
import { listRecords, upsertRecords } from "@/services/theAnalystStore";
import { ingestAuthError } from "@/lib/ingestAuth";

export const runtime = "nodejs";

/**
 * Dispara la descarga real desde la REST API de The Analyst y la guarda en el
 * store. La mantienen los workflows programados; no se llama en cada render.
 */
export async function POST(request: NextRequest) {
  const unauthorized = ingestAuthError(request);
  if (unauthorized) return unauthorized;

  try {
    const existing = listRecords();
    const result = await fetchTheAnalyst({
      limit: 20,
      fallbackRecords: existing,
    });

    const stored = upsertRecords(result.payload);
    revalidatePath("/");
    revalidatePath("/api/matches");

    return NextResponse.json(
      {
        ok: result.registro.ok,
        mensaje: "Refresco de The Analyst completado",
        registro: result.registro,
        ...stored,
        payload: result.payload,
      },
      { status: result.registro.ok ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error al refrescar The Analyst",
      },
      { status: 500 },
    );
  }
}
