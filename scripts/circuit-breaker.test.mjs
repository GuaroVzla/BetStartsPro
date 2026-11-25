import assert from "node:assert/strict";
import test from "node:test";

import { CircuitBreaker } from "../src/lib/circuitBreaker.ts";

test("tres fallos consecutivos abren el circuito", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 });
  assert.equal(breaker.allow(0), true);
  breaker.failure(false, 0);
  breaker.failure(false, 0);
  assert.equal(breaker.allow(0), true);
  breaker.failure(false, 0);
  assert.equal(breaker.allow(0), false);
  assert.equal(breaker.snapshot(0).status, "open");
});

test("un 429 abre el circuito de inmediato", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 });
  breaker.failure(true, 100);
  assert.equal(breaker.allow(101), false);
  assert.equal(breaker.snapshot(101).status, "open");
});

test("half-open permite una sola sonda y se cierra con éxito", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 });
  breaker.failure(true, 100);
  assert.equal(breaker.allow(1099), false);
  assert.equal(breaker.allow(1100), true);
  assert.equal(breaker.allow(1101), false);
  breaker.success();
  assert.equal(breaker.snapshot(1101).status, "closed");
  assert.equal(breaker.allow(1101), true);
});

test("si la sonda falla, el circuito vuelve a abrirse", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 });
  breaker.failure(true, 0);
  assert.equal(breaker.allow(1000), true);
  breaker.failure(false, 1000);
  assert.equal(breaker.allow(1001), false);
  assert.equal(breaker.snapshot(1001).status, "open");
});
