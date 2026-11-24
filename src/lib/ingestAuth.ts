import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** Comparación de tokens en tiempo constante (evita filtrar el token por timing). */
function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Protección compartida para los endpoints de ingesta.
 *
 * - Si INGEST_TOKEN está configurado, exige `Authorization: Bearer <token>`
 *   o la cabecera `x-ingest-token`.
 * - Si no está configurado, solo permite las llamadas fuera de producción,
 *   para no romper el flujo local con `npm run dev`.
 */
export function ingestAuthError(request: NextRequest): NextResponse | null {
  const expected = process.env.INGEST_TOKEN;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "INGEST_TOKEN no configurado en el servidor" },
        { status: 503 },
      );
    }
    return null;
  }

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const provided = bearer ?? request.headers.get("x-ingest-token");

  if (!provided || !tokensEqual(provided, expected)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  return null;
}
