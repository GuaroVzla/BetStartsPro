# Integración de Triunfobet

Triunfobet sirve el sportsbook de Altenar dentro de un widget que solo carga
configuración, traducciones y autenticación mientras no hay sesión iniciada.
No expone un feed público de eventos/cuotas, por lo que **no se inventa ninguna
cuota**: el crucero se alimenta únicamente con precios visibles capturados por
el usuario o por un agente con sesión.

## Formato del payload

`POST /api/ingest/triunfobet`

```json
{
  "target_app": "BetStats Pro",
  "source": "triunfobet_agent",
  "sync_mode": "enrich_or_create",
  "fecha_extraccion": "2026-11-22",
  "zona_horaria": "America/Caracas",
  "total_cotizaciones": 1,
  "cotizaciones": [
    {
      "match_slug": "2026-11-22_equipo-local_vs_equipo-visitante",
      "deporte": "Fútbol",
      "liga": "Venezuela: Liga FUTVE",
      "fecha_local": "2026-11-22",
      "hora_local": "18:00",
      "equipo_local": "Nombre exacto visible en Triunfobet",
      "equipo_visitante": "Nombre exacto visible en Triunfobet",
      "mercado": "1X2",
      "cuotas_1x2": {
        "local_1": 2.35,
        "empate_x": 3.1,
        "visitante_2": 2.8
      },
      "capturado_en": "2026-11-22T14:30:00-04:00",
      "url": "https://triunfobet.com/altenar",
      "nota": "Cuota visible en la pantalla de 1X2"
    }
  ]
}
```

Reglas:

- `match_slug` es opcional; si se omite, el cruce se hace por nombres de equipo
  y `fecha_local` en hora de Venezuela.
- Todo valor no visible se envía como `null`. El servidor rechaza cuotas `<= 1`
  y no las transforma en números válidos.
- `mercado` acepta `1X2` (por defecto), `ganador` o `moneyline`.
- `GET /api/ingest/triunfobet` lista las cotizaciones activas y
  `DELETE /api/ingest/triunfobet` las borra.

## Carga

```bash
node scripts/ingest-triunfobet.mjs scripts/triunfobet-quotes.json http://localhost:3000/api/ingest/triunfobet
```

La respuesta imprime `HTTP_STATUS: 201` cuando la ingesta es válida y `422`
cuando el esquema no cumple estas reglas. Tras reiniciar `npm run start` hay que
recargar tanto el payload de Flashscore como el de Triunfobet: ambos stores son
en memoria.

## Qué hace el motor después del cruce

1. Agrega a Triunfobet como casa de apuestas al resumen `1X2` del partido.
2. Recalcula mejor cuota, media y spread, y actualiza el favorito (cuota más
   baja entre local y visitante).
3. Compara la cuota de Triunfobet contra el resto del mercado.
4. Marca como **🔥 Hembra** las selecciones favoritas (o con probabilidad ≥ 60%)
   con cuota ≥ 1.85 y valor esperado positivo, ordenando por rentabilidad.
5. En el comparador, **🔥 Hembra · Triunfobet** destaca al favorito con cuota
   ≥ 1.80 cuyo mejor precio viene de Triunfobet; no implica EV positivo.

## Captura real del 22/11/2026

`scripts/triunfobet-quotes.json` contiene 20 cotizaciones 1X2 tomadas del widget
Altenar con sesión autenticada y convertidas de formato americano a decimal.
En la ingesta inicial, 18 cruzaron con partidos del dashboard. Los valores se
capturaron desde el shadow DOM del widget (`EventBoxRoot`, `OddLabel`,
`OddValue`); no se inventó ninguna cuota. La sesión temporal y los scripts de
login se eliminaron después de la captura.
