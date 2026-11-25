export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Normaliza para comparación, SIN eliminar tokens identificadores.
 * `real`, `atletico`, `city`, `united` y `utd` son parte de la identidad del
 * equipo: eliminarlos colapsaba Real Madrid/Atlético y City/United en el mismo
 * key, contaminando cruces de cuotas, tablas y lesiones.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|cf|sc|afc|club|de|del|the|ac|bc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenMatches(token: string, candidates: Set<string>): boolean {
  if (candidates.has(token)) return true;
  // Abreviatura tipo "man" -> "manchester", solo si es suficientemente específica.
  if (token.length < 3) return false;
  for (const candidate of candidates) {
    if (candidate.length >= 4 && (candidate.startsWith(token) || token.startsWith(candidate))) {
      return true;
    }
  }
  return false;
}

function namesLikelyMatchNormalized(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const aTokens = a.split(" ").filter((token) => token.length > 2);
  const bTokens = b.split(" ").filter((token) => token.length > 2);
  if (aTokens.length === 0 || bTokens.length === 0) return false;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let common = 0;
  for (const token of aSet) {
    if (bSet.has(token)) common += 1;
  }

  // Coincidencia total de tokens con el mismo tamaño (alias del mismo equipo).
  if (common === aSet.size && common === bSet.size) return true;
  // Un nombre explícitamente más corto sólo vale si es suficientemente largo
  // y no es un subtoken de un rival con sufijo (B, U23, Femenino...).
  const shorterFirst = aTokens.length <= bTokens.length;
  const shorterStr = shorterFirst ? a : b;
  const longerStr = shorterFirst ? b : a;
  const shorterTokens = shorterFirst ? aTokens : bTokens;
  const longerTokens = shorterFirst ? bTokens : aTokens;
  if (shorterStr.length >= 6 && longerStr.startsWith(`${shorterStr} `) && longerTokens.length - shorterTokens.length <= 1) {
    return true;
  }

  // Alias abreviado: todos los tokens del nombre corto deben coincidir por
  // igualdad o prefijo no ambiguo en el largo (p. ej. Man City/Manchester City).
  if (shorterTokens.length >= 2) {
    const longerSet = new Set(longerTokens);
    const allMatch = shorterTokens.every((token) => tokenMatches(token, longerSet));
    if (allMatch) return true;
  }

  return common >= 2 && common / Math.min(aSet.size, bSet.size) >= 0.7;
}

export function namesLikelyMatch(first: string, second: string): boolean {
  return namesLikelyMatchNormalized(normalizeName(first), normalizeName(second));
}

/**
 * Normalizador con caché para cruces que repiten los mismos nombres en cada
 * comparación (cientos de partidos × decenas de cotizaciones).
 */
export function createNameNormalizer(): (value: string) => string {
  const cache = new Map<string, string>();
  return (value: string) => {
    let normalized = cache.get(value);
    if (normalized === undefined) {
      normalized = normalizeName(value);
      cache.set(value, normalized);
    }
    return normalized;
  };
}

/**
 * Comparador con caché: la normalización NFD/regex y el cálculo de tokens se
 * hacen una sola vez por par de nombres, no por cada comparación del cruce.
 */
export function createNameMatcher(): (first: string, second: string) => boolean {
  const normalize = createNameNormalizer();
  const pairs = new Map<string, boolean>();
  return (first: string, second: string) => {
    const a = normalize(first);
    const b = normalize(second);
    const key = a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    const cached = pairs.get(key);
    if (cached !== undefined) return cached;
    const result = namesLikelyMatchNormalized(a, b);
    pairs.set(key, result);
    return result;
  };
}

/** Nombre canónico de casa para dedupe económico entre proveedores. */
export function canonicalBookmakerName(name: string, source?: string): string {
  let normalized = normalizeName(name.replace(/\*/g, ""));
  if (source) {
    const prefix = normalizeName(source);
    if (normalized.startsWith(prefix)) normalized = normalized.slice(prefix.length).trim();
  }
  return normalized || normalizeName(name);
}

export function initials(name: string): string {
  const clean = name
    .replace(
      /\b(fc|cf|sc|afc|club|the|de|del|real|atletico|athletic)\b/gi,
      " ",
    )
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function slugify(value: string): string {
  return normalizeName(value).replace(/\s+/g, "-");
}
