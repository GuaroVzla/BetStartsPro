import { NextRequest, NextResponse } from "next/server";
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

    return NextResponse.json(filtered, {
      headers: {
        "Cache-Control":
          "public, s-maxage=3600, stale-while-revalidate=600",
        "X-Data-Mode": data.meta.mode,
        "X-Cache-TTL": String(data.meta.cacheTtlSeconds),
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
