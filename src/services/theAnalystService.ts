/**
 * Conector de The Analyst (Opta Analyst).
 *
 * El sitio publica sus artículos y analíticas a través de la REST API de
 * WordPress (`/wp-json/wp/v2/posts`). Las páginas HTML y los iframes de
 * dataviz están protegidos por CDN y parte del contenido es dinámico, así que
 * este módulo intenta primero la fuente JSON, permite selectores/rutas
 * configurables como respaldo HTML y NUNCA inventa métricas: si no hay datos,
 * devuelve null y una advertencia explícita.
 */

import { dateInVET } from "@/lib/format";

export type ProbabilityOutcome = "home" | "draw" | "away";

export type TheAnalystProbabilities = {
  /** Probabilidad de victoria local (0-1). */
  home: number | null;
  /** Probabilidad de empate (0-1). */
  draw: number | null;
  /** Probabilidad de victoria visitante (0-1). */
  away: number | null;
  /** Claves calculadas como 1 - (las otras dos); no aparecen en el artículo. */
  inferidas: ProbabilityOutcome[];
};

export type TheAnalystAdvancedMetrics = {
  xg_local: number | null;
  xg_visitante: number | null;
  /** Forma reciente textual, p. ej. "W3 D1 L1". */
  forma_local: string | null;
  forma_visitante: string | null;
  /** Racha narrada en el artículo (máx. ~180 caracteres). */
  racha_local: string | null;
  racha_visitante: string | null;
  h2h_resumen: string | null;
};

export type TheAnalystMatchInsight = {
  match_slug: string | null;
  fecha_partido: string | null;
  deporte: string;
  liga: string | null;
  equipo_local: string;
  equipo_visitante: string;
  probabilidades: TheAnalystProbabilities;
  metricas: TheAnalystAdvancedMetrics;
  resumen: string | null;
  metodo: "articulo" | "dataviz" | "manual";
  confianza: "alta" | "media" | "baja";
};

export type TheAnalystRecord = {
  articulo_id: string;
  titulo: string;
  url: string;
  fecha_publicacion: string;
  tipo: "match_preview" | "prediction" | "stats" | "otro";
  liga: string | null;
  equipo_local: string | null;
  equipo_visitante: string | null;
  resumen: string | null;
  insight: TheAnalystMatchInsight | null;
  capturado_en: string | null;
  notas: string | null;
};

export type TheAnalystPayload = {
  target_app: "BetStats Pro";
  source: "the_analyst_agent";
  sync_mode: "enrich_or_create";
  fecha_extraccion: string;
  zona_horaria: string;
  total_registros: number;
  registros: TheAnalystRecord[];
  advertencias?: string[];
};

export type TheAnalystScrapeConfig = {
  apiBaseUrl: string;
  datavizPredictionsUrl: string;
  request: {
    headers: Record<string, string>;
    timeoutMs: number;
    retries: number;
  };
  query: {
    search: string;
    perPage: number;
    orderBy: string;
    order: "asc" | "desc";
  };
  jsonPaths: {
    items: string;
    id: string;
    title: string;
    content: string;
    date: string;
    link: string;
  };
  htmlSelectors: {
    article: string;
    title: string;
    content: string;
    date: string;
    link: string;
  };
};

/** Configuración por defecto; se puede sobrescribir parcialmente. */
export const DEFAULT_THE_ANALYST_CONFIG: TheAnalystScrapeConfig = {
  apiBaseUrl: "https://theanalyst.com/wp-json/wp/v2/posts",
  datavizPredictionsUrl:
    "https://dataviz.theanalyst.com/opta-football-predictions/?ticker=true",
  request: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9,es;q=0.8",
      Referer: "https://theanalyst.com/",
    },
    timeoutMs: 25_000,
    retries: 2,
  },
  query: {
    search: "prediction",
    perPage: 20,
    orderBy: "date",
    order: "desc",
  },
  jsonPaths: {
    items: "",
    id: "id",
    title: "title.rendered",
    content: "content.rendered",
    date: "date_gmt",
    link: "link",
  },
  htmlSelectors: {
    article: "article",
    title: "h1",
    content: ".entry-content",
    date: "time",
    link: "link",
  },
};

/** Alias observados en titulares de The Analyst y en otros proveedores. */
export const THE_ANALYST_TEAM_ALIASES: Record<string, string[]> = {
  manchestercity: ["man city", "mancity", "manchester city", "city"],
  manchesterunited: ["man utd", "man united", "manchester united", "red devils"],
  tottenhamhotspur: ["spurs", "tottenham", "tottenham hotspur"],
  arsenal: ["arsenal", "gunners"],
  chelsea: ["chelsea", "blues"],
  liverpool: ["liverpool", "reds"],
  brightonhovealbion: ["brighton", "brighton hove albion"],
  newcastleunited: ["newcastle", "newcastle united", "magpies"],
  leedsunited: ["leeds", "leeds united", "whites"],
  nottinghamforest: ["nottingham", "notts forest", "nottingham forest"],
  atleticodemadrid: ["atletico madrid", "atletico de madrid", "atlético de madrid"],
  interdemilan: ["inter", "inter milan", "internazionale"],
  acmilan: ["ac milan", "milan"],
  sscnapoli: ["napoli", "napoles", "nápoles", "ssc napoli"],
  borussiadortmund: ["borussia dortmund", "bvb", "dortmund"],
  bayernmunich: ["bayern munich", "bayern múnich", "bayern"],
  realmadryt: ["real madrid", "real madrryt"],
  barcelona: ["barca", "barcelona", "fc barcelona"],
};

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
  egrave: "è",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
};

const OUTCOMES: ProbabilityOutcome[] = ["home", "draw", "away"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string): string {
  const fromCodePoint = (code: number): string => {
    try {
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    } catch {
      return "";
    }
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Convierte HTML de WordPress a texto conservando saltos de párrafo/lista. */
export function htmlToText(html: string): string {
  return decodeHtml(html)
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|tr|section|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Slug compatible con los otros stores (YYYY-MM-DD_equipo_vs_equipo). */
export function slugifyTeam(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Devuelve el nombre canónico y alias útiles para encontrarlo en un artículo. */
export function aliasesForTeam(name: string): string[] {
  const clean = name.trim().replace(/\s+/g, " ");
  const key = normalizeKey(clean);
  for (const [canonical, aliases] of Object.entries(THE_ANALYST_TEAM_ALIASES)) {
    if (key === canonical || aliases.some((alias) => normalizeKey(alias) === key)) {
      return [clean, ...aliases];
    }
  }
  return [clean];
}

function distanceToName(text: string, aliases: string[], index: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const alias of aliases) {
    const needle = alias.toLowerCase();
    if (needle.length < 3) continue;
    let from = 0;
    while (from < text.length) {
      const found = text.toLowerCase().indexOf(needle, from);
      if (found < 0) break;
      best = Math.min(best, Math.abs(found + needle.length - index));
      from = found + 1;
    }
  }
  return best;
}

function parsePercent(raw: string): number | null {
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value) || value < 1 || value > 99) return null;
  return Math.round((value / 100) * 1000) / 1000;
}

/** Frase que contiene un índice, con su posición absoluta de inicio. */
function sentenceAround(text: string, index: number): { text: string; start: number } {
  const matches = Array.from(text.matchAll(/[.!?]\s+|\n+/g));
  let start = 0;
  for (const match of matches) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > index) {
      return { text: text.slice(start, (match.index ?? 0) + 1), start };
    }
    start = end;
  }
  return { text: text.slice(start), start };
}

/** Distancia mínima desde un índice hasta alguna de las palabras buscadas. */
function distanceIn(text: string, needles: string[], index: number): number {
  let best = Number.POSITIVE_INFINITY;
  const haystack = text.toLowerCase();
  for (const needle of needles) {
    const word = needle.toLowerCase();
    if (word.length < 3) continue;
    let from = 0;
    while (from < haystack.length) {
      const found = haystack.indexOf(word, from);
      if (found < 0) break;
      best = Math.min(best, Math.abs(found + word.length - index));
      from = found + 1;
    }
  }
  return best;
}

function finiteProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return Math.round(value * 1000) / 1000;
}

/** Rellena (y marca) la probabilidad ausente cuando solo faltan dos de tres. */
export function normalizeProbabilities(input: {
  home: number | null;
  draw: number | null;
  away: number | null;
  inferidas?: ProbabilityOutcome[];
}): TheAnalystProbabilities {
  const values: Record<ProbabilityOutcome, number | null> = {
    home: finiteProbability(input.home),
    draw: finiteProbability(input.draw),
    away: finiteProbability(input.away),
  };
  const inferidas = (input.inferidas ?? []).filter((key) =>
    OUTCOMES.includes(key),
  );
  const present = OUTCOMES.filter((key) => values[key] !== null);
  if (present.length === 2) {
    const sum = present.reduce((acc, key) => acc + (values[key] ?? 0), 0);
    const missing = OUTCOMES.find((key) => values[key] === null);
    if (missing && sum > 0 && sum < 0.995) {
      values[missing] = Math.round((1 - sum) * 1000) / 1000;
      if (!inferidas.includes(missing)) inferidas.push(missing);
    }
  }
  return { ...values, inferidas };
}

export function fairOddsFromProbabilities(
  probabilities: TheAnalystProbabilities,
): Record<ProbabilityOutcome, number | null> {
  const odds = (value: number | null): number | null =>
    value !== null && value > 0 ? Math.round((1 / value) * 100) / 100 : null;
  return {
    home: odds(probabilities.home),
    draw: odds(probabilities.draw),
    away: odds(probabilities.away),
  };
}

type ProbabilityCandidate = { value: number; score: number };

/**
 * Extrae home/draw/away del texto de un artículo. Cada porcentaje se puntúa
 * como candidato a los tres resultados según su cercanía a cada equipo/palabra
 * "draw"; después se elige la terna cuyo suma se acerca más al 100%. Así se
 * evita asignar el mismo porcentaje a dos outcomes y se descartan porcentajes
 * de posesión/tiros/xG. La tercera probabilidad, si falta, se infiere y marca.
 */
export function extractWinProbabilities(
  text: string,
  homeName: string,
  awayName: string,
): TheAnalystProbabilities {
  const homeAliases = aliasesForTeam(homeName);
  const awayAliases = aliasesForTeam(awayName);
  const drawWords = ["draw", "drawn", "empate", "stalemate"];
  const signalRe =
    /\b(chance|probability|likelihood|simulations?|victory|win|winning|favourit\w*|favorite|outcome|points)\b/i;
  const noiseRe =
    /\b(possession|shots?|pass(?:es|ing)?|duels?|accuracy|xG|conversion rate|expected goals|tackles|fouls|corners)\b/i;
  const strongHomeRe =
    /\b(overcam\w*|home win|heavy favourit\w*|come out on top|hosts|prevailed)\b/i;
  const strongAwayRe = /\b(upset|away win|visitors|underdog)\b/i;
  const options: Record<ProbabilityOutcome, ProbabilityCandidate[]> = {
    home: [],
    draw: [],
    away: [],
  };

  for (const match of text.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/g)) {
    const value = parsePercent(match[1]);
    if (value === null) continue;
    const index = match.index ?? 0;
    const sentence = sentenceAround(text, index);
    if (noiseRe.test(sentence.text) && !signalRe.test(sentence.text)) continue;
    const local = index - sentence.start;
    const bonus = signalRe.test(sentence.text) ? -40 : 40;
    const homeDistance = distanceIn(sentence.text, homeAliases, local);
    const awayDistance = distanceIn(sentence.text, awayAliases, local);
    const drawDistance = distanceIn(sentence.text, drawWords, local);
    const homeBonus = strongHomeRe.test(sentence.text) ? -70 : 0;
    const awayBonus = strongAwayRe.test(sentence.text) ? -45 : 0;
    const candidates: Array<{ outcome: ProbabilityOutcome; score: number }> = [
      {
        outcome: "home",
        score:
          (Number.isFinite(homeDistance) ? homeDistance : 420) + bonus + homeBonus,
      },
      {
        outcome: "away",
        score:
          (Number.isFinite(awayDistance) ? awayDistance : 420) + bonus + awayBonus,
      },
      {
        outcome: "draw",
        score: (Number.isFinite(drawDistance) ? drawDistance : 420) + bonus,
      },
    ];
    for (const candidate of candidates) {
      if (candidate.score < 340) {
        options[candidate.outcome].push({ value, score: candidate.score });
      }
    }
  }

  let best:
    | {
        cost: number;
        values: Record<ProbabilityOutcome, number | null>;
      }
    | null = null;
  for (const home of [null, ...options.home]) {
    for (const draw of [null, ...options.draw]) {
      for (const away of [null, ...options.away]) {
        const chosen = [home, draw, away].filter(
          (item): item is ProbabilityCandidate => item !== null,
        );
        if (chosen.length < 2) continue;
        const sum = chosen.reduce((acc, item) => acc + item.value, 0);
        if (sum < 0.9 || sum > 1.02) continue;
        const distinct = new Set(chosen.map((item) => item.value)).size;
        const cost =
          Math.abs(1 - sum) * 1000 +
          chosen.reduce((acc, item) => acc + item.score, 0) +
          (distinct === chosen.length ? 0 : 400) +
          (chosen.length === 2 ? 20 : 0);
        if (!best || cost < best.cost) {
          best = {
            cost,
            values: {
              home: home?.value ?? null,
              draw: draw?.value ?? null,
              away: away?.value ?? null,
            },
          };
        }
      }
    }
  }

  if (!best) {
    const pick = (outcome: ProbabilityOutcome): number | null =>
      options[outcome].sort((a, b) => a.score - b.score)[0]?.value ?? null;
    return normalizeProbabilities({
      home: pick("home"),
      draw: pick("draw"),
      away: pick("away"),
    });
  }
  return normalizeProbabilities(best.values);
}

function parseForm(raw: string): string {
  const match = /^([WDL])\s*(\d+)\s*[Dd]\s*(\d+)\s*[Ll]\s*(\d+)$/.exec(raw.trim());
  if (!match) return raw.trim();
  const [, first, a, b, c] = match;
  if (first === "W") return `W${a} D${b} L${c}`;
  if (first === "D") return `W${b} D${a} L${c}`;
  return `W${b} D${c} L${a}`;
}

function findSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function streakSentence(text: string, aliases: string[]): string | null {
  const streakRe =
    /\b(unbeaten|undefeated|winning run|straight (?:win|victory|victories)|without (?:a win|losing|conceding)|won\s+\w+\s+of\s+(?:their|his|the)\s+(?:last|past)|lost\s+\w+\s+of\s+(?:their|the)\s+(?:last|past)|racha|consecutivas?)\b/i;
  const sentences = findSentences(text).filter((sentence) => streakRe.test(sentence));
  const withName = sentences.find((sentence) =>
    aliases.some((alias) => alias.length > 3 && sentence.toLowerCase().includes(alias.toLowerCase())),
  );
  const chosen = withName ?? sentences[0] ?? null;
  return chosen ? chosen.slice(0, 180) : null;
}

function h2hSentence(text: string): string | null {
  const sentences = findSentences(text);
  const index = sentences.findIndex((sentence) =>
    /\b(head-to-head|head to head|meetings|h2h|enfrentamientos)\b/i.test(sentence),
  );
  if (index < 0) return null;
  return sentences.slice(index, index + 2).join(" ").slice(0, 240);
}

function xgFromContext(context: string): number | null {
  const pair = /xG[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*(?:-|–|—|vs\.?|v)\s*(\d+(?:[.,]\d+)?)/i.exec(context);
  if (pair) return Number(pair[1].replace(",", "."));
  const window = context.slice(Math.max(0, context.indexOf("xG") - 80), context.indexOf("xG") + 140);
  const single = /xG[^0-9]{0,80}?(\d{1,2}(?:[.,]\d{1,2})?)/i.exec(window);
  if (!single) {
    const before = /(\d{1,2}(?:[.,]\d{1,2})?)[^0-9]{0,40}xG/i.exec(window);
    return before ? Number(before[1].replace(",", ".")) : null;
  }
  return Number(single[1].replace(",", "."));
}

/** Extrae xG, forma, rachas y H2H. Solo escribe valores encontrados en el texto. */
export function extractKeyMetrics(
  text: string,
  homeName: string,
  awayName: string,
): TheAnalystAdvancedMetrics {
  const homeAliases = aliasesForTeam(homeName);
  const awayAliases = aliasesForTeam(awayName);
  let xgLocal: number | null = null;
  let xgVisitante: number | null = null;

  for (const match of text.matchAll(/\bxG\b/gi)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 180), index + 180);
    const value = xgFromContext(context);
    // xG de temporada/tipo de jugada (p. ej. "6.1 from set-pieces") no es xG
    // del partido: se descarta para no mezclar escalas distintas.
    if (
      value === null ||
      value <= 0 ||
      value > 5 ||
      /set[- ]piece|this season|this term|last season|average/i.test(context)
    ) {
      continue;
    }
    const homeDistance = distanceToName(context, homeAliases, 180);
    const awayDistance = distanceToName(context, awayAliases, 180);
    if (xgLocal === null && (homeDistance <= awayDistance || xgVisitante !== null)) {
      xgLocal = value;
    } else if (xgVisitante === null) {
      xgVisitante = value;
    }
  }

  const forms: string[] = [];
  let homeForm: string | null = null;
  let awayForm: string | null = null;
  for (const match of text.matchAll(/\b[WDL]\s*\d+\s*[Dd]\s*\d+\s*[Ll]\s*\d+\b/g)) {
    const parsed = parseForm(match[0]);
    if (!forms.includes(parsed)) forms.push(parsed);
    const index = match.index ?? 0;
    const sentence = sentenceAround(text, index);
    const local = index - sentence.start;
    const homeDistance = distanceIn(sentence.text, homeAliases, local);
    const awayDistance = distanceIn(sentence.text, awayAliases, local);
    if (!homeForm && (homeDistance <= awayDistance || awayDistance > 220)) homeForm = parsed;
    else if (!awayForm) awayForm = parsed;
  }

  const pairedXg =
    /xG[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*(?:-|–|—)\s*(\d+(?:[.,]\d+)?)/i.exec(text);
  if (pairedXg) {
    xgLocal = Number(pairedXg[1].replace(",", "."));
    xgVisitante = Number(pairedXg[2].replace(",", "."));
  }

  return {
    xg_local: xgLocal,
    xg_visitante: xgVisitante,
    forma_local: homeForm ?? forms[0] ?? null,
    forma_visitante: awayForm ?? forms[1] ?? null,
    racha_local: streakSentence(text, homeAliases),
    racha_visitante: streakSentence(text, awayAliases),
    h2h_resumen: h2hSentence(text),
  };
}

/** "Chelsea vs Leeds Prediction: Premier League Preview" -> equipos + liga. */
export function extractTeamsFromTitle(
  title: string,
): { home: string; away: string; liga: string | null } | null {
  const match =
    /^\s*(.+?)\s+(?:vs\.?|v|against)\s+(.+?)\s+(?:prediction|preview|stats|match|odds|result|report)\b[\s\S]*$/i.exec(
      title,
    );
  if (!match) return null;
  const clean = (value: string): string =>
    value
      .replace(/[:\-–—|]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const home = clean(match[1]);
  const away = clean(match[2]);
  if (!home || !away || home.length > 45 || away.length > 45) return null;

  const afterColon = title.split(":").slice(1).join(":").trim();
  const leagueFromTitle = afterColon
    ? afterColon
        .replace(/\b(preview|prediction|match report|stats)\b/gi, "")
        .replace(/[-–—\d]+$/, "")
        .trim() || null
    : null;
  return { home, away, liga: leagueFromTitle };
}

function resolveLiga(raw: Record<string, unknown>, fallback: string | null): string | null {
  if (fallback) return fallback;
  const yoast = raw.yoast_head_json;
  if (isRecord(yoast)) {
    const schema = yoast.schema;
    if (Array.isArray(schema)) {
      for (const item of schema) {
        if (isRecord(item) && Array.isArray(item.articleSection)) {
          const sections = item.articleSection.filter(
            (value): value is string => typeof value === "string",
          );
          const league = sections.find((value) => !/^football$/i.test(value.trim()));
          if (league) return league.trim();
        }
      }
    }
  }
  return null;
}

function resolveDate(raw: Record<string, unknown>): string {
  const value = raw.date_gmt ?? raw.date ?? raw.modified_gmt;
  if (typeof value === "string") {
    const parsed = new Date(value.endsWith("Z") ? value : `${value}Z`);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/** Normaliza un post de la REST API (o un objeto equivalente) a TheAnalystRecord. */
export function parseTheAnalystPost(
  raw: unknown,
  config: TheAnalystScrapeConfig = DEFAULT_THE_ANALYST_CONFIG,
): TheAnalystRecord | null {
  if (!isRecord(raw)) return null;
  const title = stripTags(String(getByPath(raw, config.jsonPaths.title) ?? raw.title ?? ""));
  const url = String(getByPath(raw, config.jsonPaths.link) ?? raw.link ?? "");
  if (!title) return null;

  const contentHtml = String(
    getByPath(raw, config.jsonPaths.content) ??
      (isRecord(raw.content) ? raw.content.rendered : "") ??
      "",
  );
  const text = htmlToText(contentHtml);
  const teams = extractTeamsFromTitle(title);
  const liga = resolveLiga(raw, teams?.liga ?? null);
  const bodyLine = text.split("\n").find((line) => line.length > 70) ?? null;
  const lowerTitle = title.toLowerCase();
  const tipo: TheAnalystRecord["tipo"] = /prediction/.test(lowerTitle)
    ? "match_preview"
    : /stats|match centre|preview/.test(lowerTitle)
      ? "stats"
      : "otro";

  let insight: TheAnalystMatchInsight | null = null;
  if (teams) {
    const probabilities = extractWinProbabilities(text, teams.home, teams.away);
    const metricas = extractKeyMetrics(text, teams.home, teams.away);
    const hasProbabilities = OUTCOMES.some((key) => probabilities[key] !== null);
    const hasMetrics =
      metricas.xg_local !== null ||
      metricas.xg_visitante !== null ||
      metricas.forma_local !== null ||
      metricas.forma_visitante !== null;
    if (hasProbabilities || hasMetrics) {
      const known = OUTCOMES.filter((key) => probabilities[key] !== null);
      const sum = known.reduce((acc, key) => acc + (probabilities[key] ?? 0), 0);
      const confianza: TheAnalystMatchInsight["confianza"] =
        known.length === 3 && sum > 0.95 && sum <= 1.02 && metricas.xg_local !== null
          ? "alta"
          : known.length >= 2 && sum > 0.8 && sum <= 1.02
            ? "media"
            : "baja";
      const date = resolveDate(raw);
      insight = {
        match_slug:
          date.slice(0, 10) && slugifyTeam(teams.home) && slugifyTeam(teams.away)
            ? `${date.slice(0, 10)}_${slugifyTeam(teams.home)}_vs_${slugifyTeam(teams.away)}`
            : null,
        fecha_partido: null,
        deporte: "Fútbol",
        liga,
        equipo_local: teams.home,
        equipo_visitante: teams.away,
        probabilidades: probabilities,
        metricas,
        resumen: bodyLine ? bodyLine.slice(0, 260) : null,
        metodo: "articulo",
        confianza,
      };
    }
  }

  return {
    articulo_id: String(getByPath(raw, config.jsonPaths.id) ?? raw.id ?? (url || title)),
    titulo: title,
    url,
    fecha_publicacion: resolveDate(raw),
    tipo,
    liga,
    equipo_local: teams?.home ?? null,
    equipo_visitante: teams?.away ?? null,
    resumen: bodyLine ? bodyLine.slice(0, 260) : null,
    insight,
    capturado_en: new Date().toISOString(),
    notas: null,
  };
}

function selectHtmlFragment(html: string, selector: string): string | null {
  if (/^link\b/i.test(selector)) {
    return (
      /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i.exec(html)?.[1] ??
      /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html)?.[1] ??
      null
    );
  }
  if (/^time\b/i.test(selector)) {
    return (
      /<time\b[^>]*datetime=["']([^"']+)/i.exec(html)?.[1] ??
      new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/time>`, "i").exec(html)?.[1] ??
      null
    );
  }
  const [rawTag, rawClass] = selector.split(".");
  const tag = rawTag || "[a-z]+";
  const pattern = rawClass
    ? new RegExp(
        `<${tag}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(rawClass)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag === "[a-z]+" ? "\\w+" : tag}>`,
        "i",
      )
    : new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return pattern.exec(html)?.[1] ?? null;
}

/** Convierte HTML (cuando la API JSON no está disponible) en un post parseable. */
export function parseArticleHtml(
  html: string,
  fallbackUrl: string,
  config: TheAnalystScrapeConfig = DEFAULT_THE_ANALYST_CONFIG,
): TheAnalystRecord | null {
  const selectors = config.htmlSelectors;
  const scope = selectHtmlFragment(html, selectors.article) ?? html;
  const title = stripTags(selectHtmlFragment(scope, selectors.title) ?? "");
  const content = selectHtmlFragment(scope, selectors.content) ?? scope;
  const link = selectHtmlFragment(html, selectors.link) ?? fallbackUrl;
  const date = selectHtmlFragment(scope, selectors.date) ?? new Date().toISOString();
  if (!title) return null;
  return parseTheAnalystPost(
    {
      id: link,
      title: { rendered: title },
      content: { rendered: content },
      link,
      date_gmt: date,
    },
    config,
  );
}

export function mergeConfig(
  overrides: Partial<TheAnalystScrapeConfig> = {},
): TheAnalystScrapeConfig {
  return {
    ...DEFAULT_THE_ANALYST_CONFIG,
    ...overrides,
    request: { ...DEFAULT_THE_ANALYST_CONFIG.request, ...overrides.request },
    query: { ...DEFAULT_THE_ANALYST_CONFIG.query, ...overrides.query },
    jsonPaths: { ...DEFAULT_THE_ANALYST_CONFIG.jsonPaths, ...overrides.jsonPaths },
    htmlSelectors: {
      ...DEFAULT_THE_ANALYST_CONFIG.htmlSelectors,
      ...overrides.htmlSelectors,
    },
  };
}

export function buildTheAnalystPayload(
  registros: TheAnalystRecord[],
  advertencias: string[] = [],
  fechaExtraccion: string = dateInVET(),
): TheAnalystPayload {
  return {
    target_app: "BetStats Pro",
    source: "the_analyst_agent",
    sync_mode: "enrich_or_create",
    fecha_extraccion: fechaExtraccion,
    zona_horaria: "America/Caracas",
    total_registros: registros.length,
    registros,
    advertencias,
  };
}

export type TheAnalystFetchOptions = {
  config?: Partial<TheAnalystScrapeConfig>;
  limit?: number;
  search?: string;
  /** Registros ya verificados que se usan solo si la red falla. */
  fallbackRecords?: TheAnalystRecord[];
  fetchImpl?: typeof fetch;
};

export type TheAnalystFetchResult = {
  payload: TheAnalystPayload;
  registro: { ok: boolean; advertencias: string[]; fuentes: number };
};

async function fetchJsonWithRetry(
  url: string,
  config: TheAnalystScrapeConfig,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.request.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.request.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: config.request.headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al consultar ${url}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Error desconocido de red");
}

/**
 * Descarga artículos desde la REST API de WordPress de The Analyst.
 * Ante un bloqueo (403/CDN) devuelve un payload vacío o los fallbackRecords,
 * siempre con una advertencia: nunca genera probabilidades inventadas.
 */
export async function fetchTheAnalyst(
  options: TheAnalystFetchOptions = {},
): Promise<TheAnalystFetchResult> {
  const config = mergeConfig(options.config);
  const fetchImpl = options.fetchImpl ?? fetch;
  const search = options.search ?? config.query.search;
  const limit = Math.max(1, Math.min(100, options.limit ?? config.query.perPage));
  const advertencias: string[] = [];
  const registros: TheAnalystRecord[] = [];

  try {
    const url = new URL(config.apiBaseUrl);
    url.searchParams.set("search", search);
    url.searchParams.set("per_page", String(limit));
    url.searchParams.set("orderby", config.query.orderBy);
    url.searchParams.set("order", config.query.order);
    url.searchParams.set("_fields", "id,date,date_gmt,link,slug,title,content,excerpt,yoast_head_json");
    const rawItems = await fetchJsonWithRetry(url.toString(), config, fetchImpl);
    const itemsPath = config.jsonPaths.items;
    const items = itemsPath ? getByPath(rawItems, itemsPath) : rawItems;
    if (!Array.isArray(items)) {
      throw new Error("La respuesta JSON de The Analyst no contiene una lista de artículos");
    }
    for (const item of items.slice(0, limit)) {
      const record = parseTheAnalystPost(item, config);
      if (record) registros.push(record);
    }
    if (registros.length === 0) {
      advertencias.push("The Analyst respondió sin artículos parseables con la búsqueda solicitada.");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    advertencias.push(`The Analyst no accesible desde el servidor (${detail}). No se inventaron métricas.`);
  }

  if (registros.length === 0 && options.fallbackRecords?.length) {
    registros.push(...options.fallbackRecords);
    advertencias.push("Se usaron registros de respaldo verificados por fallo de red/CDN.");
  }

  return {
    payload: buildTheAnalystPayload(registros, advertencias),
    registro: { ok: advertencias.length === 0, advertencias, fuentes: registros.length },
  };
}
