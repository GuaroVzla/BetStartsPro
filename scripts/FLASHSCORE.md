# Captura de Flashscore (hoy y mañana, VET)

`scripts/flashscore-scrape.mjs` genera **un payload por día** porque el
adaptador (`src/services/flashscoreAdapter.ts`) usa `fecha_extraccion` global
como fecha del partido, no un campo por partido. Por eso existen:

- `scripts/flashscore-payload.json` → hoy en VET (`dateInVETOffset(0)`)
- `scripts/flashscore-payload-manana.json` → mañana en VET (`dateInVETOffset(1)`)

VET = `America/Caracas`, UTC-04:00 sin horario de verano. Las fechas se
calculan con `Intl.DateTimeFormat(..., timeZone: "America/Caracas")`, nunca con
`new Date().toISOString()` (que daría UTC y cambiaría el día antes de medianoche).

## Fuentes y selectores verificados (23/11/2026)

1. **Versión móvil** `http://m.flashscore.com.ve/?d=0|1`: HTML server-rendered,
   sin JS. Contenedor `#score-data`, ligas en `<h4>`, filas
   `<span>HH:MM</span>Equipo A - Equipo B <a href="/partido/{mid}/" class="sched">`.
   Es la fuente base de fixtures; no depende de Cloudflare ni de CORS.
2. **Escritorio** `https://www.flashscore.com.ve/` y
   `https://www.flashscore.com.ve/futbol/manana/`: Playwright con user-agent de
   Chrome, `locale: es-VE`, `timezoneId: America/Caracas`. Selectores vigentes:
   `#live-table .event__match`, `.headerLeague__wrapper`,
   `.event__homeParticipant`, `.event__awayParticipant`, `.event__time`,
   `a.eventRowLink[href*="mid="]`, `.event__odd--odd1|2|3` (tras pulsar
   `.filters__text` con texto `CUOTAS`).
3. **XHR de cuotas** interceptados desde la propia respuesta del navegador:
   `https://global.flashscore.ninja/<id>/x/feed/fo_1_<día>_-4_es-ve_1_0`.
   Las peticiones `fetch` directas desde Node devuelven `401`; por eso se leen
   con `page.on("response")`. Formato observado: registros separados por `¬~`,
   campos `clave÷valor`, `AA` = `mid`, `YA/YB/YC` = cuotas actuales 1/X/2
   (`XA/XB/XC` = apertura). El `-4` del path confirma el offset VET.
4. **Detalle móvil** `/partido/{mid}/?t=clasificacion` y
   `?t=enfrentamiento-directo`: tablas `.standings` y `.h2h` para posiciones,
   rachas (V/E/D) y resumen H2H.

## Comandos

```bash
# Diagnóstico: imprime qué se capturó SIN sobreescribir semillas.
node scripts/flashscore-scrape.mjs --dry-run

# Captura normal (hoy + mañana).
node scripts/flashscore-scrape.mjs

# Con enriquecimiento de posiciones/rachas/H2H para los primeros 30 partidos por día.
node scripts/flashscore-scrape.mjs --details 30

# Un solo día / rutas custom.
node scripts/flashscore-scrape.mjs --days 1 --out scripts/flashscore-payload-manana.json

# Solo móvil, sin navegador (más rápido; sin cuotas).
node scripts/flashscore-scrape.mjs --no-desktop

# Diagnóstico profundo de DOM/XHR (no escribe nada).
node scripts/flashscore-diagnose.mjs --odds --feed-body
node scripts/flashscore-diagnose.mjs --url https://www.flashscore.com.ve/futbol/manana/
```

Opciones: `--timeout 20000`, `--details N` (default 0), `--mobile-base URL`,
`--desktop-base URL`, `--no-desktop`.

## Carga en la app

```bash
node scripts/ingest-payload.mjs --dry-run
node scripts/ingest-payload.mjs
# o un archivo explícito:
node scripts/ingest-payload.mjs scripts/flashscore-payload-manana.json
```

`ingest-payload.mjs` valida `fecha_extraccion` (hoy/mañana VET), el formato de
`match_slug`, duplicados y cuotas > 1 antes de hacer POST. El store importa
`flashscore-payload.json` como semilla al arrancar, y el workflow
`.github/workflows/refresh-data.yml` actualiza ambos payloads cada 3 horas; el
push resultante dispara el deploy para que el Worker incluya los partidos nuevos.

## Estructura del payload

```json
{
  "target_app": "BetStats Pro",
  "source": "flashscore_agent",
  "sync_mode": "enrich_or_create",
  "fecha_extraccion": "2026-11-24",
  "zona_horaria": "America/Caracas",
  "total_partidos": 235,
  "partidos": [
    {
      "match_slug": "2026-11-24_arsenal_vs_borussia-dortmund",
      "deporte": "Fútbol",
      "liga": "EUROPA: Champions League - Fase de liga",
      "fecha_local": "2026-11-24",
      "hora_local": "16:00",
      "estado": "Programado",
      "equipo_local": "Arsenal",
      "equipo_visitante": "Borussia Dortmund",
      "cuotas_1x2": { "local_1": 2.1, "empate_x": 3.7, "visitante_2": 3.4 },
      "estadisticas_complementarias": {
        "posicion_local": null,
        "posicion_visitante": null,
        "racha_local_ultimos_5": null,
        "racha_visitante_ultimos_5": null,
        "h2h_resumen": null
      }
    }
  ]
}
```

`match_slug` usa el mismo `slugify` que `src/lib/utils.ts`: sin tildes, sin
stopwords (`fc`, `real`, `city`, `de`, ...) y guiones en lugar de espacios.
Por eso `Manchester City` genera `manchester` y `Real Madrid`, `madrid`. Así
coinciden las claves de Flashscore, Triunfobet y Apuestas Royal.

## Solución de problemas

| Síntoma | Causa | Acción |
| --- | --- | --- |
| `sin #score-data` | cambió la versión móvil / bloqueo | Ver `MOBILE_STATUS` en `flashscore-diagnose.mjs` |
| `sin .event__match` | cambió el DOM o no cargó el feed | `flashscore-diagnose.mjs --odds --feed-body` |
| `con_cuotas=0` | no se activó la pestaña CUOTAS o el feed 401 | Verificar `pestaña_cuotas` y `feeds_cuotas` |
| Partidos de ayer | fecha UTC envez de VET | No usar `toISOString()`; ya está corregido |
| `422 match_slug inválido` | nombre vacío o carácter no ASCII | Revisar `normalizeName`/`slugify` en `ingest-utils.mjs` |
| `PAYLOAD_VACIO` | ambos sources fallaron | Revisar `diagnostico.errores`; el script no sobreescribe la semilla |
