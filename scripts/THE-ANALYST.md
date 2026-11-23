# Integración de The Analyst (Opta Analyst)

Fuente nueva e independiente: `https://theanalyst.com/`. No sustituye a
Flashscore, TriunfoBet ni Apuestas Royal; añade **contexto estadístico**
(probabilidades del supercomputer Opta, xG, forma/rachas y H2H) para cruzar con
esos proveedores.

## Qué se encontró en el sitio

- La home y varias rutas HTML (`/articles/...`, `/competition/match-preview/articles`,
  `/opta-football-match-centre`) responden **403** a clientes HTTP directos.
- La **REST API de WordPress** sí responde con headers realistas:
  `GET https://theanalyst.com/wp-json/wp/v2/posts?search=prediction&per_page=20`.
  Cada post trae `title.rendered`, `content.rendered`, `date_gmt`, `link` y
  `yoast_head_json.schema` (con `articleSection` para la liga).
- Los artículos de previa incluyen en prosa las tres probabilidades, p. ej.
  «Chelsea ... 51.1% likelihood of victory ... Leeds 24% ... draw 24.8%».
- Las visualizaciones están en iframes de `https://dataviz.theanalyst.com/`
  (contenido JS dinámico; parámetros `competitionId`, `seasonId`, `matchId`).

Por eso el conector usa la API JSON como fuente primaria y un parser HTML
defensivo (selectores configurables) como respaldo. El script de Playwright
permite además descubrir los XHR/JSON de dataviz. **Nunca se inventan datos**:
si el sitio bloquea o no expone un valor, se guarda `null` y una advertencia.

## Archivos

| Archivo | Función |
| --- | --- |
| `src/services/theAnalystService.ts` | Tipos, extracción pura de probabilidades/métricas, connector y parser configurable. |
| `src/services/theAnalystStore.ts` | Store en memoria con semilla desde `scripts/the-analyst-seed.json`. |
| `src/services/theAnalystAdapter.ts` | Normalización de equipos/ligas y cruce con las demás fuentes. |
| `src/app/api/ingest/the-analyst/route.ts` | `POST/GET/DELETE /api/ingest/the-analyst`. |
| `scripts/the-analyst-scrape.mjs` | Captura con Playwright (y modes `--discover`). |
| `scripts/the-analyst-seed.json` | Artículos reales verificados el 23/11/2026. |

## Comandos

```bash
# Capturar artículos de previa (salida, límite, búsqueda)
node scripts/the-analyst-scrape.mjs scripts/the-analyst-payload.json 20 prediction

# Descubrir endpoints XHR/JSON de los iframes de dataviz
node scripts/the-analyst-scrape.mjs scripts/the-analyst-payload.json 5 prediction --discover

# Subir lo capturado
curl -X POST http://localhost:3000/api/ingest/the-analyst \
  -H "Content-Type: application/json" \
  --data-binary @scripts/the-analyst-payload.json

# Consultar / limpiar
curl http://localhost:3000/api/ingest/the-analyst
curl -X DELETE http://localhost:3000/api/ingest/the-analyst
```

La semilla ya incluye tres artículos reales (Chelsea–Leeds, Man City–Napoli y
Newcastle–Arsenal) con probabilidades literales del texto. `GET` los devuelve
aunque la web se reinicie: el store se rehidrata desde el JSON.

## Formato del payload

```json
{
  "target_app": "BetStats Pro",
  "source": "the_analyst_agent",
  "sync_mode": "enrich_or_create",
  "fecha_extraccion": "2026-11-23",
  "zona_horaria": "America/Caracas",
  "total_registros": 1,
  "advertencias": [],
  "registros": [
    {
      "articulo_id": "269148",
      "titulo": "Chelsea vs Leeds Prediction: Premier League Preview",
      "url": "https://theanalyst.com/articles/...",
      "fecha_publicacion": "2026-11-21T12:20:57.000Z",
      "tipo": "match_preview",
      "liga": "Premier League",
      "equipo_local": "Chelsea",
      "equipo_visitante": "Leeds United",
      "resumen": "Texto literal del artículo (máx. 260 chars)",
      "insight": {
        "match_slug": "2026-11-21_chelsea_vs_leeds-united",
        "fecha_partido": "2026-11-21",
        "deporte": "Fútbol",
        "liga": "Premier League",
        "equipo_local": "Chelsea",
        "equipo_visitante": "Leeds United",
        "probabilidades": {
          "home": 0.511, "draw": 0.248, "away": 0.24, "inferidas": []
        },
        "metricas": {
          "xg_local": null, "xg_visitante": null,
          "forma_local": "W3 D1 L1", "forma_visitante": null,
          "racha_local": null, "racha_visitante": null, "h2h_resumen": null
        },
        "resumen": "51,1% / 24,8% / 24,0% según Opta supercomputer",
        "metodo": "articulo",
        "confianza": "media"
      },
      "capturado_en": "2026-11-23T14:00:00.000Z",
      "notas": null
    }
  ]
}
```

Reglas de validación del `POST`:

- `target_app`, `source` y `sync_mode` deben ser los valores mostrados.
- `fecha_extraccion` y `insight.fecha_partido`: `YYYY-MM-DD`.
- `fecha_publicacion` / `capturado_en`: ISO válida o `null`.
- Probabilidades: número en `[0, 1]` o `null`; `inferidas` solo contiene
  `home`, `draw` o `away`. Si faltaba una, se calcula `1 - (las otras dos)` y
  se marca en `inferidas` (no se presenta como dato publicado).
- `tipo`: `match_preview | prediction | stats | otro`; `metodo`:
  `articulo | dataviz | manual`; `confianza`: `alta | media | baja`.
- Todo lo no visible se envía como `null`; el servidor no rellena huecos con
  valores inventados. Un `insight` sin ninguna probabilidad se rechaza (422).

## Funciones puras y cruce

- `extractWinProbabilities(texto, local, visitante)` y
  `normalizeProbabilities(...)`: probabilidad 1X2 con detección de contexto
  (descarta posesión/tiros/xG) e inferencia marcada de la tercera.
- `extractKeyMetrics(texto, local, visitante)`: xG, forma (`W3 D1 L1`),
  rachas narradas y H2H.
- `fairOddsFromProbabilities(insight.probabilidades)`: cuotas justas `1/p`.
- `canonicalTeamName`, `canonicalLeagueName`, `findTheAnalystMatch`:
  normalizan con `normalizeName` de `src/lib/utils.ts` y alias internos, y
  cruzan por slug, equipos (incluso invertidos), fecha VET (±1 día, vía
  `dateInVETOffset`) y liga. Funciona con filas de Flashscore, TriunfoBet y
  Apuestas Royal porque comparten `equipo_local`/`equipo_visitante`.
- `enrichSportsMatchesWithTheAnalyst`: añade una nota al `intel` de los
  partidos del dashboard; no altera cuotas ni favoritos.

## Limitaciones

- Las probabilidades son **editoriales/modelo** publicadas en artículos, no
  cuotas de casino; comparar con `fairOdds` es orientativo.
- Algunos artículos dan solo dos probabilidades o ninguna: la tercera se
  infiere (campo `inferidas`) o queda `null`.
- El xG en prosa a veces corresponde a una temporada o a un tipo de jugada
  (p. ej. «xG from set-pieces 6.1»), no al partido: el parser solo lo asigna
  cuando el contexto lo permite; si hay duda se deja `null`.
- `fecha_partido` no siempre figura en el texto: en ese caso es `null` y el
  cruce usa la fecha de publicación con tolerancia de un día.
- Store en memoria: tras reiniciar el proceso, recargar el payload o usar la
  semilla incluida.
- La API REST puede cambiar o empezar a bloquear: ajusta `apiBaseUrl`,
  `jsonPaths`, `htmlSelectors` y `request.headers` desde
  `DEFAULT_THE_ANALYST_CONFIG` o con `--discover`.
