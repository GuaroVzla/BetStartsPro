import { dateInVET } from "@/lib/format";
import { canonicalFavoriteFromSummary, summarizeMarket } from "@/lib/marketSummary";
import {
  canonicalBookmakerName,
  createNameMatcher,
  createNameNormalizer,
} from "@/lib/utils";
import type { StoredApuestasRoyalQuote } from "@/services/apuestasRoyalIngestStore";
import type { BookmakerQuote, SportsMatch } from "@/types/sports";

interface MatchLookup {
  matches: SportsMatch[];
  byId: Map<string, SportsMatch>;
  byDate: Map<string, SportsMatch[]>;
  nameMatches: (first: string, second: string) => boolean;
  normalizeTeamName: (name: string) => string;
  teamPairs: Map<string, boolean>;
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(" ").filter((token) => token.length > 2));
}

function sameTeams(
  lookup: MatchLookup,
  quote: StoredApuestasRoyalQuote,
  match: SportsMatch,
): boolean {
  const localMatch = lookup.normalizeTeamName(match.home.name);
  const visitMatch = lookup.normalizeTeamName(match.away.name);
  const localQuote = lookup.normalizeTeamName(quote.equipo_local);
  const visitQuote = lookup.normalizeTeamName(quote.equipo_visitante);
  const pairKey = `${localQuote}\u0000${visitQuote}\u0000${localMatch}\u0000${visitMatch}`;
  const cached = lookup.teamPairs.get(pairKey);
  if (cached !== undefined) return cached;

  const { nameMatches } = lookup;
  const directMatch =
    (nameMatches(localQuote, localMatch) &&
      nameMatches(visitQuote, visitMatch)) ||
    (nameMatches(localQuote, visitMatch) &&
      nameMatches(visitQuote, localMatch));

  // Matching por tokens superados (≥ 50% de tokens comunes > 2 chars)
  const tokensLocal = tokenSet(localQuote);
  const tokensVisit = tokenSet(visitQuote);
  const tokensLocalMatch = tokenSet(localMatch);
  const tokensVisitMatch = tokenSet(visitMatch);

  let commonLocal = 0;
  for (const token of tokensLocal) if (tokensVisitMatch.has(token)) commonLocal += 1;
  let commonVisit = 0;
  for (const token of tokensVisit) if (tokensLocalMatch.has(token)) commonVisit += 1;

  const tokenMatch =
    tokensLocal.size > 0 &&
    tokensVisit.size > 0 &&
    tokensLocalMatch.size > 0 &&
    tokensVisitMatch.size > 0 &&
    commonLocal / Math.min(tokensLocal.size, tokensLocalMatch.size) >= 0.5 &&
    commonVisit / Math.min(tokensVisit.size, tokensVisitMatch.size) >= 0.5;

  // Matching por nombre parcial (un nombre contiene al otro)
  const partialMatch =
    localQuote.includes(localMatch) ||
    visitQuote.includes(visitMatch) ||
    localQuote.includes(visitMatch) ||
    visitQuote.includes(localMatch);

  const result = directMatch || tokenMatch || partialMatch;
  lookup.teamPairs.set(pairKey, result);
  return result;
}

function findMatch(
  lookup: MatchLookup,
  quote: StoredApuestasRoyalQuote,
): SportsMatch | null {
  if (quote.match_slug) {
    const bySlug = lookup.byId.get(`flashscore-${quote.match_slug}`);
    if (bySlug) return bySlug;
  }

  const byDate = quote.fecha_local
    ? lookup.byDate.get(quote.fecha_local) ?? []
    : lookup.matches;
  const candidates = byDate.filter((match) => sameTeams(lookup, quote, match));
  if (candidates.length <= 1) return candidates[0] ?? null;

  const { nameMatches } = lookup;
  return (
    candidates.find(
      (match) =>
        nameMatches(quote.equipo_local, match.home.name) &&
        nameMatches(quote.equipo_visitante, match.away.name),
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

  const updatedAt = quote.capturado_en ?? quote.actualizado_en;
  const rawH = home > 1 ? 1 / home : 0;
  const rawD = draw && draw > 1 ? 1 / draw : 0;
  const rawA = away > 1 ? 1 / away : 0;
  return {
    id: `apuestas-royal-${
      quote.match_slug ??
      `${quote.fecha_local ?? "sin-fecha"}-${quote.equipo_local}`
    }`,
    name: "Apuestas Royal",
    canonicalName: canonicalBookmakerName("Apuestas Royal", "apuestas-royal"),
    source: "apuestas-royal",
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
  const byDate = new Map<string, SportsMatch[]>();
  for (const match of matches) {
    const date = dateInVET(match.commenceTime);
    const bucket = byDate.get(date);
    if (bucket) bucket.push(match);
    else byDate.set(date, [match]);
  }
  const normalize = createNameNormalizer();
  const lookup: MatchLookup = {
    matches,
    byId,
    byDate,
    nameMatches: createNameMatcher(),
    normalizeTeamName: (name: string) =>
      normalize(name)
        .replace(/\b(fc|cf|sc|afc|club|the|de|del)\b/gi, "")
        .trim(),
    teamPairs: new Map<string, boolean>(),
  };
  let applied = 0;
  let unmatched = 0;

  for (const quote of quotes) {
    const bookmaker = buildBookmaker(quote);
    if (!bookmaker) {
      unmatched += 1;
      continue;
    }
    const target = findMatch(lookup, quote);
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
