# Integración de Triunfobet (widget Altenar)

Triunfobet sirve el sportsbook de Altenar en `https://triunfobet.com/altenar`.
Sin sesión iniciada el widget solo carga configuración, traducciones y
autenticación: **no expone un feed público de eventos/cuotas**. Por eso no se
inventa ninguna cuota; el dashboard solo recibe precios efectivamente visibles
en pantalla.

## Captura (con sesión)

```bash
# 1) Diagnóstico sin escribir nada: muestra shadow roots, event boxes y XHR.
node scripts/triunfobet-capture.mjs --dry-run

# 2) Con perfil persistente (nombre de usuario/contraseña ya guardados en esa carpeta):
node scripts/triunfobet-capture.mjs --profile C:/ruta/perfil-triunfobet --dry-run

# 3) Si el perfil no basta, inicie sesión en modo visible con --headed:
node scripts/triunfobet-capture.mjs --headed --profile C:/ruta/perfil-triunfobet --dry-run

# 4) Solo cuando las cuotas impresas sean correctas:
node scripts/triunfobet-capture.mjs --profile C:/ruta/perfil-triunfobet --write
```

Opciones útiles: `--wait 25000` (espera del widget), `--profile <directorio>` (perfil
persistente con la sesión ya iniciada) o `--state <storageState.json>`,
`--fecha YYYY-MM-DD` (por defecto, hoy en VET), `--out <archivo>`.

### Login con credenciales (automatización)

Si `TB_USER` y `TB_PASS` están definidos, el capturador abre
`TRIUNFOBET_LOGIN_URL` (por defecto `https://triunfobet.com/login`), rellena el
formulario y continúa hacia el widget. No necesitas `--profile` ni `--state`.

```bash
TB_USER=tu_usuario TB_PASS=tu_clave node scripts/triunfobet-capture.mjs --write
```

Los selectores por defecto son genéricos (`input[name="username"]`,
`input[type="password"]`, `button[type="submit"]`, ...). Si el formulario real
difiere, ajusta `TB_USER_SELECTOR`, `TB_PASS_SELECTOR` y `TB_SUBMIT_SELECTOR`.
El script imprime `LOGIN_OK`, `LOGIN_FALLIDO` o
`LOGIN_SELECTORES_NO_ENCONTRADOS` para que sepas qué pasó. Con CAPTCHA o 2FA no
se escriben semillas.

El workflow `.github/workflows/refresh-data.yml` usa este modo cada 3 horas con
los secrets `TB_USER` y `TB_PASS`.

El capturador:

- intercepta las respuestas XHR de `sb2frontend-altenar2.biahosted.com` y lista
  los endpoints observados **solo como diagnóstico** (no se inventa un API);
- recorre los shadow DOM y busca `EventBoxRoot`, `OddValue`, `OddLabel`,
  participantes y marca de hora;
- cruza los nombres con `flashscore-payload.json` y
  `flashscore-payload-manana.json` para reutilizar el `match_slug` oficial;
- convierte cuotas americanas (`-184`, `+350`) a decimales (`1.543`, `4.5`).

Si `COTIZACIONES_DETECTADAS=0`, no modifica la semilla. Revise
`XHR_RELEVANTES` y ejecute con `--headed` para verificar el estado de sesión.

## Formato del payload

`POST /api/ingest/triunfobet`

```json
{
  "target_app": "BetStats Pro",
  "source": "triunfobet_agent",
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
      "cuotas_1x2": { "local_1": 2.1, "empate_x": 3.7, "visitante_2": 3.4 },
      "capturado_en": "2026-11-23T15:30:00-04:00",
      "url": "https://triunfobet.com/altenar",
      "nota": "Cuota visible en el widget Altenar con sesión iniciada"
    }
  ]
}
```

Reglas:

- `match_slug` se recalcula en la ingesta con el mismo `slugify` de la UI
  (`YYYY-MM-DD_equipo_vs_equipo`, sin tildes ni stopwords como `fc`, `real`,
  `city`). No hace falta escribirlo a mano; el capturador lo genera.
- `fecha_local` debe ser hoy o mañana en VET; la ingesta descarta cotizaciones
  fuera de esa ventana salvo `--allow-stale`.
- Todo valor no visible se envía como `null`. El servidor rechaza cuotas `<= 1`.
- `mercado` acepta `1X2`, `ganador` o `moneyline`.

## Carga

```bash
node scripts/ingest-triunfobet.mjs --dry-run
node scripts/ingest-triunfobet.mjs scripts/triunfobet-quotes.json
```

`HTTP_STATUS: 201` significa ingesta válida; `422`, esquema inválido.

> `scripts/triunfobet-quotes.json` conserva 20 cotizaciones reales capturadas el
> **22/11/2026**. Están fuera de la ventana actual (23/24): se omiten con un
> mensaje claro hasta que se haga una captura nueva. No se alteraron ni se
> inventaron precios.

## Qué hace el motor después del cruce

1. Agrega a Triunfobet como casa al resumen `1X2` del partido.
2. Recalcula mejor cuota, media y spread, y actualiza el favorito.
3. Compara la cuota de Triunfobet contra el resto del mercado.
4. Marca como **🔥 Hembra** las selecciones favoritas (o con probabilidad ≥ 60%)
   con cuota ≥ 1.85 y valor esperado positivo.
5. El resumen `1X2` conserva a Triunfobet como casa cuando su precio es el mejor
   del mercado, para que el radar pueda mostrarlo como origen de la cuota.

## Solución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `COTIZACIONES_DETECTADAS=0` | Sin sesión / widget no renderiza | `--headed`, iniciar sesión, subir `--wait` |
| `sin cotizaciones vigentes` | Semilla antigua (22/11) | Captura nueva con `--write` |
| `match_slug inválido` | Nombres vacíos o caracteres raros | El capturador ya normaliza; revise el JSON |
| `422` en la API | Cuota `<= 1` o `hora_local` con formato inválido | Enviar `null` / `HH:mm` |
