/**
 * Contrato común y resiliencia de los adapters.
 *
 * Todas las fuentes se envuelven con el mismo resultado (`SourceResult`) y se
 * ejecutan en paralelo con `Promise.allSettled`. Ningún adapter puede detener
 * el pipeline: timeout, error de red, 429 o datos parciales se convierten en
 * un resultado omitido con warning; el circuit breaker evita insistir sobre
 * una fuente caída durante 5 minutos.
 */
import { CircuitBreaker, type CircuitStatus } from "@/lib/circuitBreaker";
import type { DataSourceId, SourceHealthSnapshot } from "@/types/sports";

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_500;
const BREAKER_OPEN_MS = 5 * 60 * 1000;
const BREAKER_FAILURE_THRESHOLD = 3;

export interface SourcePayload<T> {
  data: T;
  warnings?: string[];
  /** false = la fuente respondió con un error funcional; por omisión es true. */
  ok?: boolean;
  partial?: boolean;
  dataPoints?: number;
  rateLimited?: boolean;
}

export interface SourceResult<T> extends SourcePayload<T> {
  source: DataSourceId;
  ok: boolean;
  warnings: string[];
  latencyMs: number;
  dataPoints: number;
  partial: boolean;
  status: CircuitStatus;
  failures: number;
  reason?: string;
}

export interface RunSourceOptions<T> {
  fallback: T;
  timeoutMs?: number;
  dataPoints?: (data: T) => number;
}

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

const breakers = new Map<DataSourceId, CircuitBreaker>();

function breakerFor(source: DataSourceId): CircuitBreaker {
  const existing = breakers.get(source);
  if (existing) return existing;
  const created = new CircuitBreaker({
    failureThreshold: BREAKER_FAILURE_THRESHOLD,
    openMs: BREAKER_OPEN_MS,
  });
  breakers.set(source, created);
  return created;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new SourceFetchError(`timeout tras ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, guarded]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof SourceFetchError)) return false;
  return error.status === undefined || error.status === 429 || error.status >= 500;
}

function isRateLimited(error: unknown): boolean {
  return error instanceof SourceFetchError && error.status === 429;
}

function warningMentionsRateLimit(warnings: string[]): boolean {
  return warnings.some((warning) => /\b429\b|l[ií]mite de 1 req|rate limit/i.test(warning));
}

export function failedSourceResult<T>(
  source: DataSourceId,
  fallback: T,
  reason: string,
): SourceResult<T> {
  const breaker = breakerFor(source);
  const snapshot = breaker.snapshot();
  return {
    source,
    data: fallback,
    ok: false,
    warnings: [`${source}: ${reason}`],
    latencyMs: 0,
    dataPoints: 0,
    partial: true,
    status: snapshot.status,
    failures: snapshot.failures,
    reason,
  };
}

/**
 * Envuelve un adapter con timeout, un reintento ligero, circuit breaker y el
 * contrato común. Nunca lanza: devuelve `ok: false` para que el agregador
 * recalcule pesos sin interrumpir el pipeline.
 */
export async function runResilientSource<T>(
  source: DataSourceId,
  task: () => Promise<SourcePayload<T>>,
  options: RunSourceOptions<T>,
): Promise<SourceResult<T>> {
  const startedAt = Date.now();
  const breaker = breakerFor(source);
  if (!breaker.allow(startedAt)) {
    return failedSourceResult(source, options.fallback, "circuito abierto; fuente omitida");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    let payload: SourcePayload<T> | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        payload = await withTimeout(task(), timeoutMs);
        break;
      } catch (error) {
        if (attempt === 0 && isRetryable(error)) {
          await pause(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
    if (!payload) throw new SourceFetchError("respuesta vacía de la fuente");

    const warnings = payload.warnings ?? [];
    const rateLimited =
      payload.rateLimited === true || warningMentionsRateLimit(warnings);
    if (rateLimited) throw new SourceFetchError("límite de peticiones alcanzado", 429);
    if (payload.ok === false) throw new SourceFetchError("la fuente devolvió un error funcional");

    breaker.success();
    const snapshot = breaker.snapshot();
    const dataPoints =
      payload.dataPoints ?? options.dataPoints?.(payload.data) ?? 0;
    return {
      ...payload,
      source,
      ok: true,
      warnings,
      latencyMs: Date.now() - startedAt,
      dataPoints,
      partial: payload.partial === true,
      status: snapshot.status,
      failures: snapshot.failures,
    };
  } catch (error) {
    const rateLimited = isRateLimited(error);
    const reason =
      error instanceof Error ? error.message : "fallo inesperado de la fuente";
    breaker.failure(rateLimited, Date.now());
    const snapshot = breaker.snapshot();
    return {
      source,
      data: options.fallback,
      ok: false,
      warnings: [`${source}: ${reason}. Fuente omitida en esta actualización.`],
      latencyMs: Date.now() - startedAt,
      dataPoints: 0,
      partial: true,
      status: snapshot.status,
      failures: snapshot.failures,
      reason,
    };
  }
}

export function healthSnapshot(source: DataSourceId): SourceHealthSnapshot {
  const snapshot = breakerFor(source).snapshot();
  return {
    source,
    status: snapshot.status,
    ok: snapshot.openedAt === null,
    latencyMs: 0,
    dataPoints: 0,
    partial: false,
    failures: snapshot.failures,
  };
}

export function resetSourceBreakers(): void {
  breakers.clear();
}
