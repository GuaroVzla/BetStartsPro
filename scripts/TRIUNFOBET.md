# Integración de Triunfobet (widget Altenar)

Triunfobet sirve el sportsbook de Altenar en `https://triunfobet.com/altenar`.
El widget carga los eventos y las cuotas **en el navegador**, dentro de shadow
DOM, con precios en formato americano. No se inventa ninguna cuota: el dashboard
solo recibe precios efectivamente visibles en pantalla.

## ⚠️ Limitación crítica: IP residencial

La API de Altenar (`sb2frontend-altenar2.biahosted.com/api/...`) está detrás de
un WAF de Cloudflare que devuelve **403 para IPs de datacenter**:

| Origen | Resultado |
| --- | --- |
| GitHub Actions (cron `0 */3 * * *`) | `URL_STATUS=403`, `COTIZACIONES_DETECTADAS=0` |
| Cloudflare Worker (`betstatspro`) | 403 en todos los endpoints `Widget/*` |
| Navegador local en IP residencial | `URL_STATUS=200`, ~96 cotizaciones |

El endpoint auxiliar `mpc2-prod-21-is5qnl632q-uc.a.run.app/events?cee=no`
tampoco responde fuera del contexto del widget (404 desde otras IPs), así que
**no existe un feed HTTP consultable desde el cron ni desde el Worker**.

Consecuencia: el cron de GitHub (IP de datacenter) **no puede refrescar
Triunfobet**. Por eso `refresh-triunfobet.yml` corre en un runner residencial:
abre el widget público y, cuando no hay cuotas, **no sobrescribe** la semilla.
La ruta duradera es la captura local descrita abajo + commit + push (el workflow
`deploy-cloudflare.yml` reedploya el Worker con la semilla incluida en el
bundle).

## Captura local (funciona sin login)

Requiere un navegador **visible** (`--headed`) en la máquina del usuario:

```bash
# 1) Diagnóstico: shadow roots, event boxes, XHR y cuotas detectadas.
node scripts/triunfobet-capture.mjs --dry-run --headed --wait 30000

# 2) Solo cuando las cuotas impresas sean correctas:
node scripts/triunfobet-capture.mjs --write --headed --wait 30000
```

Referencia de una captura válida:

```
URL_STATUS=200 URL=https://triunfobet.com/altenar
DOM_SHADOW_ROOTS=1 EVENT_BOXES=322 XHR_RELEVANTES=36
COTIZACIONES_DETECTADAS=96
  2026-11-24_galatasaray_vs_aston-villa | {"local_1":3.65,"empate_x":3.6,"visitante_2":1.952}
```

Opciones útiles: `--wait <ms>` (espera del widget), `--out <archivo>` y
`--fecha YYYY-MM-DD` (por defecto, hoy en VET).

No se usan credenciales ni `storageState` de Triunfobet: el widget público
muestra cuotas sin iniciar sesión y esa sesión tampoco evita el bloqueo por IP.

## Conversión de cuotas

El widget usa formato americano. La conversión correcta es:

- Positivas: `decimal = 1 + valor / 100` (`+260` → `3.6`)
- Negativas: `decimal = 1 + 100 / |valor|` (`-103` → `1.971`)

`scripts/bookmaker-capture.mjs` aplica esta regla y guarda el valor original en
`cuotas_americanas` cuando está disponible.

## Formato del payload

`POST /api/ingest/triunfobet`

```json
{
  "target_app": "BetStats Pro",
  "source": "triunfobet_agent",
  "sync_mode": "enrich_or_create",
  "fecha_extraccion": "2026-11-24",
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
      "cuotas_1x2": { "local_1": 1.469, "empate_x": 4.75, "visitante_2": 6.33 },
      "capturado_en": "2026-11-24T15:30:00-04:00",
      "url": "https://triunfobet.com/altenar",
      "nota": "Cuota visible en el widget con sesión; convertida a decimal"
    }
  ]
}
```

Reglas:

- `match_slug` se recalcula en la ingesta con el mismo `slugify` de la UI
  (`YYYY-MM-DD_equipo_vs_equipo`); el capturador lo genera.
- `fecha_local` debe ser hoy o mañana en VET; fuera de esa ventana se descarta
  salvo `--allow-stale`.
- Todo valor no visible se envía como `null`. El servidor rechaza cuotas `<= 1`.
- `mercado` acepta `1X2`, `ganador` o `moneyline`.

## Carga y durabilidad

```bash
node scripts/ingest-triunfobet.mjs --dry-run
node scripts/ingest-triunfobet.mjs scripts/triunfobet-quotes.json \
  --url https://betstatspro.oswaldoserrano18.workers.dev/api/ingest/triunfobet
```

`HTTP_STATUS: 201` significa ingesta válida. **El store es en memoria por
isolate**: el POST actualiza solo el isolate que lo recibe. Para que todas las
instancias vean las cuotas hay que commitear `scripts/triunfobet-quotes.json` y
hacer push a `main`; `deploy-cloudflare.yml` reedploya el Worker con la semilla
incluida.

> `scripts/triunfobet-quotes.json` conserva 96 cotizaciones reales capturadas el
> **24/11/2026** desde IP residencial; 17 cruzan con partidos del dataset de
> Flashscore. No se alteraron ni se inventaron precios.

## Qué hace el motor después del cruce

1. Agrega a Triunfobet como casa al resumen `1X2` del partido.
2. Recalcula mejor cuota, media y spread, y actualiza el favorito.
3. Compara la cuota de Triunfobet contra el resto del mercado.
4. Marca como **🔥 Hembra** las selecciones favoritas (o con probabilidad ≥ 60%)
   con cuota ≥ 1.85 y valor esperado positivo.
5. `meta.sources.triunfobet` pasa a `true` cuando al menos una cuota se cruzó.

## Solución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `URL_STATUS=403` en GitHub/Worker | IP de datacenter bloqueada por Cloudflare | Capturar en local con `--headed` |
| `COTIZACIONES_DETECTADAS=0` | Widget no renderizó | Subir `--wait`, usar `--headed` |
| Cuotas ~`1.38` en favoritos | Conversión americana antigua | Verificar `americanToDecimal()` |
| `sin cotizaciones vigentes` | Semilla fuera de ventana VET | Captura nueva con `--write` |
| Ingesta 201 pero `triunfobet:false` | Store por isolate / semilla no desplegada | Commitear semilla y push a `main` |
| `422` en la API | Cuota `<= 1` o `hora_local` inválida | Enviar `null` / `HH:mm` |
