/**
 * Almacén en memoria de artículos/insights capturados de The Analyst.
 * Sigue el patrón de flashscoreIngestStore y triunfobetIngestStore: la semilla
 * incluida en el bundle evita que la web arranque vacía en cada isolate.
 */

import seedPayload from "../../scripts/the-analyst-seed.json";
import type {
  TheAnalystAdvancedMetrics,
  TheAnalystMatchInsight,
  TheAnalystPayload,
  TheAnalystProbabilities,
  TheAnalystRecord,
} from "@/services/theAnalystService";

export type {
  TheAnalystAdvancedMetrics,
  TheAnalystMatchInsight,
  TheAnalystPayload,
  TheAnalystProbabilities,
  TheAnalystRecord,
} from "@/services/theAnalystService";

export type StoredTheAnalystRecord = TheAnalystRecord & {
  fecha_extraccion: string;
  actualizado_en: string;
};

const store = new Map<string, StoredTheAnalystRecord>();

function pick<T>(next: T | null | undefined, previous: T | null | undefined): T | null {
  return next === null || next === undefined ? previous ?? null : next;
}

function mergeProbabilities(
  next: TheAnalystProbabilities,
  previous: TheAnalystProbabilities,
): TheAnalystProbabilities {
  return {
    home: pick(next.home, previous.home),
    draw: pick(next.draw, previous.draw),
    away: pick(next.away, previous.away),
    inferidas:
      next.inferidas && next.inferidas.length > 0 ? next.inferidas : previous.inferidas,
  };
}

function mergeMetrics(
  next: TheAnalystAdvancedMetrics,
  previous: TheAnalystAdvancedMetrics,
): TheAnalystAdvancedMetrics {
  return {
    xg_local: pick(next.xg_local, previous.xg_local),
    xg_visitante: pick(next.xg_visitante, previous.xg_visitante),
    forma_local: pick(next.forma_local, previous.forma_local),
    forma_visitante: pick(next.forma_visitante, previous.forma_visitante),
    racha_local: pick(next.racha_local, previous.racha_local),
    racha_visitante: pick(next.racha_visitante, previous.racha_visitante),
    h2h_resumen: pick(next.h2h_resumen, previous.h2h_resumen),
  };
}

function mergeInsight(
  next: TheAnalystMatchInsight | null,
  previous: TheAnalystMatchInsight | null,
): TheAnalystMatchInsight | null {
  if (!next) return previous;
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    match_slug: pick(next.match_slug, previous.match_slug),
    fecha_partido: pick(next.fecha_partido, previous.fecha_partido),
    liga: pick(next.liga, previous.liga),
    probabilidades: mergeProbabilities(next.probabilidades, previous.probabilidades),
    metricas: mergeMetrics(next.metricas, previous.metricas),
    resumen: pick(next.resumen, previous.resumen),
  };
}

/** Una clave estable por artículo; la URL evita duplicados si cambia el ID. */
export function recordKey(record: TheAnalystRecord): string {
  if (record.articulo_id) return `id:${record.articulo_id}`;
  return `url:${record.url || record.titulo}`;
}

function mergeRecord(
  existing: StoredTheAnalystRecord | undefined,
  incoming: TheAnalystRecord,
  meta: Omit<StoredTheAnalystRecord, keyof TheAnalystRecord>,
): StoredTheAnalystRecord {
  if (!existing) return { ...incoming, ...meta };
  return {
    ...existing,
    ...incoming,
    titulo: incoming.titulo || existing.titulo,
    url: incoming.url || existing.url,
    liga: pick(incoming.liga, existing.liga),
    equipo_local: pick(incoming.equipo_local, existing.equipo_local),
    equipo_visitante: pick(incoming.equipo_visitante, existing.equipo_visitante),
    resumen: pick(incoming.resumen, existing.resumen),
    insight: mergeInsight(incoming.insight, existing.insight),
    capturado_en: pick(incoming.capturado_en, existing.capturado_en),
    notas: pick(incoming.notas, existing.notas),
    ...meta,
  };
}

export function upsertRecords(payload: TheAnalystPayload): {
  created: number;
  updated: number;
  total: number;
} {
  const meta = {
    fecha_extraccion: payload.fecha_extraccion,
    actualizado_en: new Date().toISOString(),
  };

  let created = 0;
  let updated = 0;
  for (const record of payload.registros) {
    const key = recordKey(record);
    const existing = store.get(key);
    store.set(key, mergeRecord(existing, record, meta));
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated, total: store.size };
}

export function listRecords(): StoredTheAnalystRecord[] {
  return Array.from(store.values()).sort((a, b) =>
    b.fecha_publicacion.localeCompare(a.fecha_publicacion),
  );
}

/** Solo artículos de los que se extrajo un insight utilizable. */
export function listInsights(): StoredTheAnalystRecord[] {
  return listRecords().filter((record) => record.insight !== null);
}

export function clearRecords(): void {
  store.clear();
}

const seeded = seedPayload as unknown as TheAnalystPayload;
if (store.size === 0) {
  upsertRecords(seeded);
}
