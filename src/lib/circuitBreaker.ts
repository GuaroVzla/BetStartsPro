/**
 * Circuit breaker por fuente. Tres fallos consecutivos —o un 429— abren el
 * circuito durante 5 min. Pasado ese tiempo se permite una sola sonda en
 * half-open; si responde, el circuito se cierra y se reinicia el contador.
 *
 * Es una clase pura (sin reloj global ni IO) para poder probarla con `now`
 * inyectado desde los tests.
 */
export type CircuitStatus = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openMs?: number;
}

export interface CircuitSnapshot {
  status: CircuitStatus;
  failures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;
  private readonly failureThreshold: number;
  private readonly openMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.openMs = Math.max(0, options.openMs ?? 5 * 60 * 1000);
  }

  /** Devuelve true cuando la fuente puede intentar una petición. */
  allow(now: number = Date.now()): boolean {
    if (this.openedAt === null) return true;
    const elapsed = now - this.openedAt;
    if (elapsed < this.openMs) return false;
    if (this.halfOpenInFlight) return false;
    this.halfOpenInFlight = true;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }

  /** `rateLimited` fuerza la apertura inmediata (un 429 agota el circuito). */
  failure(rateLimited = false, now: number = Date.now()): void {
    if (!rateLimited) this.failures += 1;
    if (rateLimited || this.failures >= this.failureThreshold) {
      this.failures = rateLimited ? Math.max(this.failures, this.failureThreshold) : this.failures;
      this.openedAt = now;
      this.halfOpenInFlight = false;
    }
  }

  snapshot(now: number = Date.now()): CircuitSnapshot {
    if (this.openedAt !== null && now - this.openedAt >= this.openMs) {
      return { status: "half-open", failures: this.failures, openedAt: this.openedAt };
    }
    return {
      status: this.openedAt === null ? "closed" : "open",
      failures: this.failures,
      openedAt: this.openedAt,
    };
  }
}
