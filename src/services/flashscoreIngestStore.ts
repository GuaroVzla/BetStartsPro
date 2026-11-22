/**
 * Almacén en memoria para los registros inyectados por el agente de Flashscore.
 * Se mantiene separado del agregador de APIs y sobrevive entre peticiones
 * dentro del mismo proceso de Next.js (útil para el modo demo local).
 */

export type FlashscoreOdds = {
  local_1: number | null;
  empate_x: number | null;
  visitante_2: number | null;
};

export type FlashscoreStats = {
  posicion_local: number | null;
  posicion_visitante: number | null;
  racha_local_ultimos_5: Array<"V" | "E" | "D"> | null;
  racha_visitante_ultimos_5: Array<"V" | "E" | "D"> | null;
  h2h_resumen: string | null;
};

export type FlashscoreMatch = {
  match_slug: string;
  deporte: string;
  liga: string | null;
  hora_local: string | null;
  estado: string;
  equipo_local: string;
  equipo_visitante: string;
  cuotas_1x2: FlashscoreOdds;
  estadisticas_complementarias: FlashscoreStats;
};

export type FlashscorePayload = {
  target_app: "BetStats Pro";
  source: "flashscore_agent";
  sync_mode: "enrich_or_create";
  fecha_extraccion: string;
  zona_horaria: string;
  total_partidos: number;
  partidos: FlashscoreMatch[];
};

export type StoredRecord = FlashscoreMatch & {
  source: "flashscore_agent";
  sync_mode: "enrich_or_create";
  fecha_extraccion: string;
  zona_horaria: string;
  actualizado_en: string;
};

const store = new Map<string, StoredRecord>();

/** Combina un registro nuevo con uno existente sin sobrescribir datos válidos con null. */
function mergeRecord(existing: StoredRecord | undefined, incoming: FlashscoreMatch, meta: Omit<StoredRecord, keyof FlashscoreMatch>): StoredRecord {
  if (!existing) return { ...incoming, ...meta };

  const pick = <T>(next: T | null, prev: T | null): T | null => (next === null || next === undefined ? prev ?? null : next);

  return {
    ...existing,
    ...incoming,
    liga: pick(incoming.liga, existing.liga),
    hora_local: pick(incoming.hora_local, existing.hora_local),
    cuotas_1x2: {
      local_1: pick(incoming.cuotas_1x2.local_1, existing.cuotas_1x2.local_1),
      empate_x: pick(incoming.cuotas_1x2.empate_x, existing.cuotas_1x2.empate_x),
      visitante_2: pick(incoming.cuotas_1x2.visitante_2, existing.cuotas_1x2.visitante_2),
    },
    estadisticas_complementarias: {
      posicion_local: pick(incoming.estadisticas_complementarias.posicion_local, existing.estadisticas_complementarias.posicion_local),
      posicion_visitante: pick(incoming.estadisticas_complementarias.posicion_visitante, existing.estadisticas_complementarias.posicion_visitante),
      racha_local_ultimos_5: pick(incoming.estadisticas_complementarias.racha_local_ultimos_5, existing.estadisticas_complementarias.racha_local_ultimos_5),
      racha_visitante_ultimos_5: pick(incoming.estadisticas_complementarias.racha_visitante_ultimos_5, existing.estadisticas_complementarias.racha_visitante_ultimos_5),
      h2h_resumen: pick(incoming.estadisticas_complementarias.h2h_resumen, existing.estadisticas_complementarias.h2h_resumen),
    },
    ...meta,
  };
}

export function upsertMatches(payload: FlashscorePayload): { created: number; updated: number; total: number } {
  const meta = {
    source: "flashscore_agent" as const,
    sync_mode: "enrich_or_create" as const,
    fecha_extraccion: payload.fecha_extraccion,
    zona_horaria: payload.zona_horaria,
    actualizado_en: new Date().toISOString(),
  };

  let created = 0;
  let updated = 0;
  for (const match of payload.partidos) {
    const existing = store.get(match.match_slug);
    store.set(match.match_slug, mergeRecord(existing, match, meta));
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated, total: store.size };
}

export function listMatches(): StoredRecord[] {
  return Array.from(store.values()).sort((a, b) => a.match_slug.localeCompare(b.match_slug));
}

export function clearMatches(): void {
  store.clear();
}
