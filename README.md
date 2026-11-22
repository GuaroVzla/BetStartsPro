# BetStartsPro

Plataforma de analítica deportiva y comparación de cuotas multi-casa para **fútbol, básquet, béisbol y hockey**. Incluye modelo probabilístico, valor esperado, clasificaciones, rachas, rendimiento local/visitante y lesionados.

La interfaz prioriza los partidos de hoy en `America/Caracas` que aún no han comenzado. Las cuotas se cruzan con mercados reales disponibles y los valores que no se pueden verificar se muestran como `null` en lugar de inventarse.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript estricto
- Tailwind CSS 3.4
- Lucide React
- The Odds API + SportMonks + API-Sports
- Ingesta validada de cuotas de Triunfobet
- Cloudflare Workers mediante `vinext`
- Dataset mock automático sin claves

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

Sin variables de entorno la aplicación arranca automáticamente en **modo demo** con partidos realistas de los cuatro deportes, cuotas de cinco casas, clasificaciones, estadísticas y bajas.

## Cuotas de Triunfobet

Triunfobet no expone un feed público de cuotas. La integración se hace por ingesta controlada:

1. Se abre una sesión real en `https://triunfobet.com/login`.
2. Se leen las cuotas desde el DOM/shadow DOM del widget de eventos.
3. Se normalizan a decimal y se validan contra la lista de partidos activos.
4. Se envían a `POST /api/ingest/triunfobet`.

El payload y las reglas están documentados en `scripts/TRIUNFOBET.md`; `scripts/triunfobet-quotes.json` es un ejemplo con cotizaciones reales capturadas.

Las credenciales de Triunfobet solo deben pasarse por variables de entorno (`TB_USER`, `TB_PASS`) en el entorno donde se ejecute la captura; nunca deben versionarse.

Los badges de la interfaz significan:

- `👑 Favorito`: mejor resultado esperado dentro del consenso de mercados.
- `🔥 Hembra`: radar de cuota alta y valor positivo.
- `🔥 Hembra · Triunfobet`: favorito con mejor precio en Triunfobet y cuota ≥ 1.80. No implica por sí solo EV positivo.

## Variables de entorno

Crea `.env.local` a partir de `.env.example`:

```env
THE_ODDS_API_KEY=tu_clave_de_the_odds_api
SPORTMONKS_KEY=tu_token_de_sportmonks
APISPORTS_KEY=tu_clave_de_api_sports
TB_USER=tu_usuario_de_triunfobet
TB_PASS=tu_contraseña_de_triunfobet
```

- **The Odds API** se consulta con `regions=us,eu`, `markets=h2h` y `oddsFormat=decimal`. La interfaz muestra los créditos restantes de `x-requests-remaining`.
- **SportMonks** se consulta en Football v3 con el header `Authorization`. Aporta partidos y cuotas 1X2 de Premier League y Bundesliga en el plan free; sus créditos se leen de `rate_limit.remaining` / `x-ratelimit-remaining`. Si API-Sports no entrega eventos, SportMonks puede servir como fuente de partidos para esas ligas.
- **API-Sports** usa una única clave con el header `x-apisports-key` y enruta al host correspondiente: Football v3, Basketball v1, Baseball v1 y Hockey v1.
- Si una clave falta, la cuota se agota o una llamada falla, la capa de agregación activa el fallback mock sin romper la interfaz.

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
│  ├─ api/ingest/triunfobet/route.ts
│  ├─ api/matches/route.ts
│  ├─ globals.css
│  ├─ layout.tsx
│  ├─ page.tsx
│  └─ icon.svg
├─ components/
│  ├─ Dashboard.tsx
│  ├─ Navbar.tsx
│  ├─ MetricCards.tsx
│  ├─ OddsComparator.tsx
│  ├─ HighValueHighOddsList.tsx
│  ├─ MatchIntelDrawer.tsx
│  ├─ Footer.tsx
│  ├─ SportIcon.tsx
│  └─ TeamBadge.tsx
├─ config/sports.ts
├─ data/mockData.ts
├─ lib/
│  ├─ bettingAnalyzer.ts
│  ├─ format.ts
│  ├─ marketSummary.ts
│  └─ utils.ts
├─ services/
│  ├─ apiSportsService.ts
│  ├─ oddsApiService.ts
│  ├─ sportMonksService.ts
│  ├─ triunfobetIngestStore.ts
│  └─ matchAggregator.ts
└─ types/sports.ts
```

## Modelo probabilístico

1. Se normalizan los promedios anotados/recibidos frente a la media del deporte.
2. Se ponderan posición en la tabla, forma de los últimos cinco, ventaja de localía y bajas clave.
3. Fútbol, béisbol y hockey usan distribución de Poisson. Básquet usa un modelo logístico sobre el margen proyectado.
4. Probabilidad implícita = `1 / cuota`; valor esperado = `p × cuota − 1`.
5. Sin goles esperados, la probabilidad usa consenso de mercado depurado de margen y se etiqueta como `Prob. mercado`.
6. El radar filtra por defecto selecciones con `p ≥ 50%`, cuota `≥ 1.6` y `EV > 0` (ajustable desde la interfaz).

## Cloudflare Workers

La app puede ejecutarse en Cloudflare Workers con `vinext`. Cloudflare recomienda este método para aplicaciones Next.js full-stack.

```bash
npm run dev:vinext
npm run build:vinext
npm run deploy:vinext
```

El deploy usa el Worker `betstatspro` y publica el subdominio gratuito `*.workers.dev` asignado a la cuenta de Cloudflare. Para usar un dominio propio, el dominio debe estar agregado y verificado en la cuenta.

> Los stores de ingesta actuales están en memoria. En Workers cada isolate puede tener su propio estado; para producción con datos persistidos hay que sembrar los datos o migrar los stores a KV/D1.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm run dev:vinext
npm run build:vinext
npm run deploy:vinext
```

## Aviso

BetStartsPro es una herramienta informativa y estadística. No es una casa de apuestas ni garantiza resultados. Solo para mayores de 18 años. Juega con responsabilidad.
