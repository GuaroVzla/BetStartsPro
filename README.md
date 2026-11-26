# BetStartsPro

Plataforma de analítica deportiva para **fútbol, básquet, béisbol y hockey**. Incluye modelo probabilístico, valor esperado, clasificaciones, rachas, rendimiento local/visitante y lesionados.

La interfaz prioriza los partidos de hoy en `America/Caracas` que aún no han comenzado. Las cuotas se cruzan con mercados reales disponibles y los valores que no se pueden verificar se muestran como `null` en lugar de inventarse.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript estricto
- Tailwind CSS 3.4
- Lucide React
- The Odds API + SportMonks + API-Sports
- Ingesta validada de cuotas de Apuestas Royal
- Insights reales de The Analyst (xG, probabilidades y rachas)
- Cloudflare Workers mediante `vinext`
- Sin datos simulados: si faltan fuentes/claves, la UI muestra estado vacío y advertencias

## Deportes y ligas

| Deporte | Ligas |
| --- | --- |
| Fútbol | Premier League, LaLiga, Serie A, Bundesliga, Champions League |
| Básquet | NBA, Euroliga |
| Béisbol | MLB, LIDOM |
| Hockey | NHL |

## Inicio rápido

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Sin variables de entorno o sin datos de fuentes, la aplicación no usa datos simulados: mostrará advertencias y un estado vacío hasta configurar claves/fuentes reales.

### Depuración con F5 en VS Code

Pulsa **F5** con la configuración `BetStats Pro: F5 (typecheck + Next.js + navegador)`. Ejecuta `npm run typecheck`, inicia `next dev` en `http://localhost:3000` y abre Chrome con depuración full-stack (también puedes depurar las rutas API). La configuración alternativa `BetStats Pro: solo navegador (inicia servidor)` usa la tarea de fondo `dev: next` si solo necesitas depurar el cliente.

## Cuotas de Apuestas Royal

Apuestas Royal usa Cloudflare Turnstile, por lo que el login automático no es
confiable. Las cuotas se leen de la API autenticada del lobby
(`sportWidget`) con una sesión real exportada desde Chrome:

1. Abres Chrome con `--remote-debugging-port=9222` e inicias sesión.
2. `npm run royal:export` guarda `.royal-storage-state.json` (gitignored).
3. `node scripts/apuestas-royal-capture.mjs --state .royal-storage-state.json --write`
   genera `scripts/apuestas-royal-quotes.json` solo con precios observados.
4. `npm run ingest:royal` envía las cotizaciones vigentes a `/api/ingest/apuestas-royal`.

El payload, el secreto `ROYAL_STORAGE_STATE` y la resolución de problemas están
documentados en `scripts/APUESTAS-ROYAL.md`. No se inventan cuotas: lo que no se
puede verificar se conserva como `null`.

Los badges de la interfaz significan:

- `👑 Favorito`: mejor resultado esperado dentro del consenso de mercados.
- `🔥 Hembra`: radar de cuota alta y valor positivo.

## Actualización automática de datos

El workflow `.github/workflows/refresh-data.yml` se ejecuta cada 3 horas (y también manualmente con `workflow_dispatch`). Para cada corrida:

1. Captura los partidos de hoy y mañana desde Flashscore (móvil + escritorio + XHR de cuotas).
2. Captura Apuestas Royal reutilizando la sesión del secret `ROYAL_STORAGE_STATE` (Turnstile impide el login automático).
3. Descarga los artículos reales de The Analyst desde su REST API de WordPress.
4. Inyecta todo en la web desplegada mediante `POST /api/ingest/*` con el token `INGEST_TOKEN`.
5. Actualiza y hace commit de `scripts/flashscore-payload*.json`, `scripts/*-quotes.json` y `scripts/the-analyst-seed.json`. Ese push dispara el deploy a Cloudflare, de modo que el Worker incorpora los datos nuevos en su bundle aunque se reinicie un isolate.

Las semillas se importan directamente en los stores (`*IngestStore.ts` y
`theAnalystStore.ts`), así que los datos sobreviven al reinicio de isolates.

### Secrets que debes configurar en GitHub

| Secret | Descripción |
| --- | --- |
| `ROYAL_STORAGE_STATE` | Contenido completo de `.royal-storage-state.json`, exportado con `npm run royal:export`. Obligatorio para capturar Royal. |
| `BOOKMAKER_URL` | Opcional. Por defecto `https://app.apuestasroyal.com/`. |
| `INGEST_TOKEN` | Token compartido que protege los endpoints de ingesta. Genera uno largo y aleatorio. Debe coincidir con el secret del Worker. |
| `SITE_URL` | URL pública del sitio, sin barra final. |

Para Apuestas Royal, Turnstile bloquea la automatización: usa `ROYAL_STORAGE_STATE`. Cuando la sesión caduca, vuelve a exportarla con `npm run royal:export` y actualiza el secret; el capturador imprime `API_ROYAL_HTTP=401` o `TOKEN_ROYAL_NO_DISPONIBLE` y no sobrescribe la semilla.

También puedes ejecutar el flujo en local:

```bash
npm run capture:royal
npm run refresh:the-analyst
npm run ingest:royal
```

## Modo solo fuentes gratuitas (sin claves)

Configuración activa por defecto: el motor funciona sin ninguna clave premium.

```env
# .env.local mínimo
INGEST_TOKEN=token_largo_y_aleatorio
SITE_URL=http://localhost:3000
```

Con eso el dashboard se alimenta de:

- **ESPN** (pública, sin key): fixtures, estado, sede y moneyline 1X2. Usa `soccer/all` para cubrir todas las competiciones de fútbol del día y feeds de NBA, Euroliga, NCAA, MLB, ligas invernales y NHL.
- **OpenLigaDB** (pública, sin key): respaldo de Bundesliga.
- **Ingestas locales** ya capturadas (Flashscore, The Analyst, Apuestas Royal) y ETL curado.

Verificación:

```bash
npm run sources:check
```

Las fuentes premium se omiten solas si sus variables están vacías; no se inventan cuotas ni partidos. `THESPORTSDB_KEY` es opcional: sin una key propia la fuente se desactiva (la key pública `123` suele responder HTTP 429).

## Variables de entorno

Crea `.env.local` a partir de `.env.example`. Para habilitar cobertura premium añade:

```env
THE_ODDS_API_KEY=tu_clave_de_the_odds_api
SPORTMONKS_KEY=tu_token_de_sportmonks
APISPORTS_KEY=tu_clave_de_api_sports
ALLSPORTSAPI_KEY=tu_clave_de_allsportsapi
THERUNDOWN_API_KEY=tu_clave_de_therundown
BOOKMAKER_URL=https://app.apuestasroyal.com/
# Ruta al storageState exportado con `npm run royal:export` (nunca versionado).
ROYAL_STORAGE_STATE=.royal-storage-state.json
INGEST_TOKEN=token_largo_y_aleatorio
SITE_URL=https://betstatspro.tu-cuenta.workers.dev
```

- **The Odds API** se consulta con `regions=us,eu`, `markets=h2h` y `oddsFormat=decimal`. La interfaz muestra los créditos restantes de `x-requests-remaining`.
- **SportMonks** se consulta en Football v3 con el header `Authorization`. Aporta partidos y cuotas 1X2 de Premier League y Bundesliga en el plan free; sus créditos se leen de `rate_limit.remaining` / `x-ratelimit-remaining`. Si API-Sports no entrega eventos, SportMonks puede servir como fuente de partidos para esas ligas.
- **API-Sports** usa una única clave con el header `x-apisports-key` y enruta al host correspondiente: Football v3, Basketball v1, Baseball v1 y Hockey v1.
- Si una clave falta, la cuota se agota o una llamada falla, la capa de agregación devuelve advertencias y estado vacío (sin datos simulados).

## Caché y protección de cuotas

- Las llamadas de servidor usan `revalidate: 3600`.
- La ruta `GET /api/matches` devuelve `Cache-Control: s-maxage=3600, stale-while-revalidate=600`.
- El botón de actualización del cliente vuelve a solicitar `/api/matches`; los datos de API se sirven desde la caché de Next cuando está vigente.
- Las claves solo se leen en el servidor. Nunca se envían al navegador.

## Estructura principal

```text
src/
├─ app/
│  ├─ api/ingest/route.ts
│  ├─ api/matches/route.ts
│  ├─ globals.css
│  ├─ layout.tsx
│  ├─ page.tsx
│  └─ icon.svg
├─ components/
│  ├─ Dashboard.tsx
│  ├─ Navbar.tsx
│  ├─ MetricCards.tsx
│  ├─ HighValueHighOddsList.tsx
│  ├─ MatchIntelDrawer.tsx
│  ├─ Footer.tsx
│  ├─ SportIcon.tsx
│  └─ TeamBadge.tsx
├─ config/sports.ts
├─ data/ (datos generados; sin mock estático)
├─ lib/
│  ├─ bettingAnalyzer.ts
│  ├─ format.ts
│  ├─ marketSummary.ts
│  └─ utils.ts
├─ services/
│  ├─ apiSportsService.ts
│  ├─ oddsApiService.ts
│  ├─ sportMonksService.ts
│  ├─ apuestasRoyalIngestStore.ts
│  ├─ theAnalystStore.ts
│  └─ matchAggregator.ts
└─ types/sports.ts
```

## Modelo probabilístico

1. Se normalizan los promedios anotados/recibidos frente a la media del deporte.
2. Se ponderan posición en la tabla, forma de los últimos cinco, ventaja de localía y bajas clave.
3. Fútbol, béisbol y hockey usan distribución de Poisson. Básquet usa un modelo logístico sobre el margen proyectado.
4. Probabilidad implícita = `1 / cuota`; valor esperado = `p × cuota − 1`.
5. Sin goles esperados, la probabilidad usa consenso de mercado depurado de margen y se etiqueta como `Prob. mercado`.
6. El radar filtra selecciones con `p ≥ 50%`, cuota `≥ 1.6`, `edge desvigado ≥ 2%` y `EV > 0`. El edge canónico compara la probabilidad del modelo contra la implícita desvigada (proporcional); la implícita raw se conserva solo como observabilidad.

## Cloudflare Workers

La app puede ejecutarse en Cloudflare Workers con `vinext`. Cloudflare recomienda este método para aplicaciones Next.js full-stack.

```bash
npm run dev:vinext
npm run build:vinext
npm run deploy:vinext
```

El deploy usa el Worker `betstatspro` y publica el subdominio gratuito `*.workers.dev` asignado a la cuenta de Cloudflare. Para usar un dominio propio, el dominio debe estar agregado y verificado en la cuenta.

> Los stores combinan memoria con semillas importadas desde `scripts/*-quotes.json`
> y `scripts/the-analyst-seed.json`. Así, aunque cada isolate de Workers arranque
> vacío, la web muestra las últimas cuotas e insights confirmados por el workflow
> de actualización. Para persistencia instantánea sin redeploy haría falta KV/D1.

## Publicar desde GitHub (enlace gratis)

El repositorio `https://github.com/GuaroVzla/BetStartsPro` incluye el workflow `.github/workflows/deploy-cloudflare.yml`. Cada `push` a `main` compila y publica el Worker automáticamente.

> **Importante:** Cloudflare no registra dominios gratis. Lo que incluye el plan Free es un subdominio `*.workers.dev` (por ejemplo `https://betstatspro.tu-cuenta.workers.dev`). Ese es el enlace público sin costo. Un dominio propio como `misitio.com` requiere comprarlo en un registrador y apuntar sus nameservers a Cloudflare.

### 1. Preparar la cuenta de Cloudflare

1. Crea la cuenta en https://dash.cloudflare.com/sign-up.
2. Copia el **Account ID**: aparece al abrir **Workers y Pages** o en la URL del dashboard (`dash.cloudflare.com/<account-id>/...`).
3. Ve a **Mi perfil → API Tokens → Create Token** y usa la plantilla **Edit Cloudflare Workers**, o crea un token personalizado con:
   - `Account → Workers Scripts → Edit`
   - `Account → Account Settings → Read`
4. Copia el token cuando se muestre (solo aparece una vez).

### 2. Enlazar GitHub con Cloudflare

1. En GitHub entra a **Settings → Secrets and variables → Actions → New repository secret**.
2. Crea estos dos secretos:
   - `CLOUDFLARE_ACCOUNT_ID` → el Account ID del paso anterior.
   - `CLOUDFLARE_API_TOKEN` → el token del paso anterior.
3. Haz un `push` a `main` o ejecuta el workflow manualmente en **Actions → Deploy a Cloudflare Workers → Run workflow**.

### 3. Ver la web en línea

Al terminar el workflow, abre **Workers y Pages → betstatspro → Dominios y rutas** en https://dash.cloudflare.com/ y encontrarás la URL `https://betstatspro.<tu-cuenta>.workers.dev`. El mismo enlace se imprime en el log del job de GitHub Actions.

La app no usa datos simulados. Sin claves/fuentes configuradas mostrará estado vacío y advertencias; para datos reales agrega `THE_ODDS_API_KEY`, `SPORTMONKS_KEY` y `APISPORTS_KEY` como **Variables y secretos del Worker** en Cloudflare (no como secretos de GitHub), porque se leen en tiempo de ejecución dentro del Worker.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm run test:dates
npm run test:model
npm run test:etl
npm run sources:check
npm run etl:validate -- scripts/flashscore-payload.json
npm run etl:apis -- --dry-run
npm run dev:vinext
npm run build:vinext
npm run deploy:vinext
```

## ETL automatizado

La estrategia de ingesta diaria (fuentes, esquema canónico, validación, idempotencia y workflows) está documentada en [`docs/ETL_PIPELINE.md`](docs/ETL_PIPELINE.md).

- `refresh-apis.yml`: extrae APIs oficiales cada 30 min y puede ingestar payload curado en `/api/ingest/curated`.
- `refresh-data.yml`: scrapers/seeds (Flashscore, Apuestas Royal, The Analyst) cada 3h.
- `deploy-cloudflare.yml`: typecheck + tests + deploy.

## Notas de QA y producción

- `/api/matches` devuelve el catálogo completo (~515 KB sin comprimir). Cloudflare aplica gzip automáticamente: el mismo payload ocupa **~46 KB** (91 % menos), por debajo del umbral de 100 KB. No se añadió paginación para no cambiar el contrato que consume el dashboard.
- Versiones fijadas para cerrar advisories: `postcss@8.5.33`, `vite@8.3.8` y override transitivo `fflate@0.8.3`. `npm audit --omit=dev` → **0 vulnerabilidades**. No ejecutar `npm audit fix --force`: instalaría `next@16` / `vinext@0.2.1` (breaking).
- Las rutas `/api/ingest/*` exigen `INGEST_TOKEN` tanto en `POST` como en `DELETE`. Todas las respuestas incluyen cabeceras de seguridad (CSP, HSTS, `nosniff`, Referrer-Policy, X-Frame-Options, Permissions-Policy).
- Secretos pendientes de configurar fuera del repo: `ROYAL_STORAGE_STATE`, `INGEST_TOKEN` y `SITE_URL` en GitHub Actions.

## Aviso

BetStartsPro es una herramienta informativa y estadística. No es una casa de apuestas ni garantiza resultados. Solo para mayores de 18 años. Juega con responsabilidad.

