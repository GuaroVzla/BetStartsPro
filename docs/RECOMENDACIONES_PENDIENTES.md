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

Pendiente de esta área:

- [ ] `src/lib/marketSummary.ts:82-88`: `devigShin` calcula `clampedZ` pero la fórmula usa `z` sin clamp.
      Usar `clampedZ` y exponer `devigMethod` como configuración real (hoy siempre `"proportional"`).
- [ ] Unificar el umbral de edge: `buildValueFavoritePicks` (`src/lib/bettingAnalyzer.ts`, ~L842) tiene
      `minEdge` con default 0 y no lo aplica en el filtro; `src/components/TopPicks.tsx:76` usa `edge ≥ 0.08`
      hardcodeado. Ambos deben usar la regla de 2 % (0.02).
- [ ] `blendDescription` / `probabilitySource` (`src/lib/bettingAnalyzer.ts`, ~L570-590 y ~L653) siguen
      narrando "mercado 100 %" aunque `analyzeMatch` ya use DC/Elo + 25 % de mercado cuando el artefacto
      esté poblado (L711-725). Hacer que la UI lea los pesos realmente usados.
- [ ] Limpiar imports muertos: `formatInteger` (`bettingAnalyzer.ts:18`), `devigProportional` y `OddsSource`
      (`valueEngine.ts:2,7`).

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

Pendiente de esta área:

- [ ] `minScore = 7` en `theAnalystAdapter.ts` hace inalcanzable la rama `swapped` en el agregador
      (un cruce invertido puntúa como máximo 4). Bajar el umbral / subir el peso de equipos invertidos,
      o eliminar el código de inversión.
- [ ] `src/lib/utils.ts:75-77`: la comparación de largos usa `b`/`a` en vez de `shorter`/`larger`.
- [ ] Se necesitan **splits casa/visita y xG reales** desde algún proveedor: los tipos ya tienen
      `xgFor/xgAgainst/xpts` (`src/types/sports.ts:151-158`) pero `deriveStats` los deja a 0 y
      `hasGoalStatistics` (`bettingAnalyzer.ts:388-396`) descarta `table-derived`, así que el modelo
      Poisson local queda inactivo. Reactivar `distribucionH2H` solo con un campo `intel.h2h` estructurado.
- [ ] Limpiar variables sin uso en `matchAggregator.ts` (`awayPlayed/awayWins/awayDraws`, parámetro
      `sport`), `distribucionH2H`, `favoriteFromOdds`, `dateInVETOffset`.

## 3. Modelo histórico Dixon-Coles + Elo (librerías listas, integración muerta)

`[x]` `src/lib/dixonColes.ts`: tau, 1X2 truncado/renormalizado, MLE ponderado por fecha con priors,
      `lambdasForMatch`.
`[x]` `src/services/ratingService.ts`: Elo con decaimiento, margen de victoria, snapshots y 1X2.
`[x]` `src/services/modelParamsStore.ts`: carga estáticamente el artefacto (Worker-safe, sin filesystem).
`[x]` `scripts/backtest.ts`: walk-forward, mezcla DC 0.7 / Elo 0.3, métricas accuracy, RPS, log-loss,
      Brier y ECE(10).
`[ ]` `src/data/model-params.json` está **vacío** (`attack: {}`, `defense: {}`, `elo: {}`), por lo que
      `modelProbabilities()` (`bettingAnalyzer.ts:50-59`) devuelve `null` y la rama histórica nunca corre.
`[ ]` `data/historical-results.json` es `[]`: el backtest no tiene datos.
`[ ]` `npm run backtest` **falla** con `ERR_MODULE_NOT_FOUND`: los imports relativos de
      `scripts/backtest.ts:10,17` no llevan extensión `.ts` bajo `--experimental-strip-types`.

Orden de ejecución recomendado:

1. Arreglar los imports de `scripts/backtest.ts` (añadir `.ts` o cambiar a `tsx`/`vite-node`).
2. Poblar `data/historical-results.json` con resultados reales: `id`, `date`, equipos, goles y
   `closingOdds: { home, draw, away }` (sin `closingOdds` no hay baseline de mercado ni ROI).
3. Correr `npm run backtest` y revisar accuracy / RPS / log-loss / Brier / ECE.
4. Calibrar `rho`, `xiPerDay`, `homeAdvantage` (DC) y `k`, `homeAdvantage`, `decayPerDay` (Elo);
   comparar desvigado proporcional vs. Shin y medir ROI por umbral de edge y de cuota, no solo RPS.
5. Crear el script `artifact:build`: ejecutar `fitDixonColesModel` + `buildEloSnapshots` sobre el
   histórico y escribir `src/data/model-params.json`. Los `leagueId`/claves deben coincidir con los
   candidatos de `findTeamKey` (`bettingAnalyzer.ts:35-48`: nombre, shortName e id). Ejecutarlo y
   commitear el artefacto generado.
6. Añadir tests de Dixon-Coles (normalización, tau, decaimiento), del store de artefacto y un
   walk-forward determinista; `npm run test:model` ya existe pero solo cubre mercado/nombres.

## 4. Telemetría de picks (riesgo de deploy — revisar antes de publicar)

`[x]` `src/services/pickTelemetryStore.ts` escribe JSONL en `data/pick-telemetry.jsonl`.
`[x]` La llamada desde `GET /api/matches` quedó **desactivada antes del deploy de esta sesión**: el
      bundle del Worker arrastraba `import ... from "node:fs/promises"` y podía romper la ruta en
      Cloudflare. Queda un comentario en `src/app/api/matches/route.ts` apuntando a esta sección.

Pendiente (bloqueante para producción):

- [ ] `pModel/pMarket/pAnalyst` guardan `pick.blend.model/market/analyst`, que son **pesos**, no
      probabilidades. Guardar las probabilidades reales de cada fuente.
- [ ] `outcomeResult` está sin uso y `result` nunca se settlea. Llamarlo cuando haya resultado del partido.
- [ ] El `id` se repite por hora y petición (`match:outcome:YYYY-MM-DDTHH`): deduplicar.
- [ ] `node:fs/promises` + `process.cwd()` no son fiables en Cloudflare Workers. Migrar la telemetría
      a KV/D1 o a un cron Node-only; la llamada era fire-and-forget con errores silenciados.
      **No reactivar `recordPicksTelemetry` en la ruta API hasta completar la migración.**
- [ ] Quitar el import sin uso `ValuePick` (`pickTelemetryStore.ts:3`).

## 5. Hidratación SSR y caché (ya aplicada)

`[x]` `src/app/page.tsx` pasa `renderedAt` del servidor; `Dashboard.tsx` inicializa `now` con esa marca,
      lee `localStorage` dentro de `useEffect` y actualiza la hora al montar.
`[x]` `src/app/api/matches/route.ts:47-70`: TTL adaptativo (120 s si el partido está a ≤ 2 h,
      600 s si ≤ 24 h, 3600 s en adelante) y SWR = TTL/2 limitado a [60, 600].

- [ ] Verificar en producción los headers `Cache-Control`, `X-Data-Mode` y `X-Cache-TTL`, y que no
      haya warnings de hidratación.

## 6. Operaciones / CI (parcial)

`[x]` `.github/workflows/deploy-cloudflare.yml` hace checkout → `npm ci` → `npm run typecheck` →
      `npx cf deploy` con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
`[x]` `refresh-data.yml` y `refresh-triunfobet.yml` refactoring periódico de semillas (cada 3 h).

- [ ] Añadir `npm run test:dates` y `npm run test:model` al workflow de deploy, antes de `cf deploy`.
- [ ] Confirmar en Cloudflare: secrets del worker `betstatspro`, binding KV `VINEXT_KV_CACHE`
      (`cloudflare.config.ts:15-17`) y que las semillas de `scripts/` estén commiteadas.
- [ ] Ejecutar `npm run build:vinext` antes de cualquier deploy manual.

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
