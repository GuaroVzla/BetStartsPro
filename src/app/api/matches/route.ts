import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { getDashboardData } from "@/services/matchAggregator";
import type { SportFilter } from "@/types/sports";

export const revalidate = 3600;
export const runtime = "nodejs";

const VALID_SPORTS = new Set<SportFilter>([
  "all",
  "soccer",
  "basketball",
  "baseball",
  "hockey",
]);

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  if (forceRefresh) noStore();

  const sportParam = request.nextUrl.searchParams.get("sport") ?? "all";
  if (!VALID_SPORTS.has(sportParam as SportFilter)) {
    return NextResponse.json(
      {
        error:
          "Deporte no permitido. Usa soccer, basketball, baseball, hockey o all.",
      },
      { status: 400 },
    );
  }

  try {
    const data = await getDashboardData();
    const filtered =
      sportParam === "all"
        ? data
        : {
            ...data,
            matches: data.matches.filter((match) => match.sport === sportParam),
            leagues: data.leagues.filter(
              (league) => league.sport === sportParam,
            ),
          };
    // Telemetría desactivada hasta migrarla de node:fs a KV/D1 o a un cron Node-only.
    // Ver docs/RECOMENDACIONES_PENDIENTES.md (sección 4).

    const nowMs = Date.now();
    const nearestMs = filtered.matches
      .map((match) => Date.parse(match.commenceTime))
      .filter((ts) => Number.isFinite(ts) && ts >= nowMs)
      .sort((a, b) => a - b)[0];
    const minutesToKickoff =
      nearestMs == null ? Number.POSITIVE_INFINITY : (nearestMs - nowMs) / 60_000;
    const ttlSeconds = forceRefresh
      ? 0
      : minutesToKickoff <= 120
        ? 120
        : minutesToKickoff <= 24 * 60
          ? 600
          : 3600;
    const swrSeconds = ttlSeconds === 0 ? 0 : Math.min(600, Math.max(60, Math.floor(ttlSeconds / 2)));

    return NextResponse.json(filtered, {
      headers: {
        "Cache-Control": forceRefresh
          ? "no-store, max-age=0"
          : `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`,
        "X-Data-Mode": data.meta.mode,
        "X-Cache-TTL": String(ttlSeconds),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo cargar la información deportiva.",
      },
      { status: 502 },
    );
  }
}
