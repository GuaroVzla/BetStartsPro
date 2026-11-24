import assert from "node:assert/strict";
import test from "node:test";

import {
  dateInVET,
  fromVETDateTime,
  isWithinMatchWindow,
  normalizeCommenceTime,
} from "../src/lib/format.ts";

const ahora = new Date("2026-11-24T15:00:00-04:00"); // 19:00Z

test("ISO con Z se normaliza sin milisegundos", () => {
  assert.equal(
    normalizeCommenceTime("2026-11-24T02:23:18.245Z", ahora),
    "2026-11-24T02:23:18Z",
  );
});

test("ISO con offset se convierte a UTC", () => {
  assert.equal(
    normalizeCommenceTime("2026-11-25T02:30:00-04:00", ahora),
    "2026-11-25T06:30:00Z",
  );
});

test("ISO sin offset se interpreta como hora de Venezuela", () => {
  assert.equal(
    normalizeCommenceTime("2026-11-24T22:15", ahora),
    "2026-11-25T02:15:00Z",
  );
});

test("fecha sola usa mediodía VET", () => {
  assert.equal(
    normalizeCommenceTime("2026-11-24", ahora),
    "2026-11-24T16:00:00Z",
  );
});

test("DD/MM/YYYY se parsea como día/mes, nunca mes/día", () => {
  assert.equal(
    normalizeCommenceTime("25/11/2026", ahora),
    "2026-11-25T16:00:00Z",
  );
  // 11/25 sería mes 25 en el formato es-VE: se rechaza en vez de invertirse.
  assert.equal(normalizeCommenceTime("11/25/2026", ahora), null);
});

test("DD/MM sin año infiere el año cercano, no el siguiente en noviembre", () => {
  assert.equal(
    normalizeCommenceTime("25/11", ahora),
    "2026-11-25T16:00:00Z",
  );
});

test("DD/MM sin año cruza correctamente de diciembre a enero", () => {
  const finDeAnio = new Date("2026-12-31T12:00:00-04:00");
  assert.equal(
    normalizeCommenceTime("01/01", finDeAnio),
    "2027-01-01T16:00:00Z",
  );
});

test("fechas imposibles o basura se rechazan", () => {
  assert.equal(normalizeCommenceTime("31/02/2026", ahora), null);
  assert.equal(normalizeCommenceTime("2026-13-01", ahora), null);
  assert.equal(normalizeCommenceTime("25:99 2026", ahora), null);
  assert.equal(normalizeCommenceTime("", ahora), null);
  assert.equal(dateInVET("no-es-fecha"), "");
  assert.equal(fromVETDateTime("2026-02-31", "12:00"), "");
});

test("ventana radar descarta fechas lejanas aunque sean válidas", () => {
  assert.equal(
    isWithinMatchWindow("2026-11-25T16:00:00Z", ahora),
    true,
  );
  assert.equal(
    isWithinMatchWindow("2027-06-15T16:00:00Z", ahora),
    false,
  );
  assert.equal(
    isWithinMatchWindow("27/11/2026", ahora),
    false,
  );
  assert.equal(
    isWithinMatchWindow("no-es-fecha", ahora),
    false,
  );
});
