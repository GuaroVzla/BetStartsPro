import { dateInVET } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { canonicalBookmakerName, namesLikelyMatch } from "@/lib/utils";
import type { StoredTriunfobetQuote } from "@/services/triunfobetIngestStore";
import type { BookmakerQuote, SportsMatch } from "@/types/sports";


function sameTeams(quote: StoredTriunfobetQuote, match: SportsMatch): boolean {
  return (
    (namesLikelyMatch(quote.equipo_local, match.home.name) &&
      namesLikelyMatch(quote.equipo_visitante, match.away.name)) ||
    (namesLikelyMatch(quote.equipo_local, match.away.name) &&
      namesLikelyMatch(quote.equipo_visitante, match.home.name))
  );
}

function findMatch(
  matches: SportsMatch[],
  quote: StoredTriunfobetQuote,
): SportsMatch | null {
  if (quote.match_slug) {
    const bySlug = matches.find((match) => match.id === `flashscore-${quote.match_slug}`);
    if (bySlug) return bySlug;
  }

  const candidates = matches.filter((match) => {
    if (quote.fecha_local && dateInVET(match.commenceTime) !== quote.fecha_local) {
      return false;
    }
    return sameTeams(quote, match);
  });

  if (candidates.length <= 1) return candidates[0] ?? null;

  // Si la casa invirtió local/visitante, conservamos la orientación del partido.
  return (
    candidates.find(
      (match) =>
        namesLikelyMatch(quote.equipo_local, match.home.name) &&
        namesLikelyMatch(quote.equipo_visitante, match.away.name),
    ) ?? candidates[0]
  );
}

function buildBookmaker(quote: StoredTriunfobetQuote): BookmakerQuote | null {
  const home = quote.cuotas_1x2.local_1 ?? 0;
  const away = quote.cuotas_1x2.visitante_2 ?? 0;
  const draw = quote.cuotas_1x2.empate_x;
  if (home <= 1 && away <= 1 && (draw === null || draw <= 1)) return null;

  const updatedAt = quote.capturado_en ?? quote.actualizado_en;
  const rawH = home > 1 ? 1 / home : 0;
  const rawD = draw && draw > 1 ? 1 / draw : 0;
  const rawA = away > 1 ? 1 / away : 0;
  return {
    id: `triunfobet-${quote.match_slug ?? `${quote.fecha_local ?? "sin-fecha"}-${quote.equipo_local}`}`,
    name: "Triunfobet",
    canonicalName: canonicalBookmakerName("Triunfobet", "triunfobet"),
    source: "triunfobet",
    outcomes: {
      home,
      draw,
      away,
    },
    updatedAt,
    asOf: updatedAt,
    overround: Math.max(0, rawH + rawD + rawA - 1),
  };
}

export interface TriunfobetApplyResult {
  matches: SportsMatch[];
  applied: number;
  unmatched: number;
}

/**
 * Cruza las cotizaciones capturadas de Triunfobet con los partidos del día.
 * Ningún valor ausente se inventa: las cuotas nulas no entran en el resumen.
 */
export function applyTriunfobetQuotes(
  matches: SportsMatch[],
  quotes: StoredTriunfobetQuote[],
): TriunfobetApplyResult {
  if (quotes.length === 0) return { matches, applied: 0, unmatched: 0 };

  const byId = new Map(matches.map((match) => [match.id, match]));
  let applied = 0;
  let unmatched = 0;

  for (const quote of quotes) {
    const bookmaker = buildBookmaker(quote);
    if (!bookmaker) {
      unmatched += 1;
      continue;
    }
    const target = findMatch(matches, quote);
    if (!target) {
      unmatched += 1;
      continue;
    }

    const current = byId.get(target.id);
    if (!current) continue;
    const others = current.odds.bookmakers.filter(
      (entry) => !(entry.source === "triunfobet" && entry.id === bookmaker.id),
    );
    const updated: SportsMatch = {
      ...current,
      odds: summarizeMarket([...others, bookmaker]),
    };
    updated.favoriteSide = canonicalFavoriteFromSummary(updated.odds);
    updated.canonicalFavorite = updated.favoriteSide;
    byId.set(updated.id, updated);
    applied += 1;
  }

  return {
    matches: matches.map((match) => byId.get(match.id) ?? match),
    applied,
    unmatched,
  };
}
