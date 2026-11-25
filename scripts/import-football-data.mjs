import fs from "node:fs";
import path from "node:path";

const LEAGUE_MAP = {
  E0: "EPL",
  E1: "EFL Championship",
  SP1: "LaLiga",
  I1: "Serie A",
  D1: "Bundesliga",
  F1: "Ligue 1",
};

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length === 0) continue;
    const row = {};
    for (let j = 0; j < headers.length; j += 1) row[headers[j]] = cols[j] ?? "";
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseDate(value) {
  // football-data: dd/mm/yyyy or dd/mm/yy
  const m = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}T00:00:00.000Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? iso : null;
}

function num(value) {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function pickClosingOdds(row) {
  const candidates = [
    ["PSCH", "PSCD", "PSCA"], // Pinnacle closing
    ["B365CH", "B365CD", "B365CA"], // Bet365 closing
    ["AvgCH", "AvgCD", "AvgCA"], // market avg closing
    ["B365H", "B365D", "B365A"], // opening fallback
  ];
  for (const [h, d, a] of candidates) {
    const home = num(row[h]);
    const draw = num(row[d]);
    const away = num(row[a]);
    if (home > 1 && draw > 1 && away > 1) return { home, draw, away };
  }
  return undefined;
}

function mapRow(row, sourceFile) {
  const date = parseDate(row.Date);
  const home = String(row.HomeTeam ?? "").trim();
  const away = String(row.AwayTeam ?? "").trim();
  const homeGoals = num(row.FTHG);
  const awayGoals = num(row.FTAG);
  if (!date || !home || !away || homeGoals === null || awayGoals === null) return null;
  if (homeGoals < 0 || awayGoals < 0) return null;
  const div = String(row.Div ?? "").trim();
  const leagueId = LEAGUE_MAP[div] ?? (div || undefined);
  const id = `${leagueId ?? "UNK"}:${date.slice(0, 10)}:${home}:${away}`.replace(/\s+/g, "_");
  const closingOdds = pickClosingOdds(row);
  const out = { id, date, home, away, homeGoals, awayGoals };
  if (leagueId) out.leagueId = leagueId;
  if (closingOdds) out.closingOdds = closingOdds;
  out.source = path.basename(sourceFile);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/import-football-data.mjs <csv...> --out data/historical-results.json");
    process.exit(1);
  }
  let outPath = path.join(process.cwd(), "data", "historical-results.json");
  const inputs = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out") {
      outPath = path.resolve(process.cwd(), args[i + 1] ?? outPath);
      i += 1;
    } else {
      inputs.push(path.resolve(process.cwd(), arg));
    }
  }

  const all = [];
  for (const input of inputs) {
    const text = fs.readFileSync(input, "utf8");
    const rows = parseCsv(text);
    for (const row of rows) {
      const mapped = mapRow(row, input);
      if (mapped) all.push(mapped);
    }
    console.log(`${path.basename(input)}: ${rows.length} rows -> ${all.length} cumulative valid`);
  }

  // dedupe by id, keep last
  const byId = new Map();
  for (const row of all) byId.set(row.id, row);
  const deduped = [...byId.values()].sort((a, b) => {
    const delta = Date.parse(a.date) - Date.parse(b.date);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(deduped, null, 2)}\n`, "utf8");
  console.log(`Wrote ${deduped.length} matches to ${outPath}`);
  const withOdds = deduped.filter((r) => r.closingOdds).length;
  console.log(`with closingOdds: ${withOdds}/${deduped.length}`);
}

main();
