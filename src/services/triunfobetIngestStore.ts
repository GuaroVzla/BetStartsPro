/**
 * Almacén en memoria de cotizaciones de Triunfobet capturadas de forma
 * explícita. Triunfobet sirve el sportsbook de Altenar detrás de un widget que
 * requiere sesión, por lo que no existe un feed público consultable desde el
 * servidor. Este store permite inyectar únicamente cuotas realmente visibles
 * para el usuario, sin rellenar valores inventados.
 */

export type TriunfobetOdds = {
  local_1: number | null;
  empate_x: number | null;
  visitante_2: number | null;
};

export type TriunfobetQuote = {
  match_slug: string | null;
  deporte: string | null;
  liga: string | null;
  fecha_local: string | null;
  hora_local: string | null;
  equipo_local: string;
  equipo_visitante: string;
  mercado: string;
  cuotas_1x2: TriunfobetOdds;
  capturado_en: string | null;
  url: string | null;
  nota: string | null;
};

export type TriunfobetPayload = {
  target_app: "BetStats Pro";
  source: "triunfobet_agent";
  sync_mode: "enrich_or_create";
  fecha_extraccion: string;
  zona_horaria: string;
  total_cotizaciones: number;
  cotizaciones: TriunfobetQuote[];
};

export type StoredTriunfobetQuote = TriunfobetQuote & {
  source: "triunfobet_agent";
  fecha_extraccion: string;
  actualizado_en: string;
};

const store = new Map<string, StoredTriunfobetQuote>();

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteKey(quote: Pick<TriunfobetQuote, "match_slug" | "equipo_local" | "equipo_visitante" | "fecha_local">): string {
  if (quote.match_slug) return `slug:${quote.match_slug}`;
  const date = quote.fecha_local ?? "sin-fecha";
  return `teams:${date}|${normalizeKey(quote.equipo_local)}|${normalizeKey(quote.equipo_visitante)}`;
}

function mergeQuote(
  existing: StoredTriunfobetQuote | undefined,
  incoming: TriunfobetQuote,
  meta: Omit<StoredTriunfobetQuote, keyof TriunfobetQuote>,
): StoredTriunfobetQuote {
  if (!existing) return { ...incoming, ...meta };
  const pick = <T>(next: T | null, previous: T | null): T | null =>
    next === null || next === undefined ? previous ?? null : next;

  return {
    ...existing,
    ...incoming,
    match_slug: pick(incoming.match_slug, existing.match_slug),
    deporte: pick(incoming.deporte, existing.deporte),
    liga: pick(incoming.liga, existing.liga),
    fecha_local: pick(incoming.fecha_local, existing.fecha_local),
    hora_local: pick(incoming.hora_local, existing.hora_local),
    mercado: incoming.mercado,
    capturado_en: pick(incoming.capturado_en, existing.capturado_en),
    url: pick(incoming.url, existing.url),
    nota: pick(incoming.nota, existing.nota),
    cuotas_1x2: {
      local_1: pick(incoming.cuotas_1x2.local_1, existing.cuotas_1x2.local_1),
      empate_x: pick(incoming.cuotas_1x2.empate_x, existing.cuotas_1x2.empate_x),
      visitante_2: pick(incoming.cuotas_1x2.visitante_2, existing.cuotas_1x2.visitante_2),
    },
    ...meta,
  };
}

export function upsertQuotes(payload: TriunfobetPayload): { created: number; updated: number; total: number } {
  const meta = {
    source: "triunfobet_agent" as const,
    fecha_extraccion: payload.fecha_extraccion,
    actualizado_en: new Date().toISOString(),
  };

  let created = 0;
  let updated = 0;
  for (const quote of payload.cotizaciones) {
    const key = quoteKey(quote);
    const existing = store.get(key);
    store.set(key, mergeQuote(existing, quote, meta));
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated, total: store.size };
}

export function listQuotes(): StoredTriunfobetQuote[] {
  return Array.from(store.values()).sort((a, b) =>
    `${a.fecha_local ?? ""}|${a.equipo_local}`.localeCompare(
      `${b.fecha_local ?? ""}|${b.equipo_local}`,
    ),
  );
}

export function clearQuotes(): void {
  store.clear();
}

/**
 * Semilla incluida en el bundle: en Cloudflare Workers el almacén en memoria
 * arranca vacío en cada isolate, así que las cotizaciones capturadas se cargan
 * desde este archivo para que la web muestre las cuotas reales verificadas.
 */
import seedPayload from "../../scripts/triunfobet-quotes.json";

const seeded = seedPayload as unknown as TriunfobetPayload;
if (store.size === 0) {
  upsertQuotes(seeded);
}
