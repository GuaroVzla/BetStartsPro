# Fuentes de datos del motor estadístico

Validación ejecutable: `npm run sources:check` (`scripts/validate-sources.mjs`).

## Fuentes activas

| Fuente | Requiere key | Aporta | Estado | Notas |
|---|---:|---|---|---|
| The Odds API | Sí (`THE_ODDS_API_KEY`) | Cuotas 1X2, casas, timestamps, créditos | Activa si hay key | Sin key se omite; no bloquea fuentes gratuitas. |
| API-Sports | Sí (`APISPORTS_KEY`) | Fixtures, estado, standings, lesiones, stats, odds por evento | Activa si hay key | Fútbol, básquet, béisbol y hockey. |
| SportMonks | Sí (`SPORTMONKS_KEY`) | Fixtures y cuotas de fútbol | Activa si hay key | Se usa como respaldo si API-Sports no devuelve eventos. |
| ESPN (pública) | No | Fixtures, estado, sede y moneyline 1X2 | Activa | `soccer/all` cubre todas las competiciones de fútbol del día; feeds de NBA, Euroliga, NCAA (básquet), MLB, ligas invernales, NCAA (béisbol), NHL y NCAA (hockey). Endpoint no oficial; cache 30 min. |
| TheSportsDB | Sí (`THESPORTSDB_KEY` propia) | Cartelera multi-deporte hoy/mañana | Opcional | La key pública `123` se descartó por HTTP 429. Sin key propia se omite. |
| OpenLigaDB | No | Fixtures/estado de Bundesliga | Activa | Respaldo de ESPN; se deduplica por fecha+equipos. |
| Flashscore ingest | No | Partidos/cuotas capturadas por agente | Activa si hay seed/ingesta | Store en memoria; semilla en bundle. |
| TriunfoBet ingest | No | Cuotas locales capturadas | Activa si hay captura vigente | Runner residencial; WAF/Turnstile. |
| Apuestas Royal ingest | No | Cuotas locales capturadas | Activa si hay captura vigente | Sesión storageState. |
| The Analyst | No | xG/probabilidades/rachas editoriales | Activa si hay seed/ingesta | Señal editorial, no verdad única. |
| ETL curado | No | Partidos normalizados vía `POST /api/ingest/curated` | Activa si hay payload | Requiere `INGEST_TOKEN` en producción. |

## Fuentes eliminadas o descartadas

| Fuente | Motivo |
|---|---|
| Betfair | Solo existía como tipo, sin adapter, credenciales ni ingesta real. Eliminada de `OddsSource`. |
| Polymarket | Solo existía como tipo, sin adapter ni normalización. Eliminada de `OddsSource`. |
| ClubElo | Endpoint público con timeout desde este entorno; no se cableó para no introducir fallos. |
| Wikipedia/lesiones | Señal secundaria de baja confiabilidad; no se usa como verdad única. |
| TheSportsDB key pública `123` | HTTP 429 por rate limit; se exige key propia (`THESPORTSDB_KEY`) para activarla. |
| Web search genérica | El entorno devolvió HTTP 403 en repetidas pruebas; se validan endpoints directos. |

## Reglas de calidad

- Sin key no se inventan datos: la fuente se omite y se registra advertencia.
- Cuotas decimales `> 1`; si falta un lado 1X2, la cuota queda incompleta (`null`) y no se fuerza.
- Dedupe de partidos por fecha VET + equipos normalizados.
- Dedupe de cuotas por casa canónica + timestamp.
- `provenance` y notas indican si la fuente trae tabla, lesiones, xG o solo fixtures.
- Las fuentes gratuitas nunca sustituyen una cuota válida de una casa con datos más recientes.
