import { dateInVET, dateInVETOffset } from "@/lib/format";

export type CuratedOddsQuote = {
  bookmaker: string;
  canonical?: string | null;
  home: number | null;
  draw: number | null;
  away: number | null;
  updated_at?: string | null;
  as_of?: string | null;
  source?: string | null;
};

export type CuratedMatch = {
  match_key: string;
  match_slug?: string | null;
  source_match_id?: string | null;
  sport?: string | null;
  league?: { id?: string | null; name?: string | null } | null;
  commence_time_utc?: string | null;
  date_local_vet?: string | null;
  time_local_vet?: string | null;
  status?: string | null;
  home?: { id?: string | null; name?: string | null } | string | null;
  away?: { id?: string | null; name?: string | null } | string | null;
  venue?: string | null;
  score?: { home?: number | null; away?: number | null } | null;
  context_key?: string | null;
  odds_1x2?: CuratedOddsQuote[] | null;
  provenance?: string | null;
  confidence?: number | null;
  captured_at?: string | null;
};

export type CuratedPayload = {
  target_app: "BetStats Pro";
  source: "etl_curated";
  sync_mode?: "enrich_or_create" | "replace_window";
  fecha_extraccion: string;
  zona_horaria?: string;
  matches: CuratedMatch[];
  advertencias?: string[];
};

export type StoredCuratedMatch = CuratedMatch & {
  source: "etl_curated";
  fecha_extraccion: string;
  actualizado_en: string;
};

const store = new Map<string, StoredCuratedMatch>();

function pick<T>(next: T | null | undefined, prev: T | null | undefined): T | null {
  return next === null || next === undefined ? (prev ?? null) : next;
}

function nameOf(v: CuratedMatch["home"]): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  return v.name ?? null;
}

export function curatedMatchKey(match: CuratedMatch): string {
  const key = match.match_key || match.match_slug;
  if (key) return key;
  const date = match.date_local_vet ?? (match.commence_time_utc ? dateInVET(match.commence_time_utc) : dateInVETOffset(0));
  return `${date}_${String(nameOf(match.home) ?? "home").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_vs_${String(nameOf(match.away) ?? "away").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function mergeOdds(existing: CuratedOddsQuote[] | null | undefined, incoming: CuratedOddsQuote[] | null | undefined): CuratedOddsQuote[] {
  const map = new Map<string, CuratedOddsQuote>();
  for (const q of [...(existing ?? []), ...(incoming ?? [])]) {
    const k = `${q.canonical ?? q.bookmaker}|${q.updated_at ?? q.as_of ?? ""}|${q.home ?? ""}|${q.draw ?? ""}|${q.away ?? ""}`;
    if (!map.has(k)) map.set(k, q);
  }
  return Array.from(map.values());
}

function mergeMatch(existing: StoredCuratedMatch | undefined, incoming: CuratedMatch, meta: { fecha_extraccion: string; actualizado_en: string }): StoredCuratedMatch {
  if (!existing) return { ...incoming, source: "etl_curated", ...meta };
  return {
    ...existing,
    ...incoming,
    match_key: incoming.match_key || existing.match_key,
    match_slug: pick(incoming.match_slug, existing.match_slug),
    source_match_id: pick(incoming.source_match_id, existing.source_match_id),
    sport: pick(incoming.sport, existing.sport),
    league: incoming.league ?? existing.league ?? null,
    commence_time_utc: pick(incoming.commence_time_utc, existing.commence_time_utc),
    date_local_vet: pick(incoming.date_local_vet, existing.date_local_vet),
    time_local_vet: pick(incoming.time_local_vet, existing.time_local_vet),
    status: pick(incoming.status, existing.status),
    home: incoming.home ?? existing.home ?? null,
    away: incoming.away ?? existing.away ?? null,
    venue: pick(incoming.venue, existing.venue),
    score: incoming.score ?? existing.score ?? null,
    context_key: pick(incoming.context_key, existing.context_key),
    odds_1x2: mergeOdds(existing.odds_1x2, incoming.odds_1x2),
    provenance: pick(incoming.provenance, existing.provenance),
    confidence: incoming.confidence ?? existing.confidence ?? null,
    captured_at: pick(incoming.captured_at, existing.captured_at),
    source: "etl_curated",
    ...meta,
  };
}

export function upsertCuratedMatches(payload: CuratedPayload): { created: number; updated: number; total: number } {
  const meta = { fecha_extraccion: payload.fecha_extraccion, actualizado_en: new Date().toISOString() };
  let created = 0;
  let updated = 0;
  for (const match of payload.matches ?? []) {
    const key = curatedMatchKey(match);
    if (!key) continue;
    const existing = store.get(key);
    const normalized = { ...match, match_key: key };
    store.set(key, mergeMatch(existing, normalized, meta));
    if (existing) updated += 1; else created += 1;
  }
  return { created, updated, total: store.size };
}

export function listCuratedMatches(): StoredCuratedMatch[] {
  return Array.from(store.values()).sort((a, b) => a.match_key.localeCompare(b.match_key));
}

export function clearCuratedMatches(): void {
  store.clear();
}
