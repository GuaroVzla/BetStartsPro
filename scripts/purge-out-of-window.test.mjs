import assert from "node:assert/strict";
import test from "node:test";

import {
  dateInVET,
  isWithinWindow,
  isValidDate,
  matchDate,
  nextDate,
} from "./purge-out-of-window.mjs";

const referencia = "2026-11-24";

test("matchDate prefiere el slug y respeta fecha_local y fecha_extraccion", () => {
  assert.equal(
    matchDate({ match_slug: "2026-11-25_arsenal_vs_chelsea", fecha_local: "2026-11-24" }),
    "2026-11-25",
  );
  assert.equal(matchDate({ fecha_local: "2026-11-24", hora_local: "15:00" }), "2026-11-24");
  assert.equal(matchDate({ fecha_extraccion: "2026-11-24" }), "2026-11-24");
});

test("matchDate rechaza fechas imposibles o sin año", () => {
  assert.equal(matchDate({ match_slug: "2026-02-31_equipo_a_vs_b" }), "");
  assert.equal(matchDate({ fecha_local: "25/11" }), "");
  assert.equal(matchDate({}), "");
});

test("isWithinWindow acepta hoy y mañana, rechaza el resto", () => {
  assert.equal(isWithinWindow("2026-11-24", referencia), true);
  assert.equal(isWithinWindow("2026-11-25", referencia), true);
  assert.equal(isWithinWindow("2026-11-26", referencia), false);
  assert.equal(isWithinWindow("2026-11-23", referencia), false);
  assert.equal(isWithinWindow("", referencia), false);
  assert.equal(isWithinWindow("2026-11-24", "no-fecha"), false);
});

test("nextDate cruza mes y año", () => {
  assert.equal(nextDate("2026-11-30"), "2026-12-01");
  assert.equal(nextDate("2026-12-31"), "2027-01-01");
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(isValidDate("2028-02-29"), true);
});

test("dateInVET usa la zona de Venezuela incluso de noche en UTC", () => {
  assert.equal(dateInVET(new Date("2026-11-25T02:00:00Z")), "2026-11-24");
  assert.equal(dateInVET("no-es-fecha"), "");
});
