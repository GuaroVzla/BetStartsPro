# Integración de Apuestas Royal

Apuestas Royal protege el acceso con Cloudflare Turnstile, así que **el login
automático con usuario/clave no es fiable** (termina en
`CAPTCHA_TOKEN_NO_DISPONIBLE`). La integración usa una **sesión real iniciada por
el usuario** y lee las cuotas de la API autenticada que consume el propio lobby:

```
GET https://apuestasroyal.com/apiFunctions/lobby/sportWidget
Authorization: Bearer <token de localStorage.auth.token>
```

La respuesta trae `Fútbol.eventos[]` con `competidor1`, `competidor2`,
`fecha_hora`, `liga` y `odd_1x2` (`1`, `X`, `2`). Solo se publican esos precios:
**no se inventa ninguna cuota ni ningún partido**.

## 1. Exportar la sesión (una vez, y cada vez que caduque)

Abre un Chrome nuevo con depuración remota (perfil separado, no afecta tu Chrome
habitual) en PowerShell:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\royal-cdp-profile" `
  "https://www.apuestasroyal.com/index.php"
```

Inicia sesión en esa ventana (captcha incluido) y déjala abierta. Desde la raíz
del proyecto:

```bash
npm run royal:export
```

Eso genera `.royal-storage-state.json` con las cookies de `apuestasroyal.com` y
solo las claves de `localStorage` necesarias (`auth`, `operation`,
`geo.countryCode`, `location_confirmation_accepted`, `settings`,
`pageViewCookie`). El archivo pesa ~7.5 KB y está en `.gitignore`.

Si prefieres hacer login desde el propio script (sin Chrome previo), existe
`npm run royal:login`: abre una ventana visible con perfil `.royal-profile`,
espera a que completes el captcha y guarda el mismo archivo. La ventana debe
permanecer abierta hasta que el script termine.

### Secret de GitHub

Pega **todo el contenido** de `.royal-storage-state.json` como valor del secret
`ROYAL_STORAGE_STATE` (Settings → Secrets and variables → Actions → New
repository secret). El workflow lo inyecta como variable de entorno y el
capturador lo reconoce automáticamente porque empieza con `{`.

También puedes usar el archivo en local con `--state .royal-storage-state.json`
o con `ROYAL_STORAGE_STATE` apuntando a la ruta del archivo.

> Nunca subas `.royal-storage-state.json`, `.royal-profile/` ni `.env.local` al
> repositorio. Si la sesión expira, vuelve a exportarla y actualiza el secret.

## 2. Capturar cuotas reales

```bash
# Diagnóstico (no escribe nada)
node scripts/apuestas-royal-capture.mjs --state .royal-storage-state.json --dry-run

# Guardar la semilla oficial
node scripts/apuestas-royal-capture.mjs --state .royal-storage-state.json --write
```

También está el atajo `npm run capture:royal`, que usa la config por defecto
(`https://app.apuestasroyal.com/`). Salida esperada:

```
SESION_REUTILIZADA=storageState
API_ROYAL_HTTP=200
API_ROYAL_EVENTOS=15
COTIZACIONES_DETECTADAS=15
PAYLOAD=scripts/apuestas-royal-quotes.json TOTAL=15
```

El capturador cruza cada evento con `flashscore-payload.json` y
`flashscore-payload-manana.json` para reutilizar el `match_slug` oficial. Si no
hay cruce, genera uno con el mismo `slugify` de la UI. Opciones útiles: `--wait`,
`--fecha YYYY-MM-DD`, `--out <archivo>`, `--headed`, `--dry-run`, `--write`.

## 3. Inyectar en la web

```bash
# Token desde .env.local (no versionado)
$env:INGEST_TOKEN = ((Get-Content '.env.local' | Where-Object { $_ -match '^INGEST_TOKEN=' }) -replace '^INGEST_TOKEN=','').Trim()
node scripts/ingest-apuestas-royal.mjs --url http://localhost:3100/api/ingest/apuestas-royal
```

El validador recanonicaliza `match_slug`, descarta cotizaciones fuera de la
ventana hoy/mañana VET (salvo `--allow-stale`) y hace `POST` a
`/api/ingest/apuestas-royal`. `HTTP_STATUS: 201` confirma la ingesta.

### Persistencia

`src/services/apuestasRoyalIngestStore.ts` importa
`scripts/apuestas-royal-quotes.json` como semilla al arrancar. Así las cuotas
sobreviven al reinicio de isolates de Next.js/Cloudflare. El workflow de GitHub
Actions hace `git commit` de esa semilla cuando cambia; el push dispara el
deploy y la web queda actualizada sin depender del estado en memoria.

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
      "cuotas_1x2": { "local_1": 2.1, "empate_x": 3.4, "visitante_2": 3.6 },
      "capturado_en": "2026-11-23T15:30:00-04:00",
      "url": "https://app.apuestasroyal.com/",
      "nota": "Cuota 1X2 publicada por la API autenticada del lobby de Apuestas Royal"
    }
  ]
}
```

Reglas: `source` debe ser exactamente `apuestas_royal_agent`, `target_app`
`BetStats Pro`, `match_slug` `YYYY-MM-DD_equipo_vs_equipo`, `hora_local` `HH:mm`
y al menos una cuota decimal > 1 por cotización. Los `null` se conservan como
ausencia de precio y nunca sustituyen un valor válido.

## Actualización automática

`.github/workflows/refresh-data.yml` corre cada 3 horas y también con
`workflow_dispatch`:

1. Captura Apuestas Royal con `ROYAL_STORAGE_STATE`.
2. Refresca The Analyst y actualiza su semilla.
3. Inyecta todo en `SITE_URL` mediante `POST /api/ingest/*` con `INGEST_TOKEN`.
4. Commitea las semillas cambiadas; el push dispara el deploy.

Secrets necesarios: `ROYAL_STORAGE_STATE`, `INGEST_TOKEN` y `SITE_URL`. El mismo
`INGEST_TOKEN` debe existir como secret del Worker; si falta, los endpoints
responden `503`.

## Qué hace el motor después del cruce

1. Agrega Apuestas Royal como casa al resumen `1X2` del partido.
2. Recalcula mejor cuota, media y spread, y actualiza el favorito.
3. Compara el precio de Royal contra el resto del mercado.
4. El resumen `1X2` conserva a Royal como casa cuando su precio es el mejor.

## Solución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `SIN_SESION` al exportar | Chrome sin depuración o login no completado | Repetir el paso 1 y dejar la ventana abierta |
| `TOKEN_ROYAL_NO_DISPONIBLE` | Falta `auth` en el storageState | Repetir `npm run royal:export` con la sesión iniciada |
| `CAPTCHA_TOKEN_NO_DISPONIBLE` | Intentó login automático | Usar `--state` / `ROYAL_STORAGE_STATE` |
| `API_ROYAL_HTTP=401` | Token expirado | Volver a iniciar sesión y reexportar; actualizar el secret |
| `SIN_COTIZACIONES` | Widget sin eventos | Revisar sesión y ejecutar con `--headed` |
| `sin cotizaciones vigentes` | Fecha fuera de hoy/mañana VET | Nueva captura con `--write`; no usar `--allow-stale` salvo diagnóstico |
| `503` en `/api/ingest/*` | `INGEST_TOKEN` ausente o distinto | Configurar el mismo valor en `.env.local`, GitHub y el Worker |
