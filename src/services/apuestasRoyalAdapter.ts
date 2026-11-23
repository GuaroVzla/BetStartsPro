import { dateInVET, dateInVETOffset } from "@/lib/format";
import { favoriteSideFromSummary, summarizeMarket } from "@/lib/marketSummary";
import { namesLikelyMatch, normalizeName } from "@/lib/utils";
import type { StoredApuestasRoyalQuote } from "@/services/apuestasRoyalIngestStore";
import type { BookmakerQuote, SportsMatch } from "@/types/sports";

function normalizeTeamName(name: string): string {
  return normalizeName(name)
    .replace(/\b(fc|cf|sc|afc|club|the|de|del)\b/gi, "")
    .trim();
}

function sameTeams(
  quote: StoredApuestasRoyalQuote,
  match: SportsMatch,
): boolean {
  const localMatch = normalizeTeamName(match.home.name);
  const visitMatch = normalizeTeamName(match.away.name);
  const localQuote = normalizeTeamName(quote.equipo_local);
  const visitQuote = normalizeTeamName(quote.equipo_visitante);

  // Matching directo con namesLikelyMatch
  const directMatch =
    (namesLikelyMatch(localQuote, localMatch) &&
      namesLikelyMatch(visitQuote, visitMatch)) ||
    (namesLikelyMatch(localQuote, visitMatch) &&
      namesLikelyMatch(visitQuote, localMatch));

  // Matching por tokens superados (≥ 50% de tokens comunes > 2 chars)
  const tokensLocal = new Set(localQuote.split(" ").filter((t) => t.length > 2));
  const tokensVisit = new Set(visitQuote.split(" ").filter((t) => t.length > 2));
  const tokensLocalMatch = new Set(localMatch.split(" ").filter((t) => t.length > 2));
  const tokensVisitMatch = new Set(visitMatch.split(" ").filter((t) => t.length > 2));

  let commonLocal = 0;
  for (const token of tokensLocal) if (tokensVisitMatch.has(token)) commonLocal += 1;
  let commonVisit = 0;
  for (const token of tokensVisit) if (tokensLocalMatch.has(token)) commonVisit += 1;

  const tokenMatch =
    commonLocal / Math.min(tokensLocal.size, tokensLocalMatch.size) >= 0.5 &&
    commonVisit / Math.min(tokensVisit.size, tokensVisitMatch.size) >= 0.5;

  // Matching por nombre parcial (un nombre contiene al otro)
  const partialMatch =
    localQuote.includes(localMatch) ||
    visitQuote.includes(visitMatch) ||
    localQuote.includes(visitMatch) ||
    visitQuote.includes(localMatch);

  return directMatch || tokenMatch || partialMatch;
}

function findMatch(
  matches: SportsMatch[],
  quote: StoredApuestasRoyalQuote,
): SportsMatch | null {
  if (quote.match_slug) {
    const bySlug = matches.find(
      (match) => match.id === `flashscore-${quote.match_slug}`,
    );
    if (bySlug) return bySlug;
  }

  const candidates = matches.filter((match) => {
    if (
      quote.fecha_local &&
      dateInVET(match.commenceTime) !== quote.fecha_local
    ) {
      return false;
    }
    return sameTeams(quote, match);
  });

  if (candidates.length <= 1) return candidates[0] ?? null;

  return (
    candidates.find(
      (match) =>
        namesLikelyMatch(quote.equipo_local, match.home.name) &&
        namesLikelyMatch(quote.equipo_visitante, match.away.name),
    ) ?? candidates[0]
  );
}

function buildBookmaker(
  quote: StoredApuestasRoyalQuote,
): BookmakerQuote | null {
  const home = quote.cuotas_1x2.local_1 ?? 0;
  const away = quote.cuotas_1x2.visitante_2 ?? 0;
  const draw = quote.cuotas_1x2.empate_x;
  if (home <= 1 && away <= 1 && (draw === null || draw <= 1)) return null;

  return {
    id: `apuestas-royal-${
      quote.match_slug ??
      `${quote.fecha_local ?? "sin-fecha"}-${quote.equipo_local}`
    }`,
    name: "Apuestas Royal",
    source: "apuestas-royal",
    outcomes: {
      home,
      draw,
      away,
    },
    updatedAt: quote.capturado_en ?? quote.actualizado_en,
  };
}

export interface ApuestasRoyalApplyResult {
  matches: SportsMatch[];
  applied: number;
  unmatched: number;
}

/**
 * Cruza las cotizaciones de Apuestas Royal con los partidos activos. Las
 * cuotas nulas se preservan como null y nunca sustituyen un precio válido.
 */
export function applyApuestasRoyalQuotes(
  matches: SportsMatch[],
  quotes: StoredApuestasRoyalQuote[],
): ApuestasRoyalApplyResult {
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
      (entry) =>
        !(entry.source === "apuestas-royal" && entry.id === bookmaker.id),
    );
    const updated: SportsMatch = {
      ...current,
      odds: summarizeMarket([...others, bookmaker]),
    };
    updated.favoriteSide = favoriteSideFromSummary(updated.odds);
    byId.set(updated.id, updated);
    applied += 1;
  }

  return {
    matches: matches.map((match) => byId.get(match.id) ?? match),
    applied,
    unmatched,
  };
}
