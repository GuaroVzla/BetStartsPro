# Fuentes de datos del motor estadístico

Validación ejecutable: `npm run sources:check` (`scripts/validate-sources.mjs`).

## Fuentes activas

| Fuente | Requiere key | Aporta | Estado | Notas |
|---|---:|---|---|---|
| The Odds API | Sí (`THE_ODDS_API_KEY`) | Cuotas 1X2, casas, timestamps, créditos | Activa si hay key | Sin key se omite; no bloquea fuentes gratuitas. |
| API-Sports | Sí (`APISPORTS_KEY`) | Fixtures, estado, standings, lesiones, stats, odds por evento | Activa si hay key | Fútbol, básquet, béisbol y hockey. |
| SportMonks | Sí (`SPORTMONKS_KEY`) | Fixtures y cuotas de fútbol | Activa si hay key | Se usa como respaldo si API-Sports no devuelve eventos. |
| ESPN (pública) | No | Fixtures, estado, sede y moneyline 1X2 | Activa | `soccer/all` cubre todas las competiciones de fútbol del día; feeds de NBA, Euroliga, NCAA (básquet), MLB, ligas invernales, NCAA (béisbol), NHL y NCAA (hockey). Endpoint no oficial; cache 30 min. |
| TheSportsDB | Sí (`THESPORTSDB_KEY`, clave pública `123` válida) | Cartelera multi-deporte hoy/mañana, posiciones y forma | Activa si hay key | Sin cuotas 1X2; ~3 eventos por deporte/día. Tabla gratis de 5 filas y 1 resultado por equipo. Revalidada HTTP 200 el 2026-11-24. Sin key se omite. |
| AllSportsAPI | Sí (`ALLSPORTSAPI_KEY`) | Fixtures de fútbol, cuotas 1X2 de varias casas y tablas reales | Activa si hay key | Tier gratuito: 2 ventanas de fixtures + odds y hasta 6 standings por actualización; caché 15 min. Sin xG ni lesiones. |
| TheRundown | Sí (`THERUNDOWN_API_KEY`) | Fixtures multi-deporte y moneyline 1X2 de DraftKings/BetMGM/FanDuel | Activa si hay key | Plan gratis: 1 req/s, 20.000 data points/día, 5 min de retraso, 7 días de historia. `market_ids=1`, `main_line`, `hide_closed`, `offset=-240`, cache 30 min. |
| OpenLigaDB | No | Fixtures/estado de Bundesliga | Activa | Respaldo de ESPN; se deduplica por fecha+equipos. |
| Flashscore ingest | No | Partidos/cuotas capturadas por agente | Activa si hay seed/ingesta | Store en memoria; semilla en bundle. |
| Apuestas Royal ingest | No | Cuotas locales capturadas | Activa si hay captura vigente | Sesión storageState. |
| The Analyst | No | xG/probabilidades/rachas editoriales | Activa si hay seed/ingesta | Señal editorial, no verdad única. |
| ETL curado | No | Partidos normalizados vía `POST /api/ingest/curated` | Activa si hay payload | Requiere `INGEST_TOKEN` en producción. |

### TheSportsDB: endpoints gratuitos en uso

Con `THESPORTSDB_KEY` (clave pública `123`) se consumen solo endpoints del tier gratis:

| Endpoint | Uso en el motor | Límite gratis |
|---|---|---|
| `eventsday.php?d=&s=` | Cartelera de hoy/mañana (ya existente) | 3 por día |
| `lookuptable.php?l=<idLiga>` | Posiciones reales para `intel.standings` | 5 filas (tabla parcial) |
| `eventslast.php?id=<idEquipo>` | Último resultado para `intel.stats.form` | 1 evento (solo de local) |

`src/services/theSportsDbStatsService.ts` aplica estos datos solo donde la fuente original
no tenía tabla/forma real, con caché de 1 h y un tope de 6 consultas de tabla y 8 de forma
por ventana de 1 minuto (el tier gratuito permite 30 req/min). Las filas que no se pudieron
completar conservan `position = 0` / `provenance: "none"`; nunca se inventan datos.

### AllSportsAPI: endpoints gratuitos en uso

Con `ALLSPORTSAPI_KEY` se consultan estos endpoints de `/football/`:

| Endpoint | Uso en el motor | Límite/cuidado |
|---|---|---|
| `met=Fixtures&from=&to=` | Cartelera de hoy/mañana (VET), estado y sede | Una consulta por actualización; tope de 300 fixtures |
| `met=Odds&from=&to=` | Cuotas 1X2 por casa, indexadas por `event_key` | Una consulta por actualización; se dedupe por casa canónica |
| `met=Standings&leagueId=` | Posiciones reales (`standing_P/W/D/L/F/A/PTS`) | Hasta 6 ligas por actualización |

`src/services/allSportsApiService.ts` cachea el resultado 15 minutos. Solo rellena
`intel.standings` y `intel.stats` cuando la liga del fixture tiene tabla disponible;
si no hay datos, la posición queda en `0` y `provenance: "none"`. Las cuotas se
marcan con `source: "allsportsapi"`. El plan gratuito no cubre béisbol/hockey
(`File not found`) y los horarios se normalizan como hora VET por no incluir offset.

`FOOTBALL_DATA_API_KEY` quedó configurado, pero ese token solo autoriza
`/v4/competitions` y `/v4/matches` (sin partidos en la ventana); los recursos de
ligas/equipos devuelven HTTP 403. Por eso no se cableó al motor.

### TheRundown: endpoints gratuitos en uso

`THERUNDOWN_API_KEY` se envía en el header `X-TheRundown-Key` (nunca en la URL).
El adaptador `src/services/theRundownService.ts` consulta:

| Endpoint | Uso en el motor | Límite/cuidado |
|---|---|---|
| `/api/v2/sports/events/{fecha}?sport_ids=...&offset=-240` | Detecta qué deportes tienen partido hoy/mañana VET | 2 fechas por actualización |
| `/api/v2/sports/{id}/events/{fecha}?market_ids=1&affiliate_ids=19,22,23&main_line=true&hide_closed=true&offset=-240` | Fixtures y cuotas 1X2 de tres casas | Solo deportes con eventos; cache 30 min |

El tier gratis permite 1 request/s. El adaptador espacia las llamadas 1.6 s y
hace **un reintento con backoff** ante 429/5xx o error de red; si el límite
persiste, registra warning y continúa con las demás fuentes. No publica tabla
ni xG: esos campos quedan `position = 0` / `provenance: "none"` hasta que otra
fuente los complete.

## Fuentes eliminadas o descartadas

| Fuente | Motivo |
|---|---|
| Betfair | Solo existía como tipo, sin adapter, credenciales ni ingesta real. Eliminada de `OddsSource`. |
| Polymarket | Solo existía como tipo, sin adapter ni normalización. Eliminada de `OddsSource`. |
| ClubElo | Endpoint público con timeout desde este entorno; no se cableó para no introducir fallos. |
| Wikipedia/lesiones | Señal secundaria de baja confiabilidad; no se usa como verdad única. |
| Web search genérica | El entorno devolvió HTTP 403 en repetidas pruebas; se validan endpoints directos. |

## Tolerancia a fallos y fusión

Todos los adapters se ejecutan en paralelo con `Promise.allSettled` y se envuelven
en `runResilientSource` (`src/services/sourceResilience.ts`), con un contrato
común: `ok`, `data`, `warnings`, `latencyMs`, `dataPoints` y `partial`.

- Timeout de 15 s por fuente y un reintento ligero de 1.5 s en 429/5xx/red.
- Circuit breaker por fuente (`src/lib/circuitBreaker.ts`): 3 fallos
  consecutivos o un 429 abren el circuito 5 min; después se permite una sola
  sonda en half-open antes de cerrarlo.
- Si una fuente falla se omite, se escribe un warning en `meta.warnings` y su
  peso se redistribuye entre las capas que sí respondieron:
  `w'_i = (w_i · r_i) / Σ_j (w_j · r_j)`, con `r ∈ {1, 0.5, 0}`.
- `meta.sourceHealth` expone estado del circuito, latencia, data points y
  número de fallos por adapter en cada request.

El ranking se calcula en `src/lib/fusionEngine.ts` con los pesos aprobados:
mercado 45 %, modelo Elo/Poisson 20 %, forma/xG 15 %, tabla 10 %, localía/H2H
6 % y editorial/lesiones 4 %. La confianza es
`0.5·cobertura + 0.3·profundidad_de_mercado + 0.2·completitud_de_datos`.
`H2H` no está disponible en el dataset actual y se declara como
`h2hAvailable: false`; nunca se simula.

## Contrato de salida del ranking

`GET /api/matches` (y `?sport=...`) devuelve `rankedFavorites` con este shape.
El filtro por deporte renumera el ranking:

```json
{
  "generatedAt": "2026-11-24T18:00:00.000Z",
  "weights": { "market": 0.45, "model": 0.2, "form": 0.15, "standings": 0.1, "venueH2h": 0.06, "editorial": 0.04 },
  "entries": [
    {
      "rank": 1,
      "matchId": "asa-1866652",
      "sport": "soccer",
      "league": "Serie A",
      "commenceTime": "2026-11-24T22:00:00.000Z",
      "outcome": "home",
      "team": "Atlético Mineiro",
      "opponent": "Flamengo",
      "modelProbability": 0.581,
      "marketImpliedProbability": 0.524,
      "marketImpliedRaw": 0.556,
      "edge": 0.057,
      "expectedValue": 0.12,
      "isValueBet": true,
      "confidence": 0.79,
      "supportingSources": ["allsportsapi", "api-sports", "the-analyst", "modelo"],
      "layerWeights": { "market": 0.42, "model": 0.3, "form": 0.15, "standings": 0.08, "venueH2h": 0.04, "editorial": 0.01 },
      "metrics": {
        "form": ["W", "W", "D", "W", "L"],
        "goalsFor": 1.72,
        "goalsAgainst": 0.91,
        "xgFor": 1.64,
        "homeAdvantage": 0.07,
        "h2hAvailable": false
      }
    }
  ],
  "warnings": []
}
```

`modelProbability` es la probabilidad real fusionada; `marketImpliedProbability`
es la implícita desvigada de la mejor cuota (comparable) y `marketImpliedRaw` es
`1 / mejor_cuota`. `edge = modelProbability - marketImpliedProbability`.

## Reglas de calidad

- Sin key no se inventan datos: la fuente se omite y se registra advertencia.
- Cuotas decimales `> 1`; si falta un lado 1X2, la cuota queda incompleta (`null`) y no se fuerza.
- Dedupe de partidos por fecha VET + equipos normalizados.
- Dedupe de cuotas por casa canónica + timestamp.
- `provenance` y notas indican si la fuente trae tabla, lesiones, xG o solo fixtures.
- Las fuentes gratuitas nunca sustituyen una cuota válida de una casa con datos más recientes.
