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

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(fc|cf|sc|afc|club|de|del|the|real|sporting|atletico|athletic|city|united|utd|town|county|ac|bc|basket|basketball|hockey|baseball)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function namesLikelyMatch(first: string, second: string): boolean {
  const a = normalizeName(first);
  const b = normalizeName(second);

  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));

  if (aTokens.size === 0 || bTokens.size === 0) return false;

  let common = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) common += 1;
  }

  return common / Math.min(aTokens.size, bTokens.size) >= 0.5;
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
