# Integración de Apuestas Royal

No se publica una URL por defecto: en la revisión del **23/11/2026** no se
encontró un sitio público verificable de Apuestas Royal. Por eso
`scripts/bookmaker-capture.mjs --casa apuestas-royal` exige `--url` (o la variable
`BOOKMAKER_URL`) y **no se inventa ningún endpoint ni ninguna cuota**.

La fuente debe ser una página real del sitio del usuario, abierta con sesión
iniciada. El capturador lee únicamente cuotas visibles en el DOM (incluidos
shadow roots) y lista las respuestas XHR como diagnóstico; no las usa como
precio si no están en pantalla.

## Captura

```bash
# 1) Diagnóstico sin escribir nada. Reemplace SITIO-VERIFICADO por la URL real.
node scripts/apuestas-royal-capture.mjs --url https://SITIO-VERIFICADO --dry-run

# 2) Con perfil persistente (sesión ya iniciada en esa carpeta):
node scripts/apuestas-royal-capture.mjs --url https://SITIO-VERIFICADO --profile C:/ruta/perfil-apuestas-royal --dry-run

# 3) Si el perfil no basta, inspeccione el estado de sesión en modo visible:
node scripts/apuestas-royal-capture.mjs --url https://SITIO-VERIFICADO --headed --profile C:/ruta/perfil-apuestas-royal --wait 25000 --dry-run

# 4) Solo cuando las cuotas impresas sean correctas:
node scripts/apuestas-royal-capture.mjs --url https://SITIO-VERIFICADO --profile C:/ruta/perfil-apuestas-royal --write
```

También se acepta `--state <storageState.json>` en lugar de `--profile`.

Opciones útiles: `--wait 25000` (espera del widget), `--fecha YYYY-MM-DD`
(default: hoy en VET), `--out <archivo>`, `--headed`, `--dry-run`, `--write`.

El capturador:

- usa Playwright con `locale: es-VE`, `timezoneId: America/Caracas` y un
  User-Agent de Chrome realista;
- pulsa `APUESTAS DEPORTIVAS` si aparece ese acceso;
- recorre shadow DOM y busca `EventBoxRoot` / `EventBox`, `OddValue`, `OddLabel`,
  participantes y marcas de hora/fecha;
- acepta cuotas decimales y americanas (`-184` → `1.543`) y descarta valores
  `<= 1`;
- cruza nombres con `flashscore-payload.json` y
  `flashscore-payload-manana.json` para reutilizar el `match_slug` oficial. Si
  no hay cruce, genera uno con el mismo `slugify` de la UI;
- imprime `XHR_RELEVANTES` **solo para diagnosticar** selectores o sesión;
- omite eventos sin al menos dos equipos y dos cuotas y los muestra en
  `EVENTOS_OMITIDOS`.

`--dry-run` nunca sobreescribe la semilla. Si imprime `SIN_COTIZACIONES`, no se
escribe nada.

## Formato del payload

`POST /api/ingest/apuestas-royal`

```json
{
  "target_app": "BetStats Pro",
  "source": "apuestas_royal_agent",
  "sync_mode": "enrich_or_create",
  "fecha_extraccion": "2026-11-23",
  "zona_horaria": "America/Caracas",
  "total_cotizaciones": 1,
  "cotizaciones": [
    {
      "match_slug": "2026-11-24_arsenal_vs_borussia-dortmund",
      "deporte": "Fútbol",
      "liga": "Champions League",
      "fecha_local": "2026-11-24",
      "hora_local": "16:00",
      "equipo_local": "Arsenal",
      "equipo_visitante": "Borussia Dortmund",
      "mercado": "1X2",
      "cuotas_1x2": { "local_1": null, "empate_x": null, "visitante_2": null },
      "capturado_en": "2026-11-23T15:30:00-04:00",
      "url": "https://SITIO-VERIFICADO",
      "nota": "Cuota visible en el widget con sesión iniciada"
    }
  ]
}
```

Los `null` del ejemplo son solo ilustrativos: la API exige **al menos una cuota
decimal > 1** por cotización. El capturador rellena únicamente los precios que
ve en pantalla; nunca los estima.

Reglas:

- `source` debe ser exactamente `apuestas_royal_agent` y `target_app`,
  `BetStats Pro`.
- `match_slug` se recalcula en la ingesta con el mismo `slugify` de la UI
  (`YYYY-MM-DD_equipo_vs_equipo`, sin tildes ni stopwords como `fc`, `real`,
  `city`). No hace falta escribirlo a mano.
- `fecha_local` debe ser hoy o mañana en VET (`America/Caracas`, UTC-4); la
  ingesta descarta cotizaciones fuera de esa ventana salvo `--allow-stale`.
- `hora_local` usa `HH:mm`; `capturado_en`, ISO con offset `-04:00`.
- `mercado` acepta `1X2`, `ganador` o `moneyline`.

## Carga

```bash
node scripts/ingest-apuestas-royal.mjs --dry-run
node scripts/ingest-apuestas-royal.mjs scripts/apuestas-royal-quotes.json
```

El validador recanonicaliza `match_slug`, elimina duplicados, comprueba la
ventana VET y hace `POST` a `http://localhost:3000/api/ingest/apuestas-royal`
(o a `--url` / `ROYAL_INGEST_URL`). `HTTP_STATUS: 201` significa ingesta válida;
`422`, esquema inválido.

> `scripts/apuestas-royal-quotes.json` es hoy un marcador de posición con
> `total_cotizaciones: 0`. Hasta que se haga una captura real con `--write`, la
> carga termina con `sin cotizaciones vigentes`. No se agregaron precios
> ficticios para "rellenar" el archivo.

Los stores son en memoria: después de reiniciar la app hay que repetir la
ingesta.

## Qué hace el motor después del cruce

1. Agrega Apuestas Royal como casa al resumen `1X2` del partido.
2. Recalcula mejor cuota, media y spread, y actualiza el favorito.
3. Compara la cuota de Apuestas Royal contra Triunfobet y el resto del mercado.
4. El comparador resalta cuando el mejor precio viene de Apuestas Royal.

## Solución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `URL_REQUERIDA` | No se pasó la página verificada | Agregar `--url https://...` o exportar `BOOKMAKER_URL` |
| `SIN_COTIZACIONES` | Sin sesión / widget no renderiza | `--headed`, iniciar sesión, subir `--wait` |
| `EVENT_BOXES=0` | Cambiaron los selectores del sitio | Inspeccionar el DOM y ajustar `bookmaker-capture.mjs` (solo `scripts/`) |
| `COTIZACIONES_DETECTADAS=0` con eventos | No hay `OddValue` visibles o faltan equipos | Revisar `EVENTOS_OMITIDOS` y la sesión |
| `sin cotizaciones vigentes` | Semilla vacía o fecha fuera de hoy/mañana VET | Captura nueva con `--write`; no usar `--allow-stale` salvo diagnóstico |
| `match_slug inválido` | Nombres vacíos o caracteres raros | El capturador normaliza; revise el JSON si se editó a mano |
| `422` en la API | `source` incorrecto, cuotas `<= 1` o `hora_local` inválida | Enviar `null` / `HH:mm` y conservar `source: apuestas_royal_agent` |
