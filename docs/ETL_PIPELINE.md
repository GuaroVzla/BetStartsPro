# ETL Pipeline - BetStats Pro

## Objetivo
Ingerir partidos, cuotas y estadísticas diarias desde APIs oficiales y fuentes complementarias, con validación, normalización, idempotencia y observabilidad.

## Fuentes y método

| Fuente | Prioridad | Método | Frecuencia | Salida | Notas |
|---|---|---|---:|---|---|
| The Odds API | P1 | REST oficial | 30-60 min | cuotas 1X2, timestamps, créditos | Requiere `THE_ODDS_API_KEY` |
| API-Sports | P1 | REST oficial | 30-60 min | fixtures, estado, marcador, standings, lesiones, stats | Requiere `APISPORTS_KEY` |
| SportMonks | P1 | REST oficial | 30-60 min | fixtures/odds fútbol | Requiere `SPORTMONKS_KEY` |
| Flashscore | P2 | Playwright/XHR + seed | 3h | partidos, cuotas visibles, rachas | Complemento; frágil ante cambios DOM |
| TriunfoBet | P2 | Playwright sesión residencial | 3h | cuotas locales | Runner self-hosted; WAF/Turnstile |
| Apuestas Royal | P2 | Playwright storageState | 3h | cuotas locales | Turnstile/sesión expira |
| The Analyst | P3 | scrape/seed + refresh | 3h | probabilidades/insights | Señal editorial, no verdad única |
| ESPN (pública) | P1 | REST pública no oficial | 30 min | fixtures, estado, sede, moneyline; `soccer/all` + feeds NBA/NCAA/NHL/MLB | **Sin key**; validar términos de uso |
| TheSportsDB | P2 | REST pública | 30-60 min | cartelera multi-deporte | Requiere `THESPORTSDB_KEY` propia; la key `123` da 429 |
| OpenLigaDB | P3 | REST pública | 30-60 min | fixtures/estado Bundesliga | **Sin key**; respaldo de ESPN |

## Contrato canónico

Archivo: `schemas/ingest-payload.schema.json`.

Campos clave por partido/match normalizado:
- Identidad: `match_key`, `source`, `source_match_id`, `sport`, `league`.
- Tiempo: `commence_time_utc`, `date_local_vet`, `status`.
- Equipos: `home`, `away`.
- Marcador: `score.home`, `score.away`.
- Cuotas: `odds_1x2[]` con `bookmaker`, `canonical`, `home/draw/away`, `overround`, `updated_at`, `as_of`.
- Calidad: `provenance`, `confidence`, `captured_at`, `validation_errors`.

Reglas:
- Cuotas decimales `> 1`.
- Fechas válidas; ventana operativa VET hoy/mañana para radar.
- No sobrescribir datos válidos con `null`.
- Deduplicar por `match_slug/match_key` y por casa+timestamp.
- Idempotencia: upsert por clave estable.

## Flujo ETL

1. **Extract**: APIs oficiales (`scripts/etl-extract-apis.mjs`) y scrapers existentes.
2. **Validate**: `scripts/validate-ingest-payload.mjs` verifica forma, ventana VET, cuotas, duplicados.
3. **Normalize**: `scripts/ingest-utils.mjs` + adaptadores; slugs/fechas VET consistentes.
4. **Load**: `POST /api/ingest/*` con `Authorization: Bearer $INGEST_TOKEN`.
5. **Observe**: reportes JSON en `data/etl-reports/`, logs de workflow, warnings en `meta.warnings`.

## Comandos

```bash
npm run sources:check
npm run etl:validate -- scripts/flashscore-payload.json
npm run etl:apis -- --dry-run
npm run etl:apis -- --write --ingest
npm run refresh:all
```

## Validación de fuentes

`npm run sources:check` prueba en vivo:

- The Odds API, API-Sports y SportMonks solo si su key está configurada.
- ESPN y TheSportsDB siempre, porque no requieren key propia.
- OpenLigaDB como respaldo público.

Si una fuente configurada falla, el comando devuelve exit code 1 con el detalle. Las fuentes gratuitas están integradas al dashboard aunque no existan claves premium.

## Automatización

- `.github/workflows/refresh-apis.yml`: cada 30 min, extrae APIs y opcionalmente ingesta.
- `.github/workflows/refresh-data.yml`: cada 3h, scrapers/semillas Flashscore, Royal, Analyst.
- `.github/workflows/refresh-triunfobet.yml`: cada 3h, runner residencial self-hosted.
- `.github/workflows/deploy-cloudflare.yml`: typecheck + tests + deploy.

## Seguridad y operación

- Secrets: `INGEST_TOKEN`, `SITE_URL`, `THE_ODDS_API_KEY`, `SPORTMONKS_KEY`, `APISPORTS_KEY`, `ROYAL_STORAGE_STATE`, `TRIUNFOBET_STORAGE_STATE`.
- No guardar credenciales en repo. No exponer `INGEST_TOKEN` al cliente.
- Scrapers: rate limit, backoff, `continue-on-error`, kill-switch por secret ausente.
- Producción: preferir KV/D1/R2 para raw/curated; seeds git solo respaldo.

## Aceptación

- Payloads válidos según validador.
- `npm run typecheck`, `npm run test:dates`, `npm run test:model` en verde.
- Dashboard sin modo demo; warnings claros cuando falten fuentes.
