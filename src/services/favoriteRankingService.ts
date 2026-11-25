/** Adaptador del motor de fusión: une partidos, señal del modelo y salud de fuentes. */
import { getModelSignal } from "@/lib/bettingAnalyzer";
import { isMatchDayVET, resolveMatchStatus } from "@/lib/format";
import { rankFavorites, type MatchFusionInput, type RankOptions } from "@/lib/fusionEngine";
import type {
  DataSourceId,
  RankedFavoritesResult,
  SourceHealthSnapshot,
  SportsMatch,
} from "@/types/sports";

export interface FavoriteRankingOptions extends RankOptions {
  sourceHealth?: Record<DataSourceId, SourceHealthSnapshot>;
  day?: "today" | "tomorrow" | "all";
}

/**
 * Genera el ranking de favoritos usando solo partidos pre-match de la ventana.
 * Las señales ausentes se pasan como `null`: el motor de fusión redistribuye
 * pesos, pero nunca inventa datos para completar la fila.
 */
export function buildRankedFavorites(
  matches: SportsMatch[],
  options: FavoriteRankingOptions = {},
): RankedFavoritesResult {
  const now = options.now ?? new Date();
  const day = options.day ?? "all";
  const candidates = matches.filter(
    (match) =>
      isMatchDayVET(match.commenceTime, day, now) &&
      resolveMatchStatus(match, now) === "scheduled",
  );

  const inputs: MatchFusionInput[] = candidates.map((match) => {
    let modelSignal: MatchFusionInput["modelSignal"] = null;
    try {
      modelSignal = getModelSignal(match);
    } catch {
      modelSignal = null;
    }
    return { match, modelSignal, sourceHealth: options.sourceHealth };
  });

  return rankFavorites(inputs, {
    now,
    minEdge: options.minEdge,
    minOdds: options.minOdds,
    maxEntries: options.maxEntries,
    extraWarnings: options.extraWarnings,
  });
}
