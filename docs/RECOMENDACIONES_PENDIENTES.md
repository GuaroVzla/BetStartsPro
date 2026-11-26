# Recomendaciones pendientes — BetStats Pro

> Generado el 2026-11-24 después de que se apagara el equipo. El chat original se perdió:
> este documento se **reconstruyó del working tree y del `git diff`**, no de la conversación.
> `[x]` = cambio ya aplicado en el árbol de trabajo (estaba sin commitear al escribir esto).
> `[ ]` = trabajo pendiente. No implementar de golpe; seguir el orden de prioridad.

## 0. Estado de sincronización de esta sesión

- [x] Plan guardado en `docs/RECOMENDACIONES_PENDIENTES.md`.
- [x] Cambios confirmados en repositorio local (commit).
- [x] Push a GitHub (`main`).
- [x] Cloudflare Workers actualizado (push → workflow `Deploy a Cloudflare Workers` / deploy manual).

## 1. Regla de negocio vigente (ya aplicada)

`[x]` Filtro canónico del radar: `p ≥ 50%`, cuota `≥ 1.6`, **edge desvigado ≥ 2 %** y `EV > 0`.
El edge compara `p_modelo − implícita_desvigada` (desvigado proporcional); la implícita raw se conserva
solo para observabilidad. Documentado en `README.md:189`.

Archivos: `src/lib/marketSummary.ts`, `src/lib/bettingAnalyzer.ts`, `src/services/valueEngine.ts`,
`src/types/sports.ts`, `README.md`.

`[x]` `devigShin` usa `clampedZ` en la fórmula. `devigMethod` sigue existiendo en tipos/summary como
      metadata; el runtime sigue en proporcional por defecto (configurable solo a nivel de código, no UI).
`[x]` Umbral de edge unificado a `DEFAULT_MIN_EDGE` (0.02) en `buildValueFavoritePicks`; `TopPicks` usa
      umbral visual 5% solo para destacar, no para filtrar.
`[x]` `blendDescription`/UI reciben pesos reales usados por `analyzeMatch` (incluye mezcla histórica 15/85
      sobre mercado cuando aplica).
`[x]` Imports muertos limpiados en `valueEngine.ts`. (`formatInteger` no estaba presente).

## 2. Integridad y procedencia de datos (ya aplicada en gran parte)

`[x]` Se eliminó el fallback a datos mock por liga y global en `matchAggregator.ts`.
`[x]` Posiciones de tabla desconocidas → `position = 0` (no se inventan).
`[x]` `deriveStats` marca `provenance: "none" | "table-derived"` y deja splits casa/visita en 0.
`[x]` `canonicalBookmakerName` + dedupe de casas por nombre canónico con frescura ≤ 24 h.
`[x]` `normalizeName` ya no elimina tokens de identidad (`real`, `atletico`, `city`, `united`).
`[x]` The Analyst aporta `swapped` y `confidence`; las cuotas de todas las casas llevan
      `canonicalName`, `asOf` y `overround`.
`[x]` `favoriteProbability`: peso mercado 0.45 (0.35 base + 0.10 ex-H2H), H2H desactivado,
      normalización por suma de pesos presentes.

`[x]` `theAnalystAdapter.ts`: cruce invertido recibe score base 4 y solo se acepta si score final >= 7
      (p.ej. misma liga). Evita aceptar invertidos ambiguos.
`[x]` `utils.ts`: comparación de nombre corto/largo usa variables `shorter/longer` correctamente.
`[x]` `matchAggregator.ts`: eliminada la derivación muerta de splits casa/visita; splits se mantienen en 0
      con procedencia explícita.

Pendiente de esta área (depende de datos externos):
- [ ] Se necesitan **splits casa/visita y xG reales** desde algún proveedor: los tipos ya tienen
      `xgFor/xgAgainst/xpts` (`src/types/sports.ts:151-158`) pero `deriveStats` los deja a 0 y
      `hasGoalStatistics` (`bettingAnalyzer.ts:388-396`) descarta `table-derived`, así que el modelo
      Poisson local queda inactivo. Reactivar `distribucionH2H` solo con un campo `intel.h2h` estructurado.

## 3. Modelo histórico Dixon-Coles + Elo (integración activa, señal conservadora)

`[x]` `src/lib/dixonColes.ts`: tau, 1X2 truncado/renormalizado, ajuste regularizado/estable con priors,
      `lambdasForMatch`.
`[x]` `src/services/ratingService.ts`: Elo con decaimiento, margen de victoria, snapshots y 1X2.
`[x]` `src/services/modelParamsStore.ts`: carga estáticamente el artefacto (Worker-safe, sin filesystem).
`[x]` `scripts/backtest.ts`: walk-forward, mezcla DC 0.7 / Elo 0.3, métricas accuracy, RPS, log-loss,
      Brier y ECE(10).
`[x]` `scripts/build-model-artifact.ts` + `npm run artifact:build`.
`[x]` `data/historical-results.json` poblado con datos reales (football-data.co.uk, EPL 2023-24/2024-25,
      760 partidos, 760/760 con `closingOdds`).
`[x]` `src/data/model-params.json` generado con artefacto real (23 equipos DC/Elo).
`[x]` `modelProbabilities()` activo para fútbol cuando hay claves; por ahora se mezcla como señal pequeña
      sobre mercado (85% mercado / 15% modelo) porque el backtest histórico aún no supera al mercado.

Backtest real (760, walk-forward, baseline closing odds desvigado proporcional):
- Modelo DC+Elo puro: accuracy 0.3289, RPS 0.2811, log-loss 1.2093, Brier 0.7491, ECE 0.6666.
- Mercado: accuracy 0.5750, RPS 0.1883, log-loss 0.9330, Brier 0.5505, ECE 0.5571.

Pendiente para mejorar calidad (no bloqueante de integración):
- [ ] Calibrar DC/Elo y/o reparametrizar para superar baseline (RPS/log-loss/Brier/ECE).
- [ ] Comparar desvigado proporcional vs. Shin y medir ROI por umbral de edge/cuota.
- [ ] Añadir más ligas/temporadas y validación out-of-sample por liga.
- [ ] Cuando el modelo supere baseline, aumentar gradualmente su peso en `bettingAnalyzer.ts`.

## 4. Telemetría de picks (riesgo de deploy — revisar antes de publicar)

`[x]` La ruta API **no** registra telemetría (desactivada por riesgo Cloudflare/`node:fs`).
`[x]` `src/services/pickTelemetryStore.ts` convertido a builder puro sin `node:fs`/`process.cwd`;
      `recordPicksTelemetry` es no-op. Campos renombrados a `pModelWeight/pMarketWeight/pAnalystWeight`
      para reflejar que son pesos del blend.
`[x]` ID incluye timestamp completo ISO (no solo hora), reduciendo colisiones por petición.
`[x]` `src/app/api/ingest/curated/route.ts` tiene persistencia fs solo opt-in (`ENABLE_ETL_FS_PERSIST=1`) para evitar escrituras implícitas en runtime Workers.

Pendiente (bloqueante para reactivar en producción):
- [ ] Persistir en KV/D1/R2 o cron Node-only; definir esquema de dedupe/idempotencia.
- [ ] Guardar probabilidades reales por fuente además de pesos, si se necesitan para calibración.
- [ ] Implementar settlement de `result` cuando haya score final.

## 5. Hidratación SSR y caché (ya aplicada)

`[x]` `src/app/page.tsx` pasa `renderedAt` del servidor; `Dashboard.tsx` inicializa `now` con esa marca,
      lee `localStorage` dentro de `useEffect` y actualiza la hora al montar.
`[x]` `src/app/api/matches/route.ts:47-70`: TTL adaptativo (120 s si el partido está a ≤ 2 h,
      600 s si ≤ 24 h, 3600 s en adelante) y SWR = TTL/2 limitado a [60, 600].

- [ ] Verificar en producción los headers `Cache-Control`, `X-Data-Mode` y `X-Cache-TTL`, y que no
      haya warnings de hidratación. (requiere deploy/entorno desplegado)

## 6. Operaciones / CI (parcial)

`[x]` `.github/workflows/deploy-cloudflare.yml` hace checkout → `npm ci` → `npm run typecheck` →
      `npx cf deploy` con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
`[x]` `refresh-data.yml` refactoring periódico de semillas (cada 3 h).

- [ ] Añadir `npm run test:dates` y `npm run test:model` al workflow de deploy, antes de `cf deploy`.
- [ ] Confirmar en Cloudflare: secrets del worker `betstatspro`, binding KV `VINEXT_KV_CACHE`
      (`cloudflare.config.ts:15-17`) y que las semillas de `scripts/` estén commiteadas.
- [ ] Ejecutar `npm run build:vinext` antes de cualquier deploy manual. (operacional)

## Comandos de verificación

```bash
npm run typecheck                     # pasa
npm run test:dates                    # 14/14
npm run test:model                    # 6/6
npm run backtest                      # FALLA hoy: imports sin extensión .ts
npm run build:vinext                  # compilar antes de desplegar
npm run deploy:vinext                 # deploy manual (o push a main → workflow)
```

Fuente de verdad de la regla de edge: `README.md:189` y `src/lib/bettingAnalyzer.ts` (`qualifies`).
Si este documento entra en conflicto con el código, prevalece el código; actualizar este archivo al
cerrar cada reco.
